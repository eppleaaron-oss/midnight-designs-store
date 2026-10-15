import {backup,DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,open,rm,stat,link} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateSync,inflateSync} from 'node:zlib';

const ROOT='factory-backup',MANIFEST=ROOT+'/latest.enc',CHUNK=4*1024*1024;
const digest=b=>createHash('sha256').update(b).digest('hex');
const problem=(message,status=503,extra={})=>Object.assign(Error(message),{status,...extra});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function githubBackupConfig(env={},passwordHash=''){
 if(!env.FACTORY_BACKUP_REPO)return null;
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.FACTORY_BACKUP_REPO))throw problem('Invalid private backup repository.');
 const token=env.FACTORY_BACKUP_GITHUB_TOKEN||env.CATALOG_GITHUB_TOKEN;
 if(!token)throw problem('Private GitHub backup access is not configured.');
 let key;
 if(env.FACTORY_BACKUP_ENCRYPTION_KEY){if(!/^[a-f0-9]{64}$/i.test(env.FACTORY_BACKUP_ENCRYPTION_KEY))throw problem('Invalid backup encryption key.');key=Buffer.from(env.FACTORY_BACKUP_ENCRYPTION_KEY,'hex');}
 else{if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash))throw problem('Backup encryption requires the backend owner password hash.');key=Buffer.from(hkdfSync('sha256',passwordHash,'midnight-factory-backup-v1','private-sqlite-snapshots',32));}
 const maxMB=Number(env.FACTORY_BACKUP_MAX_MB||512),interval=Number(env.FACTORY_BACKUP_INTERVAL_SECONDS||300)*1000;
 if(!Number.isSafeInteger(maxMB)||maxMB<1||maxMB>2048||!Number.isSafeInteger(interval)||interval<60000||interval>86400000)throw problem('Invalid GitHub backup size or interval.');
 return {repo:env.FACTORY_BACKUP_REPO,token,key,interval,maxBytes:maxMB*1024*1024};
}
function seal(bytes,key,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);}
function unseal(bytes,key,context){try{if(bytes.length<29)throw Error();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);}catch{throw problem('Backup authentication failed. Check the original encryption key; the local database was not replaced.');}}

