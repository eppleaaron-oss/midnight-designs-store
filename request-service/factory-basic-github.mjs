import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';

const hash=b=>createHash('sha256').update(b).digest('hex');
const gitHash=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{status:409});};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const REPO='eppleaaron-oss/midnight-designs-store';
const MAX=25*1024*1024,HEADER='MIDNIGHT-BASIC-ASSET-1\n';
function seal(data,key,context){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));const encrypted=Buffer.concat([c.update(data),c.final()]);return HEADER+Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64')+'\n';}
function unseal(text,key,context){try{if(!text.startsWith(HEADER)||text.length>MAX*1.5+200)throw Error();const b=Buffer.from(text.slice(HEADER.length).trim(),'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]);}catch{fail('GitHub working file failed authentication. The tracked item was preserved.');}}

// Private, deletable release attachments: working pixels never enter Git history.
export class BasicGithubAssets{
 constructor({repo,token,key},{fetchImpl=fetch,sleep=wait,clock=Date.now}={}){Object.assign(this,{repo,token,key,fetchImpl,sleep,clock});this.lastWrite=0;this.retryAt=0;this.repositoryId=null;this.knownReleases=new Map();}
 async api(path,{method='GET',body,missing=false,upload=false}={}){
  if(this.retryAt>this.clock())throw Object.assign(Error('GitHub rate limit reached. Working files were retained for retry.'),{status:429,retryAfter:Math.ceil((this.retryAt-this.clock())/1000),retryAt:this.retryAt});
  if(method!=='GET'){await this.sleep(Math.max(0,1000-(this.clock()-this.lastWrite)));this.lastWrite=this.clock();}
  let r;try{r=await this.fetchImpl((upload?'https://uploads.github.com/repos/':'https://api.github.com/repos/')+this.repo+path,{method,headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':upload?'application/octet-stream':'application/json',...(method==='GET'?{'Cache-Control':'no-cache'}:{})},cache:'no-store',...(body!==undefined?{body:upload?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Object.assign(Error('GitHub working storage is unavailable. Resume this same item after the connection recovers.'),{status:503});}
  if(r.status===404&&missing)return null;let rateMessage='';if(r.status===403)try{rateMessage=String((await r.clone().json()).message||'');}catch{}
  const remaining=r.headers.get('x-ratelimit-remaining'),after=r.headers.get('retry-after');
  if(r.status===429||r.status===403&&(after||remaining==='0'||/rate limit|abuse detection/i.test(rateMessage))){const numeric=after?.trim()?Number(after):NaN,date=after?Date.parse(after):NaN,reset=Number(r.headers.get('x-ratelimit-reset')),seconds=Math.max(1,Math.ceil(Number.isFinite(numeric)?numeric:Number.isFinite(date)?(date-this.clock())/1000:remaining==='0'&&Number.isFinite(reset)&&reset>0?reset-this.clock()/1000:60));this.retryAt=this.clock()+seconds*1000;throw Object.assign(Error('GitHub rate limit reached. Working files were retained for retry.'),{status:429,retryAfter:seconds,retryAt:this.retryAt});}
  if(!r.ok)throw Object.assign(Error('GitHub working storage rejected the request (HTTP '+r.status+').'),{status:r.status>=500?503:409});
  return r.status===204?{}:r.json();
 }
 async verify(){const r=await this.api('');if(r.private!==true||r.visibility&&r.visibility!=='private'||!Number.isSafeInteger(r.id))fail('Working artwork requires the existing private GitHub backup repository.');if(this.repositoryId!==null&&r.id!==this.repositoryId)fail('GitHub working repository identity changed.');this.repositoryId=r.id;return true;}
 body(job){return 'Midnight Designs Basic workspace v1\n'+createHmac('sha256',this.key).update(job).digest('hex');}
 owned(r,job){if(!r||r.draft!==true||r.tag_name!=='md-basic-'+job||r.body!==this.body(job))fail('This GitHub release is not the tracked private working workspace. Nothing was deleted.');return r;}
 async find(job){for(let page=1;page<=10;page++){const rows=await this.api('/releases?per_page=100&page='+page);if(!Array.isArray(rows))fail('GitHub returned an invalid workspace list.');const found=rows.filter(r=>r.tag_name==='md-basic-'+job);if(found.length>1){if(!/^recovery-v2-[a-f0-9]{64}$/.test(job))fail('Duplicate working releases require review. Nothing was deleted.');for(const r of found)this.owned(r,job);found.sort((a,b)=>a.id-b.id);}if(found.length)return this.owned(found[0],job);if(rows.length<100)return null;}fail('Working release listing limit reached.');}
 async release(job){await this.verify();const known=this.knownReleases.get(job);if(known)return this.owned(await this.api('/releases/'+known.id),job);let r=await this.find(job);if(r){this.knownReleases.set(job,r);return r;}try{r=await this.api('/releases',{method:'POST',body:{tag_name:'md-basic-'+job,target_commitish:'main',name:'Basic working item '+job,draft:true,body:this.body(job)}});}catch(e){r=await this.find(job);if(!r)throw e;}this.owned(r,job);this.knownReleases.set(job,r);return r;}
 async list(id){const rows=[];for(let page=1;page<=10;page++){const next=await this.api('/releases/'+id+'/assets?per_page=100&page='+page);if(!Array.isArray(next))fail('GitHub returned an invalid working-file list.');rows.push(...next);if(next.length<100)return rows;}fail('Working-file limit reached.');}
 async read(asset,job,kind,file,expected){
  const meta=await this.api('/releases/assets/'+asset);if(!meta||meta.size>MAX*1.5+200)fail('GitHub working attachment is invalid or too large.');
  let r;
  for(let attempt=0;attempt<3;attempt++){
   // A cached API redirect can contain an expired signed download URL. Obtain
   // a fresh redirect on retry; never forward the GitHub token to asset hosts.
   r=await this.fetchImpl('https://api.github.com/repos/'+this.repo+'/releases/assets/'+asset+'?download='+this.clock()+'-'+attempt,{headers:{Authorization:'Bearer '+this.token,Accept:'application/octet-stream','X-GitHub-Api-Version':'2022-11-28','Cache-Control':'no-cache'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(30000)});
   if([301,302,303,307,308].includes(r.status)){let url;try{url=new URL(r.headers.get('location'));}catch{fail('GitHub returned an invalid asset download.');}if(url.protocol!=='https:'||url.username||url.password||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname))fail('GitHub returned an unrecognized asset download host.');r=await this.fetchImpl(url.href,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});}
   if(r.ok)break;
   if(![401,403,408,429,500,502,503,504].includes(r.status)||attempt===2)throw Object.assign(Error('The saved GitHub working attachment could not be downloaded (HTTP '+r.status+').'),{status:503});
   await r.body?.cancel();await this.sleep(Math.max(1000*2**attempt,Math.min(60000,Number(r.headers.get('retry-after')||0)*1000)));
  }
  let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>MAX*1.5+200)fail('Working attachment download exceeds its size limit.');chunks.push(c);}
  const data=unseal(Buffer.concat(chunks).toString('utf8'),this.key,[job,kind,file].join(':'));if(hash(data)!==expected)fail('GitHub working file checksum changed. Nothing was published.');return data;
 }
 async put(job,kind,file,data,expected){
  if(!data.length||data.length>MAX||hash(data)!==expected)fail('Working file has invalid bytes or checksum.');
  const release=await this.release(job),name=kind+'-'+file+'-'+expected+'.mdenc';let asset=(await this.list(release.id)).find(a=>a.name===name);
  if(!asset){const text=seal(data,this.key,[job,kind,file].join(':'));try{asset=await this.api('/releases/'+release.id+'/assets?name='+encodeURIComponent(name),{method:'POST',body:text,upload:true});}catch(e){asset=(await this.list(release.id)).find(a=>a.name===name);if(!asset)throw e;}}
  if(!Number.isSafeInteger(asset?.id)||asset.size>MAX*1.5+200)fail('GitHub did not identify the saved working attachment.');
  await this.read(asset.id,job,kind,file,expected);return {release:release.id,asset:asset.id,bytes:asset.size,name};
 }
 async remove(job,releaseId){
  await this.verify();const release=await this.api('/releases/'+releaseId,{missing:true});if(!release)return {verified:true,remaining:0};this.owned(release,job);
  const files=await this.list(releaseId);for(const a of files.slice(0,12)){await this.api('/releases/assets/'+a.id,{method:'DELETE',missing:true});if(await this.api('/releases/assets/'+a.id,{missing:true}))fail('GitHub has not confirmed deletion of a temporary attachment.');}
  const remaining=await this.list(releaseId);if(remaining.length)return {verified:false,remaining:remaining.length};
  await this.api('/releases/'+releaseId,{method:'DELETE',missing:true});if(await this.api('/releases/'+releaseId,{missing:true}))fail('GitHub has not confirmed workspace deletion.');this.knownReleases.delete(job);return {verified:true,remaining:0};
 }
}

export function factoryBasicGithub({db,backups,basic,fetchImpl=fetch,sleep=wait,clock=Date.now,passwordHash,env=process.env}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_github_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,token TEXT NOT NULL DEFAULT '',verified INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
 INSERT OR IGNORE INTO factory_basic_github_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS factory_basic_remote_assets(job TEXT NOT NULL,kind TEXT NOT NULL,file TEXT NOT NULL,release_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,name TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,encoded_bytes INTEGER NOT NULL,selector TEXT NOT NULL,PRIMARY KEY(job,kind,file));
 CREATE TABLE IF NOT EXISTS factory_basic_final_media(job TEXT NOT NULL,file TEXT NOT NULL,url TEXT NOT NULL,sha256 TEXT NOT NULL,git_sha TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(job,file));`);
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 if(!db.prepare('PRAGMA table_info(factory_basic_github_settings)').all().some(c=>c.name==='managed'))db.exec('ALTER TABLE factory_basic_github_settings ADD COLUMN managed INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(factory_basic_github_settings)').all().some(c=>c.name==='probe'))db.exec("ALTER TABLE factory_basic_github_settings ADD COLUMN probe TEXT NOT NULL DEFAULT ''");
 const config=backups.connection(),key=config?.key;let publishingToken='',publishingRun='',publishingUntil=0,testing=null;let assets=config?new BasicGithubAssets(config,{fetchImpl,sleep,clock}):null,checkpointing=null;
 const settings=()=>get('SELECT * FROM factory_basic_github_settings WHERE id=1');
 const token=()=>{const saved=settings().token;if(saved&&key)return unseal(saved,key,'store-publishing-token').toString();return settings().managed?(publishingUntil>clock()?publishingToken:''):(env.CATALOG_GITHUB_TOKEN||env.FACTORY_BACKUP_GITHUB_TOKEN||'');};
 async function gh(path,{method='GET',body,missing=false}={}){
  const t=token();if(!t){if(settings().managed)throw Object.assign(Error('Waiting for the GitHub publishing connection.'),{status:503,retryablePublisher:true});fail('Connect GitHub store publishing on Basic.');}
  let r;try{r=await fetchImpl('https://api.github.com/repos/'+REPO+path,{method,headers:{Authorization:'Bearer '+t,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}catch{throw Object.assign(Error('GitHub store connection is unavailable.'),{status:503});}
  if(r.status===404&&missing)return null;if(!r.ok&&settings().managed&&[401,403,429].includes(r.status))throw Object.assign(Error('Waiting for GitHub publishing access to refresh.'),{status:503,retryablePublisher:true,httpStatus:r.status});if(!r.ok)fail('GitHub store access was rejected (HTTP '+r.status+'). The token needs access to midnight-designs-store.');return r.status===204?{}:r.json();
 }
 const ready=()=>!!assets&&settings().enabled===1&&backups.snapshot().initialized&&!backups.snapshot().conflict;
 const owns=job=>!!get('SELECT job FROM factory_basic_items WHERE job=? AND closed=0',job);
 function records(job){return [
  ...all('SELECT f.id,length(f.data) length,f.sha256 FROM factory_print_files f WHERE f.draft IN (SELECT value FROM factory_job_profiles,json_each(templates) WHERE job=?)',job).map(f=>({...f,kind:'print',selector:{id:f.id}})),
  ...all('SELECT m.id,length(m.data) length,f.sha256 FROM factory_mockups m JOIN factory_mockup_files f ON f.file=m.id WHERE m.job=?',job).map(f=>({...f,kind:'mockup',selector:{id:f.id}})),
  ...all('SELECT variant,task_key,url,sha256,length(data) length FROM factory_mockup_downloads WHERE job=?',job).map(f=>({...f,id:hash(JSON.stringify([f.variant,f.task_key,f.url])),kind:'stage',selector:{variant:f.variant,task_key:f.task_key,url:f.url}}))];}
 function bytes(job,f){return Buffer.from((f.kind==='print'?get('SELECT data FROM factory_print_files WHERE id=?',f.id):f.kind==='mockup'?get('SELECT data FROM factory_mockups WHERE id=?',f.id):get('SELECT data FROM factory_mockup_downloads WHERE job=? AND variant=? AND task_key=? AND url=?',job,f.selector.variant,f.selector.task_key,f.selector.url))?.data||[]);}
 async function persist(job){if(!ready()||!owns(job))fail('The GitHub working workspace is not ready.');for(const f of records(job)){if(!f.length)continue;const saved=get('SELECT sha256 FROM factory_basic_remote_assets WHERE job=? AND kind=? AND file=?',job,f.kind,f.id);if(saved){if(saved.sha256!==f.sha256)fail('A saved working file changed after its GitHub checkpoint.');continue;}
   // Identical panels across sizes share one verified encrypted attachment.
   // Each file keeps its own draft/placement identity and original AAD context.
   const same=get('SELECT * FROM factory_basic_remote_assets WHERE job=? AND kind=? AND sha256=? AND bytes=? LIMIT 1',job,f.kind,f.sha256,f.length);
   if(same){if(hash(bytes(job,f))!==f.sha256)fail('A working file changed before its GitHub checkpoint.');const original=JSON.parse(same.selector);run('INSERT INTO factory_basic_remote_assets VALUES(?,?,?,?,?,?,?,?,?,?)',job,f.kind,f.id,same.release_id,same.asset_id,same.name,f.sha256,f.length,same.encoded_bytes,JSON.stringify({...f.selector,contextFile:original.contextFile||same.file}));}
   else {const a=await assets.put(job,f.kind,f.id,bytes(job,f),f.sha256);run('INSERT INTO factory_basic_remote_assets VALUES(?,?,?,?,?,?,?,?,?,?)',job,f.kind,f.id,a.release,a.asset,a.name,f.sha256,f.length,a.bytes,JSON.stringify(f.selector));}
  }}
 async function checkpoint(job){if(!ready())fail('GitHub checkpointing is unavailable. The item is held.');const previous=checkpointing;const p=(async()=>{await previous;if(job&&owns(job))await persist(job);await backups.checkpoint();})();checkpointing=p;try{await p;}finally{if(checkpointing===p)checkpointing=null;}}
 async function load(job,f,known=null){const a=get('SELECT * FROM factory_basic_remote_assets WHERE job=? AND kind=? AND file=?',job,f.kind,f.id);if(!a)fail('A required working file has no confirmed GitHub attachment. Resume or review this item.');const data=known||await assets.read(a.asset_id,job,f.kind,JSON.parse(a.selector).contextFile||f.id,a.sha256);if(hash(data)!==a.sha256)fail('Recovered working pixels do not match this tracked file.');if(f.kind==='print')run('UPDATE factory_print_files SET data=? WHERE id=? AND length(data)=0',data,f.id);else if(f.kind==='mockup')run('UPDATE factory_mockups SET data=? WHERE id=? AND length(data)=0',data,f.id);else run('UPDATE factory_mockup_downloads SET data=? WHERE job=? AND variant=? AND task_key=? AND url=? AND length(data)=0',data,job,f.selector.variant,f.selector.task_key,f.selector.url);return data;}
 async function hydrate(job){if(!ready()||!owns(job))return;const files=records(job),cache=new Map();
  for(const f of files.filter(f=>f.length)){const data=bytes(job,f);if(hash(data)!==f.sha256)fail('Working pixels changed after their saved checksum.');cache.set(f.kind+':'+f.sha256,data);}
  let downloaded=0,remaining=0;for(const f of files.filter(f=>!f.length)){const key=f.kind+':'+f.sha256,known=cache.get(key);
   if(f.kind==='print'&&!get('SELECT file FROM factory_basic_remote_assets WHERE job=? AND kind=? AND file=?',job,f.kind,f.id)){
    // A lease can expire after rendering but before the attachment checkpoint.
    // Recover identical verified bytes, or let the files step regenerate the
    // same file ID and enforce its previously recorded checksum.
    if(known){if(hash(known)!==f.sha256)fail('Recovered print pixels do not match their recorded checksum.');run('UPDATE factory_print_files SET data=? WHERE id=? AND length(data)=0',known,f.id);continue;}
    if(get('SELECT step FROM factory_job_runtime WHERE job=?',job)?.step===2)continue;
   }
   if(!known&&downloaded>=4){remaining++;continue;}const data=await load(job,f,known);if(!known)downloaded++;cache.set(key,data);}
  return remaining?{defer:true,note:'Restoring this item’s verified GitHub working files.'}:null;}
 async function finalMedia(job,media,supplierId){
  const mapped=new Map(all('SELECT * FROM factory_basic_final_media WHERE job=?',job).map(x=>[x.file,x]));let count=0;
  for(const m of media){if(mapped.has(m.id))continue;if(count++>=4)return {defer:true,note:'Saving approved product photos directly to the storefront repository.'};const row=get('SELECT data,mime FROM factory_mockups WHERE id=? AND job=?',m.id,job),data=Buffer.from(row?.data||[]);if(!data.length||hash(data)!==m.sha256)fail('The approved photo failed validation before storefront transfer.');
   const path='images/factory/'+supplierId+'/'+m.sha256+(row.mime==='image/png'?'.png':'.jpg'),expected=gitHash(data),old=await gh('/contents/'+path+'?ref=main',{missing:true});if(old&&old.sha!==expected)fail('An existing storefront photo has a different checksum.');
   if(!old){await gh('/contents/'+path,{method:'PUT',body:{message:'Save approved product photo '+supplierId,branch:'main',content:data.toString('base64')}});await sleep(1000);}
   const saved=await gh('/contents/'+path+'?ref=main');if(saved?.sha!==expected)fail('GitHub has not confirmed the final storefront photo.');
   const url='https://midnight-designs.store/'+path;run('INSERT INTO factory_basic_final_media(job,file,url,sha256,git_sha) VALUES(?,?,?,?,?)',job,m.id,url,m.sha256,expected);mapped.set(m.id,{url});
  }
  return {media:media.map(m=>({...m,storeUrl:mapped.get(m.id).url}))};
 }
 async function verifyFinalMedia(job){const files=all('SELECT * FROM factory_basic_final_media WHERE job=? AND verified=0',job);for(const f of files.slice(0,4)){let r;try{r=await fetchImpl(f.url+'?verify='+clock(),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{return {defer:true,note:'Waiting for the approved photos on the live storefront.'};}if(!r.ok)return {defer:true,note:'Waiting for the approved photos on the live storefront.'};let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>5*1024*1024)fail('The storefront photo exceeds the approved image limit.');chunks.push(c);}if(hash(Buffer.concat(chunks))!==f.sha256)fail('The live storefront photo does not match the approved image. Working files were retained.');run('UPDATE factory_basic_final_media SET verified=1 WHERE job=? AND file=?',job,f.file);}return files.length>4?{defer:true,note:'Verifying the remaining live storefront photos before cleanup.'}:null;}
 async function cleanup(job){
  const rows=all('SELECT * FROM factory_basic_remote_assets WHERE job=?',job),releases=[...new Set(rows.map(r=>r.release_id))];let remaining=0;
  // Also find an accepted upload whose acknowledgement was lost before its row was saved.
  if(!releases.length){const r=await assets.find(job);if(r)releases.push(r.id);}
  for(const id of releases){const result=await assets.remove(job,id);remaining+=result.remaining;}
  if(remaining)return {verified:false,remaining};
  const approved=get('SELECT decision FROM factory_basic_items WHERE job=?',job)?.decision==='approved';
  if(approved){for(const m of all('SELECT id FROM factory_mockups WHERE job=?',job))if(!get('SELECT file FROM factory_basic_final_media WHERE job=? AND file=? AND verified=1',job,m.id))fail('Keep the approved photos until every final storefront image is live and verified.');run("UPDATE factory_mockups SET data=x'' WHERE job=?",job);}
  run('DELETE FROM factory_basic_remote_assets WHERE job=?',job);return {verified:true,remaining:0,releasedRemoteBytes:[...new Map(rows.map(r=>[r.asset_id,r])).values()].reduce((n,r)=>n+r.encoded_bytes,0),removedAssetIds:rows.map(r=>r.asset_id)};
 }
 async function enable(value){
  if(!assets)fail('The private GitHub backup connection is required first.');await assets.verify();const previous=settings();if(value===undefined&&previous.managed===1&&previous.enabled===1)return snapshot();
  if(value!==undefined){if(typeof value!=='string'||value.trim().length<20||value.length>500)fail('Enter a valid repository-scoped GitHub token.');run('UPDATE factory_basic_github_settings SET token=? WHERE id=1',seal(Buffer.from(value.trim()),key,'store-publishing-token'));}
  try{const repo=await gh('');if(String(repo.id)!=='1393932711'||repo.permissions?.push!==true)fail('The GitHub token needs Contents read/write access to midnight-designs-store.');await gh('/dispatches',{method:'POST',body:{event_type:'midnight-basic-connection',client_payload:{probe:true}}});await testStorage();run("UPDATE factory_basic_github_settings SET enabled=1,managed=0,verified=?,error='' WHERE id=1",clock());await backups.checkpoint();return snapshot();}catch(e){run('UPDATE factory_basic_github_settings SET token=?,enabled=?,managed=?,verified=?,error=? WHERE id=1',previous.token,previous.enabled,previous.managed,previous.verified,e.message.slice(0,300));throw e;}
 }
 function snapshot(){const s=settings();return {available:!!assets,enabled:s.enabled===1,ready:ready(),storeConfigured:s.enabled===1&&(s.managed===1||!!token()),managed:s.managed===1,publisherOnline:publishingUntil>clock(),storageTest:s.probe?JSON.parse(s.probe):null,error:s.error||backups.snapshot().error,storage:'Private GitHub temporary attachments and verified checkpoints',processing:'One backend item at a time on the existing service; free hosting may pause and resume after a restart.',noAddedPaidServices:true,remoteBytes:get('SELECT coalesce(sum(encoded_bytes),0) n FROM (SELECT asset_id,max(encoded_bytes) encoded_bytes FROM factory_basic_remote_assets GROUP BY asset_id)').n};}
 async function testStorage(){
  const previous=settings().probe?JSON.parse(settings().probe):null;if(previous?.verified)return previous;if(testing)return testing;
  if(!assets)fail('The private GitHub backup connection is required first.');
  if(get("SELECT b.job FROM factory_basic_items b JOIN factory_jobs j ON j.id=b.job WHERE b.closed=0 AND j.status='running'"))fail('Wait for the current product step before testing storage.');
  testing=(async()=>{const id=previous?.id||'probe-'+randomBytes(16).toString('hex'),file=previous?.file||randomBytes(16).toString('hex'),data=Buffer.from('Midnight Designs encrypted working-file verification'),sha256=hash(data);let record={id,file,verified:false};run('UPDATE factory_basic_github_settings SET probe=? WHERE id=1',JSON.stringify(record));await backups.checkpoint();
   const a=await assets.put(id,'probe',file,data,sha256);record={...record,releaseId:a.release,assetId:a.asset,bytes:a.bytes};run('UPDATE factory_basic_github_settings SET probe=? WHERE id=1',JSON.stringify(record));await backups.checkpoint();const removed=await assets.remove(id,a.release);if(!removed.verified)fail('Storage test cleanup is not yet confirmed.');record={...record,verified:true,remainingAssets:0,verifiedAt:new Date(clock()).toISOString()};run('UPDATE factory_basic_github_settings SET probe=? WHERE id=1',JSON.stringify(record));await backups.checkpoint();return record;
  })();try{return await testing;}finally{testing=null;}
 }
 async function connectPublisher(value,runId,expires){
  if(!assets)fail('The private GitHub backup connection is required first.');
  if(publishingRun!==runId||publishingToken!==value){const r=await fetchImpl('https://api.github.com/repos/'+REPO+'/dispatches',{method:'POST',headers:{Authorization:'Bearer '+value,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({event_type:'midnight-basic-connection',client_payload:{probe:true}}),signal:AbortSignal.timeout(20000)});if(r.status!==204)fail('GitHub workflow does not have store write access.');}
  publishingToken=value;publishingRun=runId;publishingUntil=Math.min(expires,clock()+60000);
  const s=settings();if(!s.enabled||!s.managed&&!s.token&&!env.CATALOG_GITHUB_TOKEN){await assets.verify();await testStorage();run("UPDATE factory_basic_github_settings SET enabled=1,managed=1,verified=?,error='' WHERE id=1",clock());await backups.checkpoint();}
 }
 return {ready,owns,checkpoint,hydrate,cleanup,finalMedia,verifyFinalMedia,enable,snapshot,testStorage,connectPublisher,disconnectPublisher:runId=>{if(publishingRun===runId){publishingToken='';publishingUntil=0;}},publisherWait:job=>owns(job)&&settings().managed&&!token()?{defer:true,note:'Waiting for the next automatic GitHub publishing connection.'}:null,storeToken:()=>settings().enabled===1?token():'',secrets:()=>[token()],async file(kind,id){const a=get('SELECT * FROM factory_basic_remote_assets WHERE kind=? AND file=?',kind,id);if(!a)return null;return load(a.job,{kind,id,selector:JSON.parse(a.selector)});},async probe(){if(!assets)fail('GitHub backup access is missing.');await assets.verify();return snapshot();},mediaUrl:file=>get('SELECT url FROM factory_basic_final_media WHERE file=?',file)?.url||null};
}
