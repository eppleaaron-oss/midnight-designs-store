import {recoveryAudit,storageFailureKind} from './factory-recovery-audit.mjs';
import {BasicGithubAssets} from './factory-basic-github.mjs';
import {stripBasicWorkingPixels} from './factory-basic-storage.mjs';
import {backup,DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,open,rm,stat,statfs,link,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflate,inflateSync} from 'node:zlib';
import {promisify} from 'node:util';
import {Worker} from 'node:worker_threads';
const compress=promisify(deflate);
const prepareSnapshot=(path,maxBytes)=>new Promise((resolve,reject)=>{let answered=false;const worker=new Worker(new URL('./factory-backup-worker.mjs',import.meta.url),{workerData:{path,maxBytes},env:{...process.env,SQLITE_TMPDIR:dirname(path),TMPDIR:dirname(path)}});worker.once('message',m=>{answered=true;m?.ok?resolve():reject(problem('Recovery snapshot preparation failed. The live database was preserved.'));});worker.once('error',()=>reject(problem('Recovery snapshot worker failed. The live database was preserved.')));worker.once('exit',code=>{if(code||!answered)reject(problem('Recovery snapshot preparation did not finish.'));});});

const ROOT='factory-backup',MANIFEST=ROOT+'/latest.enc',CHUNK=4*1024*1024;
const digest=b=>createHash('sha256').update(b).digest('hex');
const problem=(message,status=503,extra={})=>Object.assign(Error(message),{status,...extra});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const gitBlobSha=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const validRelease=r=>!!r&&/^recovery-v2-[a-f0-9]{64}$/.test(r.job)&&Number.isSafeInteger(r.id)&&r.id>0;
const releaseRefs=m=>{const refs=[m?.release,...(m?.chunks||[]).map(c=>c.release||m?.release)].filter(Boolean);return [...new Map(refs.map(r=>[r.id,r])).values()];};
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
 const keySource=env.FACTORY_BACKUP_ENCRYPTION_KEY?'explicit backend key':'backend owner hash',recoveryKeys=[];
 // Existing installations initially derived their backup key from the backend
 // credential. A newly added explicit key must
 // not strand that authenticated snapshot. Try only keys already configured on
 // this backend; every candidate must pass AES-GCM before any data is restored.
 for(const value of [passwordHash])if(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(value)){
  const candidate=Buffer.from(hkdfSync('sha256',value,'midnight-factory-backup-v1','private-sqlite-snapshots',32));
  if(!candidate.equals(key)&&!recoveryKeys.some(k=>k.key.equals(candidate)))recoveryKeys.push({key:candidate,source:'original backend owner hash'});
 }
 const fingerprint=passwordHash?digest(passwordHash).slice(0,4)+'…'+digest(passwordHash).slice(-4):'unavailable';
 return {repo:env.FACTORY_BACKUP_REPO,token,key,keySource,recoveryKeys,ownerFingerprint:fingerprint,interval,maxBytes:maxMB*1024*1024,releaseSnapshots:true};
}
function seal(bytes,key,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);}
function unseal(bytes,key,context){try{if(bytes.length<29)throw Error();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);}catch{throw problem('Backup authentication failed. Check the original encryption key; the local database was not replaced.');}}

