// Recovery attachments persist after item cleanup; only that item's working
// attachments must disappear. Backup retention is covered by backup tests.
const workingReleases=g=>[...g.releases.values()].filter(r=>!r.tag_name.startsWith('md-basic-recovery-v2-'));
const workingAssets=g=>[...g.assets.values()].filter(a=>workingReleases(g).some(r=>r.id===a.release));
import {factoryBasicGithub} from './factory-basic-github.mjs';
import {GithubSnapshotStore,githubBackupConfig} from './factory-github-backup.mjs';
import {githubWorkingFixture} from './factory-github-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash,randomUUID,scryptSync} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from './server.mjs';
import {stripBasicWorkingPixels,clearBasicWorkingFiles} from './factory-basic-storage.mjs';

const origin='http://localhost:3000',workerToken='basic-fixture-worker-'.repeat(3),salt='fb'.repeat(16),passwordHash=salt+':'+scryptSync('basic-fixture-password',salt,64).toString('hex');
const rule={absorbShipping:false,rounding:'99',paymentFeeBps:290,platformFeeBps:0,marginBps:3500,discountBps:0,paymentFixedCents:30,platformFixedCents:0,minimumProfitCents:1000,minimumPriceCents:0,maximumPriceCents:15000};
const response=result=>new Response(JSON.stringify({result}),{headers:{'Content-Type':'application/json'}});
async function fixture(t,{durable=true,models=true,githubWorkspace=false,managedPublisher=false,outfitProducts=false,largePanels=false,unknownAudience=false}={}){
 const git=githubWorkingFixture(),env={FACTORY_BACKUP_REPO:'owner/private-data',FACTORY_BACKUP_GITHUB_TOKEN:'private-fixture-token'},photos=new Map();
 const png=await sharp({create:{width:30,height:24,channels:4,background:'#a73434'}}).png().toBuffer();let clock=Date.now(),manifest=null,live=false,creates=0,taskCreates=0,deletes=0,removed=false;
 const variants=[{id:3280,size:'S',color:'White',price:'15.00',in_stock:true},{id:3281,size:'M',color:'White',price:'16.00',in_stock:true}],product={id:328,title:unknownAudience?'All-Over Print Oversized Cotton T-Shirt':'All-Over Print Unisex T-Shirt',type_name:'T-Shirt',type:'CUT-SEW',currency:'USD'};
 const jacket={id:390,title:'All-Over Print Unisex Bomber Jacket',type_name:'Jacket',type:'CUT-SEW',currency:'USD'},jacketVariants=variants.map(v=>({...v,id:v.id+620})),supplierProducts=new Map(),removedProducts=new Set();
 let supplierPayload,supplierFileStatus="ok",wrongSupplierFile=false,dedupSupplierFiles=false,loseSupplierAck=false;
 const fetchImpl=async(url,o={})=>{
  url=String(url);
  if(url.startsWith('https://api.github.com/repos/owner/private-data')||url.startsWith('https://uploads.github.com/repos/owner/private-data'))return git.fetch(url,o);
  if(url==='https://api.github.com/repos/eppleaaron-oss/midnight-designs-store')return new Response(JSON.stringify({id:1393932711,permissions:{push:true}}));
  if(url.includes('/contents/images/factory/')){const path=new URL(url).pathname;if(o.method==='PUT'){const b=JSON.parse(o.body),data=Buffer.from(b.content,'base64'),sha=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');photos.set(path,{sha,data});return new Response(JSON.stringify({content:{sha}}));}const saved=photos.get(path);return saved?new Response(JSON.stringify({sha:saved.sha,size:saved.data.length})):new Response('{}',{status:404});}
  if(url==='https://api.printful.com/products')return response([...(outfitProducts?[product,jacket]:[product]),{id:83,title:'All-Over Print Basic Pillow',type_name:'Pillow'},{id:630,title:'All-Over Print Unisex Bandana',type_name:'Bandana'}]);
  if(url==='https://api.printful.com/products/328')return response({product,variants});
  if(outfitProducts&&url==='https://api.printful.com/products/390')return response({product:jacket,variants:jacketVariants});
  if(url.includes('/v2/catalog-products/'))return new Response(JSON.stringify({data:{type:'CUT-SEW',techniques:[{key:'cut-sew',is_default:true}]}}));
  if(url.includes('/mockup-generator/printfiles/'))return response({available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:largePanels?120:12,height:largePanels?80:8,dpi:150}],variant_printfiles:(url.includes('/390')?jacketVariants:variants).map(v=>({variant_id:v.id,placements:{front:1,back:1}})),option_groups:models?["Men's","Women's",'Flat']:['Flat']});
  if(url.includes('/mockup-generator/templates/'))return response({templates:[],variant_mapping:[]});
  if(url.includes('/store/products/@')){const external=decodeURIComponent(url.split('/@')[1]),found=[...supplierProducts].find(([id,p])=>p.sync_product.external_id===external&&!removedProducts.has(id));return found?response({sync_product:{id:found[0],external_id:external}}):new Response('{}',{status:404});}
  if(url==='https://api.printful.com/store/products'&&o.method==='POST'){supplierPayload=JSON.parse(o.body);creates++;const id=500+creates;supplierProducts.set(id,supplierPayload);if(loseSupplierAck){loseSupplierAck=false;return new Response("{}",{status:503});}return response({id});}
  if(/^https:\/\/api.printful.com\/store\/products\/\d+$/.test(url)){
   const id=Number(url.split('/').at(-1)),payload=supplierProducts.get(id);if(!payload)return new Response('{}',{status:404});
   if(o.method==='DELETE'){deletes++;removed=true;removedProducts.add(id);return response({});}
   if(removedProducts.has(id))return new Response('{}',{status:404});
   return response({sync_product:{id,external_id:payload.sync_product.external_id},sync_variants:payload.sync_variants.map((v,i)=>({id:601+i,variant_id:v.variant_id,synced:true,is_ignored:false,availability_status:'active',currency:'USD',size:[...variants,...jacketVariants].find(x=>x.id===v.variant_id).size,color:'White',retail_price:v.retail_price,files:v.files.map((f,n)=>({...f,type:f.type==='front'?'default':f.type,id:900+n,url:wrongSupplierFile?origin+'/factory-print-file/'+'a'.repeat(64):dedupSupplierFiles?payload.sync_variants[0].files.find(first=>first.type===f.type).url:f.url,status:supplierFileStatus}))}))});
  }
  if(o.method==='HEAD'&&url.includes('/factory-print-file/')){const key=new URL(url).pathname.split('/').at(-1),row=service.db.prepare('SELECT f.sha256 FROM factory_file_links l JOIN factory_print_files f ON f.id=l.file WHERE l.hash=?').get(createHash('sha256').update(key).digest('hex'));return new Response(null,{headers:{'Content-Type':'image/png','X-Midnight-Print-Sha256':row?.sha256||''}});}
  if(url.includes('/mockup-generator/create-task/')){const b=JSON.parse(o.body);if(models)assert.deepEqual(b.option_groups,["Men's","Women's"]);else assert.equal(b.option_groups,undefined);taskCreates++;return response({task_key:'basic-'+b.variant_ids[0],status:'pending'});}
  if(url.includes('/mockup-generator/task?')){const id=Number(new URL(url).searchParams.get('task_key').split('-')[1]);return response({status:'completed',mockups:[{variant_ids:[id],placement:'front',mockup_url:'https://files.cdn.printful.com/basic-'+id+'.png',extra:[{title:'Back',option_group:models?"Men's":'Flat',url:'https://files.cdn.printful.com/basic-back-'+id+'.png'}]}]});}
  if(url.startsWith('https://files.cdn.printful.com/basic-'))return new Response(png,{headers:{'Content-Type':'image/png'}});
  if(url.includes('/contents/ai-made-review.json'))return o.method==='PUT'?new Response('{}'):new Response('{}',{status:404});
  if(url.includes('/contents/factory-listings.json')){if(o.method==='PUT'){manifest=JSON.parse(Buffer.from(JSON.parse(o.body).content,'base64').toString());return new Response('{}');}return manifest?new Response(JSON.stringify({sha:'basic-test',content:Buffer.from(JSON.stringify(manifest)).toString('base64')})):new Response('{}',{status:404});}
  if(url.includes('/dispatches'))return new Response(null,{status:204});
  if(url.startsWith('https://midnight-designs.store/images/factory/')){const p='/repos/eppleaaron-oss/midnight-designs-store/contents'+new URL(url).pathname,a=photos.get(p);return live&&a?new Response(a.data,{headers:{'Content-Type':'image/png'}}):new Response('{}',{status:404});}
  if(url.startsWith('https://midnight-designs.store/products.json'))return new Response(JSON.stringify({products:live?Object.values(manifest?.products||{}):[]}));
  throw Error('Unexpected Basic fixture request: '+url);
 };
 const store=githubWorkspace?new GithubSnapshotStore(githubBackupConfig(env,passwordHash),{fetchImpl,sleep:async()=>{},clock:()=>clock}):null;
 const service=createService({backupSettings:githubWorkspace?{env,store,autoStart:false}:undefined,basicGithubSettings:{fetchImpl,sleep:async()=>{},clock:()=>clock},dbPath:':memory:',origin,passwordHash,secure:false,factoryLoginRequired:false,productionSettings:{storageDurable:durable,workerToken,clock:()=>clock},workflowSettings:{storageDurable:durable,fetchImpl},factorySettings:{token:'supplier-fixture',fetchImpl},blueprintSettings:{token:'supplier-fixture',fetchImpl,plans:{products:{}}},publishingSettings:{token:'supplier-fixture',githubToken:githubWorkspace?null:'store-fixture',storageDurable:durable,fetchImpl,clock:()=>clock},ideaSettings:{env:{},catalog:[]},outfitSettings:{fetchImpl}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.server.close(r)));const url='http://127.0.0.1:'+service.server.address().port,db=service.db;
 async function call(path,b,machine=false){const r=await fetch(url+path,{method:b?'POST':'GET',headers:{Origin:origin,...(b?{'Content-Type':'application/json'}:{}),...(machine?{Authorization:'Bearer '+workerToken}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json()};}
 const basic=async(path='',b)=>{const result=await call('/api/owner/ai-factory/basic'+path,b);if(path==='/approve'&&result.status===200){const item=db.prepare('SELECT job,closed FROM factory_basic_items WHERE id=?').get(b.id);if(item&&!item.closed){const p=service.publishingEngine.prepared(item.job);db.prepare("INSERT OR REPLACE INTO factory_ai_made_decisions VALUES(?,'approved',?,?)").run(item.job,p.fingerprint,new Date().toISOString());}}return result;},api=(path,b)=>call('/api/owner/ai-factory/'+path,b),machine=(path,b={})=>call('/internal/factory/'+path,{worker:'basic-worker',...b},true);
 if(githubWorkspace){await service.githubBackups.save(true);if(managedPublisher){await service.basicGithub.connectPublisher('workflow-fixture-token-'.repeat(2),'1001',clock+300000);service.basicGithub.disconnectPublisher('1001');}else await service.basicGithub.enable();}else await api('budget',{dailyBudget:1000,totalBudget:2000});await api('pricing/rule',{category:'shirts',rule});if(outfitProducts)await api('pricing/rule',{category:'jackets',rule});await machine('heartbeat');
 const upload=await api('artwork/upload',{name:'Raven front',collection:'Raven test set',scope:'collection',target:'',product:null,placements:['front'],instructions:'Keep the original artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'front.png',base64:png.toString('base64')}]});assert.equal(upload.status,200);const artwork=upload.data.artworks[0].id;
 const set='basic:test';db.prepare('INSERT INTO idea_sets(id,source,name,parts,updated,jacket) VALUES(?,?,?,?,?,0)').run(set,'printful','Raven test set',JSON.stringify({front:{artwork,name:'Raven front',url:'/api/owner/ai-factory/artwork/'+artwork+'/file'}}),new Date().toISOString());
 async function step(){clock+=31000;await machine('heartbeat');const c=await machine('claim');assert.ok(c.data.job,JSON.stringify(c.data));const result=await machine('step',{job:c.data.job,lease:c.data.lease});assert.equal(result.status,200,JSON.stringify(result));return result;}
 async function start(){const c=await basic('/create',{requestKey:randomUUID(),setId:set,product:328,sizes:['S','M'],audience:'unisex'});assert.equal(c.status,200,JSON.stringify(c.data));return c.data;}
 async function preview(item){
  let held;for(let i=0;i<35;i++){const result=await step();if(result.data.status==='waiting_input'){held=result;break;}}
  assert.ok(held,'preview eventually stops for explicit pricing confirmation');assert.match(held.data.result.wait,/Pricing/);
  const visual=(await basic()).data.active;assert.equal(visual.mockups.length,visual.recipe.variants.length*2,'real mockup images are saved before price confirmation');assert.equal(visual.listing.supplier_id,null,'no supplier product is created with unknown costs');assert.equal(visual.canApprove,false);
  assert.equal((await api('pricing/confirm-quotes',{job:item.job,extraCents:0,shippingCents:null,source:'Verified supplier included print charges',verified:true})).status,200);await basic('/resume',{id:item.id});
  for(let i=0;i<8;i++){const result=await step();if(result.data.status==='waiting_input')break;}
  const current=(await basic()).data.active;assert.equal(current.canApprove,true,JSON.stringify(current));return current;
 }
 return {service,db,git,photos,store,fetchImpl,backupConfig:githubBackupConfig(env,passwordHash),call,basic,api,machine,step,start,preview,set,artwork,png,url,live:()=>{live=true;},publisher:()=>service.basicGithub.connectPublisher('workflow-fixture-token-'.repeat(2),'1002',clock+300000),supplierFiles:(status,wrong=false,dedup=false)=>{supplierFileStatus=status;wrongSupplierFile=wrong;dedupSupplierFiles=dedup;},loseSupplierAck:()=>{loseSupplierAck=true;},counts:()=>({creates,taskCreates,deletes}),manifest:()=>manifest};
}

test('matching size templates reuse exact rendered pixels while retaining separate files and quality proofs',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.step();await f.step();
 const first=await f.step();assert.equal(first.data.result.rendered,4);assert.equal(first.data.result.reusedPixels,2);assert.equal(first.data.result.filesSaved,true,'A small multi-size garment finishes in one recoverable rendering slice');assert.equal(first.data.result.quality.decodedFiles,2,'Identical native PNGs are fully decoded once while every variant retains its proof');
 const rows=f.db.prepare('SELECT f.id,f.draft,f.placement,f.sha256,q.signature,r.pixel_signature FROM factory_print_files f JOIN factory_render_files r ON r.file=f.id JOIN factory_render_quality q ON q.file=f.id').all();
 assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.id)).size,4);assert.equal(new Set(rows.map(r=>r.draft)).size,2);
 for(const placement of ['front','back']){const pair=rows.filter(r=>r.placement===placement);assert.equal(pair[0].sha256,pair[1].sha256);assert.equal(pair[0].pixel_signature,pair[1].pixel_signature);assert.notEqual(pair[0].signature,pair[1].signature,'Supplier variant remains part of the final quality proof');}
 const remote=f.db.prepare("SELECT count(*) records,count(DISTINCT asset_id) assets FROM factory_basic_remote_assets WHERE job=? AND kind='print'").get(item.job);assert.equal(remote.records,4);assert.equal(remote.assets,2);const {factoryQuality}=await import('./factory-quality.mjs'),q=factoryQuality({db:f.db}),other=f.db.prepare('SELECT id FROM factory_print_files ORDER BY rowid DESC LIMIT 1').get();for(const trigger of f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='factory_print_files'").all())if(trigger.sql.includes('immutable'))f.db.exec('DROP TRIGGER "'+trigger.name.replaceAll('"','""')+'"');f.db.prepare('UPDATE factory_print_files SET data=? WHERE id=?').run(Buffer.from('corrupted duplicate'),other.id);await assert.rejects(q.check(item.job),/missing, changed or incorrectly sized/,'A valid matching file cannot hide corruption in another variant');
});

test('an interrupted print attachment checkpoint recovers exact file IDs and checksums before advancing',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.step();await f.step();await f.step();
 // Simulate interruption after native bytes were saved but before the files-step advancement was committed.
 f.db.prepare('UPDATE factory_job_runtime SET step=2 WHERE job=?').run(item.job);f.db.prepare("DELETE FROM factory_job_checkpoints WHERE job=? AND step='files'").run(item.job);
 const original=f.db.prepare('SELECT id,sha256 FROM factory_print_files ORDER BY rowid LIMIT 1').get();f.db.prepare("DELETE FROM factory_basic_remote_assets WHERE job=? AND kind='print' AND file=?").run(item.job,original.id);stripBasicWorkingPixels(f.db);
 await f.service.basicGithub.hydrate(item.job);assert.equal(f.db.prepare('SELECT length(data) n FROM factory_print_files WHERE id=?').get(original.id).n,0,'Unconfirmed bytes remain for deterministic regeneration, never a fake completion');
 const step=await f.step();assert.ok(['queued','retry_wait'].includes(step.data.status));const restored=f.db.prepare('SELECT sha256,length(data) n FROM factory_print_files WHERE id=?').get(original.id);assert.equal(restored.sha256,original.sha256);assert.ok(restored.n>0);assert.ok(f.db.prepare("SELECT asset_id FROM factory_basic_remote_assets WHERE job=? AND kind='print' AND file=?").get(item.job,original.id));
 if(!step.data.result?.filesSaved)for(let i=0;i<4;i++){const r=await f.step();if(r.data.result?.filesSaved)break;}
 assert.equal(f.counts().creates,0,'Recovering files cannot create another supplier product');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);assert.equal((await f.basic()).data.active.job,item.job);
});

