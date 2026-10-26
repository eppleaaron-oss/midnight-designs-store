import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {mkdtemp,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GithubSnapshotStore,githubBackupConfig,factoryGithubBackups,prepareGithubRecovery} from './factory-github-backup.mjs';
import {githubWorkingFixture} from './factory-github-fixture.mjs';
import {durableQueueStorage} from './factory-storage.mjs';
import {createService} from './server.mjs';

const config={repo:'owner/private-data',token:'private-fixture-token',key:Buffer.alloc(32,17),maxBytes:32*1024*1024,interval:60000};
const objectHash=b=>{const bytes=Buffer.from(b);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');};
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
function github(){
 const working=githubWorkingFixture();
 const blobs=new Map(),trees=new Map([['b'.repeat(40),new Map()]]),commits=new Map([['a'.repeat(40),{tree:{sha:'b'.repeat(40)},parents:[]}]]),calls=[];
 const g={head:'a'.repeat(40),private:true,blobs,trees,commits,calls,rate:false,conflict:false,failRef:false,dropResponse:false,failReads:false,releases:working.releases,assets:working.assets};
 g.fetch=async(url,options={})=>{
  if(new URL(url).pathname.includes('/releases')){working.private=g.private;return working.fetch(url,options);}assert.equal(options.headers.Authorization,'Bearer '+config.token);const u=new URL(url);assert.equal(u.origin,'https://api.github.com');const path=u.pathname.slice('/repos/owner/private-data'.length),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
  if(g.rate)return reply({message:'Do not surface secret provider responses'},429,{'retry-after':'120'});
  if(g.failReads&&method==='GET')throw Error('Sensitive network detail');
  if(path==='')return reply({id:123,private:g.private,visibility:g.private?'private':'public',default_branch:'main',size:g.size||2});
  if(path==='/git/ref/heads/main'){if(g.staleReads>0){g.staleReads--;return reply({object:{sha:g.staleHead}});}return reply({object:{sha:g.head}});}
  if(path.startsWith('/git/commits/')&&method==='GET')return reply(commits.get(path.split('/').at(-1)));
  if(path==='/contents/factory-backup/latest.enc'){const commit=commits.get(u.searchParams.get('ref')),tree=trees.get(commit.tree.sha),sha=tree.get('factory-backup/latest.enc');if(!sha)return reply({message:'Not Found'},404);const data=blobs.get(sha),download=g.alteredContents?Buffer.from(data.toString('utf8')):data;return reply({sha,encoding:'base64',content:download.toString('base64'),size:download.length});}
  if(path.startsWith('/git/blobs/')&&method==='GET'){const data=blobs.get(path.split('/').at(-1));return reply({encoding:'base64',content:data.toString('base64'),size:data.length});}
  if(path==='/git/blobs'&&method==='POST'){const data=Buffer.from(body.content,'base64'),sha=objectHash(data);blobs.set(sha,data);return reply({sha});}
  if(path==='/git/trees'&&method==='POST'){assert.equal(new Set(body.tree.map(t=>t.path)).size,body.tree.length,'No duplicate tree paths');const next=new Map(trees.get(body.base_tree));for(const t of body.tree){if(t.sha===null){assert.ok(next.has(t.path));next.delete(t.path);}else{assert.ok(blobs.has(t.sha));next.set(t.path,t.sha);}}const sha=objectHash(JSON.stringify([...next]));trees.set(sha,next);return reply({sha});}
  if(path==='/git/commits'&&method==='POST'){const sha=objectHash(JSON.stringify(body));commits.set(sha,{tree:{sha:body.tree},parents:body.parents});return reply({sha});}
  if(path==='/git/refs/heads/main'&&method==='PATCH'){
   assert.equal(body.force,false);if(g.failRef)return reply({},500);if(g.conflict)return reply({},422);if(body.sha!==g.head&&!commits.get(body.sha).parents.includes(g.head))return reply({},409);g.staleHead=g.head;g.head=body.sha;g.staleReads=g.staleReadsAfterWrite||0;
   if(g.dropResponse){g.dropResponse=false;throw Error('Lost acknowledgement');}return reply({object:{sha:g.head}});
  }
  throw Error('Unexpected fixture API: '+method+' '+path);
 };return g;
}
async function fixture(t,{large=false}={}){const dir=await mkdtemp(join(tmpdir(),'midnight-backup-test-')),path=join(dir,'source.sqlite'),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE factory_artwork(id TEXT PRIMARY KEY,data BLOB); CREATE TABLE factory_jobs(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE requests(id TEXT,name TEXT);');const artwork=large?randomBytes(8*1024*1024):Buffer.from('private-original-artwork');db.prepare('INSERT INTO factory_artwork VALUES(?,?)').run('raven',artwork);db.prepare('INSERT INTO factory_jobs VALUES(?,?)').run('outfit-1','awaiting_review');db.prepare('INSERT INTO requests VALUES(?,?)').run('request-1','private customer name');t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});const gh=github(),sleeps=[],store=new GithubSnapshotStore(config,{fetchImpl:gh.fetch,sleep:async n=>sleeps.push(n)});return {dir,path,db,artwork,gh,store,sleeps};}

test('whole SQLite snapshot restores artwork BLOBs, customer records and jobs after deleting the working database',async t=>{
 const f=await fixture(t);await assert.rejects(f.store.snapshot(f.db),/first backup explicitly/);const saved=await f.store.snapshot(f.db,{initialize:true});assert.equal(saved.commit,f.gh.head);assert.ok(f.sleeps.some(ms=>ms>0));
 for(const data of f.gh.blobs.values()){assert.equal(data.includes('private customer name'),false);assert.equal(data.includes('private-original-artwork'),false);assert.notEqual(data.subarray(0,16).toString(),'SQLite format 3\0');}
 const restored=join(f.dir,'after-restart.sqlite'),newStore=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch,sleep:async()=>{}});await newStore.restore(restored);const db=new DatabaseSync(restored);try{assert.deepEqual(Buffer.from(db.prepare('SELECT data FROM factory_artwork').get().data),f.artwork);assert.equal(db.prepare('SELECT status FROM factory_jobs').get().status,'awaiting_review');assert.equal(db.prepare('SELECT name FROM requests').get().name,'private customer name');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}
 assert.equal(durableQueueStorage(restored),false,'A GitHub snapshot does not bypass durable queue requirements');
});
test('release recovery retries a transient chunk metadata failure but still authenticates exact restored bytes',async t=>{
 const f=await fixture(t),writer=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.snapshot(f.db,{initialize:true});
 const asset=writer.manifest.chunks[0].asset;let interrupted=false,attempts=0;const waits=[];
 const fetchImpl=async(url,options)=>{if(new URL(url).pathname.endsWith('/releases/assets/'+asset)&&options?.headers?.Accept==='application/vnd.github+json'){attempts++;if(!interrupted){interrupted=true;throw Error('temporary private transport detail');}}return f.gh.fetch(url,options);};
 const reader=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl,sleep:async ms=>waits.push(ms)}),dest=join(f.dir,'retry-release.sqlite');await reader.restore(dest);assert.equal(attempts,2);assert.deepEqual(waits,[1000]);const restored=new DatabaseSync(dest);try{assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM factory_artwork').get().data),f.artwork);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{restored.close();}
});
test('unchanged snapshots make no new commit; large unchanged artwork chunks are reused after a job changes',async t=>{
 const f=await fixture(t,{large:true});await f.store.snapshot(f.db,{initialize:true});const original=f.store.manifest.chunks,head=f.gh.head,count=f.gh.calls.filter(c=>c.method!=='GET').length;assert.ok(original.length>=3);
 const same=await f.store.snapshot(f.db);assert.equal(same.unchanged,true);assert.equal(f.gh.head,head);assert.equal(f.gh.calls.filter(c=>c.method!=='GET').length,count);
 f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');await f.store.snapshot(f.db);assert.notEqual(f.gh.head,head);assert.ok(f.store.manifest.chunks.some(c=>original.some(old=>old.sha===c.sha)),'Stable artwork is not uploaded again');
});
test('public repository is refused before uploading or downloading private data',async t=>{
 const f=await fixture(t);f.gh.private=false;await assert.rejects(f.store.snapshot(f.db,{initialize:true}),/private GitHub repository/);assert.equal(f.gh.calls.some(c=>c.method!=='GET'),false);await assert.rejects(f.store.restore(join(f.dir,'no.sqlite')),/private GitHub repository/);
 f.gh.private=true;await f.store.snapshot(f.db,{initialize:true});f.gh.private=false;await assert.rejects(f.store.snapshot(f.db),/private GitHub repository/);
});
test('wrong key and damaged chunks stop recovery without creating a partial database',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const dest=join(f.dir,'recovery.sqlite'),wrong=new GithubSnapshotStore({...config,key:Buffer.alloc(32,3)},{fetchImpl:f.gh.fetch});await assert.rejects(wrong.restore(dest),/authentication failed/);await assert.rejects(stat(dest),{code:'ENOENT'});
 const chunk=f.store.manifest.chunks[0];f.gh.blobs.get(chunk.sha)[30]^=1;await assert.rejects(f.store.restore(dest),/could not be verified/);await assert.rejects(stat(dest),{code:'ENOENT'});
});
test('an altered contents download recovers through the immutable verified Git blob',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});f.gh.alteredContents=true;
 const reader=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch}),dest=join(f.dir,'verified-transport.sqlite');await reader.restore(dest);
 const restored=new DatabaseSync(dest);try{assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM factory_artwork').get().data),f.artwork);}finally{restored.close();}
 assert.ok(f.gh.calls.some(c=>c.path==='/git/blobs/'+f.gh.trees.get(f.gh.commits.get(f.gh.head).tree.sha).get('factory-backup/latest.enc')));
});
test('corrupt manifest bytes fail the Git checksum before blaming the encryption key',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const id=f.gh.trees.get(f.gh.commits.get(f.gh.head).tree.sha).get('factory-backup/latest.enc');f.gh.blobs.get(id)[30]^=1;
 const reader=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch}),dest=join(f.dir,'corrupt-manifest.sqlite');await assert.rejects(reader.restore(dest),/Git checksum/);await assert.rejects(stat(dest),{code:'ENOENT'});
});
test('recovery never overwrites a current local database',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const dest=join(f.dir,'existing.sqlite');await writeFile(dest,'current private data');await assert.rejects(f.store.restore(dest),/will not replace/);assert.equal(await readFile(dest,'utf8'),'current private data');
});
test('a GitHub conflict preserves the old branch and prevents further backup writes',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const head=f.gh.head;f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');f.gh.conflict=true;await assert.rejects(f.store.snapshot(f.db),/existing snapshot was preserved/);assert.equal(f.gh.head,head);assert.equal(f.store.hold,true);const count=f.gh.calls.length;await assert.rejects(f.store.snapshot(f.db),/owner review/);assert.equal(f.gh.calls.slice(count).some(c=>c.method!=='GET'),false);
});
test('an acknowledged checkpoint tolerates stale parent reads without declaring a competing backend',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});f.db.prepare('UPDATE factory_jobs SET status=?').run('disapproved');f.gh.staleReadsAfterWrite=3;
 const result=await f.store.snapshot(f.db);assert.equal(result.commit,f.gh.head);assert.equal(f.store.hold,false);await f.store.assertCurrent();
 const writes=f.gh.calls.filter(c=>c.method==='PATCH').length;await f.store.snapshot(f.db);assert.equal(f.gh.calls.filter(c=>c.method==='PATCH').length,writes,'confirmation retries never write another checkpoint');
});
test('a longer confirmation delay stays retryable and recovers the same accepted checkpoint',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});f.db.prepare('UPDATE factory_jobs SET status=?').run('disapproved');f.gh.staleReadsAfterWrite=8;
 await assert.rejects(f.store.snapshot(f.db),e=>e.confirmationPending===true);assert.equal(f.store.hold,false);const accepted=f.gh.head,writes=f.gh.calls.filter(c=>c.method==='PATCH').length;
 f.gh.staleReads=0;const saved=await f.store.snapshot(f.db);assert.equal(saved.commit,accepted);assert.equal(saved.unchanged,true);assert.equal(f.gh.calls.filter(c=>c.method==='PATCH').length,writes);
 f.gh.head='c'.repeat(40);await assert.rejects(f.store.assertCurrent(),e=>e.conflict===true);assert.equal(f.store.hold,true,'a genuinely different ref still blocks further external operations');
});
test('temporary errors retry with bounded waits and failed commits never become successful backups',async t=>{
 const f=await fixture(t);f.gh.failRef=true;await assert.rejects(f.store.snapshot(f.db,{initialize:true}),/HTTP 500/);assert.equal(f.store.manifest,null);assert.equal(f.gh.head,'a'.repeat(40));assert.equal(f.gh.calls.filter(c=>c.method==='PATCH').length,3);f.gh.failRef=false;f.gh.dropResponse=true;await f.store.snapshot(f.db,{initialize:true});assert.equal(f.store.head,f.gh.head);
});
test('rate limits set a retry time without exposing provider responses or claiming success',async t=>{
 const f=await fixture(t);f.gh.rate=true;const before=Date.now();await assert.rejects(f.store.snapshot(f.db,{initialize:true}),e=>e.retryAt>=before+120000&&!e.message.includes('secret provider'));assert.equal(f.gh.calls.length,1);assert.equal(f.store.manifest,null);
});
test('missing backups stop automatic restart recovery; disabled GitHub configuration does not affect normal startup',async t=>{
 const f=await fixture(t),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token,FACTORY_BACKUP_ENCRYPTION_KEY:config.key.toString('hex')},dest=join(f.dir,'missing.sqlite');await assert.rejects(prepareGithubRecovery({dbPath:dest,env,settings:{fetchImpl:f.gh.fetch}}),/instead of creating an empty workspace/);await assert.rejects(stat(dest),{code:'ENOENT'});assert.equal(await prepareGithubRecovery({dbPath:dest,env:{}}),null);
 await f.store.snapshot(f.db,{initialize:true});await prepareGithubRecovery({dbPath:dest,env,settings:{fetchImpl:f.gh.fetch}});assert.ok((await stat(dest)).size>0);
});
test('backup size limits hold oversized local data before upload',async t=>{
 const f=await fixture(t),store=new GithubSnapshotStore({...config,maxBytes:512},{fetchImpl:f.gh.fetch});await assert.rejects(store.snapshot(f.db,{initialize:true}),/size limit/);assert.equal(f.gh.calls.some(c=>c.method!=='GET'),false);
});
test('fresh initialization needs an exact empty-repository commit pin and cannot be reused after the first save',async t=>{
 const f=await fixture(t),dest=join(f.dir,'new-workspace.sqlite'),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token,FACTORY_BACKUP_ENCRYPTION_KEY:config.key.toString('hex'),FACTORY_BACKUP_INITIALIZE_FROM_COMMIT:'c'.repeat(40)};
 await assert.rejects(prepareGithubRecovery({dbPath:dest,env,settings:{fetchImpl:f.gh.fetch}}),/instead of creating an empty workspace/);env.FACTORY_BACKUP_INITIALIZE_FROM_COMMIT=f.gh.head;
 const store=await prepareGithubRecovery({dbPath:dest,env,settings:{fetchImpl:f.gh.fetch,sleep:async()=>{}}});assert.equal(store.initializeBeforeListen,true);await assert.rejects(stat(dest),{code:'ENOENT'});await store.snapshot(f.db,{initialize:true});assert.notEqual(f.gh.head,env.FACTORY_BACKUP_INITIALIZE_FROM_COMMIT);
 const head=f.gh.head,commit=f.gh.commits.get(head),tree=f.gh.trees.get(commit.tree.sha);tree.delete('factory-backup/latest.enc');await assert.rejects(prepareGithubRecovery({dbPath:dest,env,settings:{fetchImpl:f.gh.fetch}}),/instead of creating an empty workspace/);
});
test('owner-only backup controls require the same origin and status reports confirmed commits',async t=>{
 const f=await fixture(t),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token,FACTORY_BACKUP_ENCRYPTION_KEY:config.key.toString('hex')};let result;
 const service=factoryGithubBackups({db:f.db,dbPath:f.path,env,store:f.store,autoStart:false,origin:'https://factory.test',auth(req){if(!req.owner)throw Object.assign(Error('Owner required'),{status:401});},body:async req=>req.body||{},send(_res,status,data){result={status,data};},fail(status,message){throw Object.assign(Error(message),{status});},limit(){}});t.after(()=>service.close());
 await assert.rejects(service.handle({}, {},'/api/owner/ai-factory/storage','GET'),e=>e.status===401);await assert.rejects(service.handle({owner:true,headers:{origin:'https://evil.test'}},{},'/api/owner/ai-factory/storage/backup','POST'),e=>e.status===403);
 await service.handle({owner:true},{},'/api/owner/ai-factory/storage','GET');assert.equal(result.data.lastSaved,null);assert.equal(result.data.liveQueueStorage,false);const pending=service.save(true);assert.equal(service.snapshot().running,true);assert.equal(service.snapshot().lastSaved,null);await pending;assert.equal(service.snapshot().running,false);assert.equal(service.snapshot().commit,f.gh.head);assert.equal(service.snapshot().unsavedChanges,false);f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');assert.equal(service.snapshot().unsavedChanges,true);await service.tick();assert.equal(service.snapshot().unsavedChanges,false);
});
test('configuration derives stable encryption from backend credentials and rejects invalid keys and paths',()=>{
 const hash='ab'.repeat(16)+':'+'cd'.repeat(64),env={FACTORY_BACKUP_REPO:config.repo,CATALOG_GITHUB_TOKEN:config.token};assert.deepEqual(githubBackupConfig(env,hash).key,githubBackupConfig(env,hash).key);assert.notDeepEqual(githubBackupConfig(env,hash).key,githubBackupConfig(env,'ef'.repeat(16)+':'+'cd'.repeat(64)).key);assert.equal(githubBackupConfig({}),null);for(const bad of [{...env,FACTORY_BACKUP_REPO:'https://github.com/public/repo'},{...env,FACTORY_BACKUP_ENCRYPTION_KEY:'invalid'},{...env,FACTORY_BACKUP_INTERVAL_SECONDS:'1'},{...env,CATALOG_GITHUB_TOKEN:''}])assert.throws(()=>githubBackupConfig(bad,hash));
});
test('an added explicit key recovers an original owner-derived snapshot without discarding encryption or data',async t=>{
 const f=await fixture(t),passwordHash='ab'.repeat(16)+':'+'cd'.repeat(64),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token};
 const original=githubBackupConfig(env,passwordHash),writer=new GithubSnapshotStore(original,{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.snapshot(f.db,{initialize:true});
 const changed=githubBackupConfig({...env,FACTORY_BACKUP_ENCRYPTION_KEY:'ef'.repeat(32)},passwordHash),reader=new GithubSnapshotStore(changed,{fetchImpl:f.gh.fetch,sleep:async()=>{}}),dest=join(f.dir,'compatible-key.sqlite');
 await reader.restore(dest);assert.equal(reader.keySource,'original backend owner hash');assert.deepEqual(reader.key,original.key);const restored=new DatabaseSync(dest);try{assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM factory_artwork').get().data),f.artwork);}finally{restored.close();}
 const wrong=githubBackupConfig({...env,FACTORY_BACKUP_ENCRYPTION_KEY:'ef'.repeat(32)},'12'.repeat(16)+':'+'34'.repeat(64));await assert.rejects(new GithubSnapshotStore(wrong,{fetchImpl:f.gh.fetch}).restore(join(f.dir,'wrong.sqlite')),/authentication failed/);await assert.rejects(stat(join(f.dir,'wrong.sqlite')),{code:'ENOENT'});
});

test('changed backend credentials fail closed and errors contain only a one-way fingerprint',async t=>{
 const f=await fixture(t),passwordHash='ab'.repeat(16)+':'+'cd'.repeat(64),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token};
 const writer=new GithubSnapshotStore(githubBackupConfig(env,passwordHash),{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.snapshot(f.db,{initialize:true});
 const changed='12'.repeat(16)+':'+'34'.repeat(64),wrong=new GithubSnapshotStore(githubBackupConfig(env,changed),{fetchImpl:f.gh.fetch});await assert.rejects(wrong.connect(),e=>{assert.match(e.message,/owner-hash fingerprint/);assert.ok(!e.message.includes(changed));assert.ok(!e.message.includes(config.token));return /authentication failed/.test(e.message);});
});

test('real authenticated backend saves and recovers its complete schema, with private routes and assets protected',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'midnight-full-recovery-')),gh=github(),store=new GithubSnapshotStore(config,{fetchImpl:gh.fetch,sleep:async()=>{}}),origin='http://127.0.0.1:3039',password='backup-local-fixture',salt='bc'.repeat(16),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex'),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token,FACTORY_BACKUP_ENCRYPTION_KEY:config.key.toString('hex')};
 const service=createService({dbPath:join(dir,'original.sqlite'),origin,passwordHash,secure:false,backupSettings:{env,store,autoStart:false}});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(async()=>{await service.githubBackups.close();await new Promise(r=>service.server.close(r));await rm(dir,{recursive:true,force:true});});const url='http://127.0.0.1:'+service.server.address().port;
 const send=async(path,data,cookie,from=origin)=>fetch(url+path,{method:data?'POST':'GET',headers:{Origin:from,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
 assert.equal((await send('/api/owner/ai-factory/storage')).status,401);assert.equal((await send('/factory-storage.js')).status,401);
 const login=await send('/api/owner/login',{password}),cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(cookie);assert.equal((await send('/api/owner/ai-factory/storage/backup',{initialize:true},cookie,'https://evil.test')).status,403);assert.equal((await send('/factory-storage.js',null,cookie)).status,200);
 const response=await send('/api/owner/ai-factory/storage/backup',{initialize:true},cookie);assert.equal(response.status,202);await service.githubBackups.save(true);const status=await (await send('/api/owner/ai-factory/storage',null,cookie)).json();assert.equal(status.commit,gh.head);assert.ok(status.lastSaved);assert.equal(status.liveQueueStorage,false);assert.equal(JSON.stringify(status).includes(config.token),false);
 const restored=join(dir,'restored.sqlite');await new GithubSnapshotStore(config,{fetchImpl:gh.fetch}).restore(restored);const db=new DatabaseSync(restored,{readOnly:true});try{const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));for(const name of ['factory_artwork','factory_print_files','factory_mockup_tasks','factory_mockups','factory_jobs','requests','sessions','factory_editor_provider'])assert.ok(tables.has(name),name+' is included');assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);}finally{db.close();}
});

