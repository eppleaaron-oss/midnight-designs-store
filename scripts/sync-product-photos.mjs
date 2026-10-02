import fs from 'node:fs/promises';
const token=process.env.PRINTFUL_TOKEN;if(!token)throw Error('Protected supplier token required.');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const headers={Authorization:'Bearer '+token,...(process.env.PRINTFUL_STORE_ID?{'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID}:{})};
async function api(path,body){for(let i=0;i<6;i++){const r=await fetch('https://api.printful.com/'+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(r.status===429||r.status>=500){await pause(Math.max(32000,(i+1)*10000));continue}const json=await r.json();if(!r.ok)throw Error('Photo API HTTP '+r.status+': '+JSON.stringify(json.error||json.errors||json).slice(0,500));return json}throw Error('Photo API temporarily unavailable.');}
const catalog=JSON.parse(await fs.readFile('products.json','utf8'));const styles=new Map(),work=[],report={updatedAt:new Date().toISOString(),products:{},errors:[]};
let previous={products:{}};try{previous=JSON.parse(await fs.readFile('product-photos.json','utf8'))}catch{}
function curated(groups,variant){const candidates=new Map();for(const group of groups)for(const s of group.mockup_styles||[]){if(s.restricted_to_variants?.length&&!s.restricted_to_variants.includes(variant))continue;candidates.set(s.id,s)}const all=[...candidates.values()];const model=s=>/lifestyle|men|women|male|female|model|couple|person|child|kid/i.test(s.category_name);const front=s=>/front/i.test(s.view_name);const back=s=>/back/i.test(s.view_name);const flat=all.filter(s=>!model(s));flat.sort((a,b)=>((/default|flat|product/i.test(b.category_name)?1:0)-(/default|flat|product/i.test(a.category_name)?1:0))||a.id-b.id);const chosen=[];const add=s=>{if(s&&!chosen.some(x=>x.id===s.id))chosen.push(s)};const main=flat.find(front)||flat[0];add(main);add(flat.find(s=>back(s)&&s.category_name===main?.category_name)||flat.find(back));add(flat.find(s=>/side|left|right/i.test(s.view_name)));add(all.find(s=>model(s)&&front(s)));add(all.find(s=>model(s)&&back(s)));add(all.find(s=>/detail|close/i.test(s.view_name)));return chosen.slice(0,6);}
for(const p of catalog.products.slice(0,Number(process.env.PHOTO_PRODUCT_LIMIT)||catalog.products.length)){
 try{
  const saved=(await api('store/products/'+p.id)).result;
  let styleData=styles.get(p.catalogProductId);
  if(!styleData){styleData=(await api('v2/catalog-products/'+p.catalogProductId+'/mockup-styles?limit=100')).data;styles.set(p.catalogProductId,styleData)}
  const mapping=(await api('mockup-generator/printfiles/'+p.catalogProductId)).result;
  const jobs=[];
  for(const color of [...new Set(p.variants.map(v=>v.color))]){
   const retail=p.variants.find(v=>v.color===color&&v.size==='M')||p.variants.find(v=>v.color===color);
   const source=saved.sync_variants.find(v=>String(v.id)===retail.id&&v.variant_id===retail.catalogVariantId);
   if(!source||source.product.product_id!==p.catalogProductId)throw Error('Saved retail variant does not match catalog.');
   const map=mapping.variant_printfiles.find(v=>v.variant_id===retail.catalogVariantId);
   const files=source.files.filter(f=>f.type!=='preview');
   const placements=files.map(f=>{
    const area=mapping.printfiles.find(a=>a.printfile_id===map?.placements[f.type]);
    const group=styleData.find(g=>g.placement===f.type);
    if(!area||!group||f.width!==area.width||f.height!==area.height||!f.preview_url?.includes('/printfile-preview/')||f.status!=='ok')throw Error('A verified finished production canvas is unavailable for '+f.type);
    return {placement:f.type,technique:group.technique,layers:[{type:'file',url:f.preview_url,position:{width:group.print_area_width,height:group.print_area_height,top:0,left:0}}]};
   });
   if(!placements.length)throw Error('Finished production canvases unavailable.');
   const selected=curated(styleData,retail.catalogVariantId);
   if(!selected.length)throw Error('No supported photo styles.');
   const product_options=source.options.filter(o=>o.id!=='license_type').map(o=>({name:o.id,value:o.value}));
   jobs.push({p,color,variant:retail,selected,request:{source:'catalog',catalog_product_id:p.catalogProductId,catalog_variant_ids:[retail.catalogVariantId],mockup_style_ids:selected.map(s=>s.id),placements,product_options}});
  }
  report.products[p.id]={name:p.name,originalImage:p.image,catalogProductId:p.catalogProductId,photos:[],source:'Verified finished production canvases'};
  work.push(...jobs);console.log('Prepared finished production canvases for '+p.id);
 }catch(error){report.errors.push({productId:p.id,error:error.message});if(previous.products[p.id])report.products[p.id]=previous.products[p.id];console.log('Photo setup unavailable for '+p.id+': '+error.message)}
}
await fs.writeFile('product-photo-report.json',JSON.stringify({updatedAt:report.updatedAt,prepared:work.length,errors:report.errors},null,2));
if(!work.length)throw Error('No original production designs could be read. Existing photos preserved.');
await fs.mkdir('assets/product-photos',{recursive:true});let lastTask=0;const seen=new Set();
for(let start=0;start<work.length;start+=3){await pause(Math.max(0,32000-(Date.now()-lastTask)));const batch=work.slice(start,start+3);lastTask=Date.now();let tasks;try{tasks=(await api('v2/mockup-tasks',{format:'jpg',mockup_width_px:2000,products:batch.map(j=>j.request)})).data}catch(error){for(const j of batch)report.errors.push({productId:j.p.id,error:error.message});continue}
 console.log('Created mockup tasks '+JSON.stringify(tasks.map(t=>({id:t.id,status:t.status}))));
 for(let i=0;i<tasks.length;i++){const j=batch[i];let task=tasks[i];for(let attempt=0;task.status!=='completed'&&task.status!=='failed'&&attempt<90;attempt++){await pause(4000);task=(await api('v2/mockup-tasks?id='+task.id)).data[0]}if(task.status!=='completed'){report.errors.push({productId:j.p.id,error:'Mockup task '+task.status});continue}const photos=report.products[j.p.id].photos;for(const variant of task.catalog_variant_mockups||[])for(const mockup of variant.mockups||[]){const style=j.selected.find(s=>s.id===mockup.style_id);if(!style||!mockup.mockup_url?.startsWith('https://'))continue;const dedupe=j.p.id+':'+j.color+':'+mockup.mockup_url;if(seen.has(dedupe))continue;seen.add(dedupe);const name=j.p.id+'-'+j.variant.catalogVariantId+'-'+mockup.style_id+'-'+photos.length+'.jpg',path='assets/product-photos/'+name;const response=await fetch(mockup.mockup_url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Generated photo download failed.');const bytes=new Uint8Array(await response.arrayBuffer());await fs.writeFile(path,bytes);const category=/lifestyle|men|women|male|female|model|couple|person|child|kid/i.test(style.category_name)?'fit':'product';photos.push({image:path,view:style.view_name,style:style.category_name,category,color:j.color,catalogVariantId:j.variant.catalogVariantId,storeVariantIds:j.p.variants.filter(v=>v.color===j.color).map(v=>v.id),alt:j.p.name+' · '+style.view_name+' · '+(category==='fit'?'on-person mockup':'product mockup'),label:category==='fit'?'On-person · '+style.view_name:style.view_name,kind:'production-mockup'});}console.log('Saved '+photos.length+' accurate mockups for '+j.p.id);}
}
for(const [id,item] of Object.entries(report.products)){if(!item.photos.length&&previous.products[id])report.products[id]=previous.products[id];}
if(!Object.values(report.products).some(p=>p.photos.length))throw Error('No additional mockups generated. Existing catalog preserved.');
await fs.writeFile('product-photos.json',JSON.stringify({updatedAt:report.updatedAt,products:report.products},null,2)+'\n');await fs.writeFile('product-photo-report.json',JSON.stringify({updatedAt:report.updatedAt,prepared:work.length,errors:report.errors,coverage:Object.fromEntries(Object.entries(report.products).map(([id,p])=>[id,p.photos.length]))},null,2)+'\n');console.log('Photo generation complete: '+report.errors.length+' items require review.');