test('Basic creates one real tracked recipe, retrieves model mockups before approval, verifies publication and releases working capacity',async t=>{
 const f=await fixture(t),item=await f.start();
 const duplicate=await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'});assert.equal(duplicate.status,409);
 assert.equal((await f.basic('/create',{requestKey:item.request_key,setId:f.set,product:328})).data.id,item.id,'a repeated creation request returns the same item');
 const current=await f.preview(item);assert.equal(f.counts().creates,1);assert.equal(f.counts().taskCreates,2);assert.equal(f.manifest(),null,'mockup creation never publishes the listing');assert.equal(current.mockups.length,4);
 const file=f.db.prepare("SELECT data FROM factory_print_files WHERE placement='back' LIMIT 1").get();assert.deepEqual([...(await sharp(Buffer.from(file.data)).raw().toBuffer()).subarray(0,4)],[0,0,0,255],'unused print area has actual black pixels');
 assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,200);assert.equal((await f.step()).data.status,'retry_wait');assert.ok(f.manifest());assert.ok((await f.basic()).data.active,'cleanup waits for actual live-store verification');
 f.live();assert.equal((await f.step()).data.status,'completed');const saved=(await f.basic()).data;assert.equal(saved.active,null);const result=saved.recent[0];assert.equal(result.status,'published');assert.equal(result.cleanup.verified,true);assert.ok(result.cleanup.reclaimedBytes>0);assert.equal(result.storage.printBytes,0);assert.equal(result.storage.stagingBytes,0);assert.ok(result.storage.mockupBytes>0);assert.equal(f.counts().deletes,0,'publication cleanup never deletes a live supplier product');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_print_drafts').get().n,0,'working blueprint quota is reclaimed');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_artwork WHERE id=?').get(f.artwork).n,1);assert.equal(saved.liveCycleVerified,true);
 const media=new URL(Object.values(f.manifest().products)[0].image).pathname;assert.equal((await fetch(f.url+media)).status,200,'published photos survive print-file cleanup');assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'})).status,409,'the same approved recipe does not create a duplicate listing');
});

