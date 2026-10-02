import fs from 'node:fs/promises';
const token=process.env.PRINTFUL_TOKEN;if(!token)throw Error('Protected supplier token required.');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const headers={Authorization:'Bearer '+token,...(process.env.PRINTFUL_STORE_ID?{'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID}:{})};
async function api(path,body){for(let attempt=0;attempt<3;attempt++){
 const r=await fetch('https://api.printful.com/'+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw Error('Photo service HTTP '+r.status+' returned a non-JSON response.');}
 if(r.ok)return data.result;
 const reason='Photo service HTTP '+r.status+': '+JSON.stringify(data.error||data.result).slice(0,500);console.log(reason);
 if(r.status!==429&&r.status<500)throw Error(reason);if(attempt===2)throw Error(reason);await pause(Math.max(32000,Number(r.headers.get('retry-after')||0)*1000));
}}
const products=JSON.parse(await fs.readFile('products.json','utf8')).products;
let previous={products:{}};try{previous=JSON.parse(await fs.readFile('product-photos.json','utf8'))}catch{}
const output={updatedAt:new Date().toISOString(),products:{...previous.products}};
const report={updatedAt:output.updatedAt,errors:[],tasks:[],coverage:{}};const work=[];const mappings=new Map();
async function save(){report.coverage=Object.fromEntries(Object.entries(output.products).map(([id,p])=>[id,p.photos.length]));await fs.writeFile('product-photo-report.json',JSON.stringify(report,null,2)+'\n');if(Object.values(output.products).some(p=>p.photos.length))await fs.writeFile('product-photos.json',JSON.stringify(output,null,2)+'\n');}
for(const p of products.slice(0,Number(process.env.PHOTO_PRODUCT_LIMIT)||products.length)){
 try{
  if(output.products[p.id]?.originalImage===p.image&&output.products[p.id]?.photos.length>1){console.log('Preserved verified photos for '+p.id);continue;}
  const saved=await api('store/products/'+p.id);let mapping=mappings.get(p.catalogProductId);
  if(!mapping){mapping=await api('mockup-generator/printfiles/'+p.catalogProductId);mappings.set(p.catalogProductId,mapping);}
  const jobs=[];
  for(const color of [...new Set(p.variants.map(v=>v.color))]){
   const retail=p.variants.find(v=>v.color===color&&v.size==='M')||p.variants.find(v=>v.color===color);
   const source=saved.sync_variants.find(v=>String(v.id)===retail.id&&v.variant_id===retail.catalogVariantId);
   if(!source||source.product.product_id!==p.catalogProductId)throw Error('Saved retail variant does not match catalog.');
   const map=mapping.variant_printfiles.find(v=>v.variant_id===retail.catalogVariantId);
   const files=source.files.filter(f=>f.type!=='preview').map(f=>{
    const area=mapping.printfiles.find(a=>a.printfile_id===map?.placements[f.type]);
    if(!area||f.width!==area.width||f.height!==area.height||!f.preview_url?.includes('/printfile-preview/')||f.status!=='ok')throw Error('A finished production canvas is unavailable for '+f.type);
    return {placement:f.type,image_url:f.preview_url,position:{area_width:area.width,area_height:area.height,width:area.width,height:area.height,top:0,left:0}};
   });
   if(!files.length)throw Error('Finished production canvases unavailable.');
   const groups=mapping.option_groups.filter(g=>/^(Flat|Ghost|Default|Product|Men's|Women's|Lifestyle)$/i.test(g));
   const options=mapping.options.filter(o=>/^(Front|Back|Left Front|Right Back|Left|Right|Side)$/i.test(o));
   jobs.push({p,color,variant:retail,request:{variant_ids:[retail.catalogVariantId],format:'jpg',width:2000,files,product_options:Object.fromEntries(source.options.filter(o=>o.id!=='license_type').map(o=>[o.id,o.value])),...(groups.length?{option_groups:groups}:{}),...(options.length?{options}: {})}});
  }
  work.push(...jobs);console.log('Prepared finished production canvases for '+p.id);
 }catch(e){report.errors.push({productId:p.id,error:e.message});console.log('Photo setup unavailable for '+p.id+': '+e.message);}
}
await save();await fs.mkdir('assets/product-photos',{recursive:true});let lastRequest=0;
for(const job of work){
 try{
  await pause(Math.max(0,32000-(Date.now()-lastRequest)));lastRequest=Date.now();
  const task=await api('mockup-generator/create-task/'+job.p.catalogProductId,job.request);report.tasks.push({productId:job.p.id,key:task.task_key,status:task.status});await save();console.log('Created mockup task '+task.task_key+' for '+job.p.id);
  job.task=task;
 }catch(e){report.errors.push({productId:job.p.id,error:e.message});await save();}
}
for(const job of work.filter(j=>j.task)){
 try{
  let task=job.task;for(let i=0;task.status==='pending'&&i<90;i++){await pause(4000);task=await api('mockup-generator/task?task_key='+task.task_key);}
  report.tasks.find(t=>t.key===job.task.task_key).status=task.status;
  if(task.status!=='completed')throw Error('Mockup task '+task.status+': '+(task.error||'Rendering timed out.'));
  const candidates=[];
  for(const mockup of task.mockups||[]){if(mockup.variant_ids?.length&&!mockup.variant_ids.includes(job.variant.catalogVariantId))continue;
   if(mockup.mockup_url)candidates.push({url:mockup.mockup_url,view:mockup.display_name||mockup.placement,style:'Default'});
   for(const extra of mockup.extra||[])candidates.push({url:extra.url,view:extra.option||extra.title||mockup.display_name,style:extra.option_group||'Product'});
  }
  const photos=[],seen=new Set();for(const c of candidates){if(!c.url?.startsWith('https://')||seen.has(c.url))continue;seen.add(c.url);
   const r=await fetch(c.url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Generated photo download failed.');
   const path='assets/product-photos/'+job.p.id+'-'+job.variant.catalogVariantId+'-'+photos.length+'.jpg';await fs.writeFile(path,new Uint8Array(await r.arrayBuffer()));
   const category=/lifestyle|men|women|male|female|model|person|child|kid/i.test(c.style)?'fit':'product';
   photos.push({image:path,view:c.view,style:c.style,category,color:job.color,catalogVariantId:job.variant.catalogVariantId,storeVariantIds:job.p.variants.filter(v=>v.color===job.color).map(v=>v.id),alt:job.p.name+' · '+c.view+' · '+(category==='fit'?'on-person mockup':'product mockup'),label:category==='fit'?'On-person · '+c.view:c.view,kind:'production-mockup'});
  }
  if(!photos.length)throw Error('No supported product photos returned.');
  output.products[job.p.id]={name:job.p.name,originalImage:job.p.image,catalogProductId:job.p.catalogProductId,photos,source:'Verified finished production canvases'};await save();console.log('Saved '+photos.length+' accurate mockups for '+job.p.id);
 }catch(e){report.errors.push({productId:job.p.id,error:e.message});await save();}
}
await save();if(!Object.values(output.products).some(p=>p.photos.length>1))throw Error('No additional mockups generated. Existing catalog preserved.');console.log('Photo generation complete: '+report.errors.length+' products require review.');
