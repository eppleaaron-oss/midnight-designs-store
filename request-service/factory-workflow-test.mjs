import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {scryptSync,randomUUID,createHash} from 'node:crypto';
import {createService} from './server.mjs';
import {factoryArtworkEngine} from './factory-artwork-engine.mjs';
import {renderArea,factoryRendering} from './factory-rendering.mjs';
import {printFileLimits} from './factory-storage.mjs';
import {factoryWorkflow} from './factory-workflow.mjs';

const permissions={reuse:true,modify:true,crop:true,recolor:true};
const origin='http://localhost:3000',password='workflow-test-password',salt='bd'.repeat(16),workerToken='workflow-worker-'.repeat(4);
const response=result=>new Response(JSON.stringify({result}),{headers:{'Content-Type':'application/json'}});
const fixture=async()=>sharp({create:{width:24,height:12,channels:4,background:'#ff0000'}}).png().toBuffer();
const rule={absorbShipping:false,rounding:'99',paymentFeeBps:290,platformFeeBps:0,marginBps:3000,discountBps:0,paymentFixedCents:30,platformFixedCents:0,minimumProfitCents:1000,minimumPriceCents:0,maximumPriceCents:10000};

async function client(service){
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,b,machine=false){const r=await fetch(root+path,{method:b?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(machine?{Authorization:'Bearer '+workerToken}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 cookie=(await call('/api/owner/login',{password})).cookie;
 return {root,call,cookie,close:()=>new Promise(resolve=>service.server.close(resolve))};
}

test('one 14-piece outfit uses native files, real mockup downloads, review pricing and live storefront verification',async()=>{
 const ids=Array.from({length:14},(_,i)=>328+i),png=await fixture();let clock=Date.now(),manifest,live=false,brokenImages=false,creates=0,taskCreates=0,dispatches=0,failMockup=true;
 const created=new Map();
 const products=ids.map(id=>({id,title:'All-Over Print Unisex T-Shirt '+id,type_name:'T-Shirt',type:'CUT-SEW',currency:'USD'}));
 const variants=id=>[{id:id*10,size:'S',color:'White',price:'15.00',in_stock:true},{id:id*10+1,size:'M',color:'White',price:'16.00',in_stock:true}];
 const files=id=>({available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:12,height:8,dpi:150}],variant_printfiles:variants(id).map(v=>({variant_id:v.id,placements:{front:1,back:1}}))});
 const fetchImpl=async(url,o={})=>{
  url=String(url);if(o.method==='HEAD'&&url.includes('/factory-print-file/')){const key=new URL(url).pathname.split('/').at(-1),row=service.db.prepare('SELECT f.sha256 FROM factory_file_links l JOIN factory_print_files f ON f.id=l.file WHERE l.hash=?').get(createHash('sha256').update(key).digest('hex'));return new Response(null,{headers:{'Content-Type':'image/png','X-Midnight-Print-Sha256':row?.sha256||''}});}
  if(url==='https://api.printful.com/products')return response(products);
  let m=/\/products\/(\d+)$/.exec(url);if(m&&url.includes('api.printful.com')&&!url.includes('/store/'))return response({product:products.find(p=>p.id===Number(m[1])),variants:variants(Number(m[1]))});
  if(url.includes('/v2/catalog-products/'))return new Response(JSON.stringify({data:{type:'CUT-SEW',techniques:[{key:'cut-sew',is_default:true}]}}));
  m=/printfiles\/(\d+)/.exec(url);if(m){assert.equal(new URL(url).searchParams.get('technique'),'CUT-SEW');return response(files(Number(m[1])));}
  if(url.includes('/mockup-generator/templates/'))return response({templates:[],variant_mapping:[]});
  if(url.includes('/store/products/@')){const external=decodeURIComponent(url.split('@')[1]),entry=[...created].find(([,b])=>b.sync_product.external_id===external);return entry?response({sync_product:{id:entry[0]}}):new Response('{}',{status:404});}
  if(url==='https://api.printful.com/store/products'&&o.method==='POST'){assert.equal(o.headers['X-PF-Store-Id'],undefined,'single-store token does not require an account-wide store header');const b=JSON.parse(o.body);created.set(501+creates,b);creates++;return response({id:500+creates});}
  m=/\/store\/products\/(\d+)$/.exec(url);if(m){const b=created.get(Number(m[1]));return response({sync_product:{id:Number(m[1])},sync_variants:b.sync_variants.map((v,i)=>({id:601+i,variant_id:v.variant_id,synced:true,is_ignored:false,availability_status:'active',currency:'USD',size:i?'M':'S',color:'White',retail_price:v.retail_price,files:v.files.map(f=>({...f,status:'ok'}))}))});}
  if(url.includes('/mockup-generator/create-task/')){taskCreates++;const b=JSON.parse(o.body);assert.ok(b.files.every(f=>f.image_url.includes('/factory-print-file/')));assert.ok(b.files.every(f=>f.position.width===12&&f.position.height===8));return response({task_key:'task-'+b.variant_ids[0],status:'pending'});}
  if(url.includes('/mockup-generator/task?')){const id=Number(new URL(url).searchParams.get('task_key').split('-')[1]);return response({status:'completed',mockups:[{variant_ids:[id],placement:'front',mockup_url:'https://printful-upload.s3-accelerate.amazonaws.com/tmp/mockup-'+id+'.png',extra:[{title:'Back',option_group:'Flat',url:'https://printful-upload.s3-accelerate.amazonaws.com/tmp/mockup-back-'+id+'.png'}]}]});}
  if(url.startsWith('https://printful-upload.s3-accelerate.amazonaws.com/tmp/mockup-back-')&&failMockup){failMockup=false;return new Response('temporary supplier error',{status:503});}
  if(url==='https://files.cdn.printful.com/original.png')return new Response(png,{headers:{'Content-Type':'image/png'}});
  if(url.startsWith('https://printful-upload.s3-accelerate.amazonaws.com/tmp/mockup-'))return new Response(png,{headers:{'Content-Type':'image/png'}});
  if(url.includes('/contents/factory-listings.json')){if(o.method==='PUT'){manifest=JSON.parse(Buffer.from(JSON.parse(o.body).content,'base64').toString());return new Response('{}');}return manifest?new Response(JSON.stringify({sha:'manifest-test',content:Buffer.from(JSON.stringify(manifest)).toString('base64')})):new Response('{}',{status:404});}
  if(url.includes('/dispatches')){dispatches++;return new Response(null,{status:204});}
  if(url.startsWith('https://midnight-designs.store/products.json')){const products=live?Object.values(manifest?.products||{}).map(p=>brokenImages?{...p,images:[]}:p):[];return new Response(JSON.stringify({products}));}
  throw Error('Unexpected workflow request: '+url);
 };
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),productionSettings:{storageDurable:true,workerToken,clock:()=>clock},workflowSettings:{storageDurable:true,fetchImpl},factorySettings:{token:'supplier-test',fetchImpl},blueprintSettings:{token:'supplier-test',plans:{products:{}},fetchImpl},publishingSettings:{token:' supplier-test ',storeId:undefined,githubToken:'repository-test',storageDurable:true,fetchImpl,clock:()=>clock},ideaSettings:{env:{PRINTFUL_TOKEN:'supplier-test'},catalog:[],fetchImpl}});
 const c=await client(service),base='/api/owner/ai-factory/';
 const machine=(op,b={})=>c.call('/internal/factory/'+op,{worker:'workflow-worker',...b},true);
 try{
  await c.call(base+'budget',{dailyBudget:1000,totalBudget:1000});
  const uploaded=await c.call(base+'artwork/upload',{name:'Outfit art',collection:'Night',scope:'collection',target:'',product:null,placements:['front'],instructions:'Keep red on black.',permissions,files:[{filename:'art.png',base64:png.toString('base64')}]});assert.equal(uploaded.status,200);const art=uploaded.data.artworks[0].id;
  const idea=randomUUID(),set='up:test',pieces=ids.map(id=>({catalog:id,role:'shirts',label:'T-Shirt '+id,color:'Black',placements:[{area:'front',artwork:art,part:'front',name:'Outfit art',url:base+'artwork/'+art+'/file'}],empty:['back'],ready:true}));
  service.db.prepare('INSERT INTO idea_sets(id,source,name,parts,updated,jacket) VALUES(?,?,?,?,?,0)').run(set,'upload','Night',JSON.stringify({front:{artwork:art}}),new Date().toISOString());
  service.db.prepare('INSERT INTO idea_set_ideas(id,signature,set_id,kind,title,pieces,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(idea,'test-14',set,'outfit','Night outfit',JSON.stringify(pieces),'Test original artwork','new',new Date().toISOString(),new Date().toISOString());
  assert.equal((await c.call(base+'ideas/publish',{ids:[idea],wait:true,activateCreators:true})).status,200);
  assert.equal(service.db.prepare("SELECT enabled FROM factory_employees WHERE id='shirts'").get().enabled,1,'master preparation activates the selected creator roles');
  const jobs=service.db.prepare('SELECT * FROM factory_jobs ORDER BY rowid').all();assert.equal(jobs.length,14,'every outfit piece becomes its own tracked product job');assert.equal(creates,0,'queuing alone creates no supplier listings');
  const batch=service.db.prepare('SELECT jobs,status FROM idea_set_ideas WHERE id=?').get(idea);assert.equal(JSON.parse(batch.jobs).filter(Boolean).length,14);assert.equal(batch.status,'made');
  // Retry a partially accepted batch: all stable job IDs are recovered.
  service.db.prepare("UPDATE idea_set_ideas SET status='failed' WHERE id=?").run(idea);await c.call(base+'ideas/publish',{ids:[idea],wait:true,activateCreators:true});assert.equal(service.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,14);
  const job=jobs[0].id;await c.call(base+'production/job',{id:job,action:'priority',priority:9});await machine('heartbeat');assert.equal((await c.call(base+'control',{action:'start'})).status,200);
  async function step(){const lease=(await machine('claim')).data;assert.equal(lease.job,job,lease.reason);return (await machine('step',{job,lease:lease.lease})).data;}
  for(const stage of ['validate','supplier','files']){const r=await step();assert.equal(r.status,'queued',JSON.stringify(r));assert.ok(service.db.prepare('SELECT result FROM factory_job_checkpoints WHERE job=? AND step=?').get(job,stage));}
  const drafts=JSON.parse(service.db.prepare('SELECT templates FROM factory_job_profiles WHERE job=?').get(job).templates);const file=service.db.prepare("SELECT data FROM factory_print_files WHERE draft=? AND placement='back'").get(drafts[0]);
  const raw=await sharp(Buffer.from(file.data)).ensureAlpha().raw().toBuffer();assert.deepEqual([...raw.subarray(0,4)],[0,0,0,255],'base color is actual printable black pixels');assert.equal(drafts.length,2,'every selected size has its own native file set');
  const held=await step();assert.equal(held.status,'waiting_input');assert.match(held.result.wait,/Pricing hold/);assert.equal(creates,0);
  await c.call(base+'pricing/rule',{category:'shirts',rule});assert.equal((await c.call(base+'pricing/confirm-quotes',{job,extraCents:0,shippingCents:null,source:'Owner verified AOP included print charges',verified:true,remember:true})).status,200);
  await c.call(base+'production/job',{id:job,action:'resume'});assert.equal((await step()).status,'awaiting_review');assert.equal(creates,0,'review mode requires owner approval');
  assert.equal((await c.call(base+'publishing/approve',{job,confirm:true})).status,200);assert.equal((await step()).status,'queued');assert.equal(creates,1);const payload=created.get(501);assert.equal(payload.sync_variants.length,2);assert.ok(payload.sync_variants.every(v=>[3280,3281].includes(v.variant_id)),'AOP uses the supplier blank IDs while printing black panels');
  assert.ok(payload.sync_variants.every(v=>v.files.every(f=>f.url.includes('/factory-print-file/'))));
  assert.equal((await step()).status,'retry_wait');clock+=31000;assert.equal((await step()).status,'retry_wait');assert.equal(service.db.prepare('SELECT count(*) n FROM factory_mockups WHERE job=?').get(job).n,0,'a partial mockup download is not mistaken for a complete saved variant');assert.equal(service.db.prepare('SELECT count(*) n FROM factory_mockup_downloads WHERE job=?').get(job).n,1,'a valid download survives a temporary failure without making an incomplete product');clock+=31000;
  for(let i=0;i<2;i++){const result=await step();if(result.status==='retry_wait')clock+=31000;else assert.equal(result.status,'queued');}
  assert.equal(taskCreates,2);assert.equal(service.db.prepare('SELECT count(*) n FROM factory_mockups WHERE job=?').get(job).n,4);
  assert.equal((await step()).status,'waiting_input');assert.equal(dispatches,0,'a finished outfit piece stays private until final owner approval');assert.equal((await c.call(base+'publishing/approve',{job,confirm:true})).status,200);assert.equal((await step()).status,'retry_wait');assert.equal(dispatches,1);assert.ok(Object.values(manifest.products)[0].variants.every(v=>v.color==='Black'&&v.supplierBaseColor==='White'),'store shows the printed background, preserving supplier blank metadata');clock+=31000;
  const image=Object.values(manifest.products)[0].image;assert.equal((await fetch(c.root+new URL(image).pathname)).status,200,'public listing image is backed by saved supplier bytes');
  live=true;brokenImages=true;assert.equal((await step()).status,'retry_wait','missing storefront images prevent false publication');clock+=31000;brokenImages=false;
  assert.equal((await step()).status,'completed');assert.equal(dispatches,1,'polling does not dispatch duplicate catalog jobs');assert.equal(creates,1);
  const shown=(await c.call(base+'ideas')).data.made.find(m=>m.printfulId==='501');assert.equal(shown.status,'published');assert.ok(shown.thumb.startsWith('/api/owner/ai-factory/publishing/mockup/'));assert.equal(shown.mockupStatus.saved,4);assert.equal(shown.mockupStatus.generating,false);assert.ok(shown.mockupStatus.tasks.every(t=>t.task_key&&t.state==='saved'));assert.ok(Object.values(manifest.products)[0].variants.every(v=>v.images.length===2),'store variants retain their own actual saved mockups');
  assert.equal((await fetch(c.root+shown.thumb)).status,401,'private preview requires master authentication');assert.equal(Object.values(manifest.products)[0].outfitId,idea);
  // A shared supplier URL must not mix collection ownership or bypass revoked rights.
  const remoteIdea=name=>{const id=randomUUID(),set='pf:'+name,piece={...pieces[0],catalog:329,placements:[{area:'front',name:'Shared original',part:'front',url:'https://files.cdn.printful.com/original.png'}]};service.db.prepare('INSERT INTO idea_sets(id,source,name,parts,updated,jacket) VALUES(?,?,?,?,?,0)').run(set,'printful',name,'{}',new Date().toISOString());service.db.prepare('INSERT INTO idea_set_ideas(id,signature,set_id,kind,title,pieces,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,set,'product',name,JSON.stringify([piece]),'Imported supplier original','new',new Date().toISOString(),new Date().toISOString());return id;};
  const alpha=remoteIdea('Alpha'),beta=remoteIdea('Beta');await c.call(base+'ideas/publish',{ids:[alpha,beta],wait:true,activateCreators:true});const imported=service.db.prepare("SELECT id,collection FROM factory_artwork WHERE collection IN ('Alpha','Beta')").all();assert.equal(imported.length,2);assert.notEqual(imported[0].id,imported[1].id);assert.ok([alpha,beta].every(id=>service.db.prepare('SELECT status FROM idea_set_ideas WHERE id=?').get(id).status==='made'));
  const original=imported.find(a=>a.collection==='Alpha');service.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({reuse:false,crop:false,modify:false,recolor:false}),original.id);service.db.prepare("UPDATE idea_set_ideas SET status='failed',jobs='[]' WHERE id=?").run(alpha);service.db.prepare('DELETE FROM idea_made WHERE idea=?').run(alpha);await c.call(base+'ideas/publish',{ids:[alpha],wait:true,activateCreators:true});assert.match(service.db.prepare('SELECT error FROM idea_set_ideas WHERE id=?').get(alpha).error,/Enable Reuse/);assert.equal(service.db.prepare("SELECT count(*) n FROM factory_artwork WHERE collection='Alpha'").get().n,1,'reimporting does not reset revoked artwork permissions');
 }finally{await c.close();}
});

