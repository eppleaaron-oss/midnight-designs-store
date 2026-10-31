import catalogIdentity from '../catalog-identity.js';
import {studioProductDetails,orderedStudioPhotos,applyStudioDetails} from './studio-product-details.mjs';
import {ownerApproved} from '../scripts/publication-policy.mjs';
import {printfulResetDelay} from './printful-write-guard.mjs';
import {revisionHistory} from './factory-revision-history.mjs';
import {measurementLibrary,measuredAreaStamp,reviewedLayerRegion} from './factory-measured-layouts.mjs';
import {nameFactoryProduct,compareFactorySizes} from './factory-product-identity.mjs';
import {transferStudioLayer} from './factory-outfit-learning.mjs';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import sharp from 'sharp';
import {readPrintful} from './printful-read.mjs';
// Keep supplier-size canvases within the existing small backend's memory.
// These limits affect working caches and threads, never exported pixels.
sharp.cache({memory:8,files:0,items:16});
sharp.concurrency(1);
import {variantAreas} from './factory-blueprints.mjs';
import {MAX_NATIVE_PIXELS} from './factory-placement-regions.mjs';
import {renderArea} from './factory-rendering.mjs';
import {renderStudioPanelIsolated,renderAreaIsolated} from './factory-studio-render-process.mjs';
import {artworkBounds,visibleGeometry} from './factory-artwork-bounds.mjs';
import {mockupImageURL} from './factory-mockups.mjs';
import {assertBrandingPlacement} from './factory-branding.mjs';
import {BasicGithubAssets} from './factory-basic-github.mjs';
import {removeArtworkBackground} from './public/product-studio-state.js';

const ROOT='/api/owner/ai-factory/product-studio',REPO='eppleaaron-oss/midnight-designs-store';
const hash=b=>createHash('sha256').update(b).digest('hex');
const hold=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const value=(v,min,max,name)=>{if(!Number.isFinite(v)||v<min||v>max)hold('Invalid '+name+'.',400);return v;};
const templateStamp=(bp,variants)=>hash(JSON.stringify(variants.map(v=>[String(v.id),v.variant_id,variantAreas(bp,v.variant_id).map(a=>[a.placement,a.printfile_id,a.width,a.height,a.dpi,a.template?.template_id||null])])));
// Printful sync files use `default` for the front of some garments.
const supplierPanel=(v,placement)=>(v.files||[]).find(f=>f.type===placement)||(placement==='front'?(v.files||[]).find(f=>f.type==='default'):null);
const supplierPanelType=(v,placement)=>supplierPanel(v,placement)?.type||placement;
const approvalRecipe=d=>hash(JSON.stringify({variants:d.variants,templateStamp:d.templateStamp,fingerprint:d.fingerprint,...(d.details?{details:d.details}:{})}));
const fingerprint=d=>hash(JSON.stringify((d.sync_variants||[]).map(v=>[v.id,v.variant_id,(v.files||[]).filter(f=>f.type!=='preview').map(f=>[f.type,f.id,f.hash,f.url]),v.options||[]])));
export function studioLayers(panel){
 if(!panel||!Array.isArray(panel.layers)||panel.layers.length>8||!(/^#[0-9a-f]{6}$/i.test(panel.background)||panel.background===null))hold('Choose a background and up to eight artwork layers.',400);
 return {background:panel.background,layers:panel.layers.map(l=>{if(typeof l.asset!=='string'||!/^[-a-z0-9:]{1,160}$/i.test(l.asset))hold('Select saved original artwork.',400);return {asset:l.asset,x:value(l.x,0,1,'horizontal position'),y:value(l.y,0,1,'vertical position'),width:value(l.width,.001,4,'artwork width'),rotation:value(l.rotation??0,-180,180,'rotation'),mirror:l.mirror===true,allowModify:l.allowModify===true,...(l.backgroundRemoval!==undefined?{backgroundRemoval:{tolerance:value(l.backgroundRemoval?.tolerance,0,150,'background removal strength')}}:{})};})};
}
export async function renderStudioPanel(area,panel,read){
 const sources=[];
 for(const l of studioLayers(panel).layers){const a=await read(l.asset);let data=Buffer.from(a.data);if(l.backgroundRemoval){if(!a.permissions?.reuse)hold('Allow Reuse for this artwork before removing its background.');const {data:pixels,info}=await sharp(data,{limitInputPixels:40_000_000}).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});removeArtworkBackground(pixels,info.width,info.height,l.backgroundRemoval.tolerance);data=await sharp(pixels,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}const meta=await sharp(data,{limitInputPixels:40_000_000}).autoOrient().metadata(),m=meta.autoOrient||meta;
  const w=Math.max(1,Math.round(l.width*area.width)),h=Math.max(1,Math.round(w*m.height/m.width));
  const geometry={x:Math.round(l.x*area.width-w/2),y:Math.round(l.y*area.height-h/2),width:w,height:h,canvasWidth:area.width,canvasHeight:area.height,dpi:area.dpi,safeRect:l.allowModify?{x:-w,y:-h,width:area.width+2*w,height:area.height+2*h}:{x:0,y:0,width:area.width,height:area.height}};
  // Match the preview: exact black padding can extend beyond a black canvas
  // without cutting any artwork. Measure originals, never trust client bounds.
  if(panel.background==='#000000'&&!l.rotation&&!l.mirror){const bounds=await artworkBounds(data);if(bounds)geometry.contentBounds={...bounds,sourceWidth:m.width,sourceHeight:m.height};}
  sources.push({data,recipe:{fit:'contain',geometry,rotation:l.rotation,mirror:l.mirror,protect:!l.allowModify,background:panel.background},permissions:{...a.permissions,reuse:a.permissions?.reuse===true,modify:a.permissions?.modify===true||l.allowModify,crop:a.permissions?.crop===true||l.allowModify}});
 }
 // The owner controls manual artwork size. Keep actual DPI reporting while
 // retaining native canvas, geometry, permissions and pixel limits.
 return renderArea(area,sources,{background:panel.background},{},{allowLowResolution:true,preserveLayerOrder:true});
}

export async function studioPlacementIssues(variants,document,read){
 const cache=new Map(),issues=[];
 for(const [id,panels]of Object.entries(document.variants||{}))for(const [placement,panel]of Object.entries(panels)){
  const area=variants.find(v=>v.id===id)?.areas.find(a=>a.placement===placement);if(!area)continue;
  for(const [index,l]of studioLayers(panel).layers.entries()){
   if(l.allowModify||l.rotation||l.mirror)continue;
   const key=l.asset+':'+JSON.stringify(l.backgroundRemoval||null);if(!cache.has(key)){const a=await read(l.asset);let data=Buffer.from(a.data);if(l.backgroundRemoval){if(!a.permissions?.reuse)hold('Allow Reuse for this artwork before removing its background.');const {data:pixels,info}=await sharp(data,{limitInputPixels:40_000_000}).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});removeArtworkBackground(pixels,info.width,info.height,l.backgroundRemoval.tolerance);data=await sharp(pixels,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}const meta=await sharp(data).autoOrient().metadata();cache.set(key,{...(meta.autoOrient||meta),bounds:await artworkBounds(data)});}
   const m=cache.get(key),w=Math.max(1,Math.round(l.width*area.width)),h=Math.max(1,Math.round(w*m.height/m.width));
   const geometry={x:Math.round(l.x*area.width-w/2),y:Math.round(l.y*area.height-h/2),width:w,height:h};
   if(panel.background==='#000000'&&m.bounds)geometry.contentBounds={...m.bounds,sourceWidth:m.width,sourceHeight:m.height};
   const v=visibleGeometry(geometry);if(v.x<0||v.y<0||v.x+v.width>area.width||v.y+v.height>area.height){const name=area.label||placement.replace(/_dtfabric$/,'').replaceAll('_',' ');issues.push({variant:id,placement,layer:index,message:name+': visible artwork crosses the print-file edge. Choose Keep whole design inside to retain the full design, or explicitly allow edge cropping. No supplier files were changed.'});}
  }
 }
 return issues;
}

export async function studioResolutionIssues(variants,document,read){
 const cache=new Map(),issues=[];
 for(const [id,panels]of Object.entries(document.variants||{}))for(const [placement,panel]of Object.entries(panels)){
  const a=variants.find(v=>v.id===id)?.areas.find(a=>a.placement===placement);if(!a)continue;
  for(const [index,l]of studioLayers(panel).layers.entries()){
   if(!cache.has(l.asset)){const source=await read(l.asset),meta=await sharp(Buffer.from(source.data)).autoOrient().metadata();cache.set(l.asset,meta.autoOrient||meta);}
   const m=cache.get(l.asset),dpi=Math.min(m.width/Math.max(1,Math.round(l.width*a.width)),m.height/Math.max(1,Math.round(l.width*a.width*m.height/m.width)))*a.dpi;
   if(dpi+1<a.dpi)issues.push({variant:id,placement,layer:index,effectiveDpi:Math.floor(dpi),requiredDpi:a.dpi,maxWidthIn:Math.round(m.width/a.dpi*100)/100});
  }
 }
 return issues;
}
// Reconstruct only transforms represented by this editor. Unsupported creative
// edits remain flattened rather than being replaced with a guessed composition.
export function studioProductionPanel(area,recipe,lookup,background='#000000'){
 if(!recipe)return null;if(recipe.fillOnly)return {background,layers:[]};const elements=recipe.elements||[recipe],layers=[];
 for(const r of elements){const a=lookup(r.artworkId);if(!a?.width||!a?.height||r.tile||r.recolor||r.crop&&Object.entries(r.crop).some(([k,v])=>v!==(['width','height'].includes(k)?100:0)))return null;
  const ratio=Math.min(area.width/a.width,area.height/a.height)*(r.scale??100)/100,w=r.geometry?.width||(r.withoutEnlargement?Math.min(1,ratio):ratio)*a.width,h=r.geometry?.height||w*a.height/a.width;
  const x=r.geometry?r.geometry.x+w/2:area.width*(.5+(r.x||0)/100),y=r.geometry?r.geometry.y+h/2:area.height*(.5+(r.y||0)/100);
  layers.push({asset:'art:'+r.artworkId,x:x/area.width,y:y/area.height,width:w/area.width,rotation:r.rotation||0,mirror:r.mirror===true,allowModify:r.protect===false});
 }return {background,layers};
}