test('GitHub Basic needs no paid disk or AI budget, restores exact temporary attachments, publishes permanent photos, and deletes every working attachment',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true});assert.equal((await f.basic()).data.blockers.length,0);assert.equal((await f.basic()).data.readiness.storageDurable,false);assert.equal((await f.basic()).data.settings.daily_budget,0);
 const item=await f.start(),preview=await f.preview(item);assert.equal(preview.mockups.length,4);assert.ok(workingAssets(f.git).length>0);assert.ok(workingReleases(f.git).length>0);assert.equal(f.photos.size,0,'unapproved photos never enter the public repository');
 const printAssets=f.db.prepare("SELECT count(*) records,count(DISTINCT asset_id) assets FROM factory_basic_remote_assets WHERE job=? AND kind='print'").get(item.job);assert.ok(printAssets.records>printAssets.assets,'Matching variant panels share a verified working attachment');
 const dir=await mkdtemp(join(tmpdir(),'midnight-basic-github-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'restore.sqlite');await new GithubSnapshotStore(f.backupConfig,{fetchImpl:f.git.fetch,sleep:async()=>{}}).restore(path);const restored=new DatabaseSync(path);t.after(()=>restored.close());restored.function('factory_history_actor',()=>'{"type":"system","name":"Recovery test"}');
 assert.equal(restored.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n,0,'working print bytes are absent from versioned Git snapshots');assert.equal(restored.prepare('SELECT sum(length(data)) n FROM factory_mockups').get().n,0);assert.ok(restored.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.artwork).n>0,'original is retained');
 const remote=factoryBasicGithub({db:restored,backups:{connection:()=>f.backupConfig,snapshot:()=>({initialized:true}),checkpoint:async()=>{}},env:{FACTORY_BACKUP_GITHUB_TOKEN:'private-fixture-token'},fetchImpl:f.fetchImpl,sleep:async()=>{}});let result,passes=0;do{result=await remote.hydrate(item.job);passes++;}while(result?.defer);assert.ok(passes<=2,'Matching panels and photos restore once per unique checksum');assert.ok(restored.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n>0);assert.deepEqual(restored.prepare('SELECT task_key FROM factory_mockup_tasks ORDER BY variant').all(),f.db.prepare('SELECT task_key FROM factory_mockup_tasks ORDER BY variant').all());
 assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,200);assert.equal((await f.step()).data.status,'retry_wait');assert.ok(f.photos.size>0);assert.ok(workingAssets(f.git).length>0,'working files stay until the store actually verifies');f.live();assert.equal((await f.step()).data.status,'completed');
 const done=(await f.basic()).data;assert.equal(done.active,null);assert.equal(done.recent[0].cleanup.github.verified,true);assert.ok(done.recent[0].cleanup.github.releasedRemoteBytes>0);assert.equal(workingAssets(f.git).length,0);assert.equal(workingReleases(f.git).length,0);assert.equal(f.db.prepare('SELECT sum(length(data)) n FROM factory_mockups WHERE job=?').get(item.job).n,0);assert.ok(f.photos.size>0);assert.ok(f.manifest().products['501'].images.every(u=>u.startsWith('https://midnight-designs.store/images/factory/501/')));assert.equal(f.counts().creates,1);assert.equal(f.counts().taskCreates,2);
 const image=preview.mockups[0],redirect=await fetch(f.url+image.url,{redirect:'manual'});assert.equal(redirect.status,302);assert.ok(redirect.headers.get('location').startsWith('https://midnight-designs.store/images/factory/'));
});