// GitHub holds encrypted recovery snapshots. This is deliberately NOT treated as
// a durable live queue: an abrupt restart can lose changes since the last snapshot.
export class GithubSnapshotStore{
 constructor(config,{fetchImpl=fetch,sleep=pause,clock=Date.now}={}){Object.assign(this,config);this.fetch=fetchImpl;this.sleep=sleep;this.clock=clock;this.head=null;this.tree=null;this.manifest=null;this.repositoryId=null;this.lastMutation=null;this.hold=false;}
 async api(path,{method='GET',body,missing=false}={}){
  for(let attempt=0;attempt<3;attempt++){
   if(method!=='GET'){if(this.lastMutation!==null)await this.sleep(Math.max(0,1000-(this.clock()-this.lastMutation)));this.lastMutation=this.clock();}
   let response;try{response=await this.fetch('https://api.github.com/repos/'+this.repo+path,{method,headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{if(attempt<2){await this.sleep(1000*2**attempt);continue;}throw problem('GitHub backup connection failed. No new backup was confirmed.');}
   if(response.status===404&&missing)return null;
   if(response.status===429||response.status===403&&(response.headers.get('retry-after')||response.headers.get('x-ratelimit-remaining')==='0')){
    const delay=Number(response.headers.get('retry-after')||0)*1000,reset=Number(response.headers.get('x-ratelimit-reset')||0)*1000;
    throw problem('GitHub rate limit reached. Backup will retry after the required wait.',503,{retryAt:Math.max(this.clock()+60000,this.clock()+(Number.isFinite(delay)?delay:0),Number.isFinite(reset)?reset:0)});
   }
   if(response.status>=500&&attempt<2){await this.sleep(1000*2**attempt);continue;}
   if(!response.ok)throw problem('GitHub backup request failed (HTTP '+response.status+').',503,{conflict:response.status===409||response.status===422});
   if(response.status===204)return {};try{return await response.json();}catch{throw problem('GitHub returned an unreadable backup response.');}
  }
 }
 async privateRepository(){const repo=await this.api('');if(repo.private!==true||repo.visibility&&repo.visibility!=='private')throw problem('Factory backups require a private GitHub repository.');if(!Number.isSafeInteger(repo.id)||repo.id<1)throw problem('GitHub did not identify the private backup repository.');if(this.repositoryId!==null&&this.repositoryId!==repo.id)throw problem('Backup repository identity changed.');if(repo.size>1024*1024)throw problem('GitHub backup repository exceeds the 1 GB safety limit. Export and review storage before saving more snapshots.');this.repositoryId=repo.id;return repo;}
 async connect(){
  if(this.head)return this.manifest;
  const repo=await this.privateRepository();this.branch=repo.default_branch;
  if(typeof this.branch!=='string'||!this.branch)throw problem('Initialize the private backup repository with a README first.');
  const ref=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));if(!sha(ref.object?.sha))throw problem('GitHub returned an invalid backup branch.');
  const commit=await this.api('/git/commits/'+ref.object.sha);if(!sha(commit.tree?.sha))throw problem('GitHub returned an invalid backup tree.');
  const entry=await this.api('/contents/'+MANIFEST+'?ref='+ref.object.sha,{missing:true});let manifest=null;
  if(entry){if(entry.encoding!=='base64'||typeof entry.content!=='string'||entry.size>2*1024*1024||entry.content.length>3*1024*1024)throw problem('Backup manifest is invalid.');const plain=unseal(Buffer.from(entry.content.replace(/\s/g,''),'base64'),this.key,'manifest-v1');try{manifest=JSON.parse(plain.toString('utf8'));}catch{throw problem('Backup manifest is invalid.');}this.validateManifest(manifest);}
  this.head=ref.object.sha;this.tree=commit.tree.sha;this.manifest=manifest;return manifest;
 }
 validateManifest(m){if(m?.format!==1||!Number.isSafeInteger(m.bytes)||m.bytes<512||m.bytes>this.maxBytes||!/^[a-f0-9]{64}$/.test(m.sha256)||!Array.isArray(m.chunks)||m.chunks.length!==Math.ceil(m.bytes/CHUNK)||!Number.isFinite(Date.parse(m.created)))throw problem('Backup manifest is invalid or exceeds the configured size limit.');let size=0;for(const c of m.chunks){if(!/^[a-f0-9]{64}$/.test(c.id)||!sha(c.sha)||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>CHUNK)throw problem('Backup chunk manifest is invalid.');size+=c.bytes;}if(size!==m.bytes)throw problem('Backup size does not match its manifest.');}
 async snapshot(db,{initialize=false}={}){
  await this.connect();await this.privateRepository();
  if(this.hold)throw problem('Backup conflict requires an owner review. Existing GitHub snapshots were preserved.');
  if(!this.manifest&&!initialize)throw problem('No Factory backup exists yet. Save the first backup explicitly from the owner page.',409);
  const bytes=Number(db.prepare('PRAGMA page_count').get().page_count)*Number(db.prepare('PRAGMA page_size').get().page_size);if(bytes>this.maxBytes)throw problem('Factory database exceeds the configured GitHub snapshot size limit.');
  const folder=await mkdtemp(join(tmpdir(),'midnight-snapshot-'));let file;
  try{
   const path=join(folder,'snapshot.sqlite');await backup(db,path);const size=(await stat(path)).size;if(size>this.maxBytes)throw problem('Factory database exceeds the configured GitHub snapshot size limit.');
   file=await open(path,'r');const previous=new Map((this.manifest?.chunks||[]).map(c=>[c.id,c])),chunks=[],tree=[],added=new Set(),hash=createHash('sha256');let offset=0;
   while(offset<size){const data=Buffer.alloc(Math.min(CHUNK,size-offset));let used=0;while(used<data.length){const {bytesRead}=await file.read(data,used,data.length-used,offset+used);if(!bytesRead)throw problem('Unable to read a complete SQLite snapshot.');used+=bytesRead;}hash.update(data);const id=createHmac('sha256',this.key).update(data).digest('hex');let entry=previous.get(id);
    if(!entry){const encrypted=seal(deflateSync(data),this.key,'chunk-v1:'+id),blob=await this.api('/git/blobs',{method:'POST',body:{encoding:'base64',content:encrypted.toString('base64')}});if(!sha(blob.sha))throw problem('GitHub did not confirm a backup chunk.');entry={id,sha:blob.sha,bytes:data.length};previous.set(id,entry);}
    chunks.push(entry);if(!added.has(id)){tree.push({path:ROOT+'/chunks/'+id+'.bin',mode:'100644',type:'blob',sha:entry.sha});added.add(id);}offset+=data.length;
   }
   const checksum=hash.digest('hex');if(this.manifest?.sha256===checksum)return {commit:this.head,manifest:this.manifest,unchanged:true};
   const manifest={format:1,created:new Date(this.clock()).toISOString(),bytes:size,sha256:checksum,chunks};const encrypted=seal(Buffer.from(JSON.stringify(manifest)),this.key,'manifest-v1');
   const blob=await this.api('/git/blobs',{method:'POST',body:{encoding:'base64',content:encrypted.toString('base64')}});if(!sha(blob.sha))throw problem('GitHub did not confirm the backup manifest.');tree.push({path:MANIFEST,mode:'100644',type:'blob',sha:blob.sha});
   const ids=new Set(chunks.map(c=>c.id));for(const id of previous.keys())if(!ids.has(id))tree.push({path:ROOT+'/chunks/'+id+'.bin',mode:'100644',type:'blob',sha:null});
   const nextTree=await this.api('/git/trees',{method:'POST',body:{base_tree:this.tree,tree}});if(!sha(nextTree.sha))throw problem('GitHub did not confirm the backup tree.');
   const commit=await this.api('/git/commits',{method:'POST',body:{message:'Save encrypted Factory recovery snapshot',tree:nextTree.sha,parents:[this.head]}});if(!sha(commit.sha))throw problem('GitHub did not confirm the backup commit.');
   await this.privateRepository();
   try{await this.api('/git/refs/heads/'+encodeURIComponent(this.branch),{method:'PATCH',body:{sha:commit.sha,force:false}});}catch(e){if(e.conflict){this.hold=true;throw problem('GitHub changed during backup. The existing snapshot was preserved; owner review is required.',503,{conflict:true});}const current=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));if(current.object?.sha!==commit.sha)throw e;}
   const confirmed=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));if(confirmed.object?.sha!==commit.sha){this.hold=true;throw problem('GitHub backup confirmation changed. Owner review is required.',503,{conflict:true});}
   this.head=commit.sha;this.tree=nextTree.sha;this.manifest=manifest;return {commit:this.head,manifest};
  }finally{await file?.close();await rm(folder,{recursive:true,force:true});}
 }
 async restore(dbPath){
  await this.connect();await this.privateRepository();if(!this.manifest)throw problem('No verified GitHub Factory backup exists. Startup stopped instead of creating an empty workspace.');
  try{if((await stat(dbPath)).size>0)throw problem('Recovery will not replace an existing local database.',409);}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dirname(dbPath),{recursive:true,mode:0o700});const folder=await mkdtemp(join(dirname(dbPath),'.midnight-restore-'));const temporary=join(folder,'restored.sqlite');let file;
  try{
   file=await open(temporary,'wx',0o600);const hash=createHash('sha256');
   for(const c of this.manifest.chunks){const blob=await this.api('/git/blobs/'+c.sha);if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.size>CHUNK+65536||blob.content.length>Math.ceil((CHUNK+65536)/3)*4+10000)throw problem('Backup chunk is invalid.');let data;try{data=inflateSync(unseal(Buffer.from(blob.content.replace(/\s/g,''),'base64'),this.key,'chunk-v1:'+c.id),{maxOutputLength:c.bytes});}catch{throw problem('Backup chunk could not be verified. Recovery was stopped.');}if(data.length!==c.bytes||createHmac('sha256',this.key).update(data).digest('hex')!==c.id)throw problem('Backup chunk checksum failed.');hash.update(data);await file.writeFile(data);}
   await file.sync();await file.close();file=null;if(hash.digest('hex')!==this.manifest.sha256)throw problem('Complete backup checksum failed.');
   const check=new DatabaseSync(temporary,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok'))throw problem('SQLite recovery validation failed.');}finally{check.close();}
   // A hard link installs the completed file atomically without overwriting a
   // database created by another process while the download was in progress.
   await link(temporary,dbPath);return {commit:this.head,created:this.manifest.created,bytes:this.manifest.bytes};
  }finally{await file?.close();await rm(folder,{recursive:true,force:true});}
 }
}