export function factoryProductStudio({db,editor,blueprints,workflow,basic,backups,auth,body,send,fail,limit,origin,fetchImpl=fetch,clock=Date.now,token=process.env.PRINTFUL_TOKEN,storeId=process.env.PRINTFUL_STORE_ID,assets:providedAssets=null,stepAssetLimit=4,maxConcurrentUpdates=3,supplierWriteGapMs=6600,mockupWriteGapMs=31000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_studio_drafts(supplier TEXT PRIMARY KEY,source TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_studio_jobs(id TEXT PRIMARY KEY,supplier TEXT NOT NULL,source TEXT NOT NULL,revision INTEGER NOT NULL,target TEXT NOT NULL,state TEXT NOT NULL,document TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS factory_studio_one_product ON factory_studio_jobs(supplier) WHERE state NOT IN ('completed','cancelled');
 CREATE TABLE IF NOT EXISTS factory_studio_assets(id TEXT PRIMARY KEY,job TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,sha TEXT NOT NULL,data BLOB NOT NULL,remote TEXT,capability TEXT NOT NULL UNIQUE,created INTEGER NOT NULL);`);
 const learned=measurementLibrary(db),history=revisionHistory(db);
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const assetLimit=Math.max(1,Math.min(4,Math.floor(stepAssetLimit)||4)),concurrentLimit=Math.max(1,Math.min(3,Math.floor(maxConcurrentUpdates)||3));
 const config=backups.connection?.(),assets=providedAssets||(config?new BasicGithubAssets(config,{fetchImpl,clock}):null);const byteCache=new Map(),byteReads=new Map();const busy=new Map(),served=new Map(),submissions=new Set();let resolved=/^\d+$/.test(String(storeId||''))?String(storeId):null,closing=false;
 const has=table=>!!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",table);
 const nativeItems=()=>has('factory_basic_items')&&db.prepare('PRAGMA table_info(factory_basic_items)').all().some(c=>c.name==='id');
 function trackedItem(itemId,id){if(!itemId)return null;const r=get('SELECT i.*,l.supplier_id,l.copy FROM factory_basic_items i LEFT JOIN factory_listings l ON l.job=i.job WHERE i.id=?',itemId);if(!r)return null;const recipe=JSON.parse(r.recipe),copy=r.copy?JSON.parse(r.copy):{};return {id,itemId:r.id,jobId:r.job,collection:recipe.outfitCollection||recipe.set.name,name:copy.title||recipe.name,state:r.status,supplierId:r.supplier_id,editable:false,choice:{setId:recipe.set.id,product:recipe.product,audience:recipe.audience,sizes:(recipe.variants||[]).map(v=>v.size),allowUnspecifiedAudience:recipe.allowUnspecifiedAudience===true,layout:recipe.layout?.input||null}};}
 function source(id){const p=rawSource(id);return p?nameFactoryProduct(p):p;}
 function rawSource(id){if(nativeItems()&&typeof id==='string'){if(id.startsWith('item:'))return trackedItem(id.slice(5),id);if(id.startsWith('piece:')&&has('factory_basic_outfit_pieces')){const piece=get('SELECT item,outfit FROM factory_basic_outfit_pieces WHERE id=?',id.slice(6)),item=piece&&trackedItem(piece.item,id);if(item)return {...item,pieceId:id.slice(6),outfit:piece.outfit};}}
  if(typeof id==='string'&&id.startsWith('made:')&&has('idea_made')){const m=get('SELECT * FROM idea_made WHERE id=?',id.slice(5));if(m)return {id,jobId:m.job,collection:m.set_name,name:m.name,state:m.status,supplierId:m.printful_id,editable:false,choice:{setId:m.set_id,product:m.catalog}};}
  const lib=editor.library();return [...lib.pieces,...lib.products].find(p=>p.id===id);
 }
 function family(p){if(has('idea_sets')){const row=get('SELECT * FROM idea_sets WHERE id=?',p.choice.setId);if(row){const set={...row,parts:JSON.parse(row.parts)},products=nativeItems()?all("SELECT i.id FROM factory_basic_items i JOIN factory_listings l ON l.job=i.job WHERE json_extract(i.recipe,'$.set.id')=? AND l.supplier_id IS NOT NULL ORDER BY i.created",set.id).map(r=>trackedItem(r.id,'item:'+r.id)):[];return {set,products};}}
  const lib=editor.library();return {set:lib.sets.find(s=>s.id===p.choice.setId),products:[...lib.pieces,...lib.products]};
 }
 const checkpoint=()=>backups.checkpoint();const saves=new Set(),draftReceipts=new Map();let saveError='';
 function saveSoon(draft){saveError='';if(draft)draftReceipts.set(draft.supplier,{...(draftReceipts.get(draft.supplier)||{}),error:''});const p=Promise.resolve().then(checkpoint).then(()=>{if(draft){const receipt=draftReceipts.get(draft.supplier)||{};draftReceipts.set(draft.supplier,{confirmedRevision:Math.max(receipt.confirmedRevision||0,draft.revision),error:receipt.error||''});}}).catch(e=>{saveError=String(e.message).split(token||'\0').join('[redacted]').slice(0,500);if(draft)draftReceipts.set(draft.supplier,{...(draftReceipts.get(draft.supplier)||{}),error:saveError});}).finally(()=>saves.delete(p));saves.add(p);}
 const recovery=supplier=>supplier?{pending:(draftReceipts.get(supplier)?.confirmedRevision||0)<(get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',supplier)?.revision||0),tracked:draftReceipts.has(supplier),confirmedRevision:draftReceipts.get(supplier)?.confirmedRevision||0,error:draftReceipts.get(supplier)?.error||''}:{pending:saves.size>0,error:saveError};
 const remember=(id,data)=>{byteCache.set(id,data);while([...byteCache.values()].reduce((n,b)=>n+b.length,0)>12*1024*1024&&byteCache.size>1)byteCache.delete(byteCache.keys().next().value);return data;};
 const writeLanes={sync:{tail:Promise.resolve(),next:0,gap:supplierWriteGapMs},mockup:{tail:Promise.resolve(),next:0,gap:mockupWriteGapMs}};
 async function pacedSupplierWrite(url,options,lane){
  const previous=lane.tail;let release;lane.tail=new Promise(r=>release=r);await previous;
  try{const delay=lane.next-clock();if(delay>0)await sleep(delay);lane.next=clock()+lane.gap;
   const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(25000)}),limit=Number(r.headers.get('x-ratelimit-limit'));
   if(limit>0&&Number.isFinite(limit)&&lane.gap>0){lane.gap=Math.max(100,Math.ceil(66000/limit));lane.next=Math.max(lane.next,clock()+lane.gap);}
   if(r.status===429||r.headers.get('x-ratelimit-remaining')==='0'){lane.next=Math.max(lane.next,clock()+Math.max(1000,printfulResetDelay(r.headers,clock)));}
   return r;
  }finally{release();}
 }
 async function pf(path,options={}){if(!token)hold('Printful is not connected.',503);const url='https://api.printful.com/'+path,request={...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(resolved?{'X-PF-Store-Id':resolved}:{}),...options.headers}};let r;
  try{r=(!options.method||options.method==='GET')?await readPrintful(url,{...request,timeoutMs:25000},fetchImpl):await pacedSupplierWrite(url,request,path.startsWith('mockup-generator/')?writeLanes.mockup:writeLanes.sync);}catch(e){if(e.status===429)throw e;hold('The Printful connection was interrupted. Saved work is retained for retry.',503);}
  let d;try{d=await r.json();}catch{d={};}if(!r.ok||d.error||Number(d.code)>=400)throw Object.assign(Error('Printful HTTP '+r.status+': '+String(d.error?.message||d.error||d.result||'Request rejected').split(token).join('[redacted]').slice(0,450)),{status:r.status===429?429:r.status>=500?503:409,providerStatus:r.status,retryAfter:Number(r.headers.get('retry-after')||60)});return d.result;
 }
 async function connection(){if(resolved)return;const stores=await pf('stores');if(!Array.isArray(stores)||stores.length!==1)hold('The Printful store must be identified before editing.');resolved=String(stores[0].id);}
 async function detail(p){await connection();if(!/^\d+$/.test(String(p?.supplierId||'')))hold('This product has not been created in Printful. Use its waiting-piece recipe editor.');const d=await pf('store/products/'+p.supplierId);if(String(d?.sync_product?.id)!==String(p.supplierId)||!d.sync_variants?.length)hold('Printful product verification failed: requested '+p.supplierId+', returned '+(d?.sync_product?.id||'no product ID')+', '+(d?.sync_variants?.length||0)+' variants. No supplier product was changed.');if(d.sync_variants.some(v=>v.product?.product_id!==p.choice.product))hold('The supplier product does not match its saved garment. No product was substituted.');return d;}
 function jobView(j){if(!j)return null;const d=JSON.parse(j.document);return {recovery:recovery(),id:j.id,supplier:j.supplier,revision:j.revision,target:j.target,state:j.state,error:j.error,updated:j.updated,next:j.next,attempts:j.attempts,expectedFiles:Object.values(d.variants||{}).reduce((n,p)=>n+Object.keys(p).length,0),fingerprint:d.finalFingerprint||null,failureStage:d.failureStage||null,canRevise:!!(j.state==='failed'&&['queued','rendering'].includes(d.failureStage)&&!d.printfulUpdated&&!d.updatedVariants?.length&&!d.tasks?.length),awaitingApproval:j.target==='mockups'&&j.state==='completed'&&!d.storeUpdated,ownerApproved:!!d.ownerApproval,printfulUpdated:!!d.printfulUpdated,storeUpdated:!!d.storeUpdated,resolutionWarnings:d.resolutionWarnings||[],tasks:(d.tasks||[]).map(t=>({key:t.key,state:t.state,variants:t.variants,error:t.error||''})),images:(d.generatedImages||d.images||[]).map(i=>({...i,url:i.storeUrl||ROOT+'/asset/'+i.asset})),files:(d.outputs||[]).map(f=>({placement:f.placement,variant:f.variant,width:f.width,height:f.height,sha256:f.sha,url:ROOT+'/asset/'+f.asset}))};}
 async function open(id){const p=source(id);if(!p)hold('This exact saved product is unavailable.',404);const listingRequest=Promise.resolve().then(()=>fetchImpl('https://midnight-designs.store/products.json?studio-open='+clock(),{cache:'no-store',signal:AbortSignal.timeout(5000)})).then(async r=>r.ok?{verified:true,product:(await r.json()).products?.find(x=>String(x.id)===String(p.supplierId))}:{verified:false}).catch(()=>({verified:false}));const d=await detail(p),bp=blueprints.peek?.(p.choice.product)||await blueprints.load(p.choice.product,'default');
  const familyData=family(p),set=familyData.set,originals=[];
  for(const [part,a] of Object.entries(set?.parts||{})){const imported=get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_imported_artwork'")?(get('SELECT artwork FROM factory_imported_artwork WHERE url=?',a.url+'#factoryCollection='+encodeURIComponent(set.name))||get('SELECT artwork FROM factory_imported_artwork WHERE url=?',a.url)):null,aid=a.artwork||imported?.artwork,row=aid&&get('SELECT id,name,mime,data,permissions FROM factory_artwork WHERE id=?',aid);if(row){const m=await sharp(Buffer.from(row.data)).metadata();originals.push({asset:'art:'+aid,part,name:a.name||part,width:m.width,height:m.height,contentBounds:await artworkBounds(Buffer.from(row.data)),url:'/api/owner/ai-factory/artwork/'+aid+'/file'});}else originals.push({pending:true,part,name:a.name||part,url:a.thumb||a.url});}
  const variants=d.sync_variants.map(v=>({id:String(v.id),catalog:v.variant_id,name:v.name,size:v.size,color:v.color,areas:variantAreas(bp,v.variant_id).map(a=>({...a,templateUrl:a.template?.image_url?'/api/owner/ai-factory/blueprints/template/'+p.choice.product+'/'+a.template.template_id:null,current:(v.files||[]).find(f=>f.type===a.placement||a.placement==='front'&&f.type==='default')||null}))}));
  variants.sort((a,b)=>compareFactorySizes(a.size||'',b.size||'')||String(a.color||'').localeCompare(String(b.color||'')));
  const basePanels={},suggestedPanels={},savedPlan=p.jobId&&get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_render_plans'")?get('SELECT plan FROM factory_render_plans WHERE job=?',p.jobId):null,plan=savedPlan?JSON.parse(savedPlan.plan):null;
  if(plan)for(const v of variants)for(const a of v.areas){let u;try{u=new URL(a.current?.url);}catch{}const recipe=plan.numericLayout?.variants?.find(x=>x.variant===v.catalog)?.placements?.[a.placement]||plan.placements?.[a.placement];const panel=studioProductionPanel(a,recipe,id=>originals.find(a=>a.asset==='art:'+id),plan.numericLayout?.background??plan.background??'#000000');if(panel){suggestedPanels[v.id]??={};suggestedPanels[v.id][a.placement]=panel;if(u?.origin===origin&&u.pathname.startsWith('/factory-print-file/')){basePanels[v.id]??={};basePanels[v.id][a.placement]=panel;}}}
  const saved=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId)),job=get("SELECT * FROM factory_studio_jobs WHERE supplier=? ORDER BY updated DESC,rowid DESC LIMIT 1",String(p.supplierId));
  // A collection may have changed since this product was edited. Resolve the
  // saved layer IDs as well, rather than displaying blank layers or substituting
  // the collection's newer artwork into an existing product.
  const savedDocument=saved?JSON.parse(saved.document):null;
  const savedArtwork=new Set(Object.values(savedDocument?.variants||{}).flatMap(panels=>Object.values(panels).flatMap(panel=>(panel.layers||[]).map(l=>l.asset))).filter(id=>id.startsWith('art:')));
  for(const ref of savedArtwork){if(originals.some(a=>a.asset===ref))continue;const row=get('SELECT id,name,data FROM factory_artwork WHERE id=?',ref.slice(4));if(!row)continue;const meta=await sharp(Buffer.from(row.data)).metadata(),m=meta.autoOrient||meta;originals.push({asset:ref,name:row.name||'Saved product artwork',width:m.width,height:m.height,contentBounds:await artworkBounds(Buffer.from(row.data)),url:'/api/owner/ai-factory/artwork/'+row.id+'/file'});}
  const listingResult=await listingRequest,listing=listingResult.product;
  let copy=null;if(p.jobId&&get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_listings'")){const l=get('SELECT copy FROM factory_listings WHERE job=?',p.jobId);if(l)copy=JSON.parse(l.copy);}
  const details={name:listing?.name||copy?.title||p.name,description:listing?.description||copy?.description||'',collections:listing?.collections||copy?.collections||[p.collection].filter(Boolean),categoryId:listing?.categoryId||catalogIdentity.categoryId({catalogProductId:p.choice.product}),variants:Object.fromEntries(d.sync_variants.map(v=>[String(v.id),{price:Number(v.retail_price),enabled:listing?.variants?.find(x=>String(x.id)===String(v.id))?.ownerAvailable!==false}])),photoOrder:[],hiddenPhotos:[]};
  return {templateStamp:templateStamp(bp,d.sync_variants),templateSource:bp.source,recovery:recovery(),draftRecovery:recovery(String(p.supplierId)),product:{...p,printfulEditUrl:undefined},details,openedAt:clock(),published:!!listing,publicationVerified:listingResult.verified,variants,originals,basePanels,suggestedPanels,uploads:all("SELECT * FROM factory_studio_assets WHERE job=? AND kind='upload'",'studio-upload-'+p.supplierId).map(assetMeta),group:{id:set?.id,name:set?.name||p.collection,products:familyData.products.filter(x=>x.choice.setId===p.choice.setId&&x.supplierId&&x.supplierId!==p.supplierId).filter((x,i,a)=>a.findIndex(y=>y.supplierId===x.supplierId)===i).map(x=>({id:x.id,name:x.name,supplierId:x.supplierId}))},options:bp.printfiles.options||[],optionGroups:bp.printfiles.option_groups||[],fingerprint:fingerprint(d),revision:saved?.revision||0,document:saved?JSON.parse(saved.document):null,job:jobView(job),note:'Actual supplier templates and current print files. Template guidelines are visual references; the API does not provide safe-area masks.'};
 }
 function assetMeta(a){return {asset:a.id,name:a.name,width:a.width,height:a.height,url:ROOT+'/asset/'+a.id};}
 async function putAsset(job,kind,name,data,mime='image/png'){
  const sha=hash(data),same=get('SELECT * FROM factory_studio_assets WHERE job=? AND kind=? AND sha=?',job,kind,sha);if(same)return same.remote?same:{...same,data};
  const m=await sharp(data,{limitInputPixels:MAX_NATIVE_PIXELS}).metadata();if(data.length>25*1024*1024)hold('This image exceeds 25 MB.');
  if(get('SELECT coalesce(sum(length(data)),0) n FROM factory_studio_assets').n+data.length>100*1024*1024)hold('Editor working storage is full. Finish the active update before adding more images.');
  const id=randomUUID();run('INSERT INTO factory_studio_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,job,kind,name,mime,m.width,m.height,sha,Buffer.alloc(0),null,randomBytes(32).toString('hex'),clock());return {...get('SELECT * FROM factory_studio_assets WHERE id=?',id),data};
 }
 async function persistAsset(a){if(!assets)hold('Persistent artwork storage is unavailable.',503);if(a.remote)return;const data=Buffer.isBuffer(a.data)?a.data:Buffer.from(a.data);remember(a.id,data);const remote=await assets.put(a.job,a.kind,a.id,data,a.sha);run('UPDATE factory_studio_assets SET remote=?,data=? WHERE id=?',JSON.stringify(remote),Buffer.alloc(0),a.id);}
 async function bytes(a){if(byteCache.has(a.id))return byteCache.get(a.id);if(a.data?.length)return remember(a.id,Buffer.from(a.data));if(!a.remote||!assets)hold('Saved image bytes are unavailable.');if(byteReads.has(a.id))return byteReads.get(a.id);const reading=Promise.resolve().then(()=>assets.read(JSON.parse(a.remote).asset,a.job,a.kind,a.id,a.sha)).then(data=>remember(a.id,data));byteReads.set(a.id,reading);try{return await reading;}finally{byteReads.delete(a.id);}}
 async function readArtwork(ref){if(ref.startsWith('art:')){const a=get('SELECT * FROM factory_artwork WHERE id=?',ref.slice(4));if(!a)hold('Original artwork is missing.');if(a.sha256&&hash(Buffer.from(a.data))!==a.sha256)hold('Original artwork checksum changed.');const root=a.original?get('SELECT permissions FROM factory_artwork WHERE id=?',a.original):a;if(!root)hold('The preserved original artwork is missing.');const permissions=JSON.parse(a.permissions),original=JSON.parse(root.permissions);return {data:a.data,permissions:Object.fromEntries(['reuse','modify','crop','recolor'].map(k=>[k,permissions[k]===true&&original[k]===true]))};}const a=get('SELECT * FROM factory_studio_assets WHERE id=? AND kind=\'upload\'',ref);if(!a)hold('The uploaded artwork is missing.');return {data:await bytes(a),permissions:{reuse:true,crop:true,modify:true,recolor:true}};}
 async function recoverPrintPanel(j,d,v,area,file){
  if(!d.sourceJob)hold('This old print file has no saved production job. Reassign an original design to this panel before generating new mockups.');
  const item=get('SELECT recipe,cleanup FROM factory_basic_items WHERE job=?',d.sourceJob),cleanup=item?.cleanup?JSON.parse(item.cleanup):null,saved=get('SELECT plan FROM factory_render_plans WHERE job=?',d.sourceJob),plan=saved&&JSON.parse(saved.plan);
  if(!cleanup?.verified||!plan)hold('The old print file cannot be recovered from a verified recipe. Assign original artwork to this panel before finishing.');
  const template=cleanup.templates?.find(t=>t.variant===v.variant_id),savedArea=template&&JSON.parse(template.areas).find(a=>a.placement===area.placement);
  if(!savedArea||savedArea.width!==area.width||savedArea.height!==area.height||savedArea.dpi!==area.dpi)hold('This archived print template differs from the current variant. Review and assign the panel again.');
  const r=plan.numericLayout?.variants?.find(x=>x.variant===v.variant_id)?.placements?.[area.placement]||plan.placements?.[area.placement];if(!r)hold('The exact archived panel composition is missing. Reassign its original artwork.');
  const elements=r.elements||[r],sources=[];for(const recipe of elements){if(recipe.fillOnly)continue;const a=await readArtwork('art:'+recipe.artworkId);sources.push({data:Buffer.from(a.data),recipe,permissions:a.permissions});}
  const rendered=await renderAreaIsolated(area,sources,{background:plan.numericLayout?.background??plan.background??'#000000'});
  const receipt=cleanup.supplierReceipt?.variants?.find(x=>x.supplierVariantId===v.id)?.files?.find(x=>x.placement===area.placement),record=receipt?.supplierFileId===file.id?receipt:!cleanup.supplierReceipt?cleanup.files?.find(f=>f.placement===area.placement&&f.width===area.width&&f.height===area.height&&f.sha256===rendered.sha256):null;
  if(!record||record.sha256!==rendered.sha256)hold('Recovered print pixels did not match the original saved checksum. No supplier design was changed. Reassign the panel before finishing.');
  const a=await putAsset('studio-'+j.id,'print','Recovered '+area.placement,rendered.data);await persistAsset(a);return {asset:a.id,url:link(a),sha:a.sha,placement:area.placement,width:area.width,height:area.height,sourceSupplierFileId:file.id};
 }

 function saveDocument(p,b){if(!b.document||typeof b.document!=='object'||Array.isArray(b.document)||JSON.stringify(b.document).length>200000)hold('Invalid product edit.',400);const previous=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));if(!Number.isSafeInteger(b.revision)||b.revision<0||b.revision>=Number.MAX_SAFE_INTEGER||b.revision<(previous?.revision||0))hold('This product changed in another tab. Reload before saving.');
  // A browser may hold a later, acknowledged revision than the restored
  // checkpoint. Preserve that owner-submitted recipe instead of forcing a
  // reload that destroys it. Older tabs still cannot overwrite newer drafts.
  const variants=b.document.variants;if(!variants||typeof variants!=='object'||Array.isArray(variants)||Object.keys(variants).length>100)hold('Choose the exact variants to edit.',400);
  const document={...(b.document.details?{details:studioProductDetails(b.document.details)}:{}),templateStamp:b.document.templateStamp||null,fingerprint:b.document.fingerprint,variants:Object.fromEntries(Object.entries(variants).map(([id,panels])=>{if(!/^\d+$/.test(id)||!panels||typeof panels!=='object'||Array.isArray(panels)||Object.keys(panels).length>40)hold('Invalid variant or print panel.',400);return [id,Object.fromEntries(Object.entries(panels).map(([k,v])=>{if(!/^[-a-z0-9_]{1,60}$/i.test(k))hold('Invalid print panel.',400);return [k,studioLayers(v)];}))];}))};
  if(previous&&isDeepStrictEqual(JSON.parse(previous.document),document))return {revision:previous.revision,document,unchanged:true};
  const revision=Math.max(b.revision,get('SELECT coalesce(max(revision),0) n FROM factory_studio_revision_history WHERE supplier=?',String(p.supplierId)).n)+1;run('INSERT INTO factory_studio_drafts VALUES(?,?,?,?,?) ON CONFLICT(supplier) DO UPDATE SET source=excluded.source,revision=excluded.revision,document=excluded.document,updated=excluded.updated',String(p.supplierId),p.id,revision,JSON.stringify(document),clock());return {revision,document};
 }
 function update(j,d,state=j.state){run('UPDATE factory_studio_jobs SET document=?,state=?,error=\'\',attempts=0,next=0,updated=? WHERE id=?',JSON.stringify(d),state,clock(),j.id);}
 const link=a=>origin+'/factory-studio-file/'+a.capability;
 async function gh(path,opts={}){const key=basic.storeToken();if(!key)hold('Waiting for the app’s automatic GitHub publishing connection.',503);const r=await fetchImpl('https://api.github.com/repos/'+REPO+path,{...opts,headers:{Authorization:'Bearer '+key,Accept:'application/vnd.github+json','Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});if(r.status===404&&opts.missing)return null;if(!r.ok)hold('Store publishing returned HTTP '+r.status+'.',r.status===409||r.status===429||r.status>=500?503:409);if(r.status===204)return {};try{return await r.json();}catch{hold('GitHub returned an incomplete publishing response. Saved work is retained.',503);}}
 let manifestTail=Promise.resolve();
 async function readManifest(path='factory-listings.json'){
  const file=await gh('/contents/'+path+'?ref=main',{missing:true});if(!file)return {file:null,manifest:{products:{}}};let encoded=file.content;
  if(file.encoding==='none'||!encoded){
   if(!/^[a-f0-9]{40}$/.test(file.sha)||!Number.isSafeInteger(file.size)||file.size<1||file.size>16*1024*1024)hold('The saved store manifest has an invalid size or identity.');
   const blob=await gh('/git/blobs/'+file.sha);if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.content.length>24*1024*1024)hold('The saved store manifest blob is invalid.');
   const bytes=Buffer.from(blob.content,'base64'),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');if(bytes.length!==file.size||sha!==file.sha)hold('The saved store manifest checksum did not match. No listing was replaced.');encoded=blob.content;
  }
  try{const manifest=JSON.parse(Buffer.from(encoded,'base64'));if(path==='products.json'?!Array.isArray(manifest.products):!manifest.products||typeof manifest.products!=='object'||Array.isArray(manifest.products))hold('The saved store manifest is invalid.');return {file,manifest};}catch(e){if(e.status)throw e;hold('The saved store manifest could not be decoded. No listing was replaced.');}
 }
 async function content(path,data,message){for(let n=0;n<3;n++){const old=await gh('/contents/'+path+'?ref=main',{missing:true});const buf=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data,null,2)+'\n');const expected=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');if(old?.sha===expected)return;try{await gh('/contents/'+path,{method:'PUT',body:JSON.stringify({branch:'main',message,content:buf.toString('base64'),...(old?{sha:old.sha}:{})})});return;}catch(e){if(n===2)throw e;}}}
 async function advance(j){const d=JSON.parse(j.document);
  const approval=d.ownerApproval;
  if(j.target!=='mockups'&&['updating_printful','publishing','verifying_store'].includes(j.state)&&(!approval||approval.revision!==j.revision||approval.recipe!==approvalRecipe(d)))hold('Explicit owner approval is required for this exact revision. Review it in AI Made before updating fulfillment or publishing.');
  if(d.sourceJob&&get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_jobs'")&&get("SELECT id FROM factory_jobs WHERE id=? AND status IN ('archived','failed')",d.sourceJob))hold('This source product is unfinished or rejected. Review it before publishing.');
  if(j.state==='queued'){
   const live=await pf('store/products/'+j.supplier);if(fingerprint(live)!==d.fingerprint)hold('Printful files changed since you opened this product. Reload before updating.');
   const uploads=[...new Set(Object.values(d.variants).flatMap(p=>Object.values(p).flatMap(p=>p.layers.map(l=>l.asset))).filter(a=>!a.startsWith('art:')))];
   for(const a of all("SELECT * FROM factory_studio_assets WHERE kind='upload' AND id IN (SELECT value FROM json_each(?))",JSON.stringify(uploads)))await persistAsset(a);
   update(j,d,'rendering');saveSoon();return;
  }
  if(j.state==='rendering'){
   d.outputs??=[];
   for(const [variant,panels]of Object.entries(d.variants))for(const [placement,panel]of Object.entries(panels)){
    if(d.outputs.some(f=>f.variant===variant&&f.placement===placement))continue;const v=d.supplier.sync_variants.find(v=>String(v.id)===variant),area=variantAreas(d.blueprint,v.variant_id).find(a=>a.placement===placement);
    // Share pixels only when canvas, composition, source bytes and current
    // permissions match. Keep an independent output mapping for every size.
    const inputs=new Map();for(const layer of panel.layers)if(!inputs.has(layer.asset))inputs.set(layer.asset,await readArtwork(layer.asset));
    const renderKey=hash(JSON.stringify({width:area.width,height:area.height,dpi:area.dpi,panel,sources:[...inputs].map(([id,a])=>({id,sha:hash(Buffer.from(a.data)),permissions:a.permissions}))}));
    const same=d.outputs.find(o=>o.renderKey===renderKey);
    if(same){const a=get("SELECT * FROM factory_studio_assets WHERE id=? AND job=? AND kind='print'",same.asset,'studio-'+j.id);if(a?.remote&&a.sha===same.sha&&a.width===area.width&&a.height===area.height){d.outputs.push({...same,variant,placement});continue;}}
    const rendered=await renderStudioPanelIsolated(area,panel,async id=>inputs.get(id)),a=await putAsset('studio-'+j.id,'print',placement,rendered.data);await persistAsset(a);d.outputs.push({variant,placement,renderKey,asset:a.id,sha:a.sha,width:area.width,height:area.height,url:link(a)});update(j,d);if(!saves.size)saveSoon();return;
   }
   update(j,d,j.target==='mockups'?'mockups':'updating_printful');saveSoon();return;
  }
  if(j.state==='updating_printful'){
   if(j.target==='mockups'){update(j,d,'mockups');saveSoon();return;}
   // Persist the complete immutable intent once before a bounded batch of PUTs.
   // After a lost response/restart, GET reconciles the exact saved URLs; no
   // additional snapshot is required between replay-safe variant updates.
   d.updatedVariants??=[];const confirmedBefore=d.updatedVariants.length;const live=await pf('store/products/'+j.supplier);if(String(live?.sync_product?.id)!==j.supplier)hold('Supplier product identity changed.');let submittedCount=0,waiting=false;
   if(d.details){studioProductDetails(d.details,d.supplier.sync_variants.map(v=>String(v.id)));if(!d.detailsIntentSaved){d.detailsIntentSaved=true;update(j,d);try{await checkpoint();}catch(e){d.detailsIntentSaved=false;update(j,d);throw e;}}if(live.sync_variants.length!==d.supplier.sync_variants.length||d.supplier.sync_variants.some(v=>!live.sync_variants.some(x=>x.id===v.id&&x.variant_id===v.variant_id)))hold('Supplier variant identities changed.');
    if(live.sync_product.name!==d.details.name){if(live.sync_product.name!==d.supplier.sync_product.name)hold('The supplier product name changed in another editor.');await pf('store/products/'+j.supplier,{method:'PUT',body:JSON.stringify({sync_product:{name:d.details.name}})});return;}
    for(const v of live.sync_variants){const price=d.details.variants[String(v.id)].price;if(Number(v.retail_price)===price)continue;const original=d.supplier.sync_variants.find(x=>x.id===v.id);if(Number(v.retail_price)!==Number(original.retail_price))hold('A supplier price changed in another editor.');await pf('store/variants/'+v.id,{method:'PUT',body:JSON.stringify({retail_price:price.toFixed(2)})});return;}
   }

   for(const [id,panels]of Object.entries(d.variants)){
    const v=live.sync_variants.find(v=>String(v.id)===id),original=d.supplier.sync_variants.find(v=>String(v.id)===id);if(!v||v.variant_id!==original.variant_id)hold('An existing supplier variant changed. Nothing was remapped.');
    const outputs=d.outputs.filter(o=>o.variant===id),matches=outputs.every(o=>supplierPanel(v,o.placement)?.url===o.url);
    if(d.updatedVariants.includes(id)&&matches)continue;
    const replaced=new Set(Object.keys(panels).map(placement=>supplierPanelType(original,placement)));const untouched=(original.files||[]).filter(f=>f.type!=='preview'&&!replaced.has(f.type)).map(f=>({id:f.id,type:f.type,...(Array.isArray(f.options)?{options:f.options}:{})}));
    const submitted={variant_id:original.variant_id,files:[...untouched,...outputs.map(o=>({type:supplierPanelType(original,o.placement),url:o.url}))]};
    // PUT is replay-safe. A lost response is reconciled against the same variant
    // and immutable URLs. No POST to create a product exists in this editor.
    if(!matches){waiting=true;if(submittedCount>=4)continue;for(const f of v.files||[]){if(f.type==='preview')continue;const old=original.files.find(x=>x.type===f.type),output=outputs.find(x=>supplierPanelType(original,x.placement)===f.type);if(f.id!==old?.id&&f.url!==output?.url)hold('A supplier print panel changed in another editor. Reload before replacing it.');}if(!d.supplierIntentSaved){d.supplierIntentSaved=true;update(j,d);try{await checkpoint();}catch(e){d.supplierIntentSaved=false;update(j,d);throw e;}}await pf('store/variants/'+id,{method:'PUT',body:JSON.stringify(submitted)});submittedCount++;continue;}
    if(outputs.some(o=>supplierPanel(v,o.placement)?.status==='failed'))hold('Printful rejected an edited print file.');
    if(outputs.some(o=>supplierPanel(v,o.placement)?.status!=='ok')){waiting=true;continue;}
    if(!d.updatedVariants.includes(id))d.updatedVariants.push(id);
   }
   if(waiting){if(submittedCount||d.updatedVariants.length!==confirmedBefore)update(j,d);run('UPDATE factory_studio_jobs SET next=? WHERE id=?',clock()+15000,j.id);return;}
   d.printfulUpdated=true;d.finalSupplier=live;d.finalFingerprint=fingerprint(live);const draft=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',j.supplier);if(draft){const recipe=JSON.parse(draft.document);if(draft.revision===j.revision||recipe.fingerprint===d.fingerprint){recipe.fingerprint=d.finalFingerprint;run('UPDATE factory_studio_drafts SET document=? WHERE supplier=?',JSON.stringify(recipe),j.supplier);}}update(j,d,j.target==='printful'?'completed':d.tasks?.length&&d.tasks.every(t=>t.state==='saved')&&d.images?.length?'publishing':'mockups');saveSoon();return;
  }
  if(j.state==='mockups'){
   d.tasks??=[];d.images??=[];d.baseFiles??={};
   let recovered=0;for(const v of d.supplier.sync_variants)for(const a of variantAreas(d.blueprint,v.variant_id)){const key=v.id+':'+a.placement,file=supplierPanel(v,a.placement);if(!file||d.outputs.some(f=>f.variant===String(v.id)&&f.placement===a.placement)||d.baseFiles[key])continue;let u;try{u=new URL(file.url);}catch{}if(u?.origin===origin&&u.pathname.startsWith('/factory-print-file/')){d.baseFiles[key]=await recoverPrintPanel(j,d,v,a,file);update(j,d);if(++recovered>=4){if(!saves.size)saveSoon();return;}}}
   if(recovered){if(!saves.size)saveSoon();return;}
   // Native recovery above is serial; remote task and download waits do not
   // occupy the large-image rendering slot while their checkpoints complete.
   if(busy.has(j.id))busy.get(j.id).state='mockup_network';
   // One task per unique print-file set, with every available style/view.
   const groups=new Map();for(const v of d.supplier.sync_variants){const edited=d.outputs.filter(f=>f.variant===String(v.id)),areas=variantAreas(d.blueprint,v.variant_id).filter(a=>supplierPanel(v,a.placement)||edited.some(f=>f.placement===a.placement));
    const files=areas.map(a=>{const f=edited.find(f=>f.placement===a.placement)||d.baseFiles[v.id+':'+a.placement],old=supplierPanel(v,a.placement);if(!f&&!old?.url)hold('An original print file is unavailable for mockup generation.');return {placement:a.placement,image_url:f?.url||old.url,position:{area_width:a.width,area_height:a.height,width:a.width,height:a.height,top:0,left:0}};});
    const signature=hash(JSON.stringify(files));if(!groups.has(signature))groups.set(signature,{signature,variants:[],syncIds:[],files});groups.get(signature).variants.push(v.variant_id);groups.get(signature).syncIds.push(String(v.id));}
   for(const g of groups.values()){
    let task=d.tasks.find(t=>t.signature===g.signature);
    if(!task){const last=get("SELECT max(json_extract(document,'$.lastSubmit')) n FROM factory_studio_jobs")?.n||0,gap=Math.max(1,writeLanes.mockup.gap);if(last&&clock()-last<gap){run('UPDATE factory_studio_jobs SET next=? WHERE id=?',last+gap,j.id);return;}
     task={...g,state:'submitting',key:null};d.tasks.push(task);d.lastSubmit=clock();update(j,d);try{await checkpoint();}catch(e){d.tasks=d.tasks.filter(t=>t!==task);update(j,d);throw e;}
     let r;try{r=await pf('mockup-generator/create-task/'+d.product,{method:'POST',body:JSON.stringify({variant_ids:g.variants,format:'jpg',width:1200,option_groups:d.blueprint.printfiles.option_groups||[],options:d.blueprint.printfiles.options||[],files:g.files})});}catch(e){if([400,401,403,404,422,429].includes(e.providerStatus)){d.tasks=d.tasks.filter(t=>t!==task);update(j,d);}else{task.state='uncertain';update(j,d);}await checkpoint();throw e;}
     if(!r?.task_key)hold('Printful did not return a mockup task key; acceptance is unconfirmed.');task.key=r.task_key;task.state='accepted';update(j,d);await checkpoint();return;
    }
    if(!task.key)hold('Mockup submission outcome is unknown. Reconcile the accepted task before retrying.');if(task.state==='saved')continue;
    if(!task.images){const r=await pf('mockup-generator/task?task_key='+encodeURIComponent(task.key));if(r.task_key&&r.task_key!==task.key)hold('Printful returned a different mockup task.');if(r.status==='failed'){task.state='failed';task.error=String(r.error||'Mockup failed');update(j,d);hold(task.error);}if(r.status==='pending'){task.state='pending';update(j,d);run('UPDATE factory_studio_jobs SET next=? WHERE id=?',clock()+15000,j.id);return;}if(r.status!=='completed')hold('Printful returned an unrecognized mockup status.');
     const found=new Map();for(const m of r.mockups||[]){if(!m.variant_ids?.some(v=>task.variants.includes(v)))continue;for(const image of [{url:m.mockup_url,title:m.placement,style:'Default'},...(m.extra||[]).map(e=>({url:e.url,title:e.title||e.option||m.placement,style:e.option_group||'Product'}))])if(image.url){const url=mockupImageURL(image.url);found.set(url,{...image,url,variants:m.variant_ids.filter(v=>task.variants.includes(v))});}}if(!found.size||found.size>256)hold('Printful returned an empty or oversized mockup gallery.');task.images=[...found.values()];task.state='downloading';update(j,d);saveSoon();return;
    }
    let downloaded=0;for(const image of task.images){const saved=d.images.find(i=>i.source===image.url);if(saved){saved.variants=[...new Set([...saved.variants,...image.variants])];continue;}const r=await fetchImpl(image.url,{redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok)hold('A completed Printful mockup is unavailable (HTTP '+r.status+').',503);let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>5*1024*1024)hold('A mockup exceeds 5 MB.');chunks.push(c);}const b=Buffer.concat(chunks);await sharp(b,{limitInputPixels:20_000_000}).stats();const a=await putAsset('studio-'+j.id,'mockup',image.title||'Product view',b,r.headers.get('content-type')?.split(';')[0]||'image/jpeg');await persistAsset(a);d.images.push({source:image.url,asset:a.id,title:image.title,style:image.style,variants:image.variants,sha:a.sha});update(j,d);if(++downloaded>=assetLimit){if(!saves.size)saveSoon();return;}}
    task.state='saved';update(j,d);if(!saves.size)saveSoon();return;
   }
   d.images.sort((a,b)=>Number(/model|men|women|couple|kids/i.test(b.style))-Number(/model|men|women|couple|kids/i.test(a.style)));update(j,d,j.target==='store'?'publishing':'completed');saveSoon();return;
  }
  if(j.state==='publishing'){
   if(d.details){d.generatedImages??=d.images;const choices=new Set(d.generatedImages.map(i=>i.sha||i.asset));if([...d.details.photoOrder,...d.details.hiddenPhotos].some(id=>!choices.has(id)))hold('The generated gallery changed. Review its photo choices and approve the current revision before publication.');d.images=orderedStudioPhotos(d.generatedImages,d.details);}
   if(j.target!=='store'||!d.printfulUpdated||!d.images?.length||!d.tasks?.length||d.tasks.some(t=>t.state!=='saved'))hold('Publication requires owner approval, verified supplier files and completed mockups.');
   let publishedImages=0;for(const i of d.images){if(i.storeUrl)continue;const a=get('SELECT * FROM factory_studio_assets WHERE id=?',i.asset),b=await bytes(a),path='images/factory/'+j.supplier+'/'+a.sha+(a.mime==='image/png'?'.png':'.jpg');await content(path,b,'Save edited product mockup '+j.supplier);i.storeUrl='https://midnight-designs.store/'+path;update(j,d);if(++publishedImages>=assetLimit){if(!saves.size)saveSoon();return;}}
   const previousManifest=manifestTail;let releaseManifest;manifestTail=new Promise(r=>releaseManifest=r);await previousManifest;try{
   const {file,manifest}=await readManifest();if((manifest.withdrawn||[]).includes(j.supplier)){if(!d.ownerApproval||d.ownerApproval.approvedAt<=(manifest.withdrawalTimes?.[j.supplier]||d.created))hold('This product was withdrawn. Explicitly approve this revision again to restore it.');manifest.withdrawn=manifest.withdrawn.filter(id=>id!==j.supplier);}
   const live=await fetchImpl('https://midnight-designs.store/products.json',{signal:AbortSignal.timeout(25000)});if(!live.ok)hold('Live catalog could not be read.',503);let old=manifest.products?.[j.supplier]||d.storeProduct||(await live.json()).products?.find(p=>String(p.id)===j.supplier);
   if(!old){const p=source(j.source),record=p?.jobId&&get('SELECT copy FROM factory_listings WHERE job=?',p.jobId),copy=record&&JSON.parse(record.copy);if(copy?.title&&copy?.description&&d.supplier.sync_product.external_id?.startsWith('midnight-factory-')){old={id:j.supplier,catalogProductId:d.product,name:copy.title,description:copy.description,category:copy.category,tags:copy.tags||[],collections:[...new Set([...(copy.collections||[]),...(p.collection?[p.collection]:[])])],outfitId:p.outfit||null,factoryExternalId:d.supplier.sync_product.external_id,url:'products/'+j.supplier+'.html',variants:d.supplier.sync_variants.map(v=>{if(!v.synced||v.is_ignored||!(Number(v.retail_price)>0)||!v.currency)hold('A supplier variant is not ready for storefront publication.');return {id:String(v.id),catalogVariantId:v.variant_id,name:v.name,size:v.size,color:v.color,price:Number(v.retail_price),currency:v.currency,availability:v.availability_status||'unknown'};})};}}
   if(!old?.description||!old.variants?.length)hold('A complete existing storefront listing is required. Supplier changes and mockups are saved.');
   if(old.studioRevision&&old.studioRevision!==j.id&&old.studioUpdated>d.created)hold('A newer storefront edit exists.');
   const variants=old.variants.map(v=>{const sv=d.supplier.sync_variants.find(s=>String(s.id)===String(v.id));if(!sv)hold('Storefront and Printful variants do not match.');const images=d.images.filter(i=>i.variants.includes(sv.variant_id)).map(i=>i.storeUrl);if(!images.length)hold('A storefront variant has no verified new mockup.');return {...v,image:images[0],images};});
   let product={...old,image:d.images[0].storeUrl,images:[...new Set(d.images.map(i=>i.storeUrl))],variants,studioRevision:j.id,studioUpdated:clock(),publicationApproval:{state:'approved',revision:j.id}};product=applyStudioDetails(product,d.details,d.finalSupplier||d.supplier);manifest.products??={};manifest.products[j.supplier]=product;
   if(!product.factoryExternalId?.startsWith('midnight-factory-'))hold('This storefront product is not managed by the factory manifest. Supplier edits are retained.');
   await gh('/contents/factory-listings.json',{method:'PUT',body:JSON.stringify({branch:'main',message:'Update edited factory product '+j.supplier,content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64'),...(file?{sha:file.sha}:{})})});d.storeProduct=product;update(j,d,'verifying_store');
   }finally{releaseManifest();}saveSoon();
   await gh('/dispatches',{method:'POST',body:JSON.stringify({event_type:'midnight-basic-publish',client_payload:{studio:j.id,supplier:j.supplier}})});d.dispatched=true;update(j,d,'verifying_store');saveSoon();return;
  }
  if(j.state==='verifying_store'){
   if(!d.dispatched){await gh('/dispatches',{method:'POST',body:JSON.stringify({event_type:'midnight-basic-publish',client_payload:{studio:j.id,supplier:j.supplier}})});d.dispatched=true;update(j,d);saveSoon();return;}
   const r=await fetchImpl('https://midnight-designs.store/products.json?studio='+clock(),{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)hold('Storefront verification is unavailable.',503);const p=(await r.json()).products?.find(p=>String(p.id)===j.supplier);if(p?.studioRevision!==j.id){if(clock()-j.updated>45*60000)hold('Catalog deployment needs review; the edited listing is saved.');run('UPDATE factory_studio_jobs SET next=? WHERE id=?',clock()+15000,j.id);return;}
   if(d.details&&['name','description','collections','categoryOverride'].some(k=>JSON.stringify(p[k])!==JSON.stringify(d.storeProduct[k])))hold('The live product details do not match the approved revision.');
   if(d.details&&d.storeProduct.variants.some(v=>!p.variants.some(x=>x.id===v.id&&x.price===v.price&&x.ownerAvailable===v.ownerAvailable)))hold('The live product prices or variant selections do not match the approved revision.');
   if(JSON.stringify(p.images)!==JSON.stringify(d.storeProduct.images)||d.storeProduct.variants.some(v=>!p.variants.some(x=>x.id===v.id&&JSON.stringify(x.images)===JSON.stringify(v.images))))hold('The live listing does not match the saved edited images.');
   for(const url of p.images){const r=await fetchImpl(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});if(!r.ok)return;}
   d.storeUpdated=true;update(j,d,'completed');saveSoon();
  }
 }
 // Waiting supplier files may leave updated unchanged. Age uses the last
 // attempted turn, so those polls cannot starve renders or finished galleries.
 async function tick(){if(closing||busy.size>=concurrentLimit)return;if(get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_jobs'")&&get("SELECT id FROM factory_jobs WHERE status='running' LIMIT 1"))return;const networkStage=s=>['updating_printful','verifying_store','mockup_network','publishing'].includes(s),j=all("SELECT * FROM factory_studio_jobs WHERE state NOT IN ('completed','failed','cancelled') AND next<=? ORDER BY CASE WHEN updated<=? THEN updated ELSE 9223372036854775807 END,CASE state WHEN 'publishing' THEN 0 WHEN 'mockups' THEN 1 WHEN 'verifying_store' THEN 2 WHEN 'updating_printful' THEN 3 WHEN 'rendering' THEN 4 ELSE 5 END,updated LIMIT 100",clock(),clock()-300000).sort((a,b)=>{const age=x=>served.get(x.id)??x.updated,cutoff=clock()-300000,old=x=>age(x)<=cutoff?age(x):Number.MAX_SAFE_INTEGER,priority={publishing:0,mockups:1,verifying_store:2,updating_printful:3,rendering:4};return old(a)-old(b)||(priority[a.state]??5)-(priority[b.state]??5)||age(a)-age(b);}).find(j=>!busy.has(j.id)&&(!JSON.parse(j.document).learnedFrom||!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_settings'")||get('SELECT state FROM factory_settings WHERE id=1')?.state==='running')&&(networkStage(j.state)||![...busy.values()].some(b=>!networkStage(b.state))));if(!j)return;served.set(j.id,clock());const work=(async()=>{try{await connection();await advance(j);}catch(e){const current=get('SELECT * FROM factory_studio_jobs WHERE id=?',j.id),progress=JSON.parse(current.document);progress.failureStage=current.state;run('UPDATE factory_studio_jobs SET document=? WHERE id=?',JSON.stringify(progress),j.id);const attempts=j.attempts+(e.noRequest?0:1),retry=([429,503,502,504].includes(e.status)||['TimeoutError','AbortError'].includes(e.name))&&attempts<8&&!progress.tasks?.some(t=>!t.key);run('UPDATE factory_studio_jobs SET state=?,error=?,attempts=?,next=?,updated=? WHERE id=?',retry?current.state:'failed',String(e.message).split(token||'\0').join('[redacted]').slice(0,600),attempts,clock()+Math.max(e.retryAfter*1000||0,Math.min(15*60000,30000*2**Math.min(attempts,5))),clock(),j.id);try{await checkpoint();}catch{}}})();busy.set(j.id,{state:j.state,stage:j.state,work});try{await work;}finally{busy.delete(j.id);}}
 async function saveExample(p,document,revision,decision,note='',job=null){
  const set=family(p).set,parts={};for(const [part,file]of Object.entries(set?.parts||{})){if(file.artwork)parts[part]='art:'+file.artwork;}
  const metadata=new Map();return learned.record({source:p.id,supplier:p.supplierId,revision,product:{id:p.choice.product,name:p.name},blueprint:document.blueprint,document,decision,name:p.name,note,audience:p.choice.audience||'unisex',job,parts,clock,readArtwork:async(asset,background)=>{if(!metadata.has(asset)){const a=await readArtwork(asset),m=await sharp(Buffer.from(a.data)).autoOrient().metadata();metadata.set(asset,{name:a.name,...(m.autoOrient||m),bounds:background==='#000000'?await artworkBounds(Buffer.from(a.data)):null});}return metadata.get(asset);}});
 }
 function learningExamples(){
  const seen=new Set(),result=[],feedback=learned.list();
  for(const j of all("SELECT j.* FROM factory_studio_jobs j JOIN factory_studio_drafts d ON d.supplier=j.supplier AND d.revision=j.revision WHERE j.state='completed' ORDER BY j.updated DESC")){
   const d=JSON.parse(j.document),decision=feedback.find(r=>r.supplier===j.supplier),approved=decision?.state==='approved'&&decision.example.job===j.id;if(decision&&decision.state!=='approved')continue;if(seen.has(d.product)||d.learnedFrom||!d.printfulUpdated&&!approved||!d.images?.length||!d.sourceJob)continue;
   const p=source(j.source);if(!p)continue;seen.add(d.product);result.push({product:d.product,job:j.id,revision:j.revision,supplier:j.supplier,name:p.name,collection:p.collection,image:ROOT+'/asset/'+d.images[0].asset});
  }return result;
 }
 const learningJob=id=>{const j=get('SELECT * FROM factory_studio_jobs WHERE id=?',id);if(!j)return null;const d=JSON.parse(j.document);return {id:j.id,state:j.state,error:j.error,supplier:j.supplier,printfulUpdated:!!d.printfulUpdated,previewReady:j.state==='completed'&&d.images?.length>0&&d.tasks?.length>0&&d.tasks.every(t=>t.key&&t.state==='saved'),images:d.images?.length||0};};
 async function followExample(id,exampleId){
  const p=source(id),reference=get("SELECT * FROM factory_studio_jobs WHERE id=? AND state='completed'",exampleId);
  if(!p?.supplierId||!reference)hold('The product or completed placement example is unavailable.');
  const prior=get("SELECT * FROM factory_studio_jobs WHERE supplier=? ORDER BY updated DESC,rowid DESC LIMIT 1",String(p.supplierId));
  if(prior){if(JSON.parse(prior.document).learnedFrom===exampleId)return learningJob(prior.id);hold('This product already has an owner update. Keep that update and review it before continuing.');}
  if(get('SELECT supplier FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId)))hold('This product has an owner draft. It will not be overwritten.');
  const ref=JSON.parse(reference.document),rp=source(reference.source);
  const feedback=learned.list().find(r=>r.supplier===reference.supplier);if(feedback&&feedback.state!=='approved')hold('This placement example was rejected or corrected. Choose its latest approved revision.');if(feedback?.example.issues.length)hold('Review this example before automatic transfer: '+feedback.example.issues.join(' '));
  if(ref.product!==p.choice.product||!rp||!ref.printfulUpdated&&!(feedback?.state==='approved'&&feedback.example.job===reference.id))hold('Placement examples must match the exact supplier product.');
  if(p.jobId&&get("SELECT id FROM factory_jobs WHERE id=? AND status IN ('queued','running','retry_wait')",p.jobId))hold('Wait for the supplier product checkpoint to finish.');
  const referenceSet=family(rp).set,targetSet=family(p).set;if(!referenceSet||!targetSet)hold('Both original hoodie design sets are required.');
  async function originals(set){const result=[];for(const [part,file]of Object.entries(set.parts||{})){const aid=await workflow.sourceFile(file,set),a=await readArtwork('art:'+aid);result.push({part,asset:'art:'+aid,...a});}return result;}
  const [from,to,d,bp]=await Promise.all([originals(referenceSet),originals(targetSet),detail(p),blueprints.load(p.choice.product,'default')]);
  if(bp.source!=='live')hold('Live native garment templates are required.');
  const planRow=ref.sourceJob&&has('factory_render_plans')&&get('SELECT plan FROM factory_render_plans WHERE job=?',ref.sourceJob),plan=planRow?JSON.parse(planRow.plan):null,document={templateStamp:templateStamp(bp,d.sync_variants),fingerprint:fingerprint(d),variants:{}};
  const metas=new Map();async function meta(a,removal){const key=a.asset+':'+JSON.stringify(removal||null);if(metas.has(key))return metas.get(key);let data=Buffer.from(a.data);if(removal){const {data:pixels,info}=await sharp(data,{limitInputPixels:40000000}).autoOrient().ensureAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});removeArtworkBackground(pixels,info.width,info.height,removal.tolerance);data=await sharp(pixels,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}const m=await sharp(data).autoOrient().metadata(),v={...(m.autoOrient||m),asset:a.asset,bounds:await artworkBounds(data)};metas.set(key,v);return v;}
  const partKind=s=>s.replace(/_dtfabric$/,'').replace(/^default$/,'front').replace(/^left_sleeve$/,'sleeve_left').replace(/^right_sleeve$/,'sleeve_right');
  for(const v of d.sync_variants){
   const rv=ref.supplier.sync_variants.find(x=>x.variant_id===v.variant_id);if(!rv)hold('The example has no matching size/variant. That size needs its own placement review.');
   const panels={};for(const area of variantAreas(bp,v.variant_id).filter(a=>!/^label|^inside_label/.test(a.placement))){
    const oldArea=variantAreas(ref.blueprint,rv.variant_id).find(a=>a.placement===area.placement);
    if(!oldArea||measuredAreaStamp(oldArea)!==measuredAreaStamp(area))hold('The native print template changed. Review this garment before copying placements.');
    let panel=ref.variants?.[String(rv.id)]?.[area.placement];
    if(!panel){const recipe=plan?.numericLayout?.variants?.find(x=>x.variant===rv.variant_id)?.placements?.[area.placement]||plan?.placements?.[area.placement],metadata=[];for(const a of from)metadata.push(await meta(a));panel=studioProductionPanel(area,recipe,aid=>metadata.find(m=>m.asset==='art:'+aid),plan?.numericLayout?.background??plan?.background??'#000000');}
    if(!panel)hold('The reference '+area.placement+' composition is missing. No black-only replacement was guessed.');
    if(panel.background!=='#000000')hold('Only the saved black-background outfit examples can be transferred automatically.');
    const layers=[];for(const l of panel.layers){
     const matches=from.filter(a=>a.asset===l.asset);let original=matches.length===1?matches[0]:matches.find(a=>partKind(a.part)===partKind(area.placement));
     if(!original&&matches.length){const measured=plan?.numericLayout?.variants?.find(x=>x.variant===rv.variant_id)?.measurements?.filter(m=>m.placement===area.placement&&matches.some(a=>a.part===m.part))||[],ranked=measured.map(m=>({part:m.part,distance:Math.hypot(m.centerXIn*area.dpi/area.width-l.x,m.centerYIn*area.dpi/area.height-l.y)})).sort((a,b)=>a.distance-b.distance);if(ranked.length&&(ranked.length===1||ranked[0].distance+.001<ranked[1].distance))original=matches.find(a=>a.part===ranked[0].part);}
     if(!original)hold('The reference uses custom or ambiguous artwork. Map it to an original hoodie part before copying.');
     const piece=p.pieceId&&get('SELECT choice FROM factory_basic_outfit_pieces WHERE id=?',p.pieceId),sourceParts=piece?JSON.parse(piece.choice).sourceParts||{}:{},part=sourceParts[original.part]||original.part;
     const target=to.find(a=>a.part===part)||to.find(a=>partKind(a.part)===partKind(part));if(!target)hold('This hoodie has no '+original.part+' artwork. No unrelated design was substituted.');
     if(!target.permissions.reuse)hold('Artwork reuse permission is required.');assertBrandingPlacement(db,p.jobId,area.placement,get('SELECT * FROM factory_artwork WHERE id=?',target.asset.slice(4)));
     const targetMeta=await meta(target,l.backgroundRemoval),placed=transferStudioLayer(l,await meta(original,l.backgroundRemoval),targetMeta,area),bounds=targetMeta.bounds||{x:0,y:0,width:targetMeta.width,height:targetMeta.height},w=placed.width*area.width,h=w*targetMeta.height/targetMeta.width;
     const visible={x:placed.x*area.width-w/2+bounds.x/targetMeta.width*w,y:placed.y*area.height-h/2+bounds.y/targetMeta.height*h,width:bounds.width/targetMeta.width*w,height:bounds.height/targetMeta.height*h};
     if(!reviewedLayerRegion(db,p.choice.product,bp.effectiveTechnique||bp.technique||'default',area,visible))hold('Review the '+area.placement+' safe region for this exact template in Factory Basic before automatic outfit transfer.');
     if(targetMeta.width/w*area.dpi+0.01<area.dpi)hold('The new '+part+' artwork does not meet this panel’s effective resolution requirement at the approved dimensions.');
     layers.push(placed);
    }panels[area.placement]=studioLayers({background:panel.background,layers});
   }document.variants[String(v.id)]=panels;
  }
  const variants=d.sync_variants.map(v=>({id:String(v.id),areas:variantAreas(bp,v.variant_id)})),issues=await studioPlacementIssues(variants,document,readArtwork);if(issues.length)hold(issues[0].message);
  const warnings=await studioResolutionIssues(variants,document,readArtwork),saved=saveDocument(p,{revision:0,document}),jobId=randomUUID(),jobDoc={...saved.document,supplier:d,blueprint:bp,product:p.choice.product,sourceJob:p.jobId,created:clock(),resolutionWarnings:warnings,outputs:[],tasks:[],images:[],learnedFrom:exampleId,learningPolicy:'same native garment and size; map original hoodie parts; preserve visible composition; no automatic cropping or publishing'};
  run('INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)',jobId,String(p.supplierId),p.id,saved.revision,'mockups','queued',JSON.stringify(jobDoc),clock());saveSoon({supplier:String(p.supplierId),revision:saved.revision});return learningJob(jobId);
 }
 return {learningExamples,learningJob,followExample,open,tick,active:()=>busy.size>0,idle:async()=>{closing=true;await Promise.all([...busy.values()].map(b=>b.work));await Promise.all([...saves]);},async handle(req,res,path,method,url){
  const publicFile=path.match(/^\/factory-studio-file\/([a-f0-9]{64})$/);if(publicFile&&['GET','HEAD'].includes(method)){const a=get("SELECT * FROM factory_studio_assets WHERE capability=? AND kind='print'",publicFile[1]);if(!a)fail(404,'Print file unavailable.');const b=await bytes(a);res.writeHead(200,{'Content-Type':a.mime,'Content-Length':b.length,'X-Midnight-Print-Sha256':a.sha});res.end(method==='HEAD'?undefined:b);return true;}
  if(!path.startsWith(ROOT))return false;auth(req,null,true);
  const image=path.match(/\/asset\/([a-f0-9-]{36})$/);if(image&&method==='GET'){const a=get('SELECT * FROM factory_studio_assets WHERE id=?',image[1]);if(!a)fail(404,'Editor image unavailable.');const b=await bytes(a);res.writeHead(200,{'Content-Type':a.mime,'Content-Length':b.length});res.end(b);return true;}
  if(method==='GET'&&path===ROOT+'/homepage'){const file=await gh('/contents/index.html?ref=main'),html=Buffer.from(file.content,'base64').toString('utf8');send(res,200,{productIds:[...new Set([...html.matchAll(/data-featured(?:-backups)?="([^"]*)"/g)].flatMap(m=>m[1].split(',')).filter(Boolean))]});return true;}
  if(method==='GET'&&path===ROOT+'/updates'){const latest=new Map();for(const j of all('SELECT * FROM factory_studio_jobs ORDER BY updated DESC,rowid DESC'))if(!latest.has(j.supplier))latest.set(j.supplier,j);const drafts=new Map(all('SELECT * FROM factory_studio_drafts').map(d=>[d.supplier,d]));const updates=[...new Set([...drafts.keys(),...latest.keys()])].map(supplier=>{const draft=drafts.get(supplier),j=latest.get(supplier),view=jobView(j);return {supplier,source:draft?.source||j?.source,draftRevision:draft?.revision||0,draftUpdated:draft?.updated||null,details:draft&&JSON.parse(draft.document).details?Object.fromEntries(['name','collections','categoryId'].map(k=>[k,JSON.parse(draft.document).details[k]])):null,placements:draft?Object.values(JSON.parse(draft.document).variants).reduce((n,p)=>n+Object.keys(p).length,0):0,job:view?Object.fromEntries(['id','revision','target','state','error','failureStage','canRevise','ownerApproved','awaitingApproval','printfulUpdated','storeUpdated','updated','next','attempts','tasks'].map(k=>[k,view[k]]).concat([['files',view.files.length],['images',view.images.length]])):null};});send(res,200,{updates,active:busy.size,activeUpdates:[...busy.entries()].map(([id,b])=>({id,state:b.stage||b.state,phase:b.state})),concurrency:concurrentLimit});return true;}
  if(method==='GET'&&path===ROOT+'/draft-status'){const draft=get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',url.searchParams.get('supplier'));send(res,200,{revision:draft?.revision||0,recovery:recovery(url.searchParams.get('supplier'))});return true;}
  if(method==='GET'&&path===ROOT+'/job'){const j=url.searchParams.get('id')?get('SELECT * FROM factory_studio_jobs WHERE id=?',url.searchParams.get('id')):get('SELECT * FROM factory_studio_jobs WHERE supplier=? ORDER BY updated DESC,rowid DESC LIMIT 1',url.searchParams.get('supplier'));if(!j)fail(404,'Product update unavailable.');send(res,200,jobView(j));return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'product-studio',40);const b=await body(req);
  if(path===ROOT+'/homepage'){
   if(b.confirm!==true||!Array.isArray(b.productIds)||b.productIds.length>4||new Set(b.productIds).size!==b.productIds.length||b.productIds.some(id=>typeof id!=='string'||!/^\d+$/.test(id)))fail(400,'Choose up to four distinct published products for the homepage.');
   const {manifest:catalog}=await readManifest('products.json');if(!Array.isArray(catalog.products))fail(409,'The published catalog could not be verified.');
   if(b.productIds.some(id=>!catalog.products?.some(p=>p.id===id&&(!p.publicationApproval||ownerApproved(p))&&p.variants?.some(v=>v.availability==='active'))))fail(409,'Only already published, approved and available products can be featured. This action cannot publish an AI draft.');
   const file=await gh('/contents/index.html?ref=main'),html=Buffer.from(file.content,'base64').toString('utf8');
   if(!html.includes('data-featured="')||!html.includes('data-featured-backups="'))fail(409,'The homepage selection format changed. No page was overwritten.');
   const next=html.replace(/data-featured="[^"]*"/,'data-featured="'+b.productIds.join(',')+'"').replace(/data-featured-backups="[^"]*"/,'data-featured-backups=""').replace(/ data-latest="[^"]*"/,'');
   await gh('/contents/index.html',{method:'PUT',body:JSON.stringify({branch:'main',sha:file.sha,message:'Owner selected homepage products',content:Buffer.from(next).toString('base64')})});
   await gh('/dispatches',{method:'POST',body:JSON.stringify({event_type:'midnight-basic-publish',client_payload:{studio:'homepage-selection'}})});
   send(res,202,{saved:true,deploymentPending:true,productIds:b.productIds});return true;
  }
  if(path===ROOT+'/open'){send(res,200,await open(b.source));return true;}
  const p=source(b.source);if(!p?.supplierId)fail(404,'Select an existing supplier product.');
  if(['/save','/finish','/restore-revision','/feedback','/publish','/reject'].some(a=>path===ROOT+a))await backups.assertWritable?.();
  if(path===ROOT+'/unpublish'){
   if(b.confirm!==true)fail(400,'Confirm removing this product from the store.');if(get("SELECT id FROM factory_studio_jobs WHERE supplier=? AND state NOT IN ('completed','cancelled','failed')",String(p.supplierId)))fail(409,'Wait for this product’s active update before unpublishing.');
   const {file,manifest}=await readManifest(),id=String(p.supplierId);delete manifest.products[id];manifest.withdrawn=[...new Set([...(manifest.withdrawn||[]),id])];manifest.withdrawalTimes={...(manifest.withdrawalTimes||{}),[id]:clock()};await gh('/contents/factory-listings.json',{method:'PUT',body:JSON.stringify({branch:'main',sha:file.sha,message:'Owner withdrew product '+id,content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')})});await gh('/dispatches',{method:'POST',body:JSON.stringify({event_type:'midnight-basic-publish',client_payload:{studio:'withdraw-'+id}})});send(res,202,{saved:true,deploymentPending:true,note:'Withdrawal queued. The product remains visible until the catalog deployment verifies its removal. Supplier IDs and artwork are retained.'});return true;
  }
  if(path===ROOT+'/revisions'){send(res,200,{revisions:history.list(p.supplierId),currentRevision:get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId))?.revision||0,note:'Older available drafts and production recipes are retained. A restored version becomes a new private draft.'});return true;}
  if(path===ROOT+'/restore-revision'){
   const latest=get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));if(b.revision!==(latest?.revision||0))fail(409,'A newer draft exists. Reload before recovering an older version.');
   const archived=Number.isSafeInteger(b.id)&&history.get(p.supplierId,b.id);if(!archived)fail(404,'Saved revision unavailable for this product.');
   const current=await open(p.id);if(!archived.document.templateStamp||archived.document.templateStamp!==current.templateStamp)fail(409,'The supplier template or size mapping changed. This older recipe is retained, but cannot be applied automatically.');
   const saved=saveDocument(p,{revision:b.revision,document:{...archived.document,fingerprint:current.fingerprint}});saveSoon({supplier:String(p.supplierId),revision:saved.revision});send(res,202,{...saved,recoveredFrom:archived.id,savedInApp:true,recoveryPending:true,printfulUpdated:false});return true;
  }
  if(path===ROOT+'/original'){const set=family(p).set,part=set?.parts?.[b.part];if(!part)fail(404,'This image is not part of the product’s original hoodie design set.');const id=await workflow.sourceFile(part,set),a=get('SELECT * FROM factory_artwork WHERE id=?',id),m=await sharp(Buffer.from(a.data)).autoOrient().metadata(),size=m.autoOrient||m;send(res,200,{asset:'art:'+id,part:b.part,name:part.name||b.part,width:size.width,height:size.height,contentBounds:await artworkBounds(Buffer.from(a.data)),url:'/api/owner/ai-factory/artwork/'+id+'/file'});return true;}
  if(path===ROOT+'/upload'){if(typeof b.data!=='string'||b.data.length>7*1024*1024||!/^[-\w .()]{1,160}$/.test(b.name||''))fail(400,'Upload a named PNG, JPEG or WebP under 5 MB.');const data=Buffer.from(b.data,'base64');if(data.length>5*1024*1024)fail(413,'Upload under 5 MB.');const img=sharp(data,{limitInputPixels:40_000_000,failOn:'warning'}),m=await img.metadata();if(!['png','jpeg','webp'].includes(m.format)||m.pages>1)fail(400,'Use a single PNG, JPEG or WebP.');const normalized=await img.autoOrient().png().toBuffer(),a=await putAsset('studio-upload-'+p.supplierId,'upload',b.name,normalized);await persistAsset(a);saveSoon();send(res,201,{...assetMeta(a),contentBounds:await artworkBounds(normalized),recoveryPending:true});return true;}
  if(path===ROOT+'/feedback'){
   if(b.confirm!==true||!['approved','rejected','correction'].includes(b.decision))fail(400,'Confirm the placement feedback to save.');
   const draft=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));if(!draft||draft.revision!==b.revision)fail(409,'Save and inspect this exact draft revision before teaching the Brain.');
   const document=JSON.parse(draft.document),bp=await blueprints.load(p.choice.product,'default'),supplier=await detail(p);
   if(bp.source!=='live'||document.templateStamp!==templateStamp(bp,supplier.sync_variants)||document.fingerprint!==fingerprint(supplier))fail(409,'The supplier files or template changed. Reopen and inspect before saving an example.');
   const j=get('SELECT id FROM factory_studio_jobs WHERE supplier=? AND revision=? ORDER BY updated DESC,rowid DESC LIMIT 1',String(p.supplierId),b.revision);
   const result=await saveExample(p,{...document,blueprint:bp,supplier},draft.revision,b.decision,b.note||'',j?.id||null);saveSoon();send(res,200,{exampleId:result.id,state:result.state,issues:result.example.issues,note:'Placement feedback saved. This does not publish or change supplier files.'});return true;
  }
  if(path===ROOT+'/publish'){
   if(b.confirmPublication!==true)fail(400,'Explicitly approve publishing this edited product to the store.');
   let j=get('SELECT * FROM factory_studio_jobs WHERE id=? AND supplier=?',b.id,String(p.supplierId));
   if(!j)fail(404,'Select this product’s saved update.');
   const draft=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));
   if(draft?.revision!==b.revision)fail(409,'A newer draft exists. Finish that draft before publishing.');
   const d=JSON.parse(j.document),savedDocument=JSON.parse(draft.document);if(j.target==='store'&&j.state==='completed'&&d.storeUpdated&&j.revision===b.revision){send(res,202,{revision:draft.revision,document:savedDocument,job:jobView(j)});return true;}if(savedDocument.details)studioProductDetails(savedDocument.details,d.supplier.sync_variants.map(v=>String(v.id)));const photoChoices=new Set((d.generatedImages||d.images||[]).map(i=>i.sha||i.asset));if(savedDocument.details&&[...savedDocument.details.photoOrder,...savedDocument.details.hiddenPhotos].some(id=>!photoChoices.has(id)))fail(409,'Photo choices belong to an earlier gallery. Review this revision’s generated mockups before publishing.');if(savedDocument.details){const chosen=orderedStudioPhotos(d.generatedImages||d.images||[],savedDocument.details);if(!chosen.length||d.supplier.sync_variants.some(v=>!chosen.some(i=>i.variants.includes(v.variant_id))))fail(409,'Keep at least one generated photo for each existing size/color group.');}if(j.revision!==b.revision){if(!isDeepStrictEqual(d.variants,savedDocument.variants)||d.templateStamp!==savedDocument.templateStamp||savedDocument.fingerprint!==(d.finalFingerprint||d.fingerprint))fail(409,'A newer draft exists with changed artwork. Generate mockups for this draft before publishing.');d.details=savedDocument.details;d.supplier=d.finalSupplier||d.supplier;d.fingerprint=d.finalFingerprint||d.fingerprint;d.printfulUpdated=false;d.created=clock();delete d.detailsIntentSaved;delete d.supplierIntentSaved;delete d.ownerApproval;delete d.storeUpdated;delete d.dispatched;const id=randomUUID();run('INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)',id,j.supplier,j.source,b.revision,j.target,'completed',JSON.stringify(d),clock());j=get('SELECT * FROM factory_studio_jobs WHERE id=?',id);}
   if(j.target==='store'&&j.state!=='completed'){
    if(!d.ownerApproval){d.ownerApproval={revision:j.revision,recipe:approvalRecipe(d),approvedAt:clock()};run('UPDATE factory_studio_jobs SET document=?,state=?,error=\'\',next=0,updated=? WHERE id=?',JSON.stringify(d),j.state==='failed'?d.failureStage||'queued':j.state,clock(),j.id);saveSoon();j=get('SELECT * FROM factory_studio_jobs WHERE id=?',j.id);}
    send(res,202,{revision:draft.revision,document:JSON.parse(draft.document),job:jobView(j)});return true;
   }
   if(j.state!=='completed'||!['mockups','store'].includes(j.target)||!d.images?.length||d.tasks?.some(t=>t.state!=='saved'))fail(409,'Wait for this saved Printful update and its mockups to finish before publishing.');
   const live=await detail(p);if(fingerprint(live)!==(d.finalFingerprint||d.fingerprint))fail(409,'The supplier product changed after these mockups were made. Reopen and finish the current design before publishing.');
   // Recheck after the supplier request: another tab may have saved a revision.
   if(get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',j.supplier)?.revision!==b.revision)fail(409,'A newer draft exists. Finish that draft before publishing.');
   if(get("SELECT id FROM factory_studio_jobs WHERE supplier=? AND id<>? AND state NOT IN ('completed','cancelled')",j.supplier,j.id))fail(409,'Another update is still running for this product.');
   await saveExample(p,d,j.revision,'approved','Owner approved this saved revision for publication.',j.id);d.ownerApproval={revision:j.revision,recipe:approvalRecipe(d),approvedAt:clock()};run("UPDATE factory_studio_jobs SET target='store',state=?,document=?,error='',attempts=0,next=0,updated=? WHERE id=? AND state='completed'",d.printfulUpdated?'publishing':'updating_printful',JSON.stringify(d),clock(),j.id);
   saveSoon();j=get('SELECT * FROM factory_studio_jobs WHERE id=?',j.id);send(res,202,{revision:draft.revision,document:JSON.parse(draft.document),job:jobView(j)});return true;
  }
  if(path===ROOT+'/save'||path===ROOT+'/finish'){
   const submission=path===ROOT+'/finish'?String(p.supplierId):null;
   if(submission&&submissions.has(submission))fail(409,'Finish is already validating this product. Your draft is retained; wait for the tracked result before submitting again.');
   if(submission)submissions.add(submission);
   try{
   const unfinished=get("SELECT * FROM factory_studio_jobs WHERE supplier=? AND state NOT IN ('completed','cancelled')",String(p.supplierId));
   if(path.endsWith('/save')){const saved=saveDocument(p,b);saveSoon({supplier:String(p.supplierId),revision:saved.revision});send(res,202,{...saved,savedInApp:true,recoveryPending:true,printfulUpdated:false});return true;}
   if(unfinished&&unfinished.state!=='failed')fail(409,'This product has an unfinished update. Your app draft can be saved, but wait for its tracked result before submitting another.');
   if(unfinished&&!jobView(unfinished).canRevise)fail(409,'The previous update reached Printful or mockup submission. Review its result and use Return to editing before submitting changed files.');
   if((b.target==='store'||b.target==='printful')&&b.confirmPublication!==true)fail(400,'Explicitly approve publishing this edited product to the store. Saving a draft or updating Printful does not approve publication.');
   if(!['printful','mockups','store'].includes(b.target))fail(400,'Choose Printful only, Printful with mockups, or Printful and app store.');
   if(p.jobId&&get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factory_jobs'")&&get("SELECT id FROM factory_jobs WHERE id=? AND status IN ('running','queued','retry_wait')",p.jobId))fail(409,'This product is still being processed by the factory. Save an app draft now and finish after its current production job completes.');
   const d=await detail(p);if(b.document?.details)studioProductDetails(b.document.details,d.sync_variants.map(v=>String(v.id)));if(fingerprint(d)!==b.document?.fingerprint)fail(409,'The supplier product changed. Reload its files before finishing.');const bp=await blueprints.load(p.choice.product,'default');if(bp.source!=='live')fail(409,'Current supplier templates are required.');if(!/^(default|dtg|digital|cut-sew|sublimation|direct-to-fabric|dtfilm|uv)$/i.test(bp.effectiveTechnique||'default'))fail(409,'This product requires a dedicated embroidery or special-method editor. Its current files were retained.');
   if(b.document?.templateStamp!==templateStamp(bp,d.sync_variants))fail(409,'The supplier template changed since this product was opened. Reopen the editor and review its current print panels before finishing.');
   if(!assets||!config&&!providedAssets)fail(503,'Persistent editor storage is unavailable.');
   for(const [id,panels]of Object.entries(b.document?.variants||{})){const v=d.sync_variants.find(v=>String(v.id)===id);if(!v)fail(409,'A selected variant does not belong to this product.');const areas=variantAreas(bp,v.variant_id);for(const placement of Object.keys(panels))if(!areas.some(a=>a.placement===placement))fail(400,'Unsupported placement for this exact variant.');for(const [placement,panel]of Object.entries(panels))for(const l of panel.layers){if(l.asset.startsWith('art:')){const a=get('SELECT * FROM factory_artwork WHERE id=?',l.asset.slice(4));if(!a)fail(404,'Artwork missing.');assertBrandingPlacement(db,p.jobId,placement,a);}else if(!get("SELECT id FROM factory_studio_assets WHERE id=? AND kind='upload' AND job=?",l.asset,'studio-upload-'+p.supplierId))fail(403,'This uploaded image belongs to a different product.');}}
   if(!b.document?.details&&!Object.values(b.document?.variants||{}).some(v=>Object.keys(v).length)&&b.target==='printful')fail(400,'Edit a panel first, or choose mockups to refresh photos.');
   const checked=d.sync_variants.map(v=>({id:String(v.id),areas:variantAreas(bp,v.variant_id)})),issues=await studioResolutionIssues(checked,b.document,readArtwork);
   const placementIssues=await studioPlacementIssues(checked,b.document,readArtwork);if(placementIssues.length){send(res,422,{error:placementIssues[0].message,issues:placementIssues});return true;}
   // Manual edits retain their chosen scale; resolution is an auditable warning.
   // Only a failed pre-submission attempt can be superseded automatically. Its
   // history remains; external submissions and uncertain outcomes require review.
   const previousDraft=get('SELECT revision FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));if((previousDraft?.revision||0)!==b.revision)hold('This product changed in another tab. Reload before saving.');
   if(unfinished)run("UPDATE factory_studio_jobs SET state='cancelled',updated=? WHERE id=?",clock(),unfinished.id);
   const competing=get("SELECT id FROM factory_studio_jobs WHERE supplier=? AND state NOT IN ('completed','cancelled')",String(p.supplierId));if(competing)fail(409,'This product has an unfinished update. Your app draft can be saved, but wait for its tracked result before submitting another.');
   const saved=saveDocument(p,b);const id=randomUUID(),document={...saved.document,supplier:d,blueprint:bp,product:p.choice.product,sourceJob:p.jobId||null,created:clock(),resolutionWarnings:issues,outputs:[],tasks:[],images:[]};if(b.target==='store')await saveExample(p,document,saved.revision,'approved','Owner approved this edited revision for publication.',id);if(b.confirmPublication===true)document.ownerApproval={revision:saved.revision,recipe:approvalRecipe(document),approvedAt:clock()};run('INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)',id,String(p.supplierId),p.id,saved.revision,b.target,'queued',JSON.stringify(document),clock());saveSoon({supplier:String(p.supplierId),revision:saved.revision});send(res,202,{...saved,recoveryPending:true,job:jobView(get('SELECT * FROM factory_studio_jobs WHERE id=?',id)),savedInApp:true,printfulUpdated:false});return true;
   }finally{if(submission)submissions.delete(submission);}
  }
  if(path===ROOT+'/reject'){
   const j=get("SELECT * FROM factory_studio_jobs WHERE id=? AND supplier=? AND target='mockups' AND state IN ('completed','failed')",b.id,String(p.supplierId));
   if(!j||b.confirm!==true)fail(409,'Choose a finished private preview to reject.');await saveExample(p,JSON.parse(j.document),j.revision,'rejected',b.note||'Owner rejected this preview.',j.id);
   run("UPDATE factory_studio_jobs SET state='cancelled',error='Owner rejected this private preview. Original artwork and the last approved product are retained.',updated=? WHERE id=?",clock(),j.id);saveSoon();send(res,200,{rejected:true,job:jobView(get('SELECT * FROM factory_studio_jobs WHERE id=?',j.id))});return true;
  }
  if(path===ROOT+'/cancel'){const j=get("SELECT * FROM factory_studio_jobs WHERE id=? AND supplier=? AND state='failed'",b.id,String(p.supplierId));if(!j)fail(409,'Choose this product’s failed update.');const live=await detail(p);run("UPDATE factory_studio_jobs SET state='cancelled',updated=? WHERE id=?",clock(),j.id);const row=get('SELECT * FROM factory_studio_drafts WHERE supplier=?',String(p.supplierId));if(row){const document=JSON.parse(row.document);document.fingerprint=fingerprint(live);run('UPDATE factory_studio_drafts SET document=? WHERE supplier=?',JSON.stringify(document),String(p.supplierId));}saveSoon();send(res,200,{cancelled:true,note:'The current Printful files were retained. This did not undo any confirmed supplier changes.'});return true;}
  if(path===ROOT+'/retry'){const j=get("SELECT * FROM factory_studio_jobs WHERE id=? AND supplier=? AND state='failed'",b.id,String(p.supplierId));if(!j)fail(409,'Select this product’s failed update.');const d=JSON.parse(j.document);if(d.tasks?.some(t=>!t.key))fail(409,'A mockup request has an uncertain outcome. Reconcile its task key first.');run('UPDATE factory_studio_jobs SET state=?,attempts=0,next=0,error=\'\',updated=? WHERE id=?',d.failureStage||'queued',clock(),j.id);saveSoon();send(res,200,jobView(get('SELECT * FROM factory_studio_jobs WHERE id=?',j.id)));return true;}
  fail(404,'Product studio action not found.');
 }};
}
