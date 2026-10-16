import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const hold=message=>{throw Object.assign(Error(message),{status:409});};
const validKey=key=>typeof key==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(key);
const MAX_IMAGE=5*1024*1024,MAX_STORAGE=200*1024*1024;

export function mockupImageURL(value){
 let u;try{u=new URL(value);}catch{hold('Printful returned an invalid mockup image URL.');}
 // Printful documents this exact S3 bucket. Do not permit arbitrary AWS hosts.
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!(u.hostname.endsWith('.printful.com')||u.hostname==='printful-upload.s3-accelerate.amazonaws.com'))hold('Printful mockup image host is unsupported.');
 return u.href;
}

export function mockupImages(result,variant){
 if(!Array.isArray(result?.mockups)||result.mockups.length>100)hold('Printful returned an invalid mockup list.');
 const images=new Map();
 for(const m of result.mockups){
  if(!Array.isArray(m.variant_ids)||!m.variant_ids.includes(variant))continue;
  const placement=String(m.placement||'product').slice(0,100),extra=m.extra||[];
  if(!Array.isArray(extra)||extra.length>100)hold('Printful returned an invalid extra-angle list.');
  const add=(url,title,style)=>{if(!url)return;url=mockupImageURL(url);if(!images.has(url))images.set(url,{url,placement,title:String(title||placement).slice(0,150),style:String(style||'Product').slice(0,100)});};
  add(m.mockup_url,m.display_name||placement,'Default');
  for(const e of extra)add(e.url,e.title||e.option||placement,e.option_group||'Product');
 }
 if(!images.size)hold('Printful returned no mockups for the selected catalog variant.');
 if(images.size>32)hold('Printful returned more than 32 mockup images for one variant. Review the requested styles before retrying.');
 return [...images.values()];
}

const LABELS={queued:'Mockup not requested — waiting for the worker',submitting:'Submitting mockup request — acceptance not confirmed',uncertain:'Mockup request outcome unknown — reconciliation required',accepted:'Printful accepted the task — awaiting confirmed status',pending:'Printful is generating the mockup',completed:'Printful finished — saving images',downloading:'Printful finished — saving images',saved:'Mockup images saved',failed:'Printful mockup generation failed',download_failed:'Printful finished — image download needs retry',invalid:'Printful result needs review',timed_out:'Accepted task exceeded the generation time limit',rejected:'Printful rejected the mockup request',poll_error:'Accepted task — status check unavailable',blocked:'Mockup not requested — print-file access needs review'};

