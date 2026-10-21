import {aiMadePreviews} from './factory-ai-made-previews.mjs';
import {createHash} from 'node:crypto';
const ROOT='/api/owner/ai-factory/ai-made';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function factoryAiMade({db,publishing,pipeline,basic,auth,body,send,fail,limit,origin,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_ai_made_edits(job TEXT PRIMARY KEY,copy TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_ai_made_decisions(job TEXT PRIMARY KEY,decision TEXT NOT NULL,fingerprint TEXT NOT NULL,updated TEXT NOT NULL);`);
 const get=(q,...a)=>db.prepare(q).get(...a),now=()=>new Date(clock()).toISOString();let writing=false,live=null;const thumbs=new Map();const previews=aiMadePreviews({db,pf:publishing.ownerSupplier,checkpoint:()=>basic.checkpoint(),fail,clock});
 function row(job){return get('SELECT l.*,j.title,j.employee,j.status AS job_status,i.id AS item_id,i.recipe,i.closed,i.status AS item_status FROM factory_listings l JOIN factory_jobs j ON j.id=l.job LEFT JOIN factory_basic_items i ON i.job=l.job WHERE l.job=?',job);}
 function entry(r){
  const e=get('SELECT * FROM factory_ai_made_edits WHERE job=?',r.job),d=get('SELECT * FROM factory_ai_made_decisions WHERE job=?',r.job),recipe=JSON.parse(r.recipe||'null'),copy=JSON.parse(e?.copy||r.copy);
  return {thumbnail:thumbs.get(String(r.supplier_id))||null,job:r.job,itemId:r.item_id||null,name:copy.title,copy,revision:e?.revision||0,supplierId:r.supplier_id||recipe?.replaceProduct?.supplierId||null,storeId:r.store_id||null,collection:recipe?.outfitCollection||recipe?.set?.name||'',status:live?.some(p=>p.id===r.supplier_id&&p.factoryExternalId==='midnight-factory-'+r.job)?'live':d?.decision==='needs_changes'?'needs_changes':r.status==='published'?'live':d?.decision==='approved'?'publishing':'awaiting_review',productionStatus:r.item_status||r.job_status,error:r.error||'',mockups:publishing.ownerMockups(r.job),editable:!!r.item_id,closed:!!r.closed};
 }
 async function list(){let verificationError='';try{live=await publishing.ownerStore();}catch(e){live=null;verificationError=e.message;}try{for(let offset=0;offset<10000;offset+=100){const page=await publishing.ownerSupplier('store/products?limit=100&offset='+offset);if(!Array.isArray(page))break;for(const p of page)if(p.thumbnail_url)thumbs.set(String(p.id),p.thumbnail_url);if(page.length<100)break;}}catch{verificationError+=' Supplier thumbnails could not refresh; existing previews are retained.';}return {verificationError,products:db.prepare('SELECT job FROM factory_listings ORDER BY updated DESC').all().map(x=>entry(row(x.job))),note:'AI products stay here until you approve them for the store. Saving a draft does not publish it.'};}
 async function detail(job){const r=row(job);if(!r)fail(404,'AI product not found.');const p=entry(r),supplier=p.supplierId?await publishing.ownerSupplier('store/products/'+p.supplierId):null;
  const photos=[...(p.mockups||[]),...previews.gallery(job,supplier)];for(const v of supplier?.sync_variants||[])for(const f of v.files||[])if(f.type==='preview'&&(f.preview_url||f.url))photos.push({url:f.preview_url||f.url,title:v.name||'Printful preview'});
  const image=supplier?.sync_product?.thumbnail_url;if(image)photos.push({url:image,title:'Printful product'});
  p.variants=(supplier?.sync_variants||[]).map(v=>({size:v.size,color:v.color,price:v.retail_price,currency:v.currency}));p.photos=photos;p.reviewToken=digest({job,revision:p.revision,copy:p.copy,files:supplier?.sync_variants?.map(v=>({id:v.id,variant:v.variant_id,files:v.files?.filter(f=>f.type!=='preview').map(f=>({id:f.id,type:f.type,url:f.url,status:f.status}))})),photos:photos.map(p=>p.url),mockups:p.mockups});
  p.canApprove=photos.length>0&&!!(r.supplier_id||JSON.parse(r.recipe||'null')?.replaceProduct);
  return {product:p,supplier};
 }
 function validCopy(c){if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>150||typeof c.description!=='string'||!c.description.trim()||c.description.length>6000||typeof c.category!=='string'||!c.category.trim()||c.category.length>100||!['tags','collections'].every(k=>Array.isArray(c[k])&&c[k].length<=20&&c[k].every(v=>typeof v==='string'&&v.trim()&&v.length<=100)))fail(400,'Complete the product title, description, category, tags and collections.');return c;}
 async function release(r,p,supplier){
  const copy=validCopy(p.copy);
  if(!r.closed){
   const prepared=publishing.prepared(r.job);if(JSON.stringify(copy)!==JSON.stringify(prepared.copy))fail(409,'Finish the active artwork revision before editing its listing details.');
   const grant=()=>db.prepare("INSERT INTO factory_ai_made_decisions VALUES(?,'approved',?,?) ON CONFLICT(job) DO UPDATE SET decision='approved',fingerprint=excluded.fingerprint,updated=excluded.updated").run(r.job,prepared.fingerprint,now());
   if(r.item_id)await basic.approveOwner(r.job,{confirm:true,acceptMissingModel:true},grant);
   else {if(pipeline?.required(r.job))pipeline.approveOwner(r.job);if(!['mockups_saved','awaiting_review'].includes(r.status)||!p.mockups.length)fail(409,'Wait for finished product mockups before approving.');grant();db.prepare("UPDATE factory_listings SET approved=1,approval_mode='owner',fingerprint=? WHERE job=?").run(prepared.fingerprint,r.job);db.prepare("UPDATE factory_jobs SET status='queued',error='' WHERE id=?").run(r.job);await basic.checkpoint();}
   return {pending:true,note:'Approved. The tracked production job will update Printful and verify the store publication.'};
  }
  if(!supplier?.sync_product?.id||String(supplier.sync_product.id)!==p.supplierId)fail(409,'Printful product identity is not verified.');
  const recipe=JSON.parse(r.recipe||'null'),external=supplier.sync_product.external_id;
  if(external!=='midnight-factory-'+r.job)fail(409,'A newer revision owns this supplier product. Open that revision.');
  if(!supplier.sync_variants?.length||supplier.sync_variants.some(v=>!v.synced||v.is_ignored||!v.files?.some(f=>f.type!=='preview')||v.files.filter(f=>f.type!=='preview').some(f=>f.status!=='ok'||f.is_temporary)))fail(409,'Wait for permanently accepted print files on every variant.');
  const file=await publishing.ownerGithub('/contents/ai-made-review.json?ref=main'),reviews=file?JSON.parse(Buffer.from(file.content,'base64').toString('utf8')):{version:1,products:{}};
  await publishing.ownerSupplier('store/products/'+p.supplierId,{method:'PUT',body:JSON.stringify({sync_product:{name:copy.title}})});
  const metadata={decision:'approved',external,job:r.job,product:recipe?.product||supplier.sync_variants[0].product?.product_id,role:r.employee,collection:p.collection,outfit:recipe?.outfitId||null,copy,revision:p.revision,updated:now()};
  reviews.products[p.supplierId]=metadata;
  await publishing.ownerGithub('/contents/ai-made-review.json',{method:'PUT',body:JSON.stringify({message:'Owner approves AI Made product '+p.supplierId,branch:'main',...(file?{sha:file.sha}:{}),content:Buffer.from(JSON.stringify(reviews,null,2)+'\n').toString('base64')})});
  db.prepare("INSERT INTO factory_ai_made_decisions VALUES(?,'approved',?,?) ON CONFLICT(job) DO UPDATE SET decision='approved',fingerprint=excluded.fingerprint,updated=excluded.updated").run(r.job,p.reviewToken,now());await basic.checkpoint();
  await publishing.ownerGithub('/actions/workflows/approved-printful-media.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main'})});
  return {pending:true,note:'Approval saved. Product images and the store listing are being updated under the same product ID. Refresh to check the result.'};
 }
 return {list,async handle(req,res,path,method){
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;auth(req,null,true);
  if(method==='GET'){if(path===ROOT){send(res,200,await list());return true;}const id=path.slice(ROOT.length+1);if(!/^[-a-f0-9]{36}$/.test(id))fail(404,'AI product not found.');send(res,200,await detail(id));return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'ai-made',30);const b=await body(req),r=row(String(b.job||''));if(!r)fail(404,'AI product not found.');if(writing)fail(409,'A review is being saved. Retry shortly.');writing=true;
  try {
   const current=entry(r);if(b.revision!==current.revision)fail(409,'This product changed in another tab. Reload before saving.');
   if(path===ROOT+'/preview'){const d=await detail(r.job);if(!d.supplier)fail(409,'Wait for the Printful product before requesting review images.');send(res,202,await previews.generate(r.job,d.supplier,{retry:b.retry===true}));return true;}
   if(path===ROOT+'/save'){validCopy(b.copy);if(!r.closed)fail(409,'Finish the active production step before editing listing details.');db.prepare('INSERT INTO factory_ai_made_edits VALUES(?,?,?,?) ON CONFLICT(job) DO UPDATE SET copy=excluded.copy,revision=excluded.revision,updated=excluded.updated').run(r.job,JSON.stringify(b.copy),current.revision+1,now());await basic.checkpoint();send(res,200,{product:entry(row(r.job)),note:'Draft saved. The live store is unchanged until you approve this revision.'});return true;}
   if(path===ROOT+'/needs-changes'){if(current.status==='publishing')fail(409,'Publication is already requested. Wait for verification, then prepare a revision.');if(r.job_status==='running')fail(409,'Wait for the current production step before holding this item.');if(current.status==='live')fail(409,'This item is already live. Save a revision and approve its update; marking it needs changes does not withdraw a live item.');db.prepare('INSERT INTO factory_ai_made_edits VALUES(?,?,?,?) ON CONFLICT(job) DO UPDATE SET copy=excluded.copy,revision=excluded.revision,updated=excluded.updated').run(r.job,JSON.stringify(current.copy),current.revision+1,now());db.prepare("INSERT INTO factory_ai_made_decisions VALUES(?,'needs_changes','',?) ON CONFLICT(job) DO UPDATE SET decision='needs_changes',fingerprint='',updated=excluded.updated").run(r.job,now());await basic.checkpoint();send(res,200,{note:'Kept in AI Made for changes. No store publication requested.'});return true;}
   if(path!==ROOT+'/approve')fail(404,'AI Made action not found.');if(b.confirm!==true)fail(400,'Review the product images and confirm store publication.');const d=await detail(r.job);if(!d.product.canApprove||b.reviewToken!==d.product.reviewToken)fail(409,'Product images or settings changed. Reload and review again.');send(res,202,await release(r,d.product,d.supplier));return true;
  }finally{writing=false;}
 }};
}
