import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../request-service/package.json',import.meta.url))('sharp');
const ids=['490162548','490155944','490151031','490142353','490123181','490106374','490096011'];
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const ledgerPath='seven-hoodie-mockup-progress.json',dir='assets/product-photos/seven-new-hoodies';
let ledger=await read(ledgerPath).catch(()=>({products:{}}));
await fs.mkdir(dir,{recursive:true});
function checkpoint(message){
 execFileSync('git',['add','--',ledgerPath,dir,'product-photos.json','products.json'],{stdio:'pipe'});
 const changed=execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim();
 if(!changed)return;
 execFileSync('git',['commit','-m',message],{stdio:'pipe'});
 execFileSync('git',['pull','--rebase','origin','main'],{stdio:'pipe'});
 execFileSync('git',['push','origin','HEAD:main'],{stdio:'pipe'});
}
async function api(path,body){
 for(let n=0;n<5;n++){
 const r=await fetch('https://api.printful.com'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.PRINTFUL_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
 if(r.status===429){await sleep(Math.max(60000,Number(r.headers.get('retry-after')||60)*1000));continue;}
 const x=await r.json();if(!r.ok||x.code>=400)throw Error('Printful '+path+': '+JSON.stringify(x));
 return x.result;
 }throw Error('Printful rate limit');
}
const signature=d=>hash(d.sync_variants.map(v=>[v.id,v.variant_id,v.options,v.files.filter(f=>f.type!=='preview').map(f=>[f.type,f.id,f.url,f.preview_url,f.width,f.height,f.position])]));
const layout=v=>JSON.stringify([v.options,v.files.filter(f=>f.type!=='preview').map(f=>[f.type,f.id,f.preview_url,f.width,f.height,f.position])]);
const view=s=>String(s).toLowerCase().replaceAll('_',' ').replace(/ print$/,'').trim().replace(/^left sleeve$/,'sleeve_left').replace(/^right sleeve$/,'sleeve_right').replaceAll(' ','_');
for(const id of ids){
 let cat=await read('products.json'),p=cat.products.find(p=>p.id===id);
 if(!p?.studioRevision||!p.supplierPreview)throw Error('Missing approved product revision '+id);
 let d=await api('/store/products/'+id),sig=signature(d);
 if(String(d.sync_product.id)!==id||!d.sync_variants.every(v=>v.files.some(f=>f.type==='preview'&&f.preview_url===p.supplierPreview)))throw Error('Supplier revision mismatch '+id);
 let state=ledger.products[id];
 if(state?.status==='complete'&&state.fingerprint===sig){console.log(id+' already complete: '+state.photoCount);continue;}
 if(state&&state.fingerprint!==sig)throw Error('Source changed; owner review required '+id);
 if(new Set(d.sync_variants.map(layout)).size!==1)throw Error('Variant artwork differs '+id);
 const v=d.sync_variants.find(v=>v.size==='M')||d.sync_variants[0];
 const catalogId=id==='490123181'?1628:1419;
 const m=await api('/mockup-generator/printfiles/'+catalogId);
 const vm=m.variant_printfiles.find(x=>x.variant_id===v.variant_id);
 if(!d.sync_variants.every(v=>JSON.stringify(m.variant_printfiles.find(x=>x.variant_id===v.variant_id)?.placements)===JSON.stringify(vm.placements)))throw Error('Variant templates differ');
 if(!state){
 const files=[];
 for(const f of v.files.filter(f=>f.type!=='preview')){
 const canvas=m.printfiles.find(x=>x.printfile_id===vm.placements[f.type]);
 if(f.status!=='ok'||!canvas||f.width!==canvas.width||f.height!==canvas.height||f.position)throw Error('Cannot prove exact panel layout '+id+' '+f.type);
 const response=await fetch(f.preview_url,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('Panel unavailable '+f.type);
 const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();
 if(Math.abs(meta.width/meta.height-canvas.width/canvas.height)>0.01)throw Error('Panel preview aspect differs '+f.type);
 files.push({placement:f.type,image_url:f.preview_url,position:{area_width:canvas.width,area_height:canvas.height,width:canvas.width,height:canvas.height,top:0,left:0}});
 }
 const groups=m.option_groups.filter(g=>!/^templates?$/i.test(g));
 const request={variant_ids:[v.variant_id],format:'jpg',width:1500,product_options:Object.fromEntries(v.options.filter(o=>o.id==='stitch_color').map(o=>[o.id,o.value])),option_groups:groups,options:m.options,files};
 state=ledger.products[id]={name:p.name,fingerprint:sig,studioRevision:p.studioRevision,status:'submitting',groups,options:m.options,requestHash:hash(request)};
 await write(ledgerPath,ledger);checkpoint('Checkpoint exact seven-hoodie mockup request '+id);
 const task=await api('/mockup-generator/create-task/'+catalogId,request);
 if(!task.task_key)throw Error('No task key; do not resubmit '+id);
 state.taskKey=task.task_key;state.status='pending';
 await write(ledgerPath,ledger);checkpoint('Save supplier mockup task '+id);
 await sleep(32000);
 }
 if(!state.taskKey)throw Error('Uncertain previous submission; inspect supplier before retry '+id);
 let result;
 for(let n=0;n<90;n++){
 result=await api('/mockup-generator/task?task_key='+encodeURIComponent(state.taskKey));
 if(result.status==='completed')break;
 if(result.status==='failed')throw Error('Mockup task failed '+id+': '+JSON.stringify(result));
 await sleep(10000);
 }
 if(result?.status!=='completed')throw Error('Mockup still pending '+id);
 const candidates=[];
 for(const mock of result.mockups||[]){
 for(const extra of mock.extra||[])if(extra.url)candidates.push({url:extra.url,style:extra.option_group||'Supplier',view:view(extra.option||extra.title||'overview'),label:extra.option||extra.title||'Supplier overview'});
 if(mock.mockup_url&&!candidates.some(c=>c.url===mock.mockup_url))candidates.push({url:mock.mockup_url,style:'Supplier',view:'overview',label:'Supplier overview'});
 }
 if(!candidates.length)throw Error('No returned mockups '+id);
 const photos=[],seen=new Set();
 for(const c of candidates){
 const response=await fetch(c.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Mockup download '+response.status);
 const bytes=await sharp(Buffer.from(await response.arrayBuffer())).rotate().jpeg({quality:90}).toBuffer();
 const digest=hash(bytes);if(seen.has(digest))continue;seen.add(digest);
 const image=dir+'/'+id+'-'+digest.slice(0,20)+'.jpg';await fs.writeFile(image,bytes);
 photos.push({image,sha256:digest,view:c.view,style:c.style,category:/men|women|duet/i.test(c.style)?'fit':'product',color:v.color,catalogVariantId:v.variant_id,storeVariantIds:d.sync_variants.map(v=>String(v.id)),kind:'production-mockup',label:c.label+' · '+c.style,alt:p.name+' · '+c.label+' · '+c.style});
 }
 if(!photos.some(p=>p.view==='front')||!photos.some(p=>p.view==='back'))throw Error('Missing full front/back '+id);
 if(signature(await api('/store/products/'+id))!==sig)throw Error('Supplier changed during generation '+id);
 cat=await read('products.json');const latest=cat.products.find(x=>x.id===id);
 if(latest.studioRevision!==p.studioRevision||latest.image!==p.image)throw Error('Owner revision changed '+id);
 const galleries=await read('product-photos.json');
 galleries.products||={};
 galleries.products[id]={...(galleries.products[id]||{}),studioRevision:p.studioRevision,originalImage:p.image,sourceFingerprint:sig,updatedAt:new Date().toISOString(),photos};
 latest.images=[p.image,...photos.map(x=>x.image)];cat.lastSyncedAt=new Date().toISOString();
 await write('product-photos.json',galleries);await write('products.json',cat);
 state.status='complete';state.photoCount=photos.length;state.views=[...new Set(photos.map(p=>p.view))];state.styles=[...new Set(photos.map(p=>p.style))];state.completedAt=new Date().toISOString();
 await write(ledgerPath,ledger);checkpoint('Attach all supplier mockups to approved hoodie '+id);
 console.log(JSON.stringify({id,photoCount:photos.length,views:state.views,styles:state.styles}));
}
console.log('All seven galleries saved.');