export function factoryMockups({db,checked,pf,link,operation,begin,done,fetchImpl=fetch,clock=Date.now,storageDurable=false,requestOptions=()=>({}),validateVariant=async()=>{},verifyPrintFile=async()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_mockup_tasks(job TEXT NOT NULL,variant INTEGER NOT NULL,product INTEGER NOT NULL,task_key TEXT,state TEXT NOT NULL,supplier_status TEXT,accepted INTEGER,next_poll INTEGER NOT NULL DEFAULT 0,checked INTEGER,error TEXT NOT NULL DEFAULT '',request_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(job,variant));
 CREATE TABLE IF NOT EXISTS factory_mockup_task_history(job TEXT NOT NULL,variant INTEGER NOT NULL,task_key TEXT NOT NULL,product INTEGER NOT NULL,request_hash TEXT NOT NULL,supplier_status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',accepted INTEGER NOT NULL,checked INTEGER,PRIMARY KEY(job,variant,task_key));
 CREATE TABLE IF NOT EXISTS factory_mockup_manifests(job TEXT NOT NULL,variant INTEGER NOT NULL,task_key TEXT NOT NULL,images TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(job,variant,task_key));
 CREATE TABLE IF NOT EXISTS factory_mockup_downloads(job TEXT NOT NULL,variant INTEGER NOT NULL,task_key TEXT NOT NULL,url TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(job,variant,task_key,url));
 CREATE TABLE IF NOT EXISTS factory_mockup_files(file TEXT PRIMARY KEY,task_key TEXT NOT NULL,source_url TEXT NOT NULL,placement TEXT NOT NULL,title TEXT NOT NULL,style TEXT NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created INTEGER NOT NULL);`);
 const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args),active=new Set();
 const task=(job,variant)=>get('SELECT * FROM factory_mockup_tasks WHERE job=? AND variant=?',job,variant),state=(job,variant,value,error='')=>run('UPDATE factory_mockup_tasks SET state=?,error=?,updated=? WHERE job=? AND variant=?',value,error.slice(0,500),clock(),job,variant);
 const signature=d=>hash(JSON.stringify({product:d.product,variant:d.variant,technique:d.technique,areas:d.areas.map(a=>({placement:a.placement,width:a.width,height:a.height,sha256:a.sha256}))}));
 function storage(){return get('SELECT (SELECT COALESCE(sum(length(data)),0) FROM factory_mockups)+(SELECT COALESCE(sum(length(data)),0) FROM factory_mockup_downloads) n').n;}
 function ensure(p,d){let t=task(p.j.id,d.variant);if(t&&t.request_hash!==signature(d))hold('Print files changed after this mockup task was prepared. Review the product; the old task cannot be reused for different artwork.');if(t)return t;
  const op=operation(p.j.id,'mockup-'+d.variant),key=validKey(op?.reference)?op.reference:null;
  run('INSERT INTO factory_mockup_tasks(job,variant,product,task_key,state,accepted,next_poll,request_hash,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',p.j.id,d.variant,d.product,key,key?'accepted':op?'uncertain':'queued',key?op.created:null,key?op.created+10000:0,signature(d),clock(),clock());return task(p.j.id,d.variant);
 }
 function recordResult(job,variant,key,result){
  if(result?.task_key!==undefined&&result.task_key!==key)hold('Printful returned a different mockup task key. No images were attached.');
  if(!['pending','completed','failed'].includes(result?.status))hold('Printful did not return a recognized mockup task status.');
  run('UPDATE factory_mockup_tasks SET state=?,supplier_status=?,checked=?,next_poll=?,error=?,updated=? WHERE job=? AND variant=?',result.status,result.status,clock(),clock()+15000,result.status==='failed'?String(result.error||'Printful reported task failure.').slice(0,500):'',clock(),job,variant);
  const t=task(job,variant);run('INSERT INTO factory_mockup_task_history VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(job,variant,task_key) DO UPDATE SET supplier_status=excluded.supplier_status,error=excluded.error,checked=excluded.checked',job,variant,key,t.product,t.request_hash,result.status,result.status==='failed'?String(result.error||'Printful reported failure.').slice(0,500):'',t.accepted,clock());
  if(result.status==='completed'){const images=mockupImages(result,variant);run('INSERT OR IGNORE INTO factory_mockup_manifests VALUES(?,?,?,?,?)',job,variant,key,JSON.stringify(images),clock());}
 }
 async function submit(p,d,t,guard){
  if(!storageDurable)hold('Persistent backend storage is required before submitting a Printful mockup task.');
  if(t.attempts>=5)hold('Mockup request retry limit reached. Review this product before creating replacement work.');
  if(clock()<t.next_poll)return {defer:true,note:'Mockup request is waiting for Printful rate-limit recovery.'};
  const latest=get('SELECT max(created) submitted FROM factory_mockup_tasks WHERE attempts>0');
  const recent=get('SELECT max(created) submitted FROM factory_publish_operations WHERE operation LIKE \'mockup-%\'');
  const last=Math.max(latest?.submitted||0,recent?.submitted||0);
  if(last&&clock()-last<31000)return {defer:true,note:'Mockup not requested yet — waiting for the supplier submission interval.'};
  await validateVariant(p,d);const files=d.areas.map(a=>({placement:a.placement,image_url:link(a.file),position:{area_width:a.width,area_height:a.height,width:a.width,height:a.height,top:0,left:0}}));try{await Promise.all(files.map((f,i)=>verifyPrintFile(f.image_url,d.areas[i])));}catch(e){state(p.j.id,d.variant,'blocked',e.message);throw e;}guard();checked(p.j.id);
  const key='mockup-'+d.variant,id=p.j.id+':'+d.variant;active.add(id);
  try{
   begin(p.j.id,key);run("UPDATE factory_mockup_tasks SET state='submitting',attempts=attempts+1,created=?,updated=?,error='' WHERE job=? AND variant=?",clock(),clock(),p.j.id,d.variant);
   let result;try{result=await pf('mockup-generator/create-task/'+d.product,{method:'POST',body:JSON.stringify({variant_ids:[d.variant],format:'jpg',width:1000,...requestOptions(p.j.id),files})});}catch(e){
    if([400,401,403,404,422,429].includes(e.printfulStatus)){run('DELETE FROM factory_publish_operations WHERE job=? AND operation=?',p.j.id,key);state(p.j.id,d.variant,e.printfulStatus===429?'queued':'rejected',e.message);if(e.printfulStatus===429)run('UPDATE factory_mockup_tasks SET next_poll=? WHERE job=? AND variant=?',clock()+Math.max(60000,(e.retryAfter||0)*1000),p.j.id,d.variant);}
    else state(p.j.id,d.variant,'uncertain','Printful request outcome is unknown. Verify the task before retrying.');throw e;
   }
   if(!validKey(result?.task_key)){state(p.j.id,d.variant,'uncertain','Printful did not return a valid task key. Generation is not confirmed.');return {wait:'Printful mockup acceptance is unconfirmed. Reconcile the request before retrying.'};}
   // Save the accepted key before interpreting status or downloading any images.
   done(p.j.id,key,result.task_key);run("UPDATE factory_mockup_tasks SET task_key=?,accepted=?,state='accepted',next_poll=?,updated=? WHERE job=? AND variant=?",result.task_key,clock(),clock()+10000,clock(),p.j.id,d.variant);
   run('INSERT OR IGNORE INTO factory_mockup_task_history VALUES(?,?,?,?,?,?,?,?,?)',p.j.id,d.variant,result.task_key,d.product,t.request_hash,'accepted','',clock(),null);
   if(result.status!==undefined){try{recordResult(p.j.id,d.variant,result.task_key,result);}catch(e){state(p.j.id,d.variant,'invalid',e.message);return {wait:e.message};}}
   if(result.status==='pending')run('UPDATE factory_mockup_tasks SET next_poll=? WHERE job=? AND variant=?',clock()+10000,p.j.id,d.variant);
   if(result.status==='failed')return {wait:'Printful mockup task failed: '+String(result.error||'No reason supplied.')};
   return {defer:true,note:result.status==='pending'?'Printful accepted the mockup task and reports it pending.':result.status==='completed'?'Printful finished the mockup; image storage is next.':'Printful accepted the task key; generation status still needs verification.'};
  }finally{active.delete(id);}
 }
 async function download(image){
  const r=await fetchImpl(mockupImageURL(image.url),{redirect:'error',signal:AbortSignal.timeout(20000)}),mime=r.headers.get('content-type')?.split(';')[0];
  if(!r.ok)throw Object.assign(Error(r.status===404||r.status===403?'Printful mockup source expired or is unavailable. A verified replacement task may be needed.':'Printful mockup download failed (HTTP '+r.status+').'),{status:r.status>=500||r.status===429?502:409});
  if(!['image/jpeg','image/png'].includes(mime))hold('Printful mockup download is not a PNG or JPEG.');
  if(Number(r.headers.get('content-length'))>MAX_IMAGE)hold('Printful mockup exceeds the 5 MB image limit.');
  let bytes=0;const chunks=[];for await(const chunk of r.body){bytes+=chunk.length;if(bytes>MAX_IMAGE)hold('Printful mockup exceeds the 5 MB image limit.');chunks.push(chunk);}
  const data=Buffer.concat(chunks);let meta;try{const decoded=sharp(data,{limitInputPixels:20_000_000,failOn:'warning'});meta=await decoded.metadata();if(meta.pages>1||meta.format!==({'image/png':'png','image/jpeg':'jpeg'}[mime]))hold('Printful mockup encoding does not match its content type.');await decoded.stats();}catch(e){if(e.status===409)throw e;hold('Printful mockup image failed full decoding/integrity validation.');}
  return {data,mime,sha256:hash(data),width:meta.width,height:meta.height};
 }
 async function saveImages(p,d,t,guard){
  const row=get('SELECT images FROM factory_mockup_manifests WHERE job=? AND variant=? AND task_key=?',p.j.id,d.variant,t.task_key);if(!row)hold('Completed Printful task has no verified image manifest.');const images=JSON.parse(row.images);
  const saved=all('SELECT * FROM factory_mockup_downloads WHERE job=? AND variant=? AND task_key=?',p.j.id,d.variant,t.task_key);
  for(const image of saved)if(hash(Buffer.from(image.data))!==image.sha256)hold('A staged mockup checksum changed. Review storage before continuing.');
  const missing=images.filter(i=>!saved.some(s=>s.url===i.url));state(p.j.id,d.variant,'downloading');
  // At most two parallel downloads keep each leased step within worker timeouts.
  const batch=missing.slice(0,2),results=await Promise.allSettled(batch.map(download));let error;
  for(let i=0;i<results.length;i++){const result=results[i];if(result.status==='rejected'){error??=result.reason;continue;}const a=result.value;if(storage()+a.data.length>MAX_STORAGE){error??=Object.assign(Error('Persistent mockup storage limit reached.'),{status:409});continue;}run('INSERT OR IGNORE INTO factory_mockup_downloads VALUES(?,?,?,?,?,?,?,?,?,?)',p.j.id,d.variant,t.task_key,batch[i].url,a.mime,a.data,a.sha256,a.width,a.height,clock());}
  if(error){state(p.j.id,d.variant,'download_failed',error.message);throw error;}
  if(missing.length>batch.length)return {defer:true,note:'Printful finished; validated images are being saved in resumable batches.'};
  guard();checked(p.j.id);db.exec('BEGIN IMMEDIATE');try{
   for(const image of images){const a=get('SELECT * FROM factory_mockup_downloads WHERE job=? AND variant=? AND task_key=? AND url=?',p.j.id,d.variant,t.task_key,image.url);if(!a||hash(Buffer.from(a.data))!==a.sha256)hold('The saved mockup batch is incomplete.');const id=randomUUID();run('INSERT INTO factory_mockups VALUES(?,?,?,?,?)',id,p.j.id,d.variant,a.mime,a.data);run('INSERT INTO factory_mockup_files VALUES(?,?,?,?,?,?,?,?,?,?)',id,t.task_key,image.url,image.placement,image.title,image.style,a.sha256,a.width,a.height,clock());}
   run('DELETE FROM factory_mockup_downloads WHERE job=? AND variant=? AND task_key=?',p.j.id,d.variant,t.task_key);state(p.j.id,d.variant,'saved');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return null;
 }
 function gallery(job){return all('SELECT m.id,m.variant,f.task_key,f.placement,f.title,f.style,f.sha256,f.width,f.height FROM factory_mockups m LEFT JOIN factory_mockup_files f ON f.file=m.id WHERE m.job=? ORDER BY m.rowid',job).map(a=>({...a,url:'/api/owner/ai-factory/publishing/mockup/'+a.id}));}
 function snapshot(job){const tasks=all('SELECT variant,product,task_key,state,supplier_status,accepted,checked,next_poll,error,attempts FROM factory_mockup_tasks WHERE job=? ORDER BY variant',job).map(t=>{const generationConfirmed=validKey(t.task_key)&&t.accepted!==null&&t.supplier_status==='pending'&&t.state==='pending'&&t.checked!==null&&clock()-t.checked<120000;return {...t,label:t.state==='pending'&&!generationConfirmed?'Accepted task — last known pending; status needs refreshing':LABELS[t.state]||'Mockup status unavailable',generationConfirmed,staged:get('SELECT count(*) n FROM factory_mockup_downloads WHERE job=? AND variant=? AND task_key=?',job,t.variant,t.task_key||'').n,expected:JSON.parse(get('SELECT images FROM factory_mockup_manifests WHERE job=? AND variant=? AND task_key=?',job,t.variant,t.task_key||'')?.images||'[]').length};}),images=gallery(job);return {storageDurable,tasks,images,history:all('SELECT variant,product,task_key,supplier_status,error,accepted,checked FROM factory_mockup_task_history WHERE job=? ORDER BY accepted DESC',job),saved:images.length,generating:tasks.some(t=>t.generationConfirmed),label:tasks.find(t=>t.state!=='saved')?.label||(images.length?'Mockup images saved':'Mockup not requested — print files, approval and the worker must be ready')};}
 function verifiedGallery(job,variants){const images=gallery(job).filter(m=>variants.includes(m.variant));for(const variant of variants){const t=task(job,variant),manifest=t&&get('SELECT images FROM factory_mockup_manifests WHERE job=? AND variant=? AND task_key=?',job,variant,t.task_key);if(!t?.task_key||t.state!=='saved'||!manifest)hold('Verified saved mockups from an accepted task are required for every variant.');for(const expected of JSON.parse(manifest.images)){const row=get('SELECT m.id,m.data,f.sha256 FROM factory_mockups m JOIN factory_mockup_files f ON f.file=m.id WHERE m.job=? AND m.variant=? AND f.task_key=? AND f.source_url=?',job,variant,t.task_key,expected.url);if(!row||hash(Buffer.from(row.data))!==row.sha256)hold('The completed mockup set is missing an image or failed its saved checksum check.');}}return images.filter(m=>m.task_key===task(job,m.variant)?.task_key);}
 function assertReconcile(job,operationName){const variant=Number(operationName.replace(/^mockup-/,''));if(active.has(job+':'+variant))hold('Mockup submission is still active. Wait for its saved response before reconciling.');if(task(job,variant)?.task_key)hold('This mockup already has an accepted task key. Recheck that task instead of declaring no effect.');}
 function reconcile(job,operationName,outcome,key){const variant=Number(operationName.replace(/^mockup-/,''));if(!Number.isSafeInteger(variant))hold('Invalid mockup variant.');assertReconcile(job,operationName);if(outcome==='task_found'){if(!validKey(key))hold('Enter the verified Printful task key.');run("UPDATE factory_mockup_tasks SET task_key=?,state='accepted',accepted=?,next_poll=0,error='',updated=? WHERE job=? AND variant=?",key,clock(),clock(),job,variant);}else{run("UPDATE factory_mockup_tasks SET state='queued',task_key=NULL,supplier_status=NULL,next_poll=0,error='',updated=? WHERE job=? AND variant=?",clock(),job,variant);}}
 function retry(job,variant,{regenerate=false,confirm=false}={}){
  if(active.has(job+':'+variant))hold('Mockup submission is still active.');const t=task(job,variant);if(!t)hold('No mockup task exists for this variant.');if(get('SELECT id FROM factory_mockups WHERE job=? AND variant=?',job,variant))hold('Saved images are retained. Use a replacement product job to change its mockups.');
  if(regenerate){if(!confirm||!(['failed','completed'].includes(t.supplier_status)||t.state==='rejected')||t.attempts>=5)hold('Confirm replacing a verified failed/completed or rejected mockup request. Unknown submissions must be reconciled first.');run('DELETE FROM factory_publish_operations WHERE job=? AND operation=?',job,'mockup-'+variant);run("UPDATE factory_mockup_tasks SET state='queued',task_key=NULL,supplier_status=NULL,accepted=NULL,next_poll=0,error='',updated=? WHERE job=? AND variant=?",clock(),job,variant);}
  else{if(!t.task_key)hold('An accepted task key is required before checking its result.');run("UPDATE factory_mockup_tasks SET state='accepted',next_poll=0,error='',updated=? WHERE job=? AND variant=?",clock(),job,variant);}
 }
 async function execute(job,guard){const p=checked(job);if(!p.listing.supplier_id)hold('Create the validated supplier product before requesting mockups.');if(!storageDurable)hold('Persistent backend storage is required for mockups.');
  for(const d of p.files){let t=ensure(p,d);if(t.state==='saved'){verifiedGallery(job,[d.variant]);continue;}
   if(!t.task_key){if(t.state==='uncertain'||operation(job,'mockup-'+d.variant))return {wait:t.error||'Mockup request outcome is uncertain. Verify it before retrying.'};if(t.state==='rejected')return {wait:t.error||'Printful rejected this request. Review configuration before explicitly retrying.'};return submit(p,d,t,guard);}
   if(['failed','invalid','timed_out'].includes(t.state))return {wait:t.error||LABELS[t.state]};
   if(!get('SELECT images FROM factory_mockup_manifests WHERE job=? AND variant=? AND task_key=?',job,d.variant,t.task_key)){
    if(clock()<t.next_poll)return {defer:true,note:'Accepted mockup task is waiting for its next status check.'};
    run('UPDATE factory_mockup_tasks SET next_poll=? WHERE job=? AND variant=?',clock()+15000,job,d.variant);
    try{const result=await pf('mockup-generator/task?task_key='+encodeURIComponent(t.task_key));if(!result)hold('Accepted mockup task could not be found in Printful.');recordResult(job,d.variant,t.task_key,result);}catch(e){state(job,d.variant,e.status===409?'invalid':'poll_error',e.message);throw e;}
    t=task(job,d.variant);if(t.state==='failed')return {wait:'Printful mockup task failed: '+t.error};if(t.state==='pending'){if(clock()-t.accepted>2*3600000){state(job,d.variant,'timed_out','Printful still reports pending after two hours. Recheck this accepted task; do not submit a duplicate.');return {wait:task(job,d.variant).error};}return {defer:true,note:'Printful reports the accepted mockup task pending.'};}
   }
   const result=await saveImages(p,d,task(job,d.variant),guard);if(result)return result;
  }
  run("UPDATE factory_listings SET status='mockups_saved',error='',updated=? WHERE job=?",new Date(clock()).toISOString(),job);return {mockupsSaved:true};
 }
 async function restorePreview(job){
  const rows=all('SELECT m.id,f.source_url,f.sha256 FROM factory_mockups m JOIN factory_mockup_files f ON f.file=m.id WHERE m.job=? AND length(m.data)=0',job);
  for(const row of rows){const result=await download({url:row.source_url});if(result.sha256!==row.sha256)hold('Recovered preview differs from the reviewed image. Keep this tracked item held for review.');run('UPDATE factory_mockups SET data=? WHERE id=? AND length(data)=0',result.data,row.id);}
  return {restored:rows.length};
 }
 return {restorePreview,execute,snapshot,gallery,verifiedGallery,retry,reconcile,assertReconcile};
}
