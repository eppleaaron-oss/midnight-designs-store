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
async function fixture(t,{durable=true,models=true,githubWorkspace=false,managedPublisher=false,outfitProducts=false}={}){
 const git=githubWorkingFixture(),env={FACTORY_BACKUP_REPO:'owner/private-data',FACTORY_BACKUP_GITHUB_TOKEN:'private-fixture-token'},photos=new Map();
 const png=await sharp({create:{width:30,height:24,channels:4,background:'#a73434'}}).png().toBuffer();let clock=Date.now(),manifest=null,live=false,creates=0,taskCreates=0,deletes=0,removed=false;
 const variants=[{id:3280,size:'S',color:'White',price:'15.00',in_stock:true},{id:3281,size:'M',color:'White',price:'16.00',in_stock:true}],product={id:328,title:'All-Over Print Unisex T-Shirt',type_name:'T-Shirt',type:'CUT-SEW',currency:'USD'};
 const jacket={id:390,title:'All-Over Print Unisex Bomber Jacket',type_name:'Jacket',type:'CUT-SEW',currency:'USD'},jacketVariants=variants.map(v=>({...v,id:v.id+620})),supplierProducts=new Map(),removedProducts=new Set();
 let supplierPayload;
 const fetchImpl=async(url,o={})=>{
  url=String(url);
  if(url.startsWith('https://api.github.com/repos/owner/private-data')||url.startsWith('https://uploads.github.com/repos/owner/private-data'))return git.fetch(url,o);
  if(url==='https://api.github.com/repos/eppleaaron-oss/midnight-designs-store')return new Response(JSON.stringify({id:1393932711,permissions:{push:true}}));
  if(url.includes('/contents/images/factory/')){const path=new URL(url).pathname;if(o.method==='PUT'){const b=JSON.parse(o.body),data=Buffer.from(b.content,'base64'),sha=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');photos.set(path,{sha,data});return new Response(JSON.stringify({content:{sha}}));}const saved=photos.get(path);return saved?new Response(JSON.stringify({sha:saved.sha,size:saved.data.length})):new Response('{}',{status:404});}
  if(url==='https://api.printful.com/products')return response([...(outfitProducts?[product,jacket]:[product]),{id:83,title:'All-Over Print Basic Pillow',type_name:'Pillow'},{id:630,title:'All-Over Print Unisex Bandana',type_name:'Bandana'}]);
  if(url==='https://api.printful.com/products/328')return response({product,variants});
  if(outfitProducts&&url==='https://api.printful.com/products/390')return response({product:jacket,variants:jacketVariants});
  if(url.includes('/v2/catalog-products/'))return new Response(JSON.stringify({data:{type:'CUT-SEW',techniques:[{key:'cut-sew',is_default:true}]}}));
  if(url.includes('/mockup-generator/printfiles/'))return response({available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:12,height:8,dpi:150}],variant_printfiles:(url.includes('/390')?jacketVariants:variants).map(v=>({variant_id:v.id,placements:{front:1,back:1}})),option_groups:models?["Men's","Women's",'Flat']:['Flat']});
  if(url.includes('/mockup-generator/templates/'))return response({templates:[],variant_mapping:[]});
  if(url.includes('/store/products/@')){const external=decodeURIComponent(url.split('/@')[1]),found=[...supplierProducts].find(([id,p])=>p.sync_product.external_id===external&&!removedProducts.has(id));return found?response({sync_product:{id:found[0],external_id:external}}):new Response('{}',{status:404});}
  if(url==='https://api.printful.com/store/products'&&o.method==='POST'){supplierPayload=JSON.parse(o.body);creates++;const id=500+creates;supplierProducts.set(id,supplierPayload);return response({id});}
  if(/^https:\/\/api.printful.com\/store\/products\/\d+$/.test(url)){
   const id=Number(url.split('/').at(-1)),payload=supplierProducts.get(id);if(!payload)return new Response('{}',{status:404});
   if(o.method==='DELETE'){deletes++;removed=true;removedProducts.add(id);return response({});}
   if(removedProducts.has(id))return new Response('{}',{status:404});
   return response({sync_product:{id,external_id:payload.sync_product.external_id},sync_variants:payload.sync_variants.map((v,i)=>({id:601+i,variant_id:v.variant_id,synced:true,is_ignored:false,availability_status:'active',currency:'USD',size:[...variants,...jacketVariants].find(x=>x.id===v.variant_id).size,color:'White',retail_price:v.retail_price,files:v.files.map(f=>({...f,status:'ok'}))}))});
  }
  if(o.method==='HEAD'&&url.includes('/factory-print-file/')){const key=new URL(url).pathname.split('/').at(-1),row=service.db.prepare('SELECT f.sha256 FROM factory_file_links l JOIN factory_print_files f ON f.id=l.file WHERE l.hash=?').get(createHash('sha256').update(key).digest('hex'));return new Response(null,{headers:{'Content-Type':'image/png','X-Midnight-Print-Sha256':row?.sha256||''}});}
  if(url.includes('/mockup-generator/create-task/')){const b=JSON.parse(o.body);if(models)assert.deepEqual(b.option_groups,["Men's","Women's"]);else assert.equal(b.option_groups,undefined);taskCreates++;return response({task_key:'basic-'+b.variant_ids[0],status:'pending'});}
  if(url.includes('/mockup-generator/task?')){const id=Number(new URL(url).searchParams.get('task_key').split('-')[1]);return response({status:'completed',mockups:[{variant_ids:[id],placement:'front',mockup_url:'https://files.cdn.printful.com/basic-'+id+'.png',extra:[{title:'Back',option_group:models?"Men's":'Flat',url:'https://files.cdn.printful.com/basic-back-'+id+'.png'}]}]});}
  if(url.startsWith('https://files.cdn.printful.com/basic-'))return new Response(png,{headers:{'Content-Type':'image/png'}});
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
 const basic=(path='',b)=>call('/api/owner/ai-factory/basic'+path,b),api=(path,b)=>call('/api/owner/ai-factory/'+path,b),machine=(path,b={})=>call('/internal/factory/'+path,{worker:'basic-worker',...b},true);
 if(githubWorkspace){await service.githubBackups.save(true);if(managedPublisher){await service.basicGithub.connectPublisher('workflow-fixture-token-'.repeat(2),'1001',clock+300000);service.basicGithub.disconnectPublisher('1001');}else await service.basicGithub.enable();}else await api('budget',{dailyBudget:1000,totalBudget:2000});await api('pricing/rule',{category:'shirts',rule});if(outfitProducts)await api('pricing/rule',{category:'jackets',rule});await machine('heartbeat');
 const upload=await api('artwork/upload',{name:'Raven front',collection:'Raven test set',scope:'collection',target:'',product:null,placements:['front'],instructions:'Keep the original artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'front.png',base64:png.toString('base64')}]});assert.equal(upload.status,200);const artwork=upload.data.artworks[0].id;
 const set='basic:test';db.prepare('INSERT INTO idea_sets(id,source,name,parts,updated,jacket) VALUES(?,?,?,?,?,0)').run(set,'printful','Raven test set',JSON.stringify({front:{artwork,name:'Raven front',url:'/api/owner/ai-factory/artwork/'+artwork+'/file'}}),new Date().toISOString());
 async function step(){clock+=31000;await machine('heartbeat');const c=await machine('claim');assert.ok(c.data.job,JSON.stringify(c.data));const result=await machine('step',{job:c.data.job,lease:c.data.lease});assert.equal(result.status,200,JSON.stringify(result));return result;}
 async function start(){const c=await basic('/create',{requestKey:randomUUID(),setId:set,product:328,sizes:['S','M'],audience:'unisex'});assert.equal(c.status,200,JSON.stringify(c.data));return c.data;}
 async function preview(item){for(let i=0;i<2;i++)assert.equal((await step()).data.status,'queued');for(let i=0;i<20;i++){const saved=await step();if(saved.data.status==='queued')break;assert.equal(saved.data.status,'retry_wait');}const held=await step();assert.equal(held.data.status,'waiting_input');assert.match(held.data.result.wait,/Pricing/);assert.equal((await api('pricing/confirm-quotes',{job:item.job,extraCents:0,shippingCents:null,source:'Verified supplier included print charges',verified:true})).status,200);await basic('/resume',{id:item.id});assert.equal((await step()).data.status,'queued','Basic prepares mockups before final publication approval');assert.equal((await step()).data.status,'queued');for(let i=0;i<12;i++){const result=await step();if(result.data.status==='waiting_input')break;}const current=(await basic()).data.active;assert.equal(current.canApprove,true,JSON.stringify(current));return current;}
 return {service,db,git,photos,store,fetchImpl,backupConfig:githubBackupConfig(env,passwordHash),call,basic,api,machine,step,start,preview,set,artwork,png,url,live:()=>{live=true;},publisher:()=>service.basicGithub.connectPublisher('workflow-fixture-token-'.repeat(2),'1002',clock+300000),counts:()=>({creates,taskCreates,deletes}),manifest:()=>manifest};
}

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
 const item=await f.start(),preview=await f.preview(item);assert.equal(preview.mockups.length,4);assert.ok(f.git.assets.size>0);assert.ok(f.git.releases.size>0);assert.equal(f.photos.size,0,'unapproved photos never enter the public repository');
 const dir=await mkdtemp(join(tmpdir(),'midnight-basic-github-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'restore.sqlite');await new GithubSnapshotStore(f.backupConfig,{fetchImpl:f.git.fetch,sleep:async()=>{}}).restore(path);const restored=new DatabaseSync(path);t.after(()=>restored.close());restored.function('factory_history_actor',()=>'{"type":"system","name":"Recovery test"}');
 assert.equal(restored.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n,0,'working print bytes are absent from versioned Git snapshots');assert.equal(restored.prepare('SELECT sum(length(data)) n FROM factory_mockups').get().n,0);assert.ok(restored.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.artwork).n>0,'original is retained');
 const remote=factoryBasicGithub({db:restored,backups:{connection:()=>f.backupConfig,snapshot:()=>({initialized:true}),checkpoint:async()=>{}},env:{FACTORY_BACKUP_GITHUB_TOKEN:'private-fixture-token'},fetchImpl:f.fetchImpl,sleep:async()=>{}});let result;do{result=await remote.hydrate(item.job);}while(result?.defer);assert.ok(restored.prepare('SELECT sum(length(data)) n FROM factory_print_files').get().n>0);assert.deepEqual(restored.prepare('SELECT task_key FROM factory_mockup_tasks ORDER BY variant').all(),f.db.prepare('SELECT task_key FROM factory_mockup_tasks ORDER BY variant').all());
 assert.equal((await f.basic('/approve',{id:item.id,confirm:true})).status,200);assert.equal((await f.step()).data.status,'retry_wait');assert.ok(f.photos.size>0);assert.ok(f.git.assets.size>0,'working files stay until the store actually verifies');f.live();assert.equal((await f.step()).data.status,'completed');
 const done=(await f.basic()).data;assert.equal(done.active,null);assert.equal(done.recent[0].cleanup.github.verified,true);assert.ok(done.recent[0].cleanup.github.releasedRemoteBytes>0);assert.equal(f.git.assets.size,0);assert.equal(f.git.releases.size,0);assert.equal(f.db.prepare('SELECT sum(length(data)) n FROM factory_mockups WHERE job=?').get(item.job).n,0);assert.ok(f.photos.size>0);assert.ok(f.manifest().products['501'].images.every(u=>u.startsWith('https://midnight-designs.store/images/factory/501/')));assert.equal(f.counts().creates,1);assert.equal(f.counts().taskCreates,2);
 const image=preview.mockups[0],redirect=await fetch(f.url+image.url,{redirect:'manual'});assert.equal(redirect.status,302);assert.ok(redirect.headers.get('location').startsWith('https://midnight-designs.store/images/factory/'));
});

test('GitHub rejection preserves originals and holds the next item until remote deletion really succeeds',async t=>{
 const f=await fixture(t,{durable:false,githubWorkspace:true}),item=await f.start();await f.preview(item);f.git.failDelete=true;
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,503);assert.equal((await f.basic()).data.active.status,'cleanup_failed');assert.ok(f.git.assets.size>0);assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'})).status,409);assert.equal(f.photos.size,0);
 f.git.failDelete=false;assert.equal((await f.basic('/resume',{id:item.id})).status,200);const d=(await f.basic()).data;assert.equal(d.active,null);assert.equal(d.recent[0].decision,'disapproved');assert.equal(d.recent[0].cleanup.github.verified,true);assert.equal(f.git.assets.size,0);assert.ok(f.db.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.artwork).n>0);assert.equal(f.counts().deletes,1);
});