test('a changed remote checkpoint holds the old backend before another side effect',async t=>{const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});f.gh.head='c'.repeat(40);const before=f.gh.calls.filter(c=>c.method!=='GET').length;await assert.rejects(f.store.assertCurrent(),/changed on another backend/);assert.equal(f.store.hold,true);assert.equal(f.gh.calls.filter(c=>c.method!=='GET').length,before);});


test('an over-limit history still restores the legacy snapshot without making any writes',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});f.gh.size=1024*1024+1;const count=f.gh.calls.length;const reader=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch,sleep:async()=>{}}),path=join(f.dir,'full-history.sqlite');await reader.restore(path);assert.equal(f.gh.calls.slice(count).some(c=>c.method!=='GET'),false);const restored=new DatabaseSync(path);try{assert.equal(restored.prepare('SELECT status FROM factory_jobs').get().status,'awaiting_review');}finally{restored.close();}await assert.rejects(reader.snapshot(f.db),/1 GB safety limit/);
});
test('release snapshots migrate a full history, reuse unchanged chunks and retain both complete generations',async t=>{
 const f=await fixture(t,{large:true});await f.store.snapshot(f.db,{initialize:true});const legacyHead=f.gh.head,legacyBytes=[...f.gh.blobs.values()].reduce((n,b)=>n+b.length,0);f.gh.size=1024*1024+1;const writer=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.connect();f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');await writer.snapshot(f.db);assert.equal(writer.manifest.format,2);assert.ok(writer.manifest.release.id);assert.notEqual(f.gh.head,legacyHead);assert.ok([...f.gh.blobs.values()].reduce((n,b)=>n+b.length,0)-legacyBytes<65536,'Bulk snapshots do not enter Git history');
 const firstChunks=writer.manifest.chunks.map(c=>({...c})),uploadsBefore=f.gh.assets.size;
 const unrelated={id:9999,tag_name:'owner-release',draft:true,body:'keep'};f.gh.releases.set(unrelated.id,unrelated);
 for(const status of ['published','reviewed']){f.db.prepare('UPDATE factory_jobs SET status=?').run(status);await writer.snapshot(f.db);}const needed=new Set([writer.manifest.release.id,...writer.manifest.chunks.map(c=>(c.release||writer.manifest.release).id),...writer.manifest.previousReleases.map(r=>r.id),unrelated.id]);assert.deepEqual(new Set(f.gh.releases.keys()),needed,'Only releases needed by current/previous snapshots and unrelated data remain');assert.ok(f.gh.releases.has(unrelated.id));
 assert.ok(writer.manifest.chunks.some(c=>firstChunks.some(old=>old.asset===c.asset)),'Unchanged private artwork chunks are referenced without uploading again');assert.ok(f.gh.assets.size<uploadsBefore*3,'Repeated status updates do not upload three full copies');
 const path=join(f.dir,'release-recovery.sqlite'),reader=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await reader.restore(path);const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT status FROM factory_jobs').get().status,'reviewed');assert.deepEqual(Buffer.from(db.prepare('SELECT data FROM factory_artwork').get().data),f.artwork);}finally{db.close();}
 const writes=f.gh.calls.filter(c=>c.method!=='GET').length;await writer.snapshot(f.db);assert.equal(f.gh.calls.filter(c=>c.method!=='GET').length,writes,'An unchanged snapshot uploads nothing');
 const data=f.gh.assets.get(writer.manifest.chunks[0].asset).data;data[30]^=1;const damaged=join(f.dir,'damaged-release.sqlite');await assert.rejects(reader.restore(damaged),/could not be verified/);await assert.rejects(stat(damaged),{code:'ENOENT'});
});
test('a failed release checkpoint preserves the last recoverable generation and every working release',async t=>{
 const f=await fixture(t),writer=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.snapshot(f.db,{initialize:true});const first=writer.manifest.release.id,head=f.gh.head;f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');f.gh.failRef=true;await assert.rejects(writer.snapshot(f.db),/HTTP 500/);assert.equal(f.gh.head,head);assert.ok(f.gh.releases.has(first));const reader=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await reader.restore(join(f.dir,'failed-write-recovery.sqlite'));assert.equal(reader.manifest.release.id,first);
});