test('AI layout calls the configured Responses adapter, records usage, guards recipes and caches across restarts',async()=>{
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex')});const c=await client(service),base='/api/owner/ai-factory/';let calls=0,uncertain=false;
 try{
  const png=await fixture();const uploaded=await c.call(base+'artwork/upload',{name:'AI art',collection:'Night',scope:'collection',target:'',product:null,placements:['front'],instructions:'Move slightly right.',permissions,files:[{filename:'art.png',base64:png.toString('base64')}]});const art=uploaded.data.artworks[0].id,job=randomUUID(),draft=randomUUID(),date=new Date().toISOString();
  service.db.prepare('INSERT INTO factory_jobs(id,title,kind,employee,gender,brief,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(job,'AI tee','product','shirts','unisex','Use artwork on front','queued',date,date);
  service.db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(job,'Coordinate artwork',JSON.stringify([draft]));service.db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(draft,'AI tee',328,10,'default',JSON.stringify([{placement:'front',width:12,height:8,dpi:150}]),'live',date);
  service.db.prepare("UPDATE factory_settings SET state='running',daily_budget=1000,total_budget=1000").run();
  const env={OPENAI_API_KEY:'test-private-key',FACTORY_AI_MODEL:'configured-vision-model',FACTORY_AI_INPUT_CENTS_PER_MILLION:'10',FACTORY_AI_OUTPUT_CENTS_PER_MILLION:'100',FACTORY_AI_MAX_JOB_CENTS:'100'};
  const fetchImpl=async(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(o.body);assert.equal(b.store,false);assert.equal(b.text.format.strict,true);assert.ok(b.input[0].content.some(x=>x.type==='input_image'&&x.image_url.startsWith('data:image/png;base64,')));if(uncertain)throw Error('Connection lost');return new Response(JSON.stringify({id:'response-1',status:'completed',usage:{input_tokens:200,output_tokens:50},output:[{content:[{type:'output_text',text:JSON.stringify({artworkAnalysis:[{artworkId:art,subject:'Red graphic',background:'Opaque red',palette:['#ff0000'],confidence:0.9}],placements:[{area:'front',artworkId:art,fit:'contain',scale:50,x:25,y:0,rotation:0,mirror:false,tile:false,spacing:0,recolor:'#0000ff'}]})}]}]}));};
  const engine=factoryArtworkEngine({db:service.db,env,fetchImpl}),plan={colorMode:'print',background:'Black',aiLayout:true,placements:{front:{artworkId:art,fit:'contain',protect:false}}},selection={artworkIds:[art]};
  const result=await engine.plan(job,plan,[draft],selection);assert.equal(result.placements.front.x,25);assert.match(service.db.prepare('SELECT analysis FROM factory_ai_artwork_analysis WHERE job=? AND artwork=?').get(job,art).analysis,/Red graphic/);assert.equal(calls,1);assert.equal(service.db.prepare('SELECT count(*) n FROM factory_usage').get().n,1);
  const edited=await renderArea({width:12,height:8,dpi:150},png,{...result.placements.front,background:'Black'},permissions);const raw=await sharp(edited.data).ensureAlpha().raw().toBuffer();assert.equal(raw[(4*12+9)*4+2]>raw[(4*12+9)*4],true,'recolor produced blue pixels');
  const restarted=factoryArtworkEngine({db:service.db,env,fetchImpl});await restarted.plan(job,plan,[draft],selection);assert.equal(calls,1,'saved model output survives engine restart without another paid request');
  uncertain=true;await assert.rejects(engine.plan(job,{...plan,background:'White'},[draft],selection),/outcome is uncertain/);const attempts=calls;await assert.rejects(engine.plan(job,{...plan,background:'White'},[draft],selection),/earlier AI request needs review/);assert.equal(calls,attempts,'uncertain provider result is not replayed');
  assert.equal(factoryArtworkEngine({db:service.db,env:{}}).readiness().connected,false,'missing credentials never masquerade as AI generation');
 }finally{await c.close();}
});

test('automatic rendering retains completed native areas and resumes an interrupted product without duplicate files',async()=>{
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex')}),c=await client(service),base='/api/owner/ai-factory/';
 try{
  const png=await fixture(),uploaded=await c.call(base+'artwork/upload',{name:'Resume art',collection:'Night',scope:'collection',target:'',product:null,placements:['front','back'],instructions:'Preserve proportions',permissions,files:[{filename:'art.png',base64:png.toString('base64')}]});const art=uploaded.data.artworks[0].id,job=randomUUID(),draft=randomUUID(),date=new Date().toISOString();
  service.db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(job,'',JSON.stringify([draft]));service.db.prepare('INSERT INTO factory_job_audiences VALUES(?,?)').run(job,JSON.stringify({product:328,artworkIds:[art]}));service.db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(draft,'Resume tee',328,10,'default',JSON.stringify([{placement:'front',width:12,height:8,dpi:150},{placement:'back',width:120,height:80,dpi:150}]),'live',date);
  const renderer=factoryRendering({db:service.db,blueprints:{load:async()=>({source:'live',catalogType:'CUT-SEW',effectiveTechnique:'cut-sew',name:'All-Over Print Unisex Tee',variants:[{id:10,color:'White',size:'M'}],printfiles:{printfiles:[{printfile_id:1,width:12,height:8,dpi:150},{printfile_id:2,width:120,height:80,dpi:150}],variant_printfiles:[{variant_id:10,placements:{front:1,back:2}}]},layouts:{}})}}),plan={colorMode:'print',background:'Black',placements:{front:{artworkId:art},back:{artworkId:art}}};renderer.savePlan(job,plan);
  await assert.rejects(renderer.renderJob(job),/resolution is too low/);const first=service.db.prepare('SELECT id,placement FROM factory_print_files').all();assert.equal(first.length,1);assert.equal(first[0].placement,'front');
  renderer.savePlan(job,{...plan,placements:{...plan.placements,back:{fillOnly:true}}});const resumed=await renderer.renderJob(job);assert.equal(resumed.rendered,1);assert.equal(resumed.files[0].id,first[0].id);assert.equal(service.db.prepare('SELECT count(*) n FROM factory_print_files').get().n,2);
  assert.ok(printFileLimits({}).files>14*8*6,'one outfit with all size print areas is not stopped by the obsolete 256-file cap');assert.throws(()=>printFileLimits({FACTORY_PRINT_STORAGE_MB:'invalid'}),/Invalid/);
 }finally{await c.close();}
});

test('regular garments use the real fabric variant, missing colors hold and snapshot blueprints cannot start production',async()=>{
 const product={id:71,title:'Unisex T-Shirt',type_name:'T-Shirt',currency:'USD'},variants=[{id:10,size:'M',color:'Black',price:'12.00'},{id:11,size:'M',color:'White',price:'12.00'}],png=await fixture();
 const fetchImpl=async url=>{url=String(url);if(url.endsWith('/products'))return response([product]);if(url.endsWith('/products/71'))return response({product,variants});if(url.includes('/v2/'))return new Response(JSON.stringify({data:{techniques:[]}}));if(url.includes('/printfiles/'))return response({available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:12,height:8,dpi:150}],variant_printfiles:variants.map(v=>({variant_id:v.id,placements:{front:1,back:1}}))});if(url.includes('/templates/'))return response({templates:[],variant_mapping:[]});throw Error('Unexpected request '+url);};
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),productionSettings:{storageDurable:true,workerToken},workflowSettings:{storageDurable:true,fetchImpl},factorySettings:{token:'supplier-test',fetchImpl},blueprintSettings:{token:'supplier-test',plans:{products:{}},fetchImpl},ideaSettings:{env:{PRINTFUL_TOKEN:'supplier-test'},catalog:[],fetchImpl}}),c=await client(service),base='/api/owner/ai-factory/';
 try{
  await c.call(base+'employee',{id:'shirts',enabled:true});await c.call(base+'budget',{dailyBudget:1000,totalBudget:1000});
  const upload=await c.call(base+'artwork/upload',{name:'Fabric art',collection:'Night',scope:'collection',target:'',product:null,placements:['front'],instructions:'Keep original colors',permissions,files:[{filename:'art.png',base64:png.toString('base64')}]});const art=upload.data.artworks[0].id,set='up:fabric';service.db.prepare('INSERT INTO idea_sets(id,source,name,parts,updated,jacket) VALUES(?,?,?,?,?,0)').run(set,'upload','Night','{}',new Date().toISOString());
  const seed=color=>{const id=randomUUID(),piece={catalog:71,role:'shirts',label:'T-Shirt',color,placements:[{area:'front',artwork:art,part:'front',name:'Fabric art',url:base+'artwork/'+art+'/file'}],empty:['back'],ready:true};service.db.prepare('INSERT INTO idea_set_ideas(id,signature,set_id,kind,title,pieces,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,set,'product','Night tee',JSON.stringify([piece]),'Test','new',new Date().toISOString(),new Date().toISOString());return id;};
  const accepted=seed('Black'),rejected=seed('Navy');await c.call(base+'ideas/publish',{ids:[accepted,rejected],wait:true});
  assert.equal(service.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);assert.match(service.db.prepare('SELECT error FROM idea_set_ideas WHERE id=?').get(rejected).error,/no available Navy fabric/);
  const job=service.db.prepare('SELECT id FROM factory_jobs').get().id,selection=JSON.parse(service.db.prepare('SELECT selection FROM factory_job_audiences WHERE job=?').get(job).selection);assert.deepEqual(selection.variantIds,[10]);assert.equal(selection.garmentColor,'Black');assert.equal(selection.colorMode,'fabric');
  const draft=service.db.prepare('SELECT variant,areas FROM factory_print_drafts').get();assert.equal(draft.variant,10);assert.deepEqual(JSON.parse(draft.areas).map(a=>a.placement),['front'],'unassigned optional print areas are not filled as a substitute for fabric color');
  await c.call('/internal/factory/heartbeat',{worker:'fabric-worker'},true);await c.call(base+'control',{action:'start'});for(const stage of ['validate','supplier','files']){const lease=(await c.call('/internal/factory/claim',{worker:'fabric-worker'},true)).data;assert.equal(lease.step,stage);assert.equal((await c.call('/internal/factory/step',{worker:'fabric-worker',job,lease:lease.lease},true)).data.status,'queued');}
  const data=Buffer.from(service.db.prepare('SELECT data FROM factory_print_files').get().data),raw=await sharp(data).ensureAlpha().raw().toBuffer();assert.deepEqual([...raw.subarray(0,4)],[0,0,0,0],'fabric workflow keeps uncovered print pixels transparent');
  const snapshotOnly=factoryWorkflow({db:service.db,storageDurable:true,manager:{productDetails:async()=>({variants,audiences:['unisex']})},blueprints:{load:async()=>({source:'snapshot'})}});await assert.rejects(snapshotOnly.enqueue({idea:{id:randomUUID()},set:{},piece:{catalog:71}}),/stored snapshot cannot start/);
 }finally{await c.close();}
});
