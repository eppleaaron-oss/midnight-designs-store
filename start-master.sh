#!/usr/bin/env bash
set -euo pipefail
owner_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Install Python first: sudo apt install python3'
  exit 1
fi
if [ ! -f "$owner_root/master.html" ]; then
  echo 'Keep this launcher inside the Midnight Designs project folder.'
  exit 1
fi
exec python3 - "$owner_root" <<'PY'
import http.server, os, pathlib, subprocess, sys, urllib.parse, json, secrets, threading, tempfile, time
root = pathlib.Path(sys.argv[1]).resolve()
owner_token = secrets.token_hex(32)
catalog_lock = threading.Lock()
class OwnerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def allowed(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        parts = pathlib.PurePosixPath(path).parts
        target = (root / path.lstrip('/')).resolve()
        if any(part.startswith('.') for part in parts if part != '/') or not target.is_relative_to(root) or target.is_dir():
            self.send_error(404)
            return False
        return True
    def respond(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def trusted(self):
        expected = 'http://127.0.0.1:%s' % self.server.server_port
        return self.headers.get('Host') == expected[7:] and self.headers.get('Origin', expected) == expected and self.headers.get('Sec-Fetch-Site', 'same-origin') in ('same-origin', 'none')
    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == '/api/local-owner/session':
            if not self.trusted(): return self.respond(403, {'error':'Origin rejected.'})
            return self.respond(200, {'token':owner_token})
        if self.allowed(): super().do_GET()
    def do_POST(self):
        if self.path != '/api/owner/delete-design': return self.respond(404, {'error':'Not found.'})
        expected = 'http://127.0.0.1:%s' % self.server.server_port
        if not self.trusted() or self.headers.get('Origin') != expected or self.headers.get('Authorization') != 'Bearer '+owner_token:
            return self.respond(403, {'error':'Owner session rejected. Reopen the dashboard.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096: return self.respond(400, {'error':'Invalid deletion request.'})
            data = json.loads(self.rfile.read(length))
            if data.get('confirm') is not True or not isinstance(data.get('designId'), str):
                return self.respond(400, {'error':'Confirm the design to delete.'})
            with catalog_lock:
                catalog_file = root / 'designs.json'
                before = catalog_file.read_bytes()
                catalog = json.loads(before)
                if not isinstance(catalog, list): raise ValueError('Invalid catalog')
                after = [d for d in catalog if d['id'] != data['designId']]
                if len(after) == len(catalog): return self.respond(404, {'error':'Design already removed. Refresh the page.'})
                backups = root / '.catalog-backups'
                backups.mkdir(exist_ok=True, mode=0o700)
                (backups / ('designs-'+str(time.time_ns())+'.json')).write_bytes(before)
                with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.designs-', delete=False) as output:
                    json.dump(after, output, indent=2); output.write('\n'); output.flush(); os.fsync(output.fileno()); temp_path=output.name
                os.replace(temp_path, catalog_file)
            return self.respond(200, {'ok':True,'designId':data['designId'],'deploymentPending':False})
        except (ValueError, KeyError, OSError):
            return self.respond(500, {'error':'Could not save the deletion. Your design has not been removed.'})
    def do_HEAD(self):
        if self.allowed(): super().do_HEAD()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args): pass
with http.server.ThreadingHTTPServer(('127.0.0.1', 0), OwnerHandler) as server:
    url = 'http://127.0.0.1:%s/master.html' % server.server_port
    print('\nMidnight Designs — local owner dashboard\n'+url+'\nKeep this terminal open. Press Ctrl+C to stop.\n', flush=True)
    if os.environ.get('MIDNIGHT_NO_BROWSER') != '1':
        try:
            subprocess.Popen(['xdg-open', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            print('Copy the address above into Chrome.', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nDashboard stopped.', flush=True)
PY