test('a Render handoff fences the retiring writer while preserving the latest authenticated snapshot',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const expected=f.store.manifest.sha256;
 const next=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch,sleep:async()=>{}});await next.connect();const handoff=await next.claimDeploymentWriter({service:'srv-test',instance:'new-render-instance',commit:'new-commit'});
 assert.equal(handoff.manifest.sha256,expected);assert.equal(next.head,f.gh.head);assert.equal(next.hold,false);
 await assert.rejects(f.store.assertCurrent(),e=>e.conflict===true);const before=f.gh.head;await assert.rejects(f.store.snapshot(f.db),/owner review/);assert.equal(f.gh.head,before,'the retired backend cannot publish a competing checkpoint');
 const path=join(f.dir,'handoff.sqlite');await next.restore(path);const restored=new DatabaseSync(path);try{assert.equal(restored.prepare('SELECT status FROM factory_jobs').get().status,'awaiting_review');assert.ok(Buffer.from(restored.prepare('SELECT data FROM factory_artwork').get().data).equals(f.artwork));}finally{restored.close();}
});
test('a deployment that read an older snapshot cannot fence over a newer checkpoint without reconnecting',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const next=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch,sleep:async()=>{}});await next.connect();f.db.prepare('UPDATE factory_jobs SET status=?').run('running');await f.store.snapshot(f.db);const latest=f.gh.head;
 await assert.rejects(next.claimDeploymentWriter({service:'srv-test',instance:'next'}),e=>e.conflict===true);assert.equal(f.gh.head,latest,'a stale startup does not replace the newest recovery state');
 const fresh=new GithubSnapshotStore(config,{fetchImpl:f.gh.fetch,sleep:async()=>{}});await fresh.claimDeploymentWriter({service:'srv-test',instance:'next'});assert.equal(fresh.manifest.sha256,f.store.manifest.sha256);
});
test('snapshot compaction releases the application event loop while the isolated copy is prepared',async t=>{
 const f=await fixture(t,{large:true});let ticks=0;const timer=setInterval(()=>ticks++,1);try{await f.store.snapshot(f.db,{initialize:true});}finally{clearInterval(timer);}assert.ok(ticks>0,'editing and status requests can run during snapshot preparation');
});

