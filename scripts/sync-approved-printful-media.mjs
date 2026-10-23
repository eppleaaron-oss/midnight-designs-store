import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {normalize} from './sync-printful.mjs';
import {information} from './product-information.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ENGINE='printful-all-reported-views-v1';
export function approvedFactory(state){
 if(state.outfitQueue?.batch?.id!=='f13ad766-3e0d-4ddd-993b-167a318d0ae2')throw Error('The authorized outfit batch could not be verified.');
 const ids=new Set(state.outfitQueue.batch.scope?.pieceIds||[]),out=new Map();
 for(const f of state.outfitQueue.plans||[])for(const p of f.pieces||[]){const i=p.item;if(!ids.has(p.id)||!i?.closed||!i.cleanup?.verified||!['supplier_created','published'].includes(i.status)||!/^\d+$/.test(i.listing?.supplier_id||'')||!/^[-a-f0-9]{36}$/.test(i.job||''))continue;out.set(String(i.listing.supplier_id),{external:'midnight-factory-'+i.job,product:p.choice.product,role:p.role,outfit:f.id,collection:f.name});}
 return out;
}
export function mediaImportAllowed(product){return !product?.studioRevision;}
export function requests(product,detail,mapping,factory=false){
 return [...new Set(product.variants.map(v=>v.color))].flatMap(color=>{
  const retail=product.variants.find(v=>v.color===color&&v.size==='M')||product.variants.find(v=>v.color===color),source=detail.sync_variants.find(v=>String(v.id)===retail.id&&v.variant_id===retail.catalogVariantId);
  if(!source||source.product?.product_id!==product.catalogProductId)throw Error('Supplier variant identity mismatch.');
  const map=mapping.variant_printfiles?.find(v=>v.variant_id===retail.catalogVariantId);if(!map)throw Error('Exact variant print mapping unavailable.');
  const files=source.files.filter(f=>f.type!=='preview'&&!/^label|^inside_label/i.test(f.type)).map(f=>{
   const placement=f.type==='default'&&!map.placements.default&&map.placements.front?'front':f.type,area=mapping.printfiles.find(a=>a.printfile_id===map.placements[placement]);
   if(!area||f.status!=='ok'||f.is_temporary||!f.width||!f.height||!f.hash||!/^https:\/\/files\.cdn\.printful\.com\//.test(f.preview_url||''))throw Error('Permanently accepted print file unavailable: '+f.type);
   if(factory&&(f.width!==area.width||f.height!==area.height))throw Error('Factory native print file dimensions changed: '+placement);
   const scale=factory?1:area.fill_mode==='fit'?Math.min(area.width/f.width,area.height/f.height):Math.max(area.width/f.width,area.height/f.height),width=Math.round(f.width*scale),height=Math.round(f.height*scale);
   return {placement,image_url:f.preview_url,position:{area_width:area.width,area_height:area.height,width,height,top:Math.round((area.height-height)/2),left:Math.round((area.width-width)/2)}};
  });if(!files.length)throw Error('No accepted production print files.');
  const strings=v=>(v||[]).filter(x=>typeof x==='string');
  const split=(values,size)=>values.length?Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size)):[[]],result=[];
  for(const options of split(strings(mapping.options),4))for(const groups of split(strings(mapping.option_groups),Math.max(1,Math.floor(400/Math.max(1,options.length))))){
   const payload={variant_ids:[retail.catalogVariantId],format:'jpg',width:2000,files,product_options:Object.fromEntries((source.options||[]).filter(o=>o.id!=='license_type').map(o=>[o.id,o.value])),...(groups.length?{option_groups:groups}:{}),...(options.length?{options}: {})};
   result.push({color,retail,payload,key:digest([ENGINE,product.id,source.variant_id,payload])});
  }return result;
 });
}
export function candidates(task,variant){const out=[],seen=new Set();for(const m of task.mockups||[]){if(m.variant_ids?.length&&!m.variant_ids.includes(variant))continue;for(const c of [{url:m.mockup_url,view:m.display_name||m.placement,style:'Default'},...(m.extra||[]).map(e=>({url:e.url,view:e.option||e.title||m.display_name||m.placement,style:e.option_group||'Product'}))]){if(typeof c.url!=='string'||!c.url.startsWith('https://')||seen.has(c.url))continue;seen.add(c.url);out.push(c);}}return out;}
export function splitMockupRequest(job,productId){
 const field=job.payload.options?.length>1?'options':job.payload.option_groups?.length>1?'option_groups':null;if(!field)return [];
 const values=job.payload[field],middle=Math.ceil(values.length/2);return [values.slice(0,middle),values.slice(middle)].map(v=>{const payload={...job.payload,[field]:v};return {...job,payload,key:digest([ENGINE,productId,job.retail.catalogVariantId,payload])};});
}
export function supplierPreviews(product,detail,factory=false){
 const out=new Map(),ids=new Set(product.variants.map(v=>v.id));
 for(const v of detail.sync_variants||[]){if(!ids.has(String(v.id)))continue;for(const f of v.files||[]){
  if(f.type!=='preview'||f.status!=='ok')continue;
  const url=f.preview_url||f.url;if(typeof url!=='string'||!/^https:\/\/files\.cdn\.printful\.com\//.test(url))continue;
  let item=out.get(url);if(!item){item={url,view:'Supplier preview',style:'Saved Printful mockup',category:'product',color:factory?'Black':v.color,catalogVariantId:v.variant_id,storeVariantIds:[],alt:product.name+' · supplier mockup',label:'Supplier mockup',kind:'production-mockup'};out.set(url,item);}item.storeVariantIds.push(String(v.id));
 }}return [...out.values()];
}
export function rateLimitedSubmission(record){return record?.state==='rate_limited'||record?.state==='uncertain'&&record.error==='Printful rate limit did not clear.';}
export function mediaSupplierApi({headers,fetchImpl=fetch,sleep=delay,clock=Date.now}){
 let last=0;
 return async function api(path,payload){for(let attempt=0;attempt<5;attempt++){
  await sleep(Math.max(0,1200-(clock()-last)));last=clock();const r=await fetchImpl('https://api.printful.com/'+path,{method:payload?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(90000)});const d=await r.json();if(r.ok)return d.result;
  if(r.status===429){const seconds=Math.max(60,Number(r.headers.get('retry-after')||0));if(attempt<4){await sleep((seconds+2)*1000);continue;}throw Object.assign(Error('Printful rate limit: '+String(d.error?.message||d.result||'Wait before retrying').slice(0,300)),{status:429,retryAfter:seconds});}
  if(!payload&&r.status>=500&&attempt<4){await sleep(32000);continue;}throw Object.assign(Error('Printful HTTP '+r.status+': '+String(d.error?.message||d.result||'Request failed').slice(0,300)),{status:r.status});
 }throw Error('Printful read retry limit reached.');};
}
export async function run(){
 const token=process.env.PRINTFUL_TOKEN,repo=process.env.GITHUB_REPOSITORY;if(!token||!repo||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Run the protected main-branch media workflow.');
 const sharp=createRequire(new URL('../request-service/package.json',import.meta.url))('sharp'),headers={Authorization:'Bearer '+token,...(process.env.PRINTFUL_STORE_ID?{'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID}:{})};
 const read=async(path,fallback)=>{try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}},write=(path,value)=>fs.writeFile(path,JSON.stringify(value,null,2)+'\n');
 const api=mediaSupplierApi({headers});
 const backend=await fetch('https://midnight-designs-backend.onrender.com/api/owner/ai-factory/basic',{signal:AbortSignal.timeout(60000)});if(!backend.ok)throw Error('Factory receipt audit unavailable.');const approved=approvedFactory(await backend.json());
 let catalog=await read('products.json',{products:[]}),photos=await read('product-photos.json',{products:{}}),manifest=await read('factory-listings.json',{products:{}}),ledger=await read('printful-media-progress.json',{engine:ENGINE,jobs:{},errors:{}}),specs=await read('product-information.json',{products:{}});ledger.errors={};
 const paths=['printful-media-progress.json','product-photos.json','factory-listings.json','products.json','product-information.json','assets/product-photos','products','sitemap.xml','shop.html'];
 async function checkpoint(message){
  ledger.updatedAt=new Date().toISOString();await write('printful-media-progress.json',ledger);execFileSync('git',['add','--',...paths],{stdio:'pipe'});
  try{execFileSync('git',['diff','--cached','--quiet']);return;}catch{}
  execFileSync('git',['commit','-m',message],{stdio:'pipe'});
  for(let n=0;n<3;n++){try{execFileSync('git',['pull','--rebase','origin','main'],{stdio:'pipe'});execFileSync('git',['push','origin','HEAD:main'],{stdio:'pipe'});catalog=await read('products.json',catalog);photos=await read('product-photos.json',photos);manifest=await read('factory-listings.json',manifest);specs=await read('product-information.json',specs);return;}catch(e){if(n===2)throw Error('Media checkpoint could not be pushed; recover the workflow artifact before retrying.');await delay(3000);}}
 }
 let pendingPublish=0,published=0;
 async function publish(){if(!pendingPublish)return;execFileSync('node',['scripts/build-search-pages.mjs'],{stdio:'inherit'});await checkpoint('Import verified Printful products and permanent mockup galleries');execFileSync('node',['scripts/publish-catalog.mjs'],{stdio:'inherit'});published+=pendingPublish;pendingPublish=0;}
 execFileSync('node',['scripts/build-search-pages.mjs'],{stdio:'inherit'});await checkpoint('Restore product pages for saved Printful catalog');
 // Finish any saved publication before progress-only commits can restart Pages.
 execFileSync('node',['scripts/publish-catalog.mjs'],{stdio:'inherit'});
 const summaries=[];for(let offset=0;;){const page=await api('store/products?limit=100&offset='+offset);const list=Array.isArray(page)?page:page?.result;if(!Array.isArray(list))throw Error('Unexpected supplier product list.');summaries.push(...list);offset+=list.length;if(list.length<100)break;}
 const existing=new Set(catalog.products.map(p=>p.id)),withdrawn=new Set(manifest.withdrawn||[]),exclusions=new Set((await read('catalog-exclusions.json',{productIds:[]})).productIds);
 // First preserve every mockup already attached in Printful. This does not
 // require generating images or treating unfinished print files as accepted.
 const details=new Map();ledger.catalogAudit={supplierProducts:summaries.length,eligible:0,importedPreviews:0,held:[],checkedAt:new Date().toISOString()};
 for(const summary of summaries){const id=String(summary.id);if(summary.is_ignored||withdrawn.has(id)||exclusions.has(id))continue;
  try{const detail=await api('store/products/'+id);details.set(id,detail);const p=normalize(detail);if(!p)continue;const factory=detail.sync_product.external_id?.startsWith('midnight-factory-'),prior=manifest.products[id];
   if(factory&&detail.sync_product.external_id!==(approved.get(id)?.external||prior?.factoryExternalId))continue;
   if(factory&&!prior)continue;if(!mediaImportAllowed(prior)||!mediaImportAllowed(catalog.products.find(p=>p.id===id)))continue;ledger.catalogAudit.eligible++;
   const views=supplierPreviews(p,detail,factory),signature=digest(views);if(!views.length||photos.products[id]?.supplierPreviews===signature)continue;
   const current=catalog.products.find(x=>x.id===id)||prior||p,gallery=[...(photos.products[id]?.photos||[])];
   for(const view of views){const image='assets/product-photos/'+id+'-supplier-'+digest(view.url).slice(0,20)+'.jpg';let data;
    try{data=await fs.readFile(image);}catch{const r=await fetch(view.url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Saved supplier mockup HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('Supplier mockup exceeds image limit.');data=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:86,mozjpeg:true}).toBuffer();await fs.writeFile(image,data);}
    const {url,...meta}=view,photo={...meta,image,sha256:createHash('sha256').update(data).digest('hex')};if(!gallery.some(x=>x.sha256===photo.sha256&&JSON.stringify(x.storeVariantIds)===JSON.stringify(photo.storeVariantIds)))gallery.push(photo);
   }
   photos.updatedAt=new Date().toISOString();photos.products[id]={...(photos.products[id]||{}),name:current.name,originalImage:current.image,catalogProductId:p.catalogProductId,photos:gallery,supplierPreviews:signature};
   const product={...current,url:'products/'+id+'.html',images:[...new Set([...gallery.map(x=>x.image),...(current.images||[])])]};const at=catalog.products.findIndex(x=>x.id===id);if(at<0)catalog.products.unshift(product);else catalog.products[at]=product;if(factory)manifest.products[id]=product;
   catalog.updatedAt=catalog.lastSyncedAt=new Date().toISOString();await write('products.json',catalog);await write('product-photos.json',photos);await write('factory-listings.json',manifest);ledger.catalogAudit.importedPreviews+=views.length;pendingPublish++;
   if(pendingPublish%10===0){execFileSync('node',['scripts/build-search-pages.mjs'],{stdio:'inherit'});await checkpoint('Preserve existing Printful product mockups');}
  }catch(e){ledger.catalogAudit.held.push({id,error:e.message});if(e.status===429){ledger.retryAt=new Date(Date.now()+e.retryAfter*1000).toISOString();break;}}
 }
 await publish();await checkpoint('Save supplier catalog and existing mockup audit');
 summaries.sort((a,b)=>Number(approved.has(String(b.id))&&!existing.has(String(b.id)))-Number(approved.has(String(a.id))&&!existing.has(String(a.id))));
 await fs.mkdir('assets/product-photos',{recursive:true});let created=0,deadline=Date.now()+290*60000;
 for(const summary of summaries){if(Date.now()>deadline)break;const id=String(summary.id);if(summary.is_ignored||withdrawn.has(id)||exclusions.has(id))continue;
  try{
   const detail=details.get(id)||await api('store/products/'+id),p=normalize(detail);if(!p)continue;const external=detail.sync_product.external_id,isFactory=typeof external==='string'&&external.startsWith('midnight-factory-'),approval=approved.get(id),prior=manifest.products[id];
   if(isFactory&&external!==(approval?.external||prior?.factoryExternalId))continue;
   if(!mediaImportAllowed(prior)||!mediaImportAllowed(catalog.products.find(p=>p.id===id)))continue;
   if(approval&&p.catalogProductId!==approval.product)throw Error('Factory receipt product ID changed.');
   if(detail.sync_variants.filter(v=>p.variants.some(p=>p.id===String(v.id))).some(v=>(v.files||[]).filter(f=>f.type!=='preview').some(f=>f.status!=='ok'||f.is_temporary)))throw Error('Supplier print files are not permanently accepted.');
   const mapping=await api('mockup-generator/printfiles/'+p.catalogProductId),jobs=requests(p,detail,mapping,isFactory),fingerprint=digest(jobs.map(j=>j.key));
   if(photos.products[id]?.allReportedViews===fingerprint){console.log('Complete gallery retained for '+id);continue;}
   const gallery=[];
   for(const j of jobs){let record=ledger.jobs[j.key];
    if(record?.state==='downloaded'&&record.savedPhotos?.length){let intact=true;for(const photo of record.savedPhotos)try{await fs.access(photo.image);}catch{intact=false;}if(intact){gallery.push(...record.savedPhotos);continue;}}
    if(record?.state==='empty')continue;
    if(record?.state==='partitioned'||record?.state==='rejected'&&/maximum files|attempting to generate/i.test(record.error||'')){const parts=splitMockupRequest(j,id);if(!parts.length)throw Error(record.error);record.state='partitioned';jobs.push(...parts);continue;}
    if(record?.state==='rejected')throw Error(record.error||'Supplier rejected this mockup request.');
    let previous=null;if(rateLimitedSubmission(record)){previous={...record,attempts:0};record=null;}else if(record?.state==='submitting'||record?.state==='uncertain'){if((record.attempts||1)>=2)throw Error('Image generation retry limit reached; review the preserved image task record.');previous={...record};record=null;}
    if(!record){record=ledger.jobs[j.key]={productId:id,variant:j.retail.catalogVariantId,state:'submitting',created:new Date().toISOString(),attempts:previous?(previous.attempts||1)+1:1,...(previous?{previousSubmission:previous,note:'Retry of an unconfirmed image-only task; supplier products are never created here.'}:{})};await checkpoint('Checkpoint Printful mockup intent '+id);await delay(32000);try{const task=await api('mockup-generator/create-task/'+p.catalogProductId,j.payload);if(!task?.task_key)throw Error('Printful returned no task key.');Object.assign(record,{key:task.task_key,state:'pending'});created++;await checkpoint('Save accepted Printful mockup task '+id);}catch(e){record.state=e.status===429?'rate_limited':e.status===400&&/maximum files|attempting to generate/i.test(e.message)&&splitMockupRequest(j,id).length?'partitioned':e.status===400&&/No variants to generate|filters may exclude/i.test(e.message)?'empty':[400,401,403,404,422].includes(e.status)?'rejected':'uncertain';record.error=e.message;await checkpoint('Record Printful mockup submission outcome '+id);if(record.state==='partitioned'){jobs.push(...splitMockupRequest(j,id));continue;}if(record.state==='empty')continue;throw e;}}
    let task;for(let n=0;n<120;n++){task=await api('mockup-generator/task?task_key='+encodeURIComponent(record.key));if(task.status!=='pending')break;await delay(5000);}
    if(task.status!=='completed')throw Error('Mockup task '+task.status+': '+(task.error||'Not complete yet.'));
    const available=candidates(task,j.retail.catalogVariantId);if(!available.length)throw Error('Completed task returned no matching mockups.');
    const savedPhotos=[];for(const [index,c]of available.entries()){
     const name='assets/product-photos/'+id+'-'+j.retail.catalogVariantId+'-all-'+j.key.slice(0,10)+'-'+index+'.jpg';
     const r=await fetch(c.url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Mockup download HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('Mockup download exceeds its image limit.');const data=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:86,mozjpeg:true}).toBuffer();await fs.writeFile(name,data);
     const fit=/lifestyle|men|women|male|female|model|person|child|kid|couple/i.test(c.style),color=isFactory?'Black':j.color;
     savedPhotos.push({image:name,sha256:createHash('sha256').update(data).digest('hex'),view:c.view||'Product view',style:c.style,category:fit?'fit':'product',color,catalogVariantId:j.retail.catalogVariantId,storeVariantIds:p.variants.filter(v=>v.color===j.color).map(v=>v.id),alt:p.name+' · '+(c.view||'Product view'),label:(fit?'On-person · ':'')+(c.view||'Product view'),kind:'production-mockup'});
    }gallery.push(...savedPhotos);record.state='downloaded';record.photos=available.length;record.savedPhotos=savedPhotos;await checkpoint('Retain downloaded mockup views '+id);
   }
   const uniquePhotos=new Set();for(let n=gallery.length-1;n>=0;n--){const g=gallery[n],key=g.sha256?g.sha256+':'+g.storeVariantIds.join(','):g.image;if(uniquePhotos.has(key))gallery.splice(n,1);else uniquePhotos.add(key);}
   if(!gallery.length)throw Error('No saved mockups.');
   const current=catalog.products.find(v=>v.id===id);let product={...p,...(current||{}),variants:p.variants.map(v=>({...v,...(current?.variants.find(old=>old.id===v.id)||{}),availability:v.availability})),url:'products/'+id+'.html'};
   if(isFactory){const image=prior?.image||gallery[0].image;product={...product,...(prior||{}),id,catalogProductId:p.catalogProductId,factoryExternalId:external,name:p.name,description:prior?.description||p.name+'. Coordinated original artwork with a black printed background.',category:prior?.category||approval.role,tags:prior?.tags||[approval.role],collections:prior?.collections||[approval.collection],outfitId:prior?.outfitId||approval.outfit,image,images:[...new Set([...gallery.map(g=>g.image),...(prior?.images||[])])],variants:p.variants.map(v=>({...v,color:'Black',colorCode:'#000000',supplierBaseColor:v.color,images:gallery.filter(g=>g.storeVariantIds.includes(v.id)).map(g=>g.image),image:gallery.find(g=>g.storeVariantIds.includes(v.id))?.image}))};manifest.products[id]=product;await write('factory-listings.json',manifest);}
   else product.images=[...new Set([...gallery.map(g=>g.image),...(p.images||[])])];
   photos.updatedAt=new Date().toISOString();photos.products[id]={name:product.name,originalImage:product.image,catalogProductId:p.catalogProductId,photos:[...gallery,...(photos.products[id]?.photos||[]).filter(x=>!gallery.some(g=>g.image===x.image))],source:'Printful mockups from accepted supplier production files',supplierPreviews:photos.products[id]?.supplierPreviews,allReportedViews:fingerprint};await write('product-photos.json',photos);
   const at=catalog.products.findIndex(v=>v.id===id);if(at<0)catalog.products.unshift(product);else catalog.products[at]=product;catalog.lastSyncedAt=catalog.updatedAt=new Date().toISOString();await write('products.json',catalog);
   if(!specs.products[p.catalogProductId])specs.products[p.catalogProductId]=information(await api('products/'+p.catalogProductId));specs.updatedAt=new Date().toISOString();await write('product-information.json',specs);
   pendingPublish++;execFileSync('node',['scripts/build-search-pages.mjs'],{stdio:'inherit'});await checkpoint('Save '+gallery.length+' permanent Printful mockups for '+id);console.log('Saved '+gallery.length+' views for '+id+'; catalog '+catalog.products.length);
   if(!current||pendingPublish>=4)await publish();
  }catch(e){ledger.errors[id]=e.message;if(e.status===429)ledger.retryAt=new Date(Date.now()+(e.retryAfter||60)*1000).toISOString();await checkpoint('Record Printful media import hold '+id);console.log('Held '+id+': '+e.message);if(e.status===429)break;}
 }
 await publish();await checkpoint('Save Printful media import progress');console.log(JSON.stringify({catalog:catalog.products.length,published,acceptedTasks:created,galleries:Object.keys(photos.products).length,errors:ledger.errors}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e.message);process.exitCode=1;});
