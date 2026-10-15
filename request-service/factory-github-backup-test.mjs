import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {mkdtemp,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GithubSnapshotStore,githubBackupConfig,factoryGithubBackups,prepareGithubRecovery} from './factory-github-backup.mjs';
import {durableQueueStorage} from './factory-storage.mjs';
import {createService} from './server.mjs';

const config={repo:'owner/private-data',token:'private-fixture-token',key:Buffer.alloc(32,17),maxBytes:32*1024*1024,interval:60000};
const objectHash=b=>createHash('sha1').update(b).digest('hex');
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
function github(){
 const blobs=new Map(),trees=new Map([['b'.repeat(40),new Map()]]),commits=new Map([['a'.repeat(40),{tree:{sha:'b'.repeat(40)},parents:[]}]]),calls=[];
 const g={head:'a'.repeat(40),private:true,blobs,trees,commits,calls,rate:false,conflict:false,failRef:false,dropResponse:false,failReads:false};
 g.fetch=async(url,options={})=>{
  assert.equal(options.headers.Authorization,'Bearer '+config.token);const u=new URL(url);assert.equal(u.origin,'https://api.github.com');const path=u.pathname.slice('/repos/owner/private-data'.length),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
  if(g.rate)return reply({message:'Do not surface secret provider responses'},429,{'retry-after':'120'});
  if(g.failReads&&method==='GET')throw Error('Sensitive network detail');
  if(path==='')return reply({id:123,private:g.private,visibility:g.private?'private':'public',default_branch:'main',size:2});
  if(path==='/git/ref/heads/main')return reply({object:{sha:g.head}});
  if(path.startsWith('/git/commits/')&&method==='GET')return reply(commits.get(path.split('/').at(-1)));
  if(path==='/contents/factory-backup/latest.enc'){const commit=commits.get(u.searchParams.get('ref')),tree=trees.get(commit.tree.sha),sha=tree.get('factory-backup/latest.enc');if(!sha)return reply({message:'Not Found'},404);const data=blobs.get(sha);return reply({encoding:'base64',content:data.toString('base64'),size:data.length});}
  if(path.startsWith('/git/blobs/')&&method==='GET'){const data=blobs.get(path.split('/').at(-1));return reply({encoding:'base64',content:data.toString('base64'),size:data.length});}
  if(path==='/git/blobs'&&method==='POST'){const data=Buffer.from(body.content,'base64'),sha=objectHash(data);blobs.set(sha,data);return reply({sha});}
  if(path==='/git/trees'&&method==='POST'){assert.equal(new Set(body.tree.map(t=>t.path)).size,body.tree.length,'No duplicate tree paths');const next=new Map(trees.get(body.base_tree));for(const t of body.tree){if(t.sha===null){assert.ok(next.has(t.path));next.delete(t.path);}else{assert.ok(blobs.has(t.sha));next.set(t.path,t.sha);}}const sha=objectHash(JSON.stringify([...next]));trees.set(sha,next);return reply({sha});}
  if(path==='/git/commits'&&method==='POST'){const sha=objectHash(JSON.stringify(body));commits.set(sha,{tree:{sha:body.tree},parents:body.parents});return reply({sha});}
  if(path==='/git/refs/heads/main'&&method==='PATCH'){
   assert.equal(body.force,false);if(g.failRef)return reply({},500);if(g.conflict)return reply({},422);if(body.sha!==g.head&&!commits.get(body.sha).parents.includes(g.head))return reply({},409);g.head=body.sha;
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
test('recovery never overwrites a current local database',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const dest=join(f.dir,'existing.sqlite');await writeFile(dest,'current private data');await assert.rejects(f.store.restore(dest),/will not replace/);assert.equal(await readFile(dest,'utf8'),'current private data');
});
test('a GitHub conflict preserves the old branch and prevents further backup writes',async t=>{
 const f=await fixture(t);await f.store.snapshot(f.db,{initialize:true});const head=f.gh.head;f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');f.gh.conflict=true;await assert.rejects(f.store.snapshot(f.db),/existing snapshot was preserved/);assert.equal(f.gh.head,head);assert.equal(f.store.hold,true);const count=f.gh.calls.length;await assert.rejects(f.store.snapshot(f.db),/owner review/);assert.equal(f.gh.calls.slice(count).some(c=>c.method!=='GET'),false);
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
test('owner-only backup controls require the same origin and status reports confirmed commits',async t=>{
 const f=await fixture(t),env={FACTORY_BACKUP_REPO:config.repo,FACTORY_BACKUP_GITHUB_TOKEN:config.token,FACTORY_BACKUP_ENCRYPTION_KEY:config.key.toString('hex')};let result;
 const service=factoryGithubBackups({db:f.db,dbPath:f.path,env,store:f.store,autoStart:false,origin:'https://factory.test',auth(req){if(!req.owner)throw Object.assign(Error('Owner required'),{status:401});},body:async req=>req.body||{},send(_res,status,data){result={status,data};},fail(status,message){throw Object.assign(Error(message),{status});},limit(){}});t.after(()=>service.close());
 await assert.rejects(service.handle({}, {},'/api/owner/ai-factory/storage','GET'),e=>e.status===401);await assert.rejects(service.handle({owner:true,headers:{origin:'https://evil.test'}},{},'/api/owner/ai-factory/storage/backup','POST'),e=>e.status===403);
 await service.handle({owner:true},{},'/api/owner/ai-factory/storage','GET');assert.equal(result.data.lastSaved,null);assert.equal(result.data.liveQueueStorage,false);const pending=service.save(true);assert.equal(service.snapshot().running,true);assert.equal(service.snapshot().lastSaved,null);await pending;assert.equal(service.snapshot().running,false);assert.equal(service.snapshot().commit,f.gh.head);assert.equal(service.snapshot().unsavedChanges,false);f.db.prepare('UPDATE factory_jobs SET status=?').run('approved');assert.equal(service.snapshot().unsavedChanges,true);await service.tick();assert.equal(service.snapshot().unsavedChanges,false);
});
test('configuration derives stable encryption from backend credentials and rejects invalid keys and paths',()=>{
 const hash='ab'.repeat(16)+':'+'cd'.repeat(64),env={FACTORY_BACKUP_REPO:config.repo,CATALOG_GITHUB_TOKEN:config.token};assert.deepEqual(githubBackupConfig(env,hash).key,githubBackupConfig(env,hash).key);assert.notDeepEqual(githubBackupConfig(env,hash).key,githubBackupConfig(env,'ef'.repeat(16)+':'+'cd'.repeat(64)).key);assert.equal(githubBackupConfig({}),null);for(const bad of [{...env,FACTORY_BACKUP_REPO:'https://github.com/public/repo'},{...env,FACTORY_BACKUP_ENCRYPTION_KEY:'invalid'},{...env,FACTORY_BACKUP_INTERVAL_SECONDS:'1'},{...env,CATALOG_GITHUB_TOKEN:''}])assert.throws(()=>githubBackupConfig(bad,hash));
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