test('small cleanup preserves stable artwork pages and reuses authenticated recovery chunks',async t=>{
 const f=await fixture(t);f.db.prepare('DELETE FROM factory_artwork').run();f.db.exec('CREATE TABLE scratch_working_pixels(id INTEGER PRIMARY KEY,data BLOB)');f.db.prepare('INSERT INTO scratch_working_pixels VALUES(1,?)').run(randomBytes(128*1024));const original=randomBytes(8*1024*1024);f.db.prepare('INSERT INTO factory_artwork VALUES(?,?)').run('raven',original);
 const writer=new GithubSnapshotStore({...config,releaseSnapshots:true},{fetchImpl:f.gh.fetch,sleep:async()=>{}});await writer.snapshot(f.db,{initialize:true});const first=writer.manifest.chunks.map(c=>c.asset);
 f.db.exec('DELETE FROM scratch_working_pixels');await writer.snapshot(f.db);assert.ok(writer.manifest.chunks.some(c=>first.includes(c.asset)),'small cleanup must not move every unchanged artwork page');
 const path=join(f.dir,'stable-pages.sqlite');await writer.restore(path);const restored=new DatabaseSync(path);try{assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM factory_artwork').get().data),original);assert.equal(restored.prepare('SELECT count(*) n FROM scratch_working_pixels').get().n,0);assert.ok(restored.prepare('PRAGMA freelist_count').get().freelist_count>0);}finally{restored.close();}
});
test('large reclaimed regions are still compacted without changing preserved artwork',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TABLE scratch_working_pixels(id INTEGER PRIMARY KEY,data BLOB)');f.db.prepare('INSERT INTO scratch_working_pixels VALUES(1,?)').run(randomBytes(4*1024*1024));const original=randomBytes(4*1024*1024);f.db.prepare('INSERT INTO factory_artwork VALUES(?,?)').run('large-raven',original);await f.store.snapshot(f.db,{initialize:true});f.db.exec('DELETE FROM scratch_working_pixels');await f.store.snapshot(f.db);
 assert.ok(f.store.manifest.bytes<5*1024*1024);const path=join(f.dir,'compacted-pages.sqlite');await f.store.restore(path);const restored=new DatabaseSync(path);try{assert.deepEqual(Buffer.from(restored.prepare("SELECT data FROM factory_artwork WHERE id='large-raven'").get().data),original);assert.equal(restored.prepare('PRAGMA freelist_count').get().freelist_count,0);}finally{restored.close();}
});
test('a snapshot over its size cap compacts even when the free-page ratio is small',async t=>{
 const f=await fixture(t,{large:true});f.db.exec('CREATE TABLE scratch_working_pixels(id INTEGER PRIMARY KEY,data BLOB)');f.db.prepare('INSERT INTO scratch_working_pixels VALUES(1,?)').run(randomBytes(1024*1024));await f.store.snapshot(f.db,{initialize:true});f.db.exec('DELETE FROM scratch_working_pixels');f.store.maxBytes=9*1024*1024;await f.store.snapshot(f.db);assert.ok(f.store.manifest.bytes<9*1024*1024);
});
