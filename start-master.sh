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
import http.server, os, pathlib, subprocess, sys, urllib.parse
root = pathlib.Path(sys.argv[1]).resolve()
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
    def do_GET(self):
        if self.allowed(): super().do_GET()
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