test('GitHub rejection preserves originals and holds the next item until remote deletion really succeeds',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.preview(item);f.git.failDelete=true;
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,503);assert.equal((await f.basic()).data.active.status,'cleanup_failed');assert.ok(workingAssets(f.git).length>0);assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'})).status,409);assert.equal(f.photos.size,0);
 f.git.failDelete=false;assert.equal((await f.basic('/resume',{id:item.id})).status,200);const d=(await f.basic()).data;assert.equal(d.active,null);assert.equal(d.recent[0].decision,'disapproved');assert.equal(d.recent[0].cleanup.github.verified,true);assert.equal(workingAssets(f.git).length,0);assert.ok(f.db.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.artwork).n>0);assert.equal(f.counts().deletes,1);
});

test('Disapproval deletes only its owned unpublished supplier draft, originals survive, and failed cleanup keeps the next item locked',async t=>{
 const f=await fixture(t),item=await f.start();await f.preview(item);
 const profile=f.db.prepare('SELECT templates FROM factory_job_profiles WHERE job=?').get(item.job),other=randomUUID();f.db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(other,'Another product references this set',profile.templates);
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,409);let state=(await f.basic()).data;assert.equal(state.active.status,'cleanup_failed');assert.equal(state.active.closed,0);assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'})).status,409);
 f.db.prepare('DELETE FROM factory_job_profiles WHERE job=?').run(other);assert.equal((await f.basic('/resume',{id:item.id})).status,200);state=(await f.basic()).data;assert.equal(state.active,null);assert.equal(state.rejectionCleanupVerified,true);assert.equal(state.recent[0].storage.mockupBytes,0);assert.equal(state.recent[0].storage.workingBytes,0);assert.equal(f.counts().deletes,1,'retrying cleanup never creates or deletes another product');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_artwork WHERE id=?').get(f.artwork).n,1);
});
test('cleanup waits for GitHub, retains reclaimed bytes across retries, and releases the rejected lane only after checkpoint confirmation',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.preview(item);
 f.git.failDelete=true;assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,503);
 const first=(await f.basic()).data.active;assert.equal(first.cleanup.verified,false);assert.equal(first.cleanup.localVerified,true);assert.ok(first.cleanup.reclaimedBytes>0);assert.ok(first.cleanup.files.length>0);
 const remaining=workingAssets(f.git).length;f.store.hold=true;
 await assert.rejects(f.service.basic.tick(),/GitHub/);const held=(await f.basic()).data.active;assert.equal(held.cleanup.reclaimedBytes,first.cleanup.reclaimedBytes);assert.deepEqual(held.cleanup.files,first.cleanup.files);assert.equal(held.cleanup.verified,false);assert.equal(held.closed,0);assert.equal(workingAssets(f.git).length,remaining);
 f.store.hold=false;f.git.failDelete=false;f.git.staleReadsAfterWrite=3;
 assert.equal((await f.basic('/resume',{id:item.id})).status,200);const state=(await f.basic()).data;assert.equal(state.active,null);assert.equal(state.recent[0].cleanup.verified,true);assert.equal(state.recent[0].cleanup.reclaimedBytes,first.cleanup.reclaimedBytes);assert.deepEqual(state.recent[0].cleanup.files,first.cleanup.files);assert.equal(workingAssets(f.git).length,0);assert.equal(state.recent[0].error,'');assert.equal(f.store.hold,false);assert.equal(f.counts().deletes,1);
});
test('a failed final checkpoint never reports verified cleanup and retries without losing the original cleanup record',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.preview(item);let failFinal=true;
 f.service.basic.setWorkspace({...f.service.basicGithub,async checkpoint(job){if(failFinal&&f.db.prepare('SELECT closed FROM factory_basic_items WHERE id=?').get(item.id).closed){failFinal=false;throw Object.assign(Error('Checkpoint confirmation delayed'),{status:503});}return f.service.basicGithub.checkpoint(job);}});
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,503);const held=(await f.basic()).data.active;
 assert.equal(held.closed,0);assert.equal(held.cleanup.verified,false);assert.equal(held.cleanup.github.verified,true);assert.ok(held.cleanup.reclaimedBytes>0);assert.equal(workingAssets(f.git).length,0);
 assert.equal((await f.basic('/resume',{id:item.id})).status,200);const done=(await f.basic()).data;assert.equal(done.active,null);assert.equal(done.recent[0].cleanup.verified,true);assert.equal(done.recent[0].cleanup.reclaimedBytes,held.cleanup.reclaimedBytes);assert.deepEqual(done.recent[0].cleanup.files,held.cleanup.files);assert.equal(f.counts().deletes,1);assert.equal(done.recent[0].error,'');
});

test('Basic backup copies omit disposable pixels, preserve file IDs and restore the same recipe without duplicate supplier or mockup tasks',async t=>{
 const f=await fixture(t),item=await f.start();await f.preview(item);const folder=await mkdtemp(join(tmpdir(),'basic-backup-'));t.after(()=>rm(folder,{recursive:true,force:true}));const path=join(folder,'snapshot.sqlite');await backup(f.db,path);const copy=new DatabaseSync(path);
 try{stripBasicWorkingPixels(copy);assert.equal(copy.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n,0);assert.equal(copy.prepare('SELECT sum(length(data)) n FROM factory_mockups').get().n,0);assert.equal(copy.prepare('SELECT count(*) n FROM factory_mockup_downloads').get().n,0);assert.equal(copy.prepare('SELECT count(*) n FROM factory_artwork WHERE id=?').get(f.artwork).n,1);}finally{copy.close();}
 const ids=f.db.prepare('SELECT id FROM factory_print_files ORDER BY id').all();stripBasicWorkingPixels(f.db);assert.equal((await f.basic()).data.active.temporaryPixelsMissing,true);assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,409);const before=f.counts();assert.equal((await f.basic('/resume',{id:item.id})).status,200);assert.deepEqual(f.db.prepare('SELECT id FROM factory_print_files ORDER BY id').all(),ids);assert.deepEqual(f.counts(),before);assert.equal((await f.basic()).data.active.temporaryPixelsMissing,false);
});