// GitHub holds encrypted recovery snapshots. This is deliberately NOT treated as
// a durable live queue: an abrupt restart can lose changes since the last snapshot.
export class GithubSnapshotStore{
 constructor(config,{fetchImpl=fetch,sleep=pause,clock=Date.now}={}){Object.assign(this,config);this.fetch=fetchImpl;this.sleep=sleep;this.clock=clock;this.head=null;this.previousHead=null;this.tree=null;this.manifest=null;this.repositoryId=null;this.lastMutation=null;this.hold=false;}
 async pinLocal(){if(!this.localPath)return;const path=this.localPath+'.recovery.json',temporary=path+'.'+randomBytes(8).toString('hex');try{await writeFile(temporary,JSON.stringify({head:this.head,sha256:this.manifest?.sha256}),{mode:0o600});await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
 async api(path,{method='GET',body,missing=false}={}){
  for(let attempt=0;attempt<3;attempt++){
   if(method!=='GET'){if(this.lastMutation!==null)await this.sleep(Math.max(0,1000-(this.clock()-this.lastMutation)));this.lastMutation=this.clock();}
   let response;try{response=await this.fetch('https://api.github.com/repos/'+this.repo+path,{method,headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28',...(method==='GET'?{'Cache-Control':'no-cache'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});}catch{if(attempt<2){await this.sleep(1000*2**attempt);continue;}throw problem('GitHub backup connection failed. No new backup was confirmed.');}
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
 async privateRepository({write=false}={}){const repo=await this.api('');if(repo.private!==true||repo.visibility&&repo.visibility!=='private')throw problem('Factory backups require a private GitHub repository.');if(!Number.isSafeInteger(repo.id)||repo.id<1)throw problem('GitHub did not identify the private backup repository.');if(this.repositoryId!==null&&this.repositoryId!==repo.id)throw problem('Backup repository identity changed.');if(write&&repo.size>1024*1024)throw problem('GitHub backup repository exceeds the 1 GB safety limit. Export and review storage before saving more snapshots.');this.repositoryId=repo.id;return repo;}
 async connect(){
  if(this.head)return this.manifest;
  const repo=await this.privateRepository();this.branch=repo.default_branch;
  if(typeof this.branch!=='string'||!this.branch)throw problem('Initialize the private backup repository with a README first.');
  const ref=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));if(!sha(ref.object?.sha))throw problem('GitHub returned an invalid backup branch.');
  const commit=await this.api('/git/commits/'+ref.object.sha);if(!sha(commit.tree?.sha))throw problem('GitHub returned an invalid backup tree.');
  const entry=await this.api('/contents/'+MANIFEST+'?ref='+ref.object.sha,{missing:true});let manifest=null;
  if(entry){
   if(entry.encoding!=='base64'||typeof entry.content!=='string'||entry.size>2*1024*1024||entry.content.length>3*1024*1024)throw problem('Backup manifest is invalid.');
   // Verify the transport bytes before classifying an AES failure as a key
   // problem. Contents responses can be transformed by intermediaries; Git's
   // immutable blob endpoint provides an independent, hash-checked read.
   let encrypted=Buffer.from(entry.content.replace(/\s/g,''),'base64');
   if(!sha(entry.sha))throw problem('Backup manifest has no verified Git blob identity.');
   if(gitBlobSha(encrypted)!==entry.sha){
    const blob=await this.api('/git/blobs/'+entry.sha);
    if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.size>2*1024*1024||blob.content.length>3*1024*1024)throw problem('Backup manifest download is invalid. The saved snapshot was not changed.');
    encrypted=Buffer.from(blob.content.replace(/\s/g,''),'base64');
    if(gitBlobSha(encrypted)!==entry.sha)throw problem('Backup manifest download failed its Git checksum. The saved snapshot was not changed.');
   }
   let plain;
   for(const candidate of [{key:this.key,source:this.keySource||'configured key'},...(this.recoveryKeys||[])]){
    try{plain=unseal(encrypted,candidate.key,'manifest-v1');this.key=candidate.key;this.keySource=candidate.source;break;}catch{}
   }
   if(!plain)throw problem('Backup authentication failed for verified Git blob '+entry.sha+'. The configured backend keys cannot decrypt this snapshot. Key source: '+(this.keySource||'configured key')+'; owner-hash fingerprint: '+(this.ownerFingerprint||'unavailable')+'. The local database was not replaced.');
   try{manifest=JSON.parse(plain.toString('utf8'));}catch{throw problem('Backup manifest is invalid.');}this.validateManifest(manifest);
  }
  this.head=ref.object.sha;this.tree=commit.tree.sha;this.manifest=manifest;return manifest;
 }
 async confirmHead(expected,previous=null){
  for(let attempt=0;attempt<4;attempt++){
   const ref=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));
   // Another local checkpoint may have finished while this GET was in flight.
   if(this.head!==expected&&this.head!==previous)return false;
   if(ref.object?.sha===expected)return true;
   if(previous&&ref.object?.sha===previous){if(attempt<3){await this.sleep(250*2**attempt);continue;}throw problem('GitHub is still confirming the saved checkpoint. The tracked item will retry without creating another product.',503,{confirmationPending:true});}
   this.hold=true;throw problem('GitHub checkpoint changed on another backend. This item is held before another external operation.',503,{conflict:true});
  }
 }
 async claimDeploymentWriter({service,instance,commit=''}){
  if(!/^srv-[a-z0-9]+$/.test(service||'')||typeof instance!=='string'||!instance||instance.length>160)throw problem('Invalid deployment writer identity.');
  await this.connect();if(!this.manifest)throw problem('A verified recovery snapshot is required before deployment handoff.');await this.assertCurrent();
  const parent=this.head,payload=Buffer.from(JSON.stringify({service,instance,commit:String(commit).slice(0,64),claimedAt:new Date(this.clock()).toISOString()})+'\n');
  const blob=await this.api('/git/blobs',{method:'POST',body:{encoding:'base64',content:payload.toString('base64')}});if(!sha(blob.sha))throw problem('GitHub did not confirm the deployment handoff record.');
  const tree=await this.api('/git/trees',{method:'POST',body:{base_tree:this.tree,tree:[{path:ROOT+'/render-writer.json',mode:'100644',type:'blob',sha:blob.sha}]}});if(!sha(tree.sha))throw problem('GitHub did not confirm the handoff tree.');
  const next=await this.api('/git/commits',{method:'POST',body:{message:'Hand off Factory recovery writer to Render deployment',tree:tree.sha,parents:[parent]}});if(!sha(next.sha))throw problem('GitHub did not confirm the deployment writer.');
  const accepted=await this.api('/git/refs/heads/'+encodeURIComponent(this.branch),{method:'PATCH',body:{sha:next.sha,force:false}});if(accepted.object?.sha!==next.sha)await this.confirmHead(next.sha,parent);
  this.previousHead=parent;this.head=next.sha;this.tree=tree.sha;await this.confirmHead(next.sha,parent);return {commit:next.sha,manifest:this.manifest};
 }
 async assertCurrent(){if(this.hold)throw problem(this.lineageError||'Backup conflict requires owner review before another write.',503,{conflict:true});await this.connect();while(!await this.confirmHead(this.head,this.previousHead)){};}
 validateManifest(m){if(![1,2].includes(m?.format)||!Number.isSafeInteger(m.bytes)||m.bytes<512||m.bytes>this.maxBytes||!/^[a-f0-9]{64}$/.test(m.sha256)||!Array.isArray(m.chunks)||m.chunks.length!==Math.ceil(m.bytes/CHUNK)||!Number.isFinite(Date.parse(m.created)))throw problem('Backup manifest is invalid or exceeds the configured size limit.');if(m.format===2&&(!/^recovery-v2-[a-f0-9]{64}$/.test(m.release?.job)||!Number.isSafeInteger(m.release?.id)))throw problem('Backup release identity is invalid.');let size=0;for(const c of m.chunks){if(!/^[a-f0-9]{64}$/.test(c.id)||!sha(c.sha)||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>CHUNK)throw problem('Backup chunk manifest is invalid.');if(m.format===2&&(!Number.isSafeInteger(c.asset)||c.asset<1||!/^[a-f0-9]{64}$/.test(c.encodedSha)||c.release!==undefined&&!validRelease(c.release)))throw problem('Backup release chunk is invalid.');size+=c.bytes;}if(size!==m.bytes)throw problem('Backup size does not match its manifest.');if(m.previousReleases!==undefined&&(!Array.isArray(m.previousReleases)||m.previousReleases.length>1024||m.previousReleases.some(r=>!validRelease(r))))throw problem('Backup retained release identities are invalid.');}
 async snapshot(db,{initialize=false,directory=this.localPath?dirname(this.localPath):tmpdir()}={}){
  await this.connect();await this.privateRepository({write:!this.releaseSnapshots});
  if(this.hold)throw problem('Backup conflict requires an owner review. Existing GitHub snapshots were preserved.');
  await this.assertCurrent();
  if(!this.manifest&&!initialize)throw problem('No Factory backup exists yet. Save the first backup explicitly from the owner page.',409);
  // Reproducible Basic working pixels are removed from the copy before applying the backup limit.
  await mkdir(directory,{recursive:true,mode:0o700});
  const pages=db.prepare('PRAGMA page_count').get().page_count,pageSize=db.prepare('PRAGMA page_size').get().page_size,required=pages*pageSize+64*1024*1024,space=await statfs(directory);
  if(space.bavail*space.bsize<required)throw problem('Recovery backup needs more temporary working space. Existing backups and live artwork were preserved.');
  const folder=await mkdtemp(join(directory,'.midnight-snapshot-'));let file;
  try{
   const path=join(folder,'snapshot.sqlite');await backup(db,path);await prepareSnapshot(path,this.maxBytes);const size=(await stat(path)).size;if(size>this.maxBytes)throw problem('Factory database exceeds the configured GitHub snapshot size limit.');
   file=await open(path,'r');
   const assets=this.releaseSnapshots?new BasicGithubAssets(this,{fetchImpl:this.fetch,sleep:this.sleep,clock:this.clock}):null;let release=null;
   if(assets){const whole=createHash('sha256');for(let offset=0;offset<size;){const data=Buffer.alloc(Math.min(CHUNK,size-offset));const {bytesRead}=await file.read(data,0,data.length,offset);if(!bytesRead)throw problem('Unable to read the recovery snapshot.');whole.update(data.subarray(0,bytesRead));offset+=bytesRead;}const checksum=whole.digest('hex');if(this.manifest?.sha256===checksum){await this.pinLocal();return {commit:this.head,manifest:this.manifest,unchanged:true};}const job='recovery-v2-'+checksum,r=await assets.release(job);release={job,id:r.id};}
   const previous=new Map((this.manifest?.chunks||[]).map(c=>[c.id,c])),chunks=[],tree=[],added=new Set(),hash=createHash('sha256');let offset=0;
   while(offset<size){const data=Buffer.alloc(Math.min(CHUNK,size-offset));let used=0;while(used<data.length){const {bytesRead}=await file.read(data,used,data.length-used,offset+used);if(!bytesRead)throw problem('Unable to read a complete SQLite snapshot.');used+=bytesRead;}hash.update(data);const id=createHmac('sha256',this.key).update(data).digest('hex');let entry=previous.get(id);if(assets&&this.manifest?.format!==2)entry=null;else if(assets&&entry)entry={...entry,release:entry.release||this.manifest.release};
    if(assets&&!entry){const compressed=await compress(data),encodedSha=digest(compressed),saved=await assets.put(release.job,'backup',id,compressed,encodedSha);entry={id,sha:gitBlobSha(compressed),bytes:data.length,asset:saved.asset,encodedSha,release};}
    else if(!assets&&!entry){const encrypted=seal(await compress(data),this.key,'chunk-v1:'+id),blob=await this.api('/git/blobs',{method:'POST',body:{encoding:'base64',content:encrypted.toString('base64')}});if(!sha(blob.sha))throw problem('GitHub did not confirm a backup chunk.');entry={id,sha:blob.sha,bytes:data.length};previous.set(id,entry);}
    chunks.push(entry);if(!assets&&!added.has(id)){tree.push({path:ROOT+'/chunks/'+id+'.bin',mode:'100644',type:'blob',sha:entry.sha});added.add(id);}offset+=data.length;
   }
   const checksum=hash.digest('hex');if(this.manifest?.sha256===checksum){await this.pinLocal();return {commit:this.head,manifest:this.manifest,unchanged:true};}
   const manifest={format:assets?2:1,...(release?{release,previousRelease:this.manifest?.release||null,previousReleases:releaseRefs(this.manifest)}:{}),created:new Date(this.clock()).toISOString(),bytes:size,sha256:checksum,chunks};const encrypted=seal(Buffer.from(JSON.stringify(manifest)),this.key,'manifest-v1');
   const blob=await this.api('/git/blobs',{method:'POST',body:{encoding:'base64',content:encrypted.toString('base64')}});if(!sha(blob.sha))throw problem('GitHub did not confirm the backup manifest.');tree.push({path:MANIFEST,mode:'100644',type:'blob',sha:blob.sha});
   const ids=new Set(chunks.map(c=>c.id));for(const id of previous.keys())if(this.manifest?.format!==2&&!ids.has(id))tree.push({path:ROOT+'/chunks/'+id+'.bin',mode:'100644',type:'blob',sha:null});
   const nextTree=await this.api('/git/trees',{method:'POST',body:{base_tree:this.tree,tree}});if(!sha(nextTree.sha))throw problem('GitHub did not confirm the backup tree.');
   const commit=await this.api('/git/commits',{method:'POST',body:{message:'Save encrypted Factory recovery snapshot',tree:nextTree.sha,parents:[this.head]}});if(!sha(commit.sha))throw problem('GitHub did not confirm the backup commit.');
   await this.privateRepository({write:!assets});
   const retired=this.manifest?.previousReleases||(this.manifest?.previousRelease?[this.manifest.previousRelease]:[]);
   const parentHead=this.head;
   try{const accepted=await this.api('/git/refs/heads/'+encodeURIComponent(this.branch),{method:'PATCH',body:{sha:commit.sha,force:false}});if(accepted.object?.sha!==commit.sha)await this.confirmHead(commit.sha,parentHead);}catch(e){if(e.conflict){this.hold=true;throw problem('GitHub changed during backup. The existing snapshot was preserved; owner review is required.',503,{conflict:true});}try{await this.confirmHead(commit.sha,parentHead);}catch{throw e;}}
   // The write response acknowledges this exact ref. A stale GET of its parent
   // is a bounded consistency wait, not evidence of a competing backend.
   this.previousHead=parentHead;this.head=commit.sha;this.tree=nextTree.sha;this.manifest=manifest;
   await this.confirmHead(this.head,parentHead);
   // Reused chunks retain their original encryption context. Keep every release
   // needed by this and the previous complete snapshot before retiring old ones.
   const keep=new Set([...releaseRefs(manifest),...(manifest.previousReleases||[])].map(r=>r.id));
   if(assets)for(const r of retired){if(keep.has(r.id))continue;try{await this.assertCurrent();await assets.remove(r.job,r.id);}catch(e){if(this.hold)throw e;}}
   await this.pinLocal();return {commit:this.head,manifest};
  }finally{await file?.close();await rm(folder,{recursive:true,force:true});}
 }
 async restore(dbPath){
  await this.connect();await this.privateRepository();if(!this.manifest)throw problem('No verified GitHub Factory backup exists. Startup stopped instead of creating an empty workspace.');
  try{if((await stat(dbPath)).size>0)throw problem('Recovery will not replace an existing local database.',409);}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dirname(dbPath),{recursive:true,mode:0o700});const folder=await mkdtemp(join(dirname(dbPath),'.midnight-restore-'));const temporary=join(folder,'restored.sqlite');let file;
  try{
   file=await open(temporary,'wx',0o600);const hash=createHash('sha256');
   const assets=this.manifest.format===2?new BasicGithubAssets(this,{fetchImpl:this.fetch,sleep:this.sleep,clock:this.clock}):null;if(assets)for(const ref of releaseRefs(this.manifest)){const r=await assets.api('/releases/'+ref.id);assets.owned(r,ref.job);}
   for(const c of this.manifest.chunks){if(assets){let data;try{let compressed;for(let attempt=0;attempt<3;attempt++){try{compressed=await assets.read(c.asset,(c.release||this.manifest.release).job,'backup',c.id,c.encodedSha);break;}catch(e){const temporary=[429,502,503,504].includes(e.status)||['TypeError','AbortError','TimeoutError'].includes(e.name);if(!temporary||attempt===2)throw e;await this.sleep(1000*2**attempt);}}data=inflateSync(compressed,{maxOutputLength:c.bytes});}catch(e){throw problem('Backup release chunk could not be verified. Recovery was stopped. Asset '+c.asset+'; '+([429,502,503,504].includes(e.status)||['TypeError','AbortError','TimeoutError'].includes(e.name)?'temporary download failure':'attachment authentication or integrity failure')+'.',503,{failureKind:storageFailureKind(e)});}if(data.length!==c.bytes||createHmac('sha256',this.key).update(data).digest('hex')!==c.id)throw problem('Backup chunk checksum failed.');hash.update(data);await file.writeFile(data);continue;}const blob=await this.api('/git/blobs/'+c.sha);if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.size>CHUNK+65536||blob.content.length>Math.ceil((CHUNK+65536)/3)*4+10000)throw problem('Backup chunk is invalid.');let data;try{data=inflateSync(unseal(Buffer.from(blob.content.replace(/\s/g,''),'base64'),this.key,'chunk-v1:'+c.id),{maxOutputLength:c.bytes});}catch{throw problem('Backup chunk could not be verified. Recovery was stopped.');}if(data.length!==c.bytes||createHmac('sha256',this.key).update(data).digest('hex')!==c.id)throw problem('Backup chunk checksum failed.');hash.update(data);await file.writeFile(data);}
   await file.sync();await file.close();file=null;if(hash.digest('hex')!==this.manifest.sha256)throw problem('Complete backup checksum failed.');
   let audit;const check=new DatabaseSync(temporary,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok'))throw problem('SQLite recovery validation failed.');audit=recoveryAudit(check);}finally{check.close();}
   // A hard link installs the completed file atomically without overwriting a
   // database created by another process while the download was in progress.
   await link(temporary,dbPath);return {commit:this.head,created:this.manifest.created,bytes:this.manifest.bytes,sha256:this.manifest.sha256,integrity:'ok',checkedAt:new Date(this.clock()).toISOString(),audit};
  }finally{await file?.close();await rm(folder,{recursive:true,force:true});}
 }
}

export async function prepareGithubRecovery({dbPath,env=process.env,passwordHash,settings={}}){
 const config=githubBackupConfig(env,passwordHash);if(!config)return null;
 const store=new GithubSnapshotStore(config,settings);let exists=false;try{exists=(await stat(dbPath)).size>0;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!exists){
  await store.connect();
  if(store.manifest&&env.RENDER_SERVICE_ID){for(let attempt=0;attempt<3;attempt++){try{await store.claimDeploymentWriter({service:env.RENDER_SERVICE_ID,instance:env.RENDER_INSTANCE_ID||env.RENDER_GIT_COMMIT||'render-startup',commit:env.RENDER_GIT_COMMIT});break;}catch(e){if(!e.conflict||attempt===2)throw e;store.head=null;store.previousHead=null;store.tree=null;store.manifest=null;store.hold=false;await store.connect();}}}
  // Fresh initialization is an explicit, one-time pin to the empty
  // destination's current commit. The first snapshot advances that ref.
  if(!store.manifest&&sha(env.FACTORY_BACKUP_INITIALIZE_FROM_COMMIT)&&env.FACTORY_BACKUP_INITIALIZE_FROM_COMMIT===store.head)store.initializeBeforeListen=true;
  else {store.restoreReceipt=await store.restore(dbPath);console.log('Factory startup restore verified: '+JSON.stringify({commit:store.restoreReceipt.commit,integrity:store.restoreReceipt.integrity,counts:store.restoreReceipt.audit.counts,missingReferencedArtwork:store.restoreReceipt.audit.missingReferencedArtwork.length,recoverableRevisions:store.restoreReceipt.audit.recoverableRevisions.length,bytes:store.restoreReceipt.bytes}));}
 }else{
  await store.connect();if(store.manifest){let pin;try{pin=JSON.parse(await readFile(dbPath+'.recovery.json','utf8'));}catch{}if(pin?.head!==store.head||pin?.sha256!==store.manifest.sha256){store.hold=true;store.lineageError='Local backup lineage is missing or older than the current remote checkpoint. Local work was preserved; automatic backup writes are held for recovery review.';}}
 }
 store.localPath=dbPath;if(!store.hold&&store.manifest)await store.pinLocal();return store;
}

export function factoryGithubBackups({db,dbPath,auth,body,send,fail,limit,origin,env=process.env,passwordHash,store:preparedStore,fetchImpl=fetch,sleep=pause,clock=Date.now,autoStart=true}){
 db.exec('CREATE TABLE IF NOT EXISTS factory_restore_checks(id INTEGER PRIMARY KEY CHECK(id=1),report TEXT NOT NULL)');
 let config,configurationError='';try{config=githubBackupConfig(env,passwordHash);}catch(e){configurationError=e.message;}
 const store=preparedStore||(config?new GithubSnapshotStore(config,{fetchImpl,sleep,clock}):null);let pending=null,watermark=-1,lastError=configurationError,lastSaved=store?.manifest?.created||null,commit=store?.manifest?store.head:null,retryAt=0,closed=false;
 let restoreRunning=null,restoreError='',restoreErrorKind=null;let restoreReport=db.prepare('SELECT report FROM factory_restore_checks WHERE id=1').get()?.report;restoreReport=restoreReport?JSON.parse(restoreReport):null;if(store?.restoreReceipt){restoreReport={...store.restoreReceipt,kind:'startup restore'};db.prepare('INSERT INTO factory_restore_checks VALUES(1,?) ON CONFLICT(id) DO UPDATE SET report=excluded.report').run(JSON.stringify(restoreReport));}
 const changes=()=>Number(db.prepare('SELECT total_changes() n').get().n);
 function snapshot(){return {configured:!!store,repository:config?.repo||null,encryptionSource:store?.keySource||config?.keySource||null,running:!!pending,initialized:!!store?.manifest,lastSaved,commit,bytes:store?.manifest?.bytes||0,unsavedChanges:!!store&&changes()!==watermark,error:lastError||store?.lineageError||'',failureKind:storageFailureKind(lastError||store?.lineageError),restore:{running:!!restoreRunning,error:restoreError,failureKind:restoreErrorKind||storageFailureKind(restoreError),report:restoreReport},capacity:{snapshotLimitBytes:store?.maxBytes||0,snapshotBytes:store?.manifest?.bytes||0},retryAt:retryAt?new Date(retryAt).toISOString():null,conflict:!!store?.hold,intervalSeconds:(config?.interval||0)/1000,liveQueueStorage:false,note:'GitHub stores encrypted recovery snapshots. Changes after the last completed backup can be lost on a sudden restart. Continuous production still requires durable live queue storage.'};}
 function activeGithubStep(){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_basic_github_settings'").get()&&!!db.prepare("SELECT 1 FROM factory_basic_github_settings s JOIN factory_basic_items b JOIN factory_jobs j ON j.id=b.job WHERE s.id=1 AND s.enabled=1 AND b.closed=0 AND j.status='running'").get();}
 async function save(initialize=false,{checkpoint=false}={}){
  if(!checkpoint&&activeGithubStep())throw problem('The active Basic step will save its working files and checkpoint before another backup.',409);
  if(closed)throw problem('Backup service is closing.');if(restoreRunning)await restoreRunning;if(!store)throw problem(configurationError||'GitHub backups are not configured.');if(pending)return pending;
  if(clock()<retryAt)throw problem('GitHub backup is waiting before its next permitted attempt.',429);
  const marker=changes();lastError='';pending=(async()=>{try{const saved=await store.snapshot(db,{initialize,directory:dirname(dbPath)});watermark=marker;lastSaved=saved.manifest.created;commit=saved.commit;retryAt=0;return snapshot();}catch(e){lastError=e.message;retryAt=e.retryAt||clock()+60000;throw e;}finally{pending=null;}})();return pending;
 }
 async function verifyRestore(){
  if(restoreRunning)return restoreRunning;if(!store)throw problem('GitHub backups are not configured.');restoreError='';restoreErrorKind=null;
  restoreRunning=(async()=>{let folder;try{folder=await mkdtemp(join(tmpdir(),'midnight-restore-check-'));if(pending)await pending;await store.connect();const reader=new GithubSnapshotStore({repo:store.repo,token:store.token,key:store.key,maxBytes:store.maxBytes,releaseSnapshots:store.releaseSnapshots},{fetchImpl:store.fetch,sleep:store.sleep,clock:store.clock});await reader.connect();const report=await reader.restore(join(folder,'verified.sqlite'));restoreReport={...report,kind:'isolated restore check',liveDataUnchanged:true,liveAudit:recoveryAudit(db)};db.prepare('INSERT INTO factory_restore_checks VALUES(1,?) ON CONFLICT(id) DO UPDATE SET report=excluded.report').run(JSON.stringify(restoreReport));return restoreReport;}catch(e){restoreError=String(e.message);restoreErrorKind=storageFailureKind(e);throw e;}finally{try{if(folder)await rm(folder,{recursive:true,force:true});}catch(e){restoreError='Temporary restore cleanup failed: '+e.message;restoreErrorKind=storageFailureKind(e);throw e;}finally{restoreRunning=null;}}})();return restoreRunning;
 }
 async function tick(){if(!store||closed||pending||restoreRunning||clock()<retryAt||store.hold||activeGithubStep())return;try{await store.connect();if(!closed&&store.manifest&&changes()!==watermark)await save();}catch(e){lastError=e.message;retryAt=e.retryAt||clock()+60000;}}
 const timer=autoStart&&store?setInterval(()=>{tick().catch(()=>{});},config.interval):null;timer?.unref();
 async function checkpoint(){if(!store)throw problem('GitHub checkpoint storage is not configured.');const target=changes();if(pending)await pending;while(watermark<target)await save(false,{checkpoint:true});await store.assertCurrent();return snapshot();}
 return {snapshot,save,tick,checkpoint,verifyRestore,assertWritable:async()=>{if(store)await store.assertCurrent();},audit:()=>recoveryAudit(db),connection:()=>store?{repo:store.repo,token:store.token,key:store.key}:null,async close(){closed=true;if(timer)clearInterval(timer);await pending?.catch(()=>{});await restoreRunning?.catch(()=>{});},async handle(req,res,path,method){if(!path.startsWith('/api/owner/ai-factory/storage'))return false;auth(req,null,true);if(path==='/api/owner/ai-factory/storage/audit'&&method==='GET'){send(res,200,recoveryAudit(db));return true;}if(path==='/api/owner/ai-factory/storage/restore-check'&&method==='POST'){if(req.headers.origin!==origin)fail(403,'Request origin rejected.');limit(req,'github-restore-check',2);if(!store?.manifest&&!store?.head)await store?.connect();if(!store?.manifest)fail(409,'A completed backup is required before verification.');verifyRestore().catch(()=>{});send(res,202,snapshot());return true;}if(path==='/api/owner/ai-factory/storage'&&method==='GET'){if(store&&!store.head)try{await store.connect();lastSaved=store.manifest?.created||null;commit=store.manifest?store.head:null;}catch(e){lastError=e.message;}send(res,200,snapshot());return true;}if(path==='/api/owner/ai-factory/storage/backup'&&method==='POST'){if(req.headers.origin!==origin)fail(403,'Request origin rejected.');limit(req,'github-backup',4);const b=await body(req);if(b.initialize!==undefined&&typeof b.initialize!=='boolean')fail(400,'Invalid backup initialization.');if(!store)fail(503,configurationError||'GitHub backups are not configured.');if(clock()<retryAt)fail(429,'GitHub backup is waiting before its next permitted attempt.');if(activeGithubStep())fail(409,'The active Basic step is saving its own checkpoint.');save(b.initialize===true).catch(()=>{});send(res,202,snapshot());return true;}fail(404,'Storage action not found.');}};
}