test('Disapproval deletes only its owned unpublished supplier draft, originals survive, and failed cleanup keeps the next item locked',async t=>{
 const f=await fixture(t),item=await f.start();await f.preview(item);
 const profile=f.db.prepare('SELECT templates FROM factory_job_profiles WHERE job=?').get(item.job),other=randomUUID();f.db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(other,'Another product references this set',profile.templates);
 assert.equal((await f.basic('/disapprove',{id:item.id,confirm:true})).status,409);let state=(await f.basic()).data;assert.equal(state.active.status,'cleanup_failed');assert.equal(state.active.closed,0);assert.equal((await f.basic('/create',{requestKey:randomUUID(),setId:f.set,product:328,audience:'unisex'})).status,409);
 f.db.prepare('DELETE FROM factory_job_profiles WHERE job=?').run(other);assert.equal((await f.basic('/resume',{id:item.id})).status,200);state=(await f.basic()).data;assert.equal(state.active,null);assert.equal(state.rejectionCleanupVerified,true);assert.equal(state.recent[0].storage.mockupBytes,0);assert.equal(state.recent[0].storage.workingBytes,0);assert.equal(f.counts().deletes,1,'retrying cleanup never creates or deletes another product');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_artwork WHERE id=?').get(f.artwork).n,1);
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
 const item=await f.start();await f.preview(item);await f.basic('/approve',{id:item.id,confirm:true});const waiting=await f.step();assert.equal(waiting.data.status,'retry_wait');assert.match(waiting.data.result.note,/GitHub publishing connection/);assert.equal(f.manifest(),null);
 await f.publisher();assert.equal((await f.step()).data.status,'retry_wait');assert.ok(f.manifest());f.live();await f.publisher();assert.equal((await f.step()).data.status,'completed');assert.equal((await f.basic()).data.active,null);assert.equal(f.git.assets.size,0);
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
 await f.basic('/approve',{id:first.id,confirm:true});await f.step();f.live();assert.equal((await f.step()).data.status,'completed');assert.equal(f.git.assets.size,0);
 await f.service.basicOutfits.tick();const second=(await f.basic()).data.active;assert.ok(second);assert.notEqual(second.id,first.id);assert.equal(second.recipe.product,390);
 f.db.prepare('UPDATE factory_basic_outfit_pieces SET item=NULL WHERE item=?').run(second.id);await f.service.basicOutfits.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,2,'lost queue pointer reconciles without a duplicate job');
 await f.preview(second);await f.basic('/approve',{id:second.id,confirm:true});for(let i=0;i<4;i++){if((await f.step()).data.status==='completed')break;}
 await f.service.basicOutfits.tick();const done=(await f.basic()).data;assert.equal(done.active,null);assert.equal(done.outfitQueue.active,null);assert.equal(done.outfitQueue.recent[0].status,'complete');assert.equal(done.outfitQueue.recent[0].published,2);assert.equal(f.git.assets.size,0);assert.equal(f.git.releases.size,0);assert.equal(f.counts().creates,2);
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

test('primary-panel adaptation requires owner permission and preserves matching assignments',async t=>{
 const f=await fixture(t);const catalog=(await f.basic('/catalog')).data.products;assert.equal(catalog.some(p=>p.id===83),false,'unclassified nonclothing products are not advertised for production');assert.equal(catalog.find(p=>p.id===630).role,'accessories','live creator capabilities take priority over an incompatible saved category');const original=JSON.parse(f.db.prepare('SELECT parts FROM idea_sets WHERE id=?').get(f.set).parts);f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify({default:original.front}),f.set);
 assert.equal((await f.basic('/inspect',{setId:f.set,product:328})).status,409);const inspected=await f.basic('/inspect',{setId:f.set,product:328,adaptArtwork:true});assert.equal(inspected.status,200);assert.deepEqual(inspected.data.placements.map(p=>[p.area,p.part]),[['front','default']]);assert.deepEqual(inspected.data.fill,['back']);assert.match(inspected.data.warnings.join(' '),/with your primary-panel permission/);
});