test('Basic exposes real storage blockers, keeps customer routes isolated, and requires explicit review when people/model options are missing',async t=>{
 const f=await fixture(t,{durable:false}),state=(await f.basic()).data;assert.ok(state.blockers.some(x=>x.code==='workspace'));assert.equal(state.liveCycleVerified,false);assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328})).status,409);assert.equal((await f.call('/api/requests')).status,401);assert.equal((await f.call('/api/owner/export')).status,401);
 const response=await fetch(f.url+'/ai-factory/basic');assert.equal(response.status,200);assert.match(await response.text(),/data-factory-public="true"/);
 const g=await fixture(t,{models:false}),item=await g.start();await g.preview(item);assert.equal((await g.basic('/approve',{id:item.id,confirm:true})).status,409);assert.equal((await g.basic('/approve',{id:item.id,confirm:true,acceptMissingModel:true})).status,200);
});

test('Basic does not substitute artwork into other placements or approve changed print files',async t=>{
 const f=await fixture(t),inspect=await f.basic('/inspect',{setId:f.set,product:328,audience:'unisex'});assert.equal(inspect.status,200);assert.deepEqual(inspect.data.placements.map(x=>x.area),['front']);assert.deepEqual(inspect.data.fill,['back']);const item=await f.start();await f.preview(item);f.db.exec("DROP TRIGGER preserve_factory_print_files_UPDATE");f.db.prepare("UPDATE factory_print_files SET data=x'00' WHERE placement='front'").run();assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,409);
 const old=(await f.basic()).data.active;assert.equal(old.decision,null);assert.equal(f.manifest(),null);
});

test('Basic follows private installations’ existing login setting and preserves its exact destination',async t=>{
 const service=createService({dbPath:':memory:',origin,passwordHash,secure:false,factorySettings:{token:null},publishingSettings:{token:null,githubToken:null},ideaSettings:{env:{},catalog:[]}});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.server.close(r)));const url='http://127.0.0.1:'+service.server.address().port;
 const page=await fetch(url+'/ai-factory/basic',{redirect:'manual'});assert.equal(page.status,302);assert.equal(page.headers.get('location'),'/login?next=ai-factory-basic');assert.equal((await fetch(url+'/factory-basic.js')).status,401);assert.equal((await fetch(url+'/api/owner/ai-factory/basic')).status,401);
 const login=await fetch(url+'/api/owner/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'basic-fixture-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];assert.equal(login.status,200);const opened=await fetch(url+'/ai-factory/basic',{headers:{Cookie:cookie}});assert.equal(opened.status,200);assert.doesNotMatch(await opened.text(),/data-factory-public="true"/);
});

test('the GitHub workflow can connect publishing without another owner token and expired connections defer safely',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,managedPublisher:true});const state=(await f.basic()).data;assert.equal(state.github.managed,true);assert.equal(state.github.storageTest.verified,true);assert.equal(state.github.storageTest.remainingAssets,0);assert.equal(state.github.publisherOnline,false);assert.equal(state.blockers.length,0);
 const item=await f.start();await f.preview(item);const ownerWait=(await f.basic()).data.active;assert.equal(ownerWait.jobStatus,'waiting_input');assert.match(ownerWait.error,/Review the real mockups/);assert.equal(ownerWait.canApprove,true);assert.equal((await f.machine('claim')).data.job,null,'Unapproved items do not churn publisher retries');await assert.rejects(f.service.basic.approveBatch(item.id,'not-the-frozen-recipe',{}),/Batch authorization/);await f.basic('/approve',{id:item.id,confirm:true});const waiting=await f.step();assert.equal(waiting.data.status,'retry_wait');assert.match(waiting.data.result.note,/GitHub publishing connection/);assert.equal(f.manifest(),null);
 await f.publisher();assert.equal((await f.step()).data.status,'retry_wait');assert.ok(f.manifest());f.live();await f.publisher();assert.equal((await f.step()).data.status,'completed');assert.equal((await f.basic()).data.active,null);assert.equal(workingAssets(f.git).length,0);
});


test('GitHub outfit produces two coordinated pieces serially, waits for owner decisions and cleanup, then publishes the complete group',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,outfitProducts:true});
 const choice={requestKey:randomUUID(),name:'Raven complete outfit',setId:f.set,audience:'unisex',adaptArtwork:true,pieces:[{product:328,sizes:['M']},{product:390,sizes:['M']}]};
 const created=await f.basic('/outfits/create',choice);assert.equal(created.status,200,JSON.stringify(created));const outfit=created.data;
 assert.equal(outfit.status,'running',JSON.stringify(outfit));assert.equal(outfit.total,2);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);
 assert.equal((await f.basic('/outfits/create',choice)).data.id,outfit.id,'double click replays the same plan');
 const first=(await f.basic()).data.active;assert.ok(first);assert.equal(first.recipe.outfitId,outfit.id);
 const context=JSON.parse(f.db.prepare('SELECT selection FROM factory_job_audiences WHERE job=?').get(first.job).selection);assert.equal(context.outfitId,outfit.id);assert.equal(context.storeCollection,choice.name);
 await f.service.basicOutfits.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);
 assert.equal((await f.api('outfits/publish',{id:outfit.id,published:true})).status,409);const legacyPiece=f.db.prepare('SELECT id FROM factory_outfit_items WHERE outfit=?').get(outfit.id);assert.equal((await f.api('outfits/replace',{itemId:legacyPiece.id})).status,409);
 await f.preview(first);await f.service.basicOutfits.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1,'owner review holds the next piece');
 await f.basic('/approve',{id:first.id,confirm:true});await f.step();f.live();assert.equal((await f.step()).data.status,'completed');assert.equal(workingAssets(f.git).length,0);
 await f.service.basicOutfits.tick();const second=(await f.basic()).data.active;assert.ok(second);assert.notEqual(second.id,first.id);assert.equal(second.recipe.product,390);
 f.db.prepare('UPDATE factory_basic_outfit_pieces SET item=NULL WHERE item=?').run(second.id);await f.service.basicOutfits.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,2,'lost queue pointer reconciles without a duplicate job');
 await f.preview(second);await f.basic('/approve',{id:second.id,confirm:true});for(let i=0;i<4;i++){if((await f.step()).data.status==='completed')break;}
 await f.service.basicOutfits.tick();const done=(await f.basic()).data;assert.equal(done.active,null);assert.equal(done.outfitQueue.active,null);assert.equal(done.outfitQueue.recent[0].status,'complete');assert.equal(done.outfitQueue.recent[0].published,2);assert.equal(workingAssets(f.git).length,0);assert.equal(workingReleases(f.git).length,0);assert.equal(f.counts().creates,2);
 const publicOutfits=(await f.call('/api/outfits')).data.outfits;assert.equal(publicOutfits.length,1);assert.equal(publicOutfits[0].id,outfit.id);assert.equal(publicOutfits[0].products.length,2);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_artwork').get().n,1);
});