export async function prepareGithubRecovery({dbPath,env=process.env,passwordHash,settings={}}){
 const config=githubBackupConfig(env,passwordHash);if(!config)return null;
 const store=new GithubSnapshotStore(config,settings);let exists=false;try{exists=(await stat(dbPath)).size>0;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!exists)await store.restore(dbPath);return store;
}

export function factoryGithubBackups({db,dbPath,auth,body,send,fail,limit,origin,env=process.env,passwordHash,store:preparedStore,fetchImpl=fetch,sleep=pause,clock=Date.now,autoStart=true}){
 let config,configurationError='';try{config=githubBackupConfig(env,passwordHash);}catch(e){configurationError=e.message;}
 const store=preparedStore||(config?new GithubSnapshotStore(config,{fetchImpl,sleep,clock}):null);let pending=null,watermark=-1,lastError=configurationError,lastSaved=store?.manifest?.created||null,commit=store?.manifest?store.head:null,retryAt=0,closed=false;
 const changes=()=>Number(db.prepare('SELECT total_changes() n').get().n);
 function snapshot(){return {configured:!!store,repository:config?.repo||null,running:!!pending,initialized:!!store?.manifest,lastSaved,commit,bytes:store?.manifest?.bytes||0,unsavedChanges:!!store&&changes()!==watermark,error:lastError,retryAt:retryAt?new Date(retryAt).toISOString():null,conflict:!!store?.hold,intervalSeconds:(config?.interval||0)/1000,liveQueueStorage:false,note:'GitHub stores encrypted recovery snapshots. Changes after the last completed backup can be lost on a sudden restart. Continuous production still requires durable live queue storage.'};}
 async function save(initialize=false){
  if(closed)throw problem('Backup service is closing.');if(!store)throw problem(configurationError||'GitHub backups are not configured.');if(pending)return pending;
  if(clock()<retryAt)throw problem('GitHub backup is waiting before its next permitted attempt.',429);
  const marker=changes();lastError='';pending=(async()=>{try{const saved=await store.snapshot(db,{initialize});watermark=marker;lastSaved=saved.manifest.created;commit=saved.commit;retryAt=0;return snapshot();}catch(e){lastError=e.message;retryAt=e.retryAt||clock()+60000;throw e;}finally{pending=null;}})();return pending;
 }
 async function tick(){if(!store||closed||pending||clock()<retryAt||store.hold)return;try{await store.connect();if(!closed&&store.manifest&&changes()!==watermark)await save();}catch(e){lastError=e.message;retryAt=e.retryAt||clock()+60000;}}
 const timer=autoStart&&store?setInterval(()=>{tick().catch(()=>{});},config.interval):null;timer?.unref();
 return {snapshot,save,tick,async close(){closed=true;if(timer)clearInterval(timer);await pending?.catch(()=>{});},async handle(req,res,path,method){if(!path.startsWith('/api/owner/ai-factory/storage'))return false;auth(req,null,true);if(path==='/api/owner/ai-factory/storage'&&method==='GET'){if(store&&!store.head)try{await store.connect();lastSaved=store.manifest?.created||null;commit=store.manifest?store.head:null;}catch(e){lastError=e.message;}send(res,200,snapshot());return true;}if(path==='/api/owner/ai-factory/storage/backup'&&method==='POST'){if(req.headers.origin!==origin)fail(403,'Request origin rejected.');limit(req,'github-backup',4);const b=await body(req);if(b.initialize!==undefined&&typeof b.initialize!=='boolean')fail(400,'Invalid backup initialization.');if(!store)fail(503,configurationError||'GitHub backups are not configured.');if(clock()<retryAt)fail(429,'GitHub backup is waiting before its next permitted attempt.');save(b.initialize===true).catch(()=>{});send(res,202,snapshot());return true;}fail(404,'Storage action not found.');}};
}
