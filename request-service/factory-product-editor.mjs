import {randomUUID} from 'node:crypto';

export function printfulProductEditUrl(storeId,productId){const store=String(storeId||'').trim(),product=String(productId||'').trim();return /^\d+$/.test(store)&&/^\d+$/.test(product)?'https://www.printful.com/dashboard/product-templates/published/'+store+'/'+product:null;}
const ROOT='/api/owner/ai-factory/product-editor';
// Editor revisions contain recipes, never disposable rendered pixels. They are
// included in the same database recovery snapshots as the production queue.
export function factoryProductEditor({db,basic,outfits,auth,body,send,fail,limit,origin,clock=Date.now,fetchImpl=fetch,storeId=process.env.PRINTFUL_STORE_ID,printfulToken=process.env.PRINTFUL_TOKEN}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_product_edits(id TEXT PRIMARY KEY,source TEXT NOT NULL,choice TEXT NOT NULL,note TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);`);
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),now=()=>new Date(clock()).toISOString();
 const choiceFrom=r=>{const c=JSON.parse(r.recipe);return {setId:c.set.id,product:c.product,audience:c.audience,sizes:c.variants.map(v=>v.size),allowUnspecifiedAudience:c.allowUnspecifiedAudience===true,layout:c.layout?.input||null};};
 const edit=r=>r?{...r,choice:JSON.parse(r.choice)}:null;
 let pending=0,recoveryError='';
 function checkpoint(){pending++;recoveryError='';Promise.resolve().then(()=>basic.checkpoint()).catch(e=>{recoveryError=String(e.message||e).slice(0,500);}).finally(()=>{pending--;});}
 const recovery=()=>({pending:pending>0,error:recoveryError,backup:basic.snapshot().backup||null});
 let resolvedStoreId=/^\d+$/.test(String(storeId||'').trim())?String(storeId).trim():null,storeLookup=null,storeLookupAt=0,storeLookupError='';
 async function discoverStore(){
  if(resolvedStoreId||!printfulToken||clock()-storeLookupAt<60000)return;
  if(storeLookup)return storeLookup;
  storeLookupAt=clock();storeLookup=(async()=>{try{
   const r=await fetchImpl('https://api.printful.com/stores',{headers:{Authorization:'Bearer '+printfulToken},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Printful store lookup returned HTTP '+r.status+'.');const body=await r.json(),stores=Array.isArray(body.result)?body.result:body.result?.stores;
   if(!Array.isArray(stores)||!stores.length||stores.length>10||stores.some(s=>!/^\d+$/.test(String(s.id))))throw Error('Printful store discovery did not return a usable store list.');
   let selected=stores.length===1?stores[0]:null;
   if(!selected){const product=[...library().pieces,...library().products].find(p=>/^\d+$/.test(String(p.supplierId)))?.supplierId,matched=[];if(!product)throw Error('A saved supplier product is required to identify the Printful store.');const signal=AbortSignal.timeout(20000);
    for(const candidate of stores){const check=await fetchImpl('https://api.printful.com/store/products/'+product,{headers:{Authorization:'Bearer '+printfulToken,'X-PF-Store-Id':String(candidate.id)},signal});if(check.status===404)continue;if(!check.ok)throw Error('Printful store ownership lookup returned HTTP '+check.status+'.');const detail=await check.json();if(String(detail.result?.sync_product?.id)===String(product))matched.push(candidate);}
    if(matched.length!==1)throw Error('Printful did not uniquely match the saved product to one store.');selected=matched[0];
   }
   resolvedStoreId=String(selected.id);storeLookupError='';
  }catch(e){storeLookupError=e.message;}finally{storeLookup=null;}})();return storeLookup;
 }
 function library(){
  const q=outfits.snapshot(),families=[...q.plans,...q.recent,...(q.active?[q.active]:[])],seen=new Set(),pieces=[];
  const scope=q.batch?.scope?new Set(q.batch.scope.pieceIds):null;
  for(const f of families)for(const p of f.pieces){if(seen.has(p.id)||scope&&!scope.has(p.id))continue;seen.add(p.id);pieces.push({id:'piece:'+p.id,pieceId:p.id,outfit:f.id,collection:f.name,name:p.choice.slotName||p.role,choice:p.item?.id&&get('SELECT recipe FROM factory_basic_items WHERE id=?',p.item.id)?choiceFrom(get('SELECT recipe FROM factory_basic_items WHERE id=?',p.item.id)):{...p.choice,...(p.choice.ownerRecipe||{}),layout:p.choice.ownerRecipe?.layout||p.choice.designerPlan?.layout||p.choice.layout},state:p.item?.status||'waiting',supplierId:p.item?.listing?.supplier_id||null,editable:!p.item,version:p.signature||'',itemId:p.item?.id||null,jobId:p.item?.job||null});}
  const products=all('SELECT i.*,l.supplier_id,l.status AS listing_status,l.copy FROM factory_basic_items i LEFT JOIN factory_listings l ON l.job=i.job ORDER BY i.created DESC LIMIT 500').map(r=>({id:'item:'+r.id,itemId:r.id,jobId:r.job,collection:JSON.parse(r.recipe).outfitCollection||JSON.parse(r.recipe).set.name,name:r.copy?JSON.parse(r.copy).title:JSON.parse(r.recipe).name,choice:choiceFrom(r),state:r.status,supplierId:r.supplier_id||null,editable:false}));
  const sets=basic.snapshot().sets;
  // Older Idea Room products have tracked jobs but no Basic item. Expose
  // their source identity too, so gallery links never select a different item.
  const has=name=>!!get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",name);
  const jobs=new Set(products.map(p=>p.jobId)),legacy=[];
  if(has('idea_made')&&has('factory_jobs')&&has('factory_job_audiences'))for(const m of all("SELECT m.*,j.gender,a.selection FROM idea_made m JOIN factory_jobs j ON j.id=m.job LEFT JOIN factory_job_audiences a ON a.job=j.id WHERE m.status!='deleted' ORDER BY m.created DESC LIMIT 500")){
   if(jobs.has(m.job))continue;
   const selection=JSON.parse(m.selection||'{}'),saved=has('factory_job_layouts')?get('SELECT layout FROM factory_job_layouts WHERE job=?',m.job):null,layout=saved?JSON.parse(saved.layout):null;
   legacy.push({id:'made:'+m.id,jobId:m.job,collection:m.set_name,name:m.name,state:m.status,supplierId:m.printful_id||null,editable:false,choice:{setId:m.set_id,product:m.catalog,audience:m.gender||'unisex',sizes:selection.sizes||[],allowUnspecifiedAudience:selection.allowUnspecifiedAudience===true,layout:layout?.input||null}});
  }
  const linked=rows=>rows.map(p=>({...p,printfulEditUrl:printfulProductEditUrl(resolvedStoreId,p.supplierId)}));
  return {pieces:linked(pieces),products:linked([...products,...legacy]),sets,printfulEditorError:resolvedStoreId?null:storeLookupError||'A valid Printful store ID is required for native product editing.',recovery:recovery(),edits:all('SELECT * FROM factory_product_edits ORDER BY updated DESC LIMIT 200').map(edit),batch:q.batch,active:basic.currentJob(),note:'Saving a draft does not change Printful. Apply to a waiting piece to change the recipe the factory will use. Completed products are preserved; Create revised copy uses owner review.'};
 }
 let mediaCache=null,mediaAt=0,mediaPending=null;
 async function storeMedia(){
  if(mediaCache&&clock()-mediaAt<300000)return mediaCache;
  if(mediaPending)return mediaPending;
  mediaPending=(async()=>{
   const read=async name=>{const r=await fetchImpl('https://midnight-designs.store/'+name,{signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}});if(!r.ok)throw Error('Saved storefront media unavailable');return r.json();};
   const [photos,catalog]=await Promise.allSettled([read('product-photos.json'),read('products.json')]);
   const result={photos:photos.status==='fulfilled'?photos.value:mediaCache?.photos||{products:{}},publishedIds:catalog.status==='fulfilled'?(catalog.value.products||[]).map(p=>String(p.id)):mediaCache?.publishedIds||[],unavailable:photos.status==='rejected'};
   if(photos.status==='fulfilled'){mediaCache=result;mediaAt=clock();}return result;
  })().finally(()=>{mediaPending=null;});return mediaPending;
 }
 function source(id){if(typeof id!=='string'||id.length>160)fail(400,'Select a source product or waiting piece.');const x=library();return [...x.pieces,...x.products].find(r=>r.id===id)||null;}
 async function save(b){
  const original=source(b.source);if(!original)fail(404,'The selected product is no longer available.');
  if(typeof b.note!=='string'||b.note.length>2000)fail(400,'Use a note up to 2,000 characters.');
  const p=await basic.inspect(b.choice);if(!p.numericLayout)fail(400,'Choose and inspect a numeric layout first.');basic.verifyLayoutReceipt(b.choice,p);
  const choice={setId:p.set.id,product:p.product.id,audience:p.audience,sizes:p.variants.map(v=>v.size),allowUnspecifiedAudience:p.allowUnspecifiedAudience===true,layout:p.numericLayout.input};
  const previous=b.id?get('SELECT * FROM factory_product_edits WHERE id=?',b.id):null;
  if(b.id&&!previous)fail(404,'Saved edit not found.');
  if(previous&&(previous.source!==b.source||previous.revision!==b.revision))fail(409,'This edit changed in another tab. Reload before saving.');
  const id=previous?.id||randomUUID(),revision=(previous?.revision||0)+1,date=now();
  db.prepare('INSERT INTO factory_product_edits VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET choice=excluded.choice,note=excluded.note,revision=excluded.revision,updated=excluded.updated').run(id,b.source,JSON.stringify(choice),b.note,revision,previous?.created||date,date);
  checkpoint();return {...edit(get('SELECT * FROM factory_product_edits WHERE id=?',id)),recoveryPending:true};
 }
 return {library,save,async handle(req,res,path,method){
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;auth(req,null,true);
  if(method==='GET'&&path===ROOT+'/media'){send(res,200,await storeMedia());return true;}
  if(method==='GET'&&path===ROOT){await discoverStore();send(res,200,library());return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'product-editor',30);const b=await body(req);
  if(path===ROOT+'/embedded/check'){
   const selected=source(b.source);if(!selected)fail(404,'The selected product is not in the saved factory records.');
   if(!printfulToken)fail(503,'The backend Printful connection is missing.');await discoverStore();
   const headers={Authorization:'Bearer '+printfulToken,'Content-Type':'application/json',...(resolvedStoreId?{'X-PF-Store-Id':resolvedStoreId}:{})};
   let supplier={id:selected.supplierId,verified:false,status:null,variants:[]};
   if(selected.supplierId){const r=await fetchImpl('https://api.printful.com/store/products/'+selected.supplierId,{headers,signal:AbortSignal.timeout(20000)});supplier.status=r.status;
    if(r.ok){const d=(await r.json()).result;if(String(d?.sync_product?.id)===String(selected.supplierId)){supplier.verified=true;supplier.name=d.sync_product.name;supplier.variants=(d.sync_variants||[]).map(v=>({id:v.id,catalogVariantId:v.variant_id,synced:v.synced,files:(v.files||[]).filter(f=>f.type!=='preview').map(f=>({type:f.type,id:f.id,status:f.status,width:f.width,height:f.height}))}));}}
   }
   // A capability probe creates only an unused designer session. Never expose
   // its nonce, create a template/product, or claim the design was imported.
   const r=await fetchImpl('https://api.printful.com/embedded-designer/nonces',{method:'POST',headers,body:JSON.stringify({external_product_id:'md-owner-access-check-'+randomUUID()}),signal:AbortSignal.timeout(20000)});
   let d;try{d=await r.json();}catch{d={};}
   const approved=r.ok&&typeof d.result?.nonce?.nonce==='string';let reason=approved?'Printful accepted an Embedded Design Maker session.':String(d.error?.message||d.error?.reason||d.error||'Printful rejected the Embedded Design Maker session.');reason=reason.split(printfulToken).join('[redacted]').slice(0,600);
   send(res,200,{supplier,embedded:{approved,httpStatus:r.status,reason},updated:false,note:'Read-only product verification and designer access check. No design, print file, supplier variant or storefront product was changed.'});return true;
  }
  if(path===ROOT+'/save'){send(res,202,await save(b));return true;}
  const draft=get('SELECT * FROM factory_product_edits WHERE id=?',String(b.id||''));if(!draft)fail(404,'Save this edit first.');if(draft.revision!==b.revision)fail(409,'The saved edit changed. Reload before applying it.');
  const c=JSON.parse(draft.choice),p=await basic.inspect(c);if(!p.numericLayout||p.numericLayout.requiresAcceptance)fail(409,'The saved layout needs a fresh size and placement review.');
  // Recheck after the supplier read; another tab may have saved in the meantime.
  if(get('SELECT revision FROM factory_product_edits WHERE id=?',draft.id).revision!==draft.revision)fail(409,'The saved edit changed during inspection.');
  if(path===ROOT+'/apply'){
   if(!draft.source.startsWith('piece:'))fail(409,'Completed products need a revised copy; they cannot overwrite a waiting piece.');
   const original=source(draft.source);if(!original?.editable)fail(409,'This piece has started. Its frozen production recipe is preserved.');
   if(c.product!==original.choice.product||c.setId!==original.choice.setId)fail(409,'Keep this piece’s garment and design family. Use a revised copy for a different garment or artwork set.');
   outfits.editPiece(original.pieceId,{...c,inspectionToken:p.inspectionToken},basic.inspectionSignature(p),draft.note);
   checkpoint();send(res,202,{applied:true,recoveryPending:true,id:draft.id,note:'Saved layout applied to this waiting factory piece.'});return true;
  }
  if(path===ROOT+'/create'){
   if(b.confirm!==true)fail(400,'Confirm creating a revised copy.');
   const item=await basic.create({...c,inspectionToken:p.inspectionToken,requestKey:'editor_'+draft.id+'_r'+draft.revision});send(res,200,{item,note:'Revised copy created. Original supplier product retained. Owner approval is required before storefront publication.'});return true;
  }
  fail(404,'Product editor action not found.');
 }};
}