test('outfit preflight is atomic, pause prevents the next piece, and failed deletion blocks advancement',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,outfitProducts:true});const spec={requestKey:randomUUID(),name:'Raven outfit',setId:f.set,audience:'unisex',pieces:[{product:328,sizes:['M']},{product:99999,sizes:['M']}]};
 assert.equal((await f.basic('/outfits/create',spec)).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_basic_outfit_runs').get().n,0);
 spec.pieces[1].product=390;const created=await f.basic('/outfits/create',spec);assert.equal(created.status,200);const id=created.data.id,first=(await f.basic()).data.active;await f.preview(first);f.git.failDelete=true;
 assert.equal((await f.basic('/disapprove',{id:first.id,confirm:true})).status,503);await f.service.basicOutfits.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);
 assert.equal((await f.basic('/outfits/control',{id,action:'pause'})).status,200);f.git.failDelete=false;assert.equal((await f.basic('/resume',{id:first.id})).status,200);await f.service.basicOutfits.tick();assert.equal((await f.basic()).data.active,null);
 assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328})).status,409,'an open outfit reserves its lane');
 assert.equal((await f.basic('/outfits/control',{id,action:'resume'})).status,200);const second=(await f.basic()).data.active;assert.ok(second);assert.equal(second.recipe.product,390);assert.equal((await f.basic('/outfits/control',{id,action:'cancel'})).status,409);
 await f.basic('/disapprove',{id:second.id,confirm:true});await f.service.basicOutfits.tick();assert.equal((await f.basic()).data.outfitQueue.recent[0].status,'reviewed');assert.equal(f.db.prepare('SELECT published FROM factory_outfits WHERE id=?').get(id).published,0);
 const previous=(await f.basic()).data.outfitQueue.recent[0],piece=previous.pieces[0],replacement={requestKey:randomUUID(),id,pieceId:piece.id,setId:f.set,adaptArtwork:true};const rebuilt=await f.basic('/outfits/replace',replacement);assert.equal(rebuilt.status,200,JSON.stringify(rebuilt));assert.equal(rebuilt.data.pieces[0].revision,2);assert.notEqual(rebuilt.data.pieces[0].item.id,first.id);assert.equal(rebuilt.data.pieces[1].item.id,second.id,'other outfit pieces are preserved');assert.equal((await f.basic('/outfits/replace',replacement)).data.pieces[0].item.id,rebuilt.data.pieces[0].item.id,'replacement retries do not duplicate work');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,3);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_basic_outfit_revisions').get().n,1);
});

test('switching production pauses the old outfit, verifies rejection cleanup, cancels pending pieces, then creates the exact new garment',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,outfitProducts:true});
 const made=await f.basic('/outfits/create',{requestKey:randomUUID(),name:'Old outfit',setId:f.set,audience:'unisex',adaptArtwork:true,pieces:[{product:328,sizes:['M']},{product:390,sizes:['M']}]});assert.equal(made.status,200);const outfit=made.data.id,item=(await f.basic()).data.active;
 await f.preview(item);assert.equal((await f.basic('/outfits/control',{id:outfit,action:'pause'})).status,200);
 assert.equal((await f.basic('/outfits/control',{id:outfit,action:'cancel'})).status,409,'the active item cannot be abandoned before cleanup');
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,200);await f.service.basicOutfits.tick();assert.equal((await f.basic()).data.active,null,'paused outfit does not enqueue its next jacket');assert.equal((await f.basic('/outfits/control',{id:outfit,action:'cancel'})).status,200);
 f.db.prepare('UPDATE factory_jobs SET error=? WHERE id=?').run('Pricing hold: stale archived message',item.job);assert.equal((await f.basic()).data.recent[0].error,'');
 const next=await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:390,sizes:['M'],audience:'unisex'});assert.equal(next.status,200,JSON.stringify(next.data));assert.equal(next.data.recipe.product,390);assert.equal((await f.basic()).data.outfitQueue.active,null);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_artwork WHERE id=?').get(f.artwork).n,1);assert.equal(f.manifest(),null,'switching never approves or publishes either garment');
});

test('primary-panel adaptation requires owner permission and preserves matching assignments',async t=>{
 const f=await fixture(t);const catalog=(await f.basic('/catalog')).data.products;assert.equal(catalog.some(p=>p.id===83),false,'unclassified nonclothing products are not advertised for production');assert.equal(catalog.find(p=>p.id===630).role,'accessories','live creator capabilities take priority over an incompatible saved category');const original=JSON.parse(f.db.prepare('SELECT parts FROM idea_sets WHERE id=?').get(f.set).parts);f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify({default:original.front}),f.set);
 assert.equal((await f.basic('/inspect',{setId:f.set,product:328})).status,409);const inspected=await f.basic('/inspect',{setId:f.set,product:328,adaptArtwork:true});assert.equal(inspected.status,200);assert.deepEqual(inspected.data.placements.map(p=>[p.area,p.part]),[['front','default']]);assert.deepEqual(inspected.data.fill,['back']);assert.match(inspected.data.warnings.join(' '),/with your primary-panel permission/);
});


test('Basic saves real previews with no price rules, but cannot create a supplier product or publish until pricing is verified',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true});f.db.prepare('DELETE FROM factory_pricing_rules').run();
 const item=await f.start();let held;for(let i=0;i<35;i++){const result=await f.step();if(result.data.status==='waiting_input'){held=result;break;}}
 assert.ok(held);assert.match(held.data.result.wait,/Save pricing rules/);const current=(await f.basic()).data.active;
 assert.equal(current.step,3);assert.equal(current.mockups.length,4);assert.equal(current.printFiles.length,4);assert.ok(current.printFiles.every(f=>f.effectiveDpi===null||f.effectiveDpi>=150));
 assert.equal(current.listing.supplier_id,null);assert.equal(current.canApprove,false);assert.equal(current.listing.approved,0);assert.equal(f.counts().creates,0);assert.equal(f.manifest(),null);
 assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,409,'visual previews never bypass prices or owner approval');
 assert.throws(()=>f.service.publishingEngine.prepared(item.job),/Pricing hold/);
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,200);assert.equal((await f.basic()).data.active,null);assert.equal(workingAssets(f.git).length,0);assert.equal(f.counts().deletes,0,'no supplier product exists to delete');
 assert.ok(f.db.prepare('SELECT length(data) bytes FROM factory_artwork WHERE id=?').get(f.artwork).bytes>0);
});

test('a legacy low-resolution Basic job can fit its original artwork and resume the same tracked job without lowering required DPI',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,largePanels:true}),item=await f.start();
 const saved=JSON.parse(f.db.prepare('SELECT plan FROM factory_render_plans WHERE job=?').get(item.job).plan);for(const p of Object.values(saved.placements))delete p.withoutEnlargement;
 f.db.prepare('UPDATE factory_render_plans SET plan=? WHERE job=?').run(JSON.stringify(saved),item.job);
 await f.step();await f.step();const fail=await f.step();assert.equal(fail.data.status,'waiting_input');assert.match(fail.data.result.wait,/resolution is too low/);
 assert.equal((await f.basic('/fit-artwork',{id:item.id})).status,200);
 for(let i=0;i<8;i++){const result=await f.step();if(result.data.status==='queued')break;}
 const current=(await f.basic()).data.active;assert.equal(current.job,item.job);assert.equal(current.printFiles.length,4);assert.ok(current.printFiles.every(f=>f.width===120&&f.height===80));assert.ok(current.printFiles.every(f=>f.effectiveDpi===null||f.effectiveDpi===150));
 assert.equal((await f.basic('/fit-artwork',{id:item.id})).status,409,'completed files cannot be changed under accepted tasks');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);assert.equal(f.counts().creates,0);
});

