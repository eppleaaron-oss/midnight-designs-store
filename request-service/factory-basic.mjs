import {audienceMatches} from './factory-audiences.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {variantAreas} from './factory-blueprints.mjs';
import {garmentColorCapability} from './factory-color.mjs';
import {isBrandArtwork} from './factory-branding.mjs';
import {loadCatalog,PLANS} from './factory-ideas.mjs';
import {basicStorage,clearBasicWorkingFiles} from './factory-basic-storage.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalize=s=>s.replace(/_dtfabric$/,'').replace(/^(left|right)_hood$/,'hood').replace(/^top_front$/,'front').replace(/^top_back$/,'back');
const modelStyle=s=>!/(flat|hanger|folded|mannequin|product)/i.test(s)&&/(model|men['’]?s|women['’]?s|couple|kids|youth)/i.test(s);
const ROOT='/api/owner/ai-factory/basic';

export function factoryBasic({db,auth,body,send,fail,limit,origin,manager,ideas,workflow,blueprints,production,rendering,publishing,pricing,quality,backups,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_items(
  id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,recipe_key TEXT NOT NULL,recipe TEXT NOT NULL,job TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating',decision TEXT,closed INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',
  cleanup TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS factory_basic_one_active ON factory_basic_items((1)) WHERE closed=0;`);
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a),now=()=>new Date(clock()).toISOString();
 const row=job=>get('SELECT * FROM factory_basic_items WHERE job=?',job),active=()=>get('SELECT * FROM factory_basic_items WHERE closed=0');
 let creating=false,cleaning=false,workspace=null,outfits=null;
 const remote=()=>workspace?.ready()===true;
 const checkpoint=job=>workspace?.snapshot().enabled&&(!job||row(job))?workspace.checkpoint(job):Promise.resolve();
 function blockers(){
  const r=production.readiness(),p={...publishing.basicConnectionStatus(),mode:publishing.mode()},s=get('SELECT * FROM factory_settings WHERE id=1'),out=[];
  if(!remote()&&(!r.storageDurable||!p.storageDurable))out.push({code:'workspace',message:workspace?.snapshot().available?'Connect GitHub working space below for one-item production.':'Persistent production workspace is not attached. GitHub recovery backups do not replace live file and queue storage.'});
  if(!r.workerConnected)out.push({code:'worker',message:'The backend production worker is not connected.'});
  if(!p.supplierConfigured)out.push({code:'supplier',message:'The backend Printful token is not configured.'});
  if(!p.storeConfigured&&!workspace?.snapshot().storeConfigured)out.push({code:'publishing',message:'Storefront publishing credentials are not configured on the backend.'});
  if(p.mode!=='review')out.push({code:'review',message:'Basic requires Review before publishing. Automatic mode is not used.'});
  if(!remote()&&(!s.daily_budget||!s.total_budget))out.push({code:'budget',message:'Set daily and total spending limits below before starting.'});
  return out;
 }
 async function catalog(){
  const live=await manager.catalog(),known=new Map(loadCatalog(PLANS).map(x=>[x.id,x]));
  return live.filter(p=>known.has(p.id)||/all.over.print/i.test(p.name)).map(p=>{const preferred=known.get(p.id)?.role;return {...p,role:p.roles.includes(preferred)?preferred:p.roles[0],image:known.get(p.id)?.image||null};}).filter(p=>typeof p.role==='string');
 }
 function sets(){ideas.syncSets();return all('SELECT * FROM idea_sets WHERE enabled=1 ORDER BY jacket DESC,name').map(s=>({...s,parts:JSON.parse(s.parts)}));}
 async function inspect({setId,product,sizes=[],audience='unisex',adaptArtwork=false}){
  if(typeof adaptArtwork!=='boolean')fail(400,'Choose whether to adapt artwork to primary panels.');
  const set=sets().find(s=>s.id===setId);if(!set)fail(400,'Select an existing design set.');
  if(!Number.isSafeInteger(product))fail(400,'Choose an exact garment.');
  if(!['unisex','men','women','children'].includes(audience)||!Array.isArray(sizes)||sizes.length>100||sizes.some(x=>typeof x!=='string'||x.length>40))fail(400,'Choose a supported audience and size range.');
  const available=(await catalog()).find(p=>p.id===product);if(!available)fail(409,'This garment is not in the connected all-over-print catalog.');
  const [detail,bp]=await Promise.all([manager.productDetails(product),blueprints.load(product,'default')]);
  if(bp.source!=='live'||garmentColorCapability(bp).mode!=='print')fail(409,'This garment has no verified live all-over-print blueprint.');
  if(!audienceMatches(detail,audience))fail(409,'This garment does not support the selected audience.');
  const bySize=new Map();for(const v of detail.variants){if(sizes.length&&!sizes.includes(v.size))continue;const prior=bySize.get(v.size||v.name);if(!prior||/^white$/i.test(v.color))bySize.set(v.size||v.name,v);}
  const variants=[...bySize.values()];if(!variants.length||sizes.some(s=>!variants.some(v=>v.size===s)))fail(409,'A selected size is not currently available.');
  const areaMap=new Map();for(const v of variants)for(const a of variantAreas(bp,v.id))if(!/^label|^inside_label/i.test(a.placement))areaMap.set(a.placement,a);
  const placements=[],fill=[],warnings=[],used=new Set();
  for(const area of areaMap.values()){
   const key=normalize(area.placement);let part=set.parts[key],partKey=key;
   if(!part&&adaptArtwork&&/^(front|default|left_leg|right_leg)$/.test(key)){partKey=['front','default','back'].find(k=>set.parts[k]);part=set.parts[partKey];if(part)warnings.push('Adapted '+partKey+' artwork to '+area.placement+' with your primary-panel permission.');}
   if(part){if(part.artwork&&isBrandArtwork(db,get('SELECT * FROM factory_artwork WHERE id=?',part.artwork)))fail(409,'Company branding cannot replace the product artwork. Choose a design set.');placements.push({area:area.placement,part:partKey,name:part.name||partKey,url:part.url,artwork:part.artwork||null});used.add(partKey);}
   else fill.push(area.placement);
  }
  if(!placements.length)fail(409,'This design set has no artwork assigned to this garment’s supported panels.');
  for(const key of Object.keys(set.parts))if(!used.has(key))warnings.push('The '+key+' artwork has no matching panel and will not be moved elsewhere.');
  if(fill.length)warnings.push('Black fill only: '+fill.join(', ')+'.');
  const groups=(bp.printfiles.option_groups||[]).filter(x=>typeof x==='string'),modelGroups=groups.filter(modelStyle).filter(s=>audience==='women'?!/^men['’]?s/i.test(s):audience==='men'?!/^women['’]?s/i.test(s):true).slice(0,2);
  if(!modelGroups.length)warnings.push('Printful does not report a recognized people/model style for this garment. Review its available product mockups before approving.');
  return {set,product:detail,variants,audience,role:available.role,placements,fill,warnings,areas:[...areaMap.values()],modelGroups,hasModelOptions:!!modelGroups.length,source:'live Printful catalog and native print files'};
 }
 function detail(r){
  if(!r)return null;const recipe=JSON.parse(r.recipe),j=r.job&&get('SELECT * FROM factory_jobs WHERE id=?',r.job),l=r.job&&get('SELECT * FROM factory_listings WHERE job=?',r.job),rt=r.job&&get('SELECT step FROM factory_job_runtime WHERE job=?',r.job);
  const mockups=r.job?{mockups:publishing.mockupGallery(r.job),mockupStatus:publishing.mockupStatus(r.job)}:null;
  return {...r,recipe,cleanup:r.cleanup?JSON.parse(r.cleanup):null,jobStatus:j?.status||null,error:r.error||j?.error||l?.error||'',listing:l?{...l,copy:JSON.parse(l.copy)}:null,step:rt?.step??0,
   checkpoints:r.job?all('SELECT step,created,result FROM factory_job_checkpoints WHERE job=?',r.job).map(x=>({...x,result:JSON.parse(x.result)})):[],
   mockups:mockups?.mockups||[],mockupStatus:mockups?.mockupStatus||null,pricing:r.cleanup?JSON.parse(r.cleanup).pricing:r.job?pricing.assessJob(r.job):null,storage:r.job?basicStorage(db,r.job):null,
   temporaryPixelsMissing:!!(r.job&&get("SELECT id FROM factory_print_files WHERE draft IN (SELECT value FROM factory_job_profiles,json_each(templates) WHERE job=?) AND length(data)=0 UNION ALL SELECT id FROM factory_mockups WHERE job=? AND length(data)=0 LIMIT 1",r.job,r.job)),
   printFiles:r.job?all('SELECT f.id,f.placement,f.width,f.height,q.required_dpi AS requiredDpi,q.effective_dpi AS effectiveDpi FROM factory_print_files f LEFT JOIN factory_render_quality q ON q.file=f.id WHERE f.draft IN (SELECT value FROM factory_job_profiles,json_each(templates) WHERE job=?) ORDER BY f.rowid',r.job).map(f=>({...f,url:'/api/owner/ai-factory/blueprints/file/'+f.id})):[],
   canApprove:!r.closed&&r.decision===null&&rt?.step===6&&l?.status==='mockups_saved'&&j?.status!=='running',
   storefrontUrl:l?.status==='published'&&l.store_id?'https://midnight-designs.store/products/'+encodeURIComponent(l.store_id)+'.html':null};
 }
 function snapshot(){return {outfitQueue:outfits?.snapshot()||null,active:detail(active()),recent:all('SELECT * FROM factory_basic_items ORDER BY created DESC LIMIT 20').map(detail),sets:sets().map(s=>({...s,parts:Object.fromEntries(Object.entries(s.parts).map(([k,v])=>[k,{name:v.name,thumb:v.thumb||v.url}]))})),blockers:blockers(),readiness:production.readiness(),production:remote()&&!active()?null:production.snapshot().pauseReason,settings:get('SELECT state,daily_budget,total_budget FROM factory_settings WHERE id=1'),backup:backups.snapshot(),github:workspace?.snapshot()||null,oneActiveItem:true,liveCycleVerified:!!get("SELECT id FROM factory_basic_items WHERE status='published' AND closed=1 AND json_extract(cleanup,'$.verified')=1"),rejectionCleanupVerified:!!get("SELECT id FROM factory_basic_items WHERE decision='disapproved' AND closed=1 AND json_extract(cleanup,'$.verified')=1"),note:'Original design sets are retained. Disposable Basic print pixels and unapproved preview pixels are omitted from new GitHub snapshots; approved storefront photos are retained. Existing Git history is unchanged.'};}
 async function create(b,context={}){
  if(typeof b.requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(b.requestKey))fail(400,'A stable creation request ID is required.');
  const previous=get('SELECT * FROM factory_basic_items WHERE request_key=?',b.requestKey);if(previous)return detail(previous);
  if(outfits?.activeId()&&context.outfitId!==outfits.activeId())fail(409,'Finish or cancel the current outfit queue before creating a separate item.');
  if(creating||cleaning||active())fail(409,'Finish or disapprove the current item and verify cleanup before starting another.');
  const blocked=blockers();if(blocked.length)fail(409,blocked.map(x=>x.message).join(' '));
  if(get("SELECT id FROM factory_jobs WHERE status IN ('queued','running','retry_wait') LIMIT 1"))fail(409,'Finish or pause existing queued production before starting the single-item Basic lane.');
  creating=true;
  try{
   const p=await inspect(b);if(context.signature&&context.signature!==inspectionSignature(p))fail(409,'Artwork or supplier variants changed since the outfit was checked. Review this piece before retrying.');const recipeKey=hash([p.set.parts,p.product.id,p.variants.map(v=>v.id),'Black','fixed-basic-v1']);
   if(get("SELECT id FROM factory_basic_items WHERE recipe_key=? AND decision='approved' LIMIT 1",recipeKey))fail(409,'This exact set and garment recipe is already approved. Open its tracked product instead of creating a duplicate.');
   if(get("SELECT id FROM factory_jobs WHERE status IN ('queued','running','retry_wait') LIMIT 1"))fail(409,'Other production started during selection. Finish or pause it before starting Basic.');
   const id=randomUUID(),recipe={outfitId:context.outfitId||null,outfitCollection:context.collection||null,set:p.set,product:p.product.id,name:p.product.name,role:p.role,audience:p.audience,variants:p.variants,placements:p.placements,fill:p.fill,warnings:p.warnings,modelGroups:p.modelGroups,hasModelOptions:p.hasModelOptions,color:'Black',fit:'contain'};
   run('INSERT INTO factory_basic_items(id,request_key,recipe_key,recipe,created,updated) VALUES(?,?,?,?,?,?)',id,b.requestKey,recipeKey,JSON.stringify(recipe),now(),now());
   await enqueue(get('SELECT * FROM factory_basic_items WHERE id=?',id));await checkpoint(get('SELECT job FROM factory_basic_items WHERE id=?',id).job);return detail(get('SELECT * FROM factory_basic_items WHERE id=?',id));
  }finally{creating=false;}
 }
 async function enqueue(r){
  const p=JSON.parse(r.recipe),settingsUpdated=get('SELECT updated FROM factory_settings WHERE id=1').updated;manager.activateCreators([p.role]);
  try{
   const job=await workflow.enqueue({idea:{id:r.id,kind:'product'},set:p.set,piece:{catalog:p.product,label:p.name,role:p.role,color:'Black',audience:p.audience,placements:p.placements},brief:'Basic fixed recipe: keep this design set together. Preserve assigned panels and proportions; black fill across every unused supported panel. No exterior company branding. Owner review before publication.',variantIds:p.variants.map(v=>v.id),fixedRecipe:true,outfitId:p.outfitId,storeCollection:p.outfitCollection});
   const selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job).selection);selection.basicMode=true;
   run('UPDATE factory_job_audiences SET selection=? WHERE job=?',JSON.stringify(selection),job);run('DELETE FROM factory_pipeline_jobs WHERE job=?',job);
   run("UPDATE factory_basic_items SET job=?,status='producing',error='',updated=? WHERE id=?",job,now(),r.id);
   if(get('SELECT updated FROM factory_settings WHERE id=1').updated===settingsUpdated)run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());
  }catch(e){run("UPDATE factory_basic_items SET status='held',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);throw e;}
 }
 function prepareReview(job,p){if(!row(job))return null;if(publishing.mode()!=='review')return {wait:'Basic requires review mode.'};quality.assert(job);run("UPDATE factory_listings SET approved=1,approval_mode='basic_preview',fingerprint=?,status='preparing_mockups',updated=? WHERE job=?",p.fingerprint,now(),job);return {preparedForMockups:true,note:'Preparing the unpublished supplier draft and real mockups. Storefront approval has not been given.'};}
 function beforePublication(job){const r=row(job);if(!r)return null;if(r.closed||r.decision==='disapproved')return {wait:'This Basic item is closed or disapproved.'};if(r.decision!=='approved'){run("UPDATE factory_basic_items SET status='awaiting_review',updated=? WHERE job=?",now(),job);return {wait:'Review the real mockups and choose Approve or Disapprove on Basic.'};}quality.assert(job);return null;}
 async function cleanup(r){
  if(cleaning)return;cleaning=true;
  try{
   const l=get('SELECT * FROM factory_listings WHERE job=?',r.job),j=get('SELECT status FROM factory_jobs WHERE id=?',r.job);
   if(j?.status==='running')fail(409,'The current worker step must finish before cleanup.');
   if(r.decision==='approved'&&l?.status!=='published')fail(409,'Keep final files until the live storefront product is verified.');
   if(get("SELECT operation FROM factory_publish_operations WHERE job=? AND status='uncertain'",r.job))fail(409,'Reconcile the uncertain supplier operation before cleanup.');
   if(r.decision==='disapproved')await publishing.discardDraft(r.job);
   const prior=r.cleanup?JSON.parse(r.cleanup):null,savedPrice=pricing.assessJob(r.job);let result={...clearBasicWorkingFiles(db,r.job,{keepPhotos:r.decision==='approved'}),pricing:savedPrice};
   if(remote()){if(prior?.files?.length)result={...prior,...result,files:prior.files,templates:prior.templates,before:prior.before,reclaimedBytes:prior.reclaimedBytes};run("UPDATE factory_basic_items SET cleanup=?,status='cleaning' WHERE id=?",JSON.stringify({...result,verified:false}),r.id);const cleared=await workspace.cleanup(r.job);if(!cleared.verified){run('UPDATE factory_basic_items SET cleanup=? WHERE id=?',JSON.stringify({...result,verified:false,github:cleared}),r.id);await checkpoint();return;}result={...result,github:cleared,after:basicStorage(db,r.job),reclaimedBytes:(result.before?.workingBytes||0)+(result.before?.mockupBytes||0),verified:true};}
   run('UPDATE factory_basic_items SET cleanup=?,closed=1,status=?,error=\'\',updated=? WHERE id=?',JSON.stringify(result),r.decision==='approved'?'published':'disapproved',now(),r.id);
   run('UPDATE factory_jobs SET status=?,updated=? WHERE id=?',r.decision==='approved'?'completed':'archived',now(),r.job);await checkpoint();
  }catch(e){run("UPDATE factory_basic_items SET closed=0,status='cleanup_failed',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);try{await checkpoint();}catch{}throw e;}finally{cleaning=false;}
 }
 async function settled(job){const r=row(job);if(r&&!r.closed&&(r.decision==='disapproved'||r.decision==='approved'&&get('SELECT status FROM factory_listings WHERE job=?',job)?.status==='published'))await cleanup(r);}
 function options(job){const r=row(job);if(!r)return {};const p=JSON.parse(r.recipe);return p.modelGroups.length?{option_groups:p.modelGroups}:{};}
 function orderMedia(job,media){const r=row(job);if(!r)return media;const groups=JSON.parse(r.recipe).modelGroups;return [...media].sort((a,b)=>Number(groups.includes(b.style))-Number(groups.includes(a.style)));}
 function inspectionSignature(p){return hash([p.set.parts,p.product.id,p.variants.map(v=>v.id),p.placements,p.fill]);}
 return {create,catalog,inspectionSignature,setOutfits(o){outfits=o;},currentJob:()=>active()?.job||null,githubReady:remote,setWorkspace(w){workspace=w;},workspaceReady:job=>remote()&&!!row(job),previewAllowed:job=>{const r=row(job);return !!r&&!r.closed&&r.decision===null&&get('SELECT step FROM factory_job_runtime WHERE job=?',job)?.step===3&&publishing.mode()==='review';},assertPreview:job=>quality.assert(job),checkpoint,restore:job=>remote()?workspace.hydrate(job):Promise.resolve(),storeToken:()=>workspace?.storeToken()||'',publisherManaged:()=>workspace?.snapshot().managed===true,publisherWait:job=>workspace?.publisherWait(job)||null,verifyFinalMedia:job=>remote()?workspace.verifyFinalMedia(job):null,finalMedia:(job,media,supplier)=>remote()?workspace.finalMedia(job,media,supplier):null,mediaUrl:file=>workspace?.mediaUrl(file)||null,fileData:(kind,id)=>workspace?.file(kind,id)||null,owns:job=>!!row(job),permits:job=>!active()||active().job===job,prepareReview,beforePublication,settled,options,orderMedia,snapshot,inspect,
  async tick(){const r=active();if(r?.job&&(r.decision==='disapproved'||get('SELECT status FROM factory_listings WHERE job=?',r.job)?.status==='published'))await settled(r.job);},
  async handle(req,res,path,method,url){
   if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;auth(req,null,true);
   if(method==='GET'){
    if(path===ROOT){send(res,200,snapshot());return true;}
    if(path===ROOT+'/catalog'){send(res,200,{products:await catalog(),source:'live Printful catalog; exact availability and panels are checked when selected'});return true;}
    fail(404,'Basic page action not found.');
   }
   if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-basic',60);const b=await body(req);
   if(path===ROOT+'/inspect'){send(res,200,await inspect(b));return true;}
   if(path===ROOT+'/random'){
    const candidates=(await catalog()).filter(p=>audienceMatches(p,b.audience||'unisex')).sort(()=>Math.random()-.5);let found;
    for(const p of candidates.slice(0,12)){try{found=await inspect({...b,product:p.id});break;}catch(e){if(![400,409].includes(e.status))throw e;}}
    if(!found)fail(409,'No compatible garment was verified in this selection. Try an exact garment or refresh Printful.');send(res,200,found);return true;
   }
   if(path===ROOT+'/control'){if(!remote()||!['start','resume'].includes(b.action))fail(409,'Connect GitHub working space first.');run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());await checkpoint(active()?.job);send(res,200,snapshot());return true;}
   if(path===ROOT+'/github'){if(!workspace)fail(409,'GitHub workspace is unavailable.');await workspace.enable(b.token);send(res,200,snapshot());return true;}
   if(path===ROOT+'/refresh'){limit(req,'basic-refresh',4);await ideas.refreshPrintful();ideas.syncSets();send(res,200,snapshot());return true;}
   if(path===ROOT+'/create'){send(res,200,await create(b));return true;}
   if(!['/approve','/disapprove','/resume','/fit-artwork'].some(action=>path===ROOT+action))fail(404,'Basic action not found.');
   const r=get('SELECT * FROM factory_basic_items WHERE id=?',typeof b.id==='string'?b.id:'');if(!r)fail(404,'Tracked Basic item not found.');
   if(r.closed){if(path===ROOT+'/approve'&&r.decision!=='approved'||path===ROOT+'/disapprove'&&r.decision!=='disapproved')fail(409,'This item is already closed with another decision.');send(res,200,detail(r));return true;}
   if(path===ROOT+'/approve'&&r.decision==='approved'){send(res,200,snapshot());return true;}
   const j=r.job&&get('SELECT status FROM factory_jobs WHERE id=?',r.job);
   if(path===ROOT+'/fit-artwork'){
    const rt=get('SELECT step FROM factory_job_runtime WHERE job=?',r.job);
    if(r.closed||r.decision||!rt||rt.step>2||j?.status==='running'||get('SELECT 1 FROM factory_print_files WHERE draft IN (SELECT value FROM factory_job_profiles,json_each(templates) WHERE job=?) LIMIT 1',r.job)||get('SELECT 1 FROM factory_publish_operations WHERE job=? LIMIT 1',r.job))fail(409,'Resolution fitting is available only before print files or supplier operations have been saved.');
    const saved=get('SELECT plan FROM factory_render_plans WHERE job=?',r.job),plan=saved&&JSON.parse(saved.plan);if(!plan?.placements)fail(409,'The original placement recipe is missing.');
    for(const p of Object.values(plan.placements))if(p.artworkId)p.withoutEnlargement=true;
    run('UPDATE factory_render_plans SET plan=? WHERE job=?',JSON.stringify(plan),r.job);run("UPDATE factory_jobs SET status='queued',error='',updated=? WHERE id=?",now(),r.job);run("UPDATE factory_job_runtime SET available=0,error='' WHERE job=?",r.job);run("UPDATE factory_basic_items SET error='',updated=? WHERE id=?",now(),r.id);run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());
   }else if(path===ROOT+'/approve'){
    if(remote()){let result;do{result=await workspace.hydrate(r.job);}while(result?.defer);}
    if(publishing.mode()!=='review')fail(409,'Basic requires review mode before approving.');
    if(b.confirm!==true||!detail(r).canApprove||detail(r).temporaryPixelsMissing)fail(409,'Wait for the completed mockups, variants, listing and price before approving.');
    if(!JSON.parse(r.recipe).hasModelOptions&&b.acceptMissingModel!==true)fail(409,'Acknowledge the missing people/model option after reviewing the actual product images.');
    const p=publishing.prepared(r.job);quality.assert(r.job);publishing.verifiedMockups(r.job,p.files.map(d=>d.variant));
    if(p.fingerprint!==p.listing.fingerprint)fail(409,'Files, listing or prices changed. Prepare and review the updated product first.');
    run("UPDATE factory_basic_items SET decision='approved',status='publishing',error='',updated=? WHERE id=?",now(),r.id);
    run("UPDATE factory_jobs SET status='queued',error='',updated=? WHERE id=?",now(),r.job);run("UPDATE factory_job_runtime SET available=0,error='' WHERE job=?",r.job);
   }else if(path===ROOT+'/disapprove'){
    if(b.confirm!==true)fail(400,'Confirm disapproval.');if(r.decision==='approved'||j?.status==='running'||get('SELECT status FROM factory_listings WHERE job=?',r.job)?.status==='catalog_pending')fail(409,'Finish the current operation before disapproving. Published products are kept live.');
    run("UPDATE factory_basic_items SET decision='disapproved',status='cleaning',updated=? WHERE id=?",now(),r.id);
    if(r.job){run("UPDATE factory_jobs SET status='waiting_input',updated=? WHERE id=?",now(),r.job);await checkpoint(r.job);await cleanup({...r,decision:'disapproved'});}else run("UPDATE factory_basic_items SET closed=1,status='disapproved',cleanup=?,updated=? WHERE id=?",JSON.stringify({verified:true,reclaimedBytes:0,files:[],before:null,after:null}),now(),r.id);
   }else if(path===ROOT+'/resume'){
    if(r.status==='cleanup_failed'){await cleanup(r);}
    else if(!r.job){const blocked=blockers();if(blocked.length)fail(409,blocked[0].message);await enqueue(r);}
    else{
     if(j?.status==='running')fail(409,'This job is still running.');
     if(r.decision==='disapproved'){await cleanup(r);}else{
      if(get("SELECT operation FROM factory_publish_operations WHERE job=? AND status='uncertain'",r.job))fail(409,'The previous supplier result is uncertain. Reconcile it in Production diagnostics before resuming this same job.');
      if(get('SELECT retries FROM factory_job_runtime WHERE job=?',r.job)?.retries>production.snapshot().policy.retryLimit)fail(409,'The retry limit is exhausted. Review this tracked failure before continuing.');
      if(remote()){let restored;do{restored=await workspace.hydrate(r.job);}while(restored?.defer);}
      if(detail(r).temporaryPixelsMissing){await rendering.renderJob(r.job);await quality.check(r.job);await publishing.restoreBasicPreview(r.job);}
      run("UPDATE factory_jobs SET status='queued',error='',updated=? WHERE id=?",now(),r.job);run("UPDATE factory_job_runtime SET available=0,error='' WHERE job=?",r.job);run("UPDATE factory_basic_items SET error='',updated=? WHERE id=?",now(),r.id);
     }
    }
   }else fail(404,'Basic action not found.');
   await checkpoint(active()?.job);send(res,200,snapshot());return true;
  }};
}