test('hoodie collection requests are persistent plans, reuse the existing hoodie and do not disturb an active product',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true,outfitProducts:true});
 const first=await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'});assert.equal(first.status,200,JSON.stringify(first.data));
 const source='pf:482797453',set=f.db.prepare('SELECT * FROM idea_sets WHERE id=?').get(f.set);
 f.db.prepare('INSERT INTO idea_sets(id,source,name,product,catalog,jacket,parts,updated) VALUES(?,?,?,?,?,?,?,?)').run(source,'printful','Even in darkness','Unisex cotton hoodie',1419,0,set.parts,set.updated);
 const b={setIds:[source],names:{[source]:'Even in darkness'},unresolved:[{key:'stag-ravens',name:'Stag and ravens'}]},plans=await f.basic('/outfits/plan-hoodie-collections',b);assert.equal(plans.status,200,JSON.stringify(plans.data));assert.equal(plans.data.created,2);assert.equal(plans.data.productionStarted,false);assert.equal(plans.data.plans.length,2);
 const saved=plans.data.plans.find(p=>p.reusedProducts.length);assert.equal(saved.name,'Even in darkness matching collection');assert.equal(saved.total,19);assert.equal(new Set(saved.pieces.map(p=>p.choice.product)).size,19);assert.equal(saved.reusedProducts[0].id,'482797453');assert.ok(saved.pieces.some(p=>p.choice.product===513&&p.choice.audience==='men'),'the requested shoe audience is retained while catalog unavailability still holds the slot');
 assert.ok(plans.data.plans.find(p=>!p.reusedProducts.length).error.includes('Source artwork'));
 assert.equal((await f.basic('/outfits/plan-hoodie-collections',b)).data.created,0);assert.equal((await f.basic()).data.active.id,first.data.id);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);assert.equal(f.counts().creates,0);assert.equal(f.counts().taskCreates,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM factory_outfit_items WHERE outfit=? AND job='' AND approved=1").get(saved.id).n,1);
 const missing=plans.data.plans.find(p=>!p.reusedProducts.length);assert.equal((await f.basic('/outfits/assign-plan-source',{id:missing.id,setId:f.set,sourceParts:{front:'missing'}})).status,400);const sourceParts=JSON.parse(set.parts);sourceParts.default=sourceParts.front;delete sourceParts.front;f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify(sourceParts),f.set);const attached=await f.basic('/outfits/assign-plan-source',{id:missing.id,setId:f.set,sourceParts:{front:'default'}});assert.equal(attached.status,200,JSON.stringify(attached.data));assert.ok(attached.data.plans.find(p=>p.id===missing.id).pieces.every(p=>p.choice.setId===f.set&&p.choice.sourceParts.front==='default'));assert.equal((await f.basic()).data.active.id,first.data.id);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);
});

test('collection slots permit 20 distinct products handled by one creator and preserve per-piece audiences',async t=>{
 const f=await fixture(t),{factoryBasicOutfits}=await import('./factory-basic-outfits.mjs');let captured,request;
 const api=factoryBasicOutfits({db:f.db,origin,auth(){},body:async()=>request,send:(_res,status,data)=>{captured={status,data};},fail:(status,message)=>{throw Object.assign(Error(message),{status});},limit(){},basic:{snapshot:()=>({blockers:[]}),checkpoint:async()=>{},inspect:async c=>({product:{id:c.product},role:'shirts',set:{name:'Test'},audience:c.audience}),verifyLayoutReceipt(){},inspectionSignature:c=>String(c.product.id),create:async()=>{throw Error('Native files deliberately not generated in this test.');}}});
 request={requestKey:randomUUID(),name:'Twenty matching pieces',setId:f.set,pieces:Array.from({length:20},(_,i)=>({product:1000+i,audience:i===1?'women':'men'}))};
 await api.handle({headers:{origin}},{},'/api/owner/ai-factory/basic/outfits/create','POST');assert.equal(captured.status,200);assert.equal(captured.data.total,20);assert.equal(captured.data.status,'held');assert.equal(captured.data.pieces[1].choice.audience,'women');assert.equal(new Set(captured.data.pieces.map(p=>p.role)).size,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
 const p=captured.data.pieces;f.db.prepare('INSERT INTO factory_outfit_items(id,outfit,role,template,job) VALUES(?,?,?,?,?)').run(p[0].id,captured.data.id,'shirts','','');f.db.prepare('INSERT INTO factory_outfit_items(id,outfit,role,template,job) VALUES(?,?,?,?,?)').run(p[1].id,captured.data.id,'shirts','','');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_outfit_items WHERE outfit=?').get(captured.data.id).n,2,'the database permits independent products sharing one worker');
});


test('an explicitly allowed unspecified supplier audience remains allowed in the real worker without inventing gender tags',async t=>{
 const f=await fixture(t,{unknownAudience:true});const b={requestKey:randomUUID(),setId:f.set,product:328,sizes:['M'],audience:'unisex'};assert.equal((await f.basic('/create',b)).status,409,'Unspecified products require explicit permission');
 const created=await f.basic('/create',{...b,allowUnspecifiedAudience:true});assert.equal(created.status,200,JSON.stringify(created.data));const item=created.data;const selection=JSON.parse(f.db.prepare('SELECT selection FROM factory_job_audiences WHERE job=?').get(item.job).selection);assert.equal(selection.allowUnspecifiedAudience,true);
 const visual=await f.preview(item);assert.equal(visual.canApprove,true);assert.deepEqual(visual.listing.copy.tags,['shirts']);assert.equal(f.counts().creates,1);assert.equal(f.counts().taskCreates,1);
});

function supplierBatch(f,item){
 const r=f.db.prepare('SELECT recipe FROM factory_basic_items WHERE id=?').get(item.id),recipe=JSON.parse(r.recipe);recipe.outfitId='supplier-test-plan';
 f.db.prepare('UPDATE factory_basic_items SET recipe=? WHERE id=?').run(JSON.stringify(recipe),item.id);
 f.db.prepare('INSERT INTO factory_basic_outfit_runs VALUES(?,?,?,?,?,?,?)').run('supplier-test-plan','supplier-test-plan-key','Supplier test','planned','','2026-10-19','2026-10-19');
 f.db.prepare('INSERT INTO factory_basic_outfit_pieces(id,outfit,ordinal,role,choice,signature,item,error,revision) VALUES(?,?,0,?,?,?,?,?,1)').run('supplier-test-piece','supplier-test-plan','shirts',JSON.stringify({product:328,setId:f.set}),'',item.id,'');
 f.db.prepare("INSERT INTO factory_basic_batches(id,request_key,plans,recipes,status,accept_missing_model,error,created,updated) VALUES(?,?,?,?,'paused',0,'',?,?)").run('supplier-test-batch','supplier-test-batch-key',JSON.stringify(['supplier-test-plan']),JSON.stringify([{product:328,layout:{number:5},sizes:[],audience:'unisex'}]),'2026-10-19','2026-10-19');
 f.db.prepare('INSERT INTO factory_basic_batch_items VALUES(?,?,?)').run('supplier-test-batch',item.id,item.recipe_key);
}
async function targetSupplier(f){
 assert.equal((await f.api('control',{action:'pause'})).status,200);
 const changed=await f.basic('/outfits/batch-control',{id:'supplier-test-batch',action:'resume',target:'printful',confirm:true});assert.equal(changed.status,200,JSON.stringify(changed.data));
 assert.equal((await f.basic('/control',{action:'resume'})).status,200);
}
async function readySupplier(f,item){
 for(let i=0;i<12;i++){const result=await f.step();if(result.data.status==='waiting_input'){assert.match(result.data.result.wait,/Pricing/);break;}}
 assert.equal(f.counts().taskCreates,0);
 assert.equal((await f.api('pricing/confirm-quotes',{job:item.job,extraCents:0,shippingCents:null,source:'Verified supplier included print charges',verified:true})).status,200);
 assert.equal((await f.basic('/resume',{id:item.id})).status,200);await f.step();
}
test('Printful-only batch verifies real supplier files and cleans working storage without mockups or storefront publication',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);
 assert.equal((await f.basic('/outfits/batch-control',{id:'supplier-test-batch',action:'resume',target:'printful'})).status,409);
 assert.equal((await f.basic()).data.active.productionTarget,'storefront');await targetSupplier(f);await readySupplier(f,item);await f.step();
 assert.equal(f.counts().creates,1);assert.equal((await f.basic()).data.active.listing.supplier_id,'501');assert.ok(workingAssets(f.git).length);
 f.supplierFiles('waiting');assert.equal((await f.step()).data.status,'retry_wait');assert.ok((await f.basic()).data.active.storage.printBytes>0);
 f.supplierFiles('ok',false,true);await f.step();const saved=(await f.basic()).data,done=saved.recent[0];assert.equal(saved.active,null);assert.equal(done.status,'supplier_created');assert.equal(done.cleanup.verified,true);assert.equal(done.cleanup.retainedSupplierProduct,'501');assert.equal(done.cleanup.supplierReceipt.variants.length,2);assert.equal(done.listing.store_id,null);assert.equal(f.manifest(),null);assert.equal(f.counts().taskCreates,0);assert.equal(f.counts().deletes,0);assert.equal(workingAssets(f.git).length,0);assert.ok(f.db.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.artwork).n>0);assert.equal(saved.outfitQueue.batch.printfulCreated,1);assert.equal(saved.outfitQueue.batch.published,0);
});
test('Printful-only recovers an accepted POST without duplicates and holds mismatched file references',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);await readySupplier(f,item);f.loseSupplierAck();assert.equal((await f.step()).data.status,'retry_wait');await f.step();assert.equal(f.counts().creates,1);
 f.supplierFiles('ok',true);const held=await f.step();assert.equal(held.data.status,'waiting_input');assert.match(held.data.result.wait,/reference differs/);assert.ok((await f.basic()).data.active.storage.printBytes>0);assert.equal(f.manifest(),null);f.supplierFiles('ok');await f.basic('/resume',{id:item.id});await f.step();assert.equal((await f.basic()).data.recent[0].status,'supplier_created');assert.equal(f.counts().creates,1);
});
test('Printful-only authorization is bound to the frozen batch recipe',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);assert.equal((await f.basic()).data.active.productionTarget,'printful');f.db.prepare("UPDATE factory_basic_batch_items SET recipe_key='different'").run();assert.equal((await f.basic()).data.active.productionTarget,'storefront');
});

test('Printful-only cleanup retries automatically after attachment deletion fails, retaining the supplier product',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);await readySupplier(f,item);await f.step();
 f.git.failDelete=true;const claim=await f.machine('claim');assert.equal(claim.data.job,item.job);const result=await f.machine('step',{job:item.job,lease:claim.data.lease});assert.notEqual(result.status,200);assert.equal((await f.basic()).data.active.status,'cleanup_failed');assert.equal(f.counts().creates,1);
 f.git.failDelete=false;await f.service.basic.tick();assert.equal((await f.basic()).data.active,null);assert.equal((await f.basic()).data.recent[0].status,'supplier_created');assert.equal(f.counts().deletes,0);assert.equal(f.counts().creates,1);
});

test('Printful-only cleanup waits for the supplier receipt checkpoint before deleting recoverable files',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);await readySupplier(f,item);await f.step();
 let release,entered=false;const gate=new Promise(r=>{release=r;}),checkpoint=f.service.basicGithub.checkpoint,snapshot=f.service.githubBackups.snapshot;
 f.service.basicGithub.checkpoint=async job=>{if(f.db.prepare('SELECT job FROM factory_supplier_receipts WHERE job=?').get(item.job)&&!entered){entered=true;await gate;}return checkpoint(job);};
 f.service.githubBackups.snapshot=()=>({...snapshot(),running:entered});
 const claim=await f.machine('claim'),step=f.machine('step',{job:item.job,lease:claim.data.lease});
 for(let i=0;i<100&&!entered;i++)await new Promise(r=>setTimeout(r,5));assert.equal(entered,true);
 await f.service.basic.tick();assert.ok(f.db.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n>0,'Pending durable receipt must retain all print pixels');assert.ok(workingAssets(f.git).length>0,'Pending receipt must retain its recovery attachments');
 f.service.githubBackups.snapshot=snapshot;release();assert.equal((await step).status,200);assert.equal((await f.basic()).data.active,null);assert.equal(f.counts().creates,1);assert.equal(f.counts().deletes,0);
});

test('a failed local supplier-intent checkpoint never claims a Printful submission occurred',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);await readySupplier(f,item);
 const checkpoint=f.service.basicGithub.checkpoint;let failed=false;
 f.service.basicGithub.checkpoint=async job=>{if(job&&!failed&&f.db.prepare("SELECT 1 FROM factory_publish_operations WHERE job=? AND operation='supplier' AND status='uncertain'").get(job)){failed=true;throw Object.assign(Error('Transient working-file download'),{status:503});}return checkpoint(job);};
 assert.equal((await f.step()).data.status,'retry_wait');assert.equal(f.counts().creates,0);assert.equal(f.db.prepare("SELECT 1 FROM factory_publish_operations WHERE job=? AND operation='supplier'").get(item.job),undefined);
 await f.step();assert.equal(f.counts().creates,1);
});
test('supplier reconciliation checks the live external ID before clearing a stale operation',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();supplierBatch(f,item);await targetSupplier(f);await readySupplier(f,item);
 f.db.prepare("UPDATE factory_jobs SET status='waiting_input' WHERE id=?").run(item.job);f.db.prepare("INSERT INTO factory_publish_operations VALUES(?,?,'uncertain',NULL,?)").run(item.job,'supplier',0);
 const r=await f.api('publishing/reconcile',{job:item.job,operation:'supplier',outcome:'check',verified:true});assert.equal(r.status,200);assert.equal(f.counts().creates,0);assert.equal(f.db.prepare("SELECT 1 FROM factory_publish_operations WHERE job=? AND operation='supplier'").get(item.job),undefined);
 await f.basic('/resume',{id:item.id});await f.step();assert.equal(f.counts().creates,1);
});
