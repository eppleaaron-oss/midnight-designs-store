import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {renderArea} from './factory-rendering.mjs';
import {factoryProductStudio,renderStudioPanel,studioLayers,studioProductionPanel,studioPlacementIssues} from './factory-product-studio.mjs';
const ROOT='/api/owner/ai-factory/product-studio';
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE factory_artwork(id TEXT,name TEXT,mime TEXT,data BLOB,permissions TEXT)');const png=await sharp({create:{width:100,height:100,channels:4,background:'#ff0000'}}).png().toBuffer();db.prepare('INSERT INTO factory_artwork VALUES(?,?,?,?,?)').run('art1','Rose front','image/png',png,JSON.stringify({reuse:true,modify:false,crop:false}));
 const p={id:'piece:one',supplierId:'123',name:'Rose hoodie',collection:'Rose',choice:{setId:'rose',product:390}},sibling={...p,id:'piece:two',supplierId:'456',name:'Rose pants'};
 const supplier={sync_product:{id:123,name:'Rose hoodie',external_id:'midnight-factory-job1'},sync_variants:[11,12].map((id,i)=>({id,variant_id:21+i,size:i?'M':'S',color:'White',retail_price:'49.99',product:{product_id:390},options:[{id:'keep',value:true}],files:[{id:31+i,type:'front',status:'ok',url:'https://files.printful.com/original.png'},{id:41+i,type:'back',status:'ok',url:'https://files.printful.com/back.png'}]}))};
 const bp={source:'live',effectiveTechnique:'cut-sew',printfiles:{printfiles:[{printfile_id:1,width:100,height:100,dpi:100}],variant_printfiles:[21,22].map(variant_id=>({variant_id,placements:{front:1,back:1}})),option_groups:['Flat',"Men's"],options:['Front','Back']},layouts:{templates:[],variant_mapping:[]}};
 let time=100000,puts=0,posts=0,throwPut=false,throwMockup=false,rateMockup=false,backupCount=0,authCalls=0;const calls=[],remote=new Map(),contents=new Map();let assetId=1,liveProduct=null;const originalProduct={id:'123',name:'Rose hoodie',description:'Existing description',factoryExternalId:'midnight-factory-job1',image:'old.jpg',images:['old.jpg'],variants:supplier.sync_variants.map(v=>({id:String(v.id),catalogVariantId:v.variant_id,price:49.99,currency:'USD',size:v.size,color:'Black',images:['old.jpg'],image:'old.jpg'}))};contents.set('factory-listings.json',{products:{123:originalProduct}});
 const assets={put:async(job,kind,file,data)=>{const id=assetId++;remote.set(id,Buffer.from(data));return {asset:id};},read:async id=>remote.get(id)};
 const response=d=>new Response(JSON.stringify({result:d}),{status:200,headers:{'Content-Type':'application/json'}});
 const fetchImpl=async(url,opts={})=>{calls.push({url,method:opts.method||'GET',body:opts.body&&JSON.parse(opts.body)});
  if(url.includes('api.github.com/repos/')){const u=new URL(url);if(u.pathname.includes('/contents/')){const path=u.pathname.split('/contents/')[1];if(opts.method==='PUT'){const b=JSON.parse(opts.body),raw=Buffer.from(b.content,'base64');contents.set(path,path.endsWith('.json')?JSON.parse(raw):raw);return new Response(JSON.stringify({content:{sha:'saved'}}));}const data=contents.get(path);if(!data)return new Response('{}',{status:404});return new Response(JSON.stringify({sha:'saved',content:Buffer.from(Buffer.isBuffer(data)?data:JSON.stringify(data)).toString('base64')}));}if(u.pathname.endsWith('/dispatches')){liveProduct=contents.get('factory-listings.json').products['123'];return new Response(null,{status:204});}}
  if(url.startsWith('https://midnight-designs.store/products.json'))return new Response(JSON.stringify({products:[liveProduct||originalProduct]}));
  if(url.startsWith('https://midnight-designs.store/images/'))return new Response(png);
  if(url.endsWith('/stores'))return response([{id:1}]);
  if(url.endsWith('/store/products/123'))return response(supplier);
  if(url.includes('/store/variants/')){puts++;const id=Number(url.split('/').at(-1)),v=supplier.sync_variants.find(v=>v.id===id),b=JSON.parse(opts.body);assert.equal(b.variant_id,v.variant_id);assert.equal(b.retail_price,undefined);assert.equal(b.options,undefined);v.files=b.files.map(f=>f.url?{...f,id:99+id,status:'ok'}:{...v.files.find(v=>v.id===f.id)});if(throwPut){throwPut=false;throw Error('response lost');}return response(v);}
  if(url.includes('/mockup-generator/create-task/')){posts++;if(rateMockup){rateMockup=false;return new Response(JSON.stringify({error:{message:'slow down'}}),{status:429});}if(throwMockup){throwMockup=false;throw Error('mockup response lost');}return response({task_key:'task'+posts});}
  if(url.includes('/mockup-generator/task?'))return response({task_key:new URL(url).searchParams.get('task_key'),status:'completed',mockups:[{variant_ids:[21,22],placement:'front',mockup_url:'https://files.printful.com/front.jpg',extra:[{url:'https://files.printful.com/back.jpg',title:'Back',option_group:'Flat'}]}]});
  if(url.includes('files.printful.com/'))return new Response(png,{headers:{'Content-Type':'image/png'}});
  throw Error('Unexpected URL '+url);
 };
 const options={db,editor:{library:()=>({pieces:[p,sibling],products:[],sets:[{id:'rose',name:'Rose original hoodie',parts:{front:{name:'Rose front',artwork:'art1'}}}]})},blueprints:{load:async()=>bp},workflow:{sourceFile:async p=>p.artwork},basic:{storeToken:()=>'store-key'},backups:{connection:()=>null,checkpoint:async()=>{backupCount++;}},auth:()=>{authCalls++;},body:async req=>req.payload,send:(res,status,data)=>{res.data=data;res.status=status;},fail:(status,message)=>{throw Object.assign(Error(message),{status});},limit:()=>{},origin:'https://app.test',stepAssetLimit:1,supplierWriteGapMs:0,mockupWriteGapMs:0,fetchImpl,clock:()=>time,token:'secret',assets};
 let studio=factoryProductStudio(options);
 const call=async(path,b,origin='https://app.test')=>{const res={};await studio.handle({headers:{origin},payload:b},res,ROOT+'/'+path,'POST',new URL('https://app.test'));return res.data;};
 const open=()=>call('open',{source:p.id});
 const document=async()=>({templateStamp:(await open()).templateStamp,fingerprint:(await open()).fingerprint,variants:{11:{front:{background:'#000000',layers:[{asset:'art:art1',x:.5,y:.5,width:.5,rotation:0}]}}}});
 const tick=async()=>{time+=32000;await studio.tick();};
 const job=()=>{const j=db.prepare('SELECT * FROM factory_studio_jobs ORDER BY updated DESC LIMIT 1').get();return j?{...j,document:JSON.parse(j.document)}:null;};
 const draftStatus=async()=>{const res={};await studio.handle({headers:{}},res,ROOT+'/draft-status','GET',new URL('https://app.test?supplier=123'));return res.data;};
 return {db,p,supplier,open,document,call,tick,job,draftStatus,counts:()=>({puts,posts,backupCount,authCalls}),calls,setLostPut:()=>{throwPut=true;},setLostMockup:()=>{throwMockup=true;},setRateMockup:()=>{rateMockup=true;},restart:()=>{studio=factoryProductStudio(options);},options};
}
test('open binds exact supplier product, variant templates and original hoodie family',async t=>{const f=await fixture(t),o=await f.open();assert.equal(o.product.supplierId,'123');assert.equal(o.variants.length,2);assert.equal(o.variants[0].areas[0].width,100);assert.equal(o.originals[0].asset,'art:art1');assert.equal(o.group.products[0].supplierId,'456');assert.ok(!JSON.stringify(o).includes('secret'));await assert.rejects(f.call('open',{source:'piece:missing'}),/exact saved product/);});
test('manual enlargement renders the selected size while automatic rendering retains its DPI gate',async()=>{
 const png=await sharp({create:{width:100,height:50,channels:4,background:'#ff0000'}}).png().toBuffer(),a={width:1000,height:1000,dpi:100},panel={background:'#000000',layers:[{asset:'art:one',x:.5,y:.5,width:.8}]};
 const rendered=await renderStudioPanel(a,panel,async()=>({data:png,permissions:{reuse:true}})),{data,info}=await sharp(rendered.data).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1000);assert.equal(info.height,1000);assert.equal(rendered.effectiveDpi,12.5);
 const red=(x,y)=>data[(y*info.width+x)*info.channels];assert.equal(red(99,500),0);assert.equal(red(100,500),255);assert.equal(red(899,500),255);assert.equal(red(900,500),0);assert.equal(red(500,299),0);assert.equal(red(500,300),255);assert.equal(red(500,700),0);
 await assert.rejects(renderArea(a,png,{scale:80,allowLowResolution:true},{reuse:true}),/resolution is too low/);
});

test('draft revisions reject races; wrong variants and placements never reach Printful',async t=>{const f=await fixture(t),d=await f.document();const saved=await f.call('save',{source:f.p.id,revision:0,document:d});assert.equal(saved.printfulUpdated,false);await assert.rejects(f.call('save',{source:f.p.id,revision:0,document:d}),/another tab/);const wrong=structuredClone(d);wrong.variants[999]=wrong.variants[11];await assert.rejects(f.call('finish',{source:f.p.id,revision:1,document:wrong,target:'printful'}),/does not belong/);assert.equal(f.counts().puts,0);assert.equal(f.db.prepare('SELECT revision FROM factory_studio_drafts').get().revision,1);});
test('repeated Save of unchanged panels keeps the same revision and does not make a queued update appear outdated',async t=>{
 const f=await fixture(t),d=await f.document();const saved=await f.call('save',{source:f.p.id,revision:0,document:d});const again=await f.call('save',{source:f.p.id,revision:saved.revision,document:saved.document});assert.equal(again.revision,1);assert.equal(again.unchanged,true);
 const finished=await f.call('finish',{source:f.p.id,revision:again.revision,document:again.document,target:'printful'});assert.equal(finished.revision,1);assert.equal(finished.job.revision,1);
 await f.call('save',{source:f.p.id,revision:1,document:finished.document});const reopened=await f.open();assert.equal(reopened.revision,1);assert.equal(reopened.job.revision,1);assert.deepEqual(reopened.document.variants,saved.document.variants);assert.equal(f.counts().puts,0);
});
test('Finish submits the edited document once, and an uncertain response never triggers a second save',async()=>{
 const {finishSavedDraft}=await import('./public/product-studio-state.js'),calls=[],document={variants:{}},saved={revision:4,document,job:{id:'tracked'}};let adopted;
 const r=await finishSavedDraft({source:'piece:one',revision:3,document,target:'store',confirmPublication:true,dirty:true,api:async(path,b)=>{calls.push(path);assert.equal(b.document,document);return saved;},onSaved:x=>adopted=x});assert.equal(r,saved);assert.equal(adopted,saved);assert.deepEqual(calls,['finish']);
 calls.length=0;await assert.rejects(finishSavedDraft({source:'piece:one',revision:3,document,target:'store',dirty:true,api:async path=>{calls.push(path);throw Error('response lost');}}),/response lost/);assert.deepEqual(calls,['finish']);
});
test('identical bomber panels reuse their saved native pixels across sizes and permission changes still stop reuse',async t=>{
 const f=await fixture(t),d=await f.document();d.variants[12]=structuredClone(d.variants[11]);await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});await f.tick();await f.tick();assert.equal(f.job().document.outputs.length,1);await f.tick();assert.equal(f.job().state,'updating_printful');const out=f.job().document.outputs;assert.equal(out.length,2);assert.equal(out[0].asset,out[1].asset);assert.equal(out[0].sha,out[1].sha);assert.notEqual(out[0].variant,out[1].variant);f.restart();for(let n=0;n<8&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,2);
 const g=await fixture(t),p=await g.document();p.variants[12]=structuredClone(p.variants[11]);await g.call('finish',{source:g.p.id,revision:0,document:p,target:'printful'});await g.tick();await g.tick();g.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({reuse:false}),'art1');await g.tick();assert.equal(g.job().state,'failed');assert.equal(g.counts().puts,0);
});
test('size-specific artwork positions and native canvases never reuse another panel’s pixels',async t=>{
 for(const differentCanvas of [false,true]){const f=await fixture(t),d=await f.document();d.variants[12]=structuredClone(d.variants[11]);if(differentCanvas){const bp=await f.options.blueprints.load();bp.printfiles.printfiles.push({printfile_id:2,width:200,height:100,dpi:100});bp.printfiles.variant_printfiles[1].placements.front=2;d.templateStamp=(await f.open()).templateStamp;}else d.variants[12].front.layers[0].x=.3;
 await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});for(let n=0;n<10&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);const out=f.job().document.outputs;assert.equal(out.length,2);assert.notEqual(out[0].asset,out[1].asset);assert.notEqual(out[0].sha,out[1].sha);assert.equal(out[1].width,differentCanvas?200:100);}
});
test('Finish updates the same variant, preserves untouched files/options/prices, checkpoints and reopens',async t=>{const f=await fixture(t),d=await f.document(),r=await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});assert.equal(r.job.printfulUpdated,false);await assert.rejects(f.call('finish',{source:f.p.id,revision:1,document:d,target:'printful'}),/unfinished update/);for(let n=0;n<10&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,0);assert.equal(f.supplier.sync_variants[0].id,11);assert.equal(f.supplier.sync_variants[0].retail_price,'49.99');assert.equal(f.supplier.sync_variants[0].files.find(f=>f.type==='back').id,41);assert.equal(f.supplier.sync_variants[1].files[0].id,32);assert.ok(f.counts().backupCount>2);const o=await f.open();assert.equal(o.document.fingerprint,o.fingerprint);assert.equal(o.job.printfulUpdated,true);});
test('long-sleeve default/front aliases replace exactly one real supplier file and verify the same mockup panel',async t=>{
 const f=await fixture(t);for(const v of f.supplier.sync_variants)v.files[0].type='default';
 await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});
 // Reproduce Printful's canonical default response for the front panel.
 for(let n=0;n<35&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);
 const put=f.calls.find(c=>c.method==='PUT'&&c.url.includes('/store/variants/'));
 assert.equal(put.body.files.filter(f=>f.type==='default').length,1);assert.equal(put.body.files.some(f=>f.type==='front'),false);assert.ok(put.body.files.find(f=>f.type==='default').url.includes('/factory-studio-file/'));
 assert.equal(f.counts().puts,1);assert.equal(f.supplier.sync_variants[0].files.find(f=>f.type==='back').id,41);assert.equal(f.supplier.sync_variants[1].files.find(f=>f.type==='default').id,32);
 const tasks=f.calls.filter(c=>c.url.includes('create-task'));assert.ok(tasks.every(c=>c.body.files.some(f=>f.placement==='front')));assert.ok(tasks.some(c=>c.body.files.some(f=>f.placement==='front'&&f.image_url==='https://files.printful.com/original.png')));assert.equal((await f.open()).job.printfulUpdated,true);
});
test('restart reconciles a lost PUT response without creating or updating a duplicate product',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});f.setLostPut();for(let n=0;n<4;n++)await f.tick();f.restart();for(let n=0;n<8&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.ok(f.calls.every(c=>!(c.url.endsWith('/store/products')&&c.method==='POST')));});
test('size updates share a durable intent checkpoint and reconcile a lost batch response without repeated PUTs',async t=>{
 const f=await fixture(t),d=await f.document();d.variants[12]=structuredClone(d.variants[11]);await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});
 while(f.job().state!=='updating_printful')await f.tick();const before=f.counts().backupCount;await f.tick();assert.equal(f.counts().puts,2);assert.ok(f.counts().backupCount-before<=2,'one intent checkpoint and one coalesced recovery snapshot for both sizes');
 f.restart();await f.tick();assert.equal(f.job().state,'completed');assert.equal(f.counts().puts,2);
 const g=await fixture(t),recipe=await g.document();recipe.variants[12]=structuredClone(recipe.variants[11]);await g.call('finish',{source:g.p.id,revision:0,document:recipe,target:'printful'});while(g.job().state!=='updating_printful')await g.tick();g.setLostPut();await g.tick();g.restart();for(let n=0;n<8&&g.job().state!=='completed';n++)await g.tick();assert.equal(g.job().state,'completed',g.job().error);assert.equal(g.counts().puts,2,'the accepted first PUT must not be sent again');
});
test('real accepted mockup tasks request all supplier styles and save every returned view',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});for(let n=0;n<35&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);const j=f.job().document;assert.equal(j.images.length,2);assert.ok(j.tasks.every(t=>t.key&&t.state==='saved'));assert.ok(f.calls.filter(c=>c.url.includes('create-task')).every(c=>c.body.option_groups.length===2&&c.body.options.length===2));assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_assets WHERE remote IS NOT NULL AND length(data)=0').get().n,2);});
test('a mockup rate limit retries with no false accepted task; uncertain submissions never resubmit',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});f.setLostMockup();for(let n=0;n<15&&f.job().state!=='failed';n++)await f.tick();assert.equal(f.job().state,'failed');assert.equal(f.job().document.tasks[0].key,null);await assert.rejects(f.call('retry',{source:f.p.id,id:f.job().id}),/uncertain outcome/);const before=f.counts().posts;f.restart();await f.tick();assert.equal(f.counts().posts,before);});
test('cross-origin actions fail and original artwork permissions prevent unapproved transforms',async t=>{const f=await fixture(t);await assert.rejects(f.call('open',{source:f.p.id},'https://other.test'),/Origin/);const d=await f.document();d.variants[11].front.layers[0].rotation=20;await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});for(let n=0;n<5&&f.job().state!=='failed';n++)await f.tick();assert.equal(f.job().state,'failed');assert.match(f.job().error,/Modify permission/);assert.equal(f.counts().puts,0);await f.call('cancel',{source:f.p.id,id:f.job().id});assert.equal(f.job().state,'cancelled');});
test('a concurrent Printful change is held before any update; validation rejects nonnumeric layout',async t=>{const f=await fixture(t);const d=await f.document();f.supplier.sync_variants[0].files[0].id=777;await assert.rejects(f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'}),/supplier product changed/);assert.equal(f.counts().puts,0);assert.throws(()=>studioLayers({background:'#000000',layers:[{asset:'art:a',x:NaN,y:.5,width:.5}]}),/Invalid horizontal/);});

test('store publishing retains product/variant IDs and verifies permanently saved photos before success',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});for(let n=0;n<45&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.job().document.storeUpdated,true);const product=f.job().document.storeProduct;assert.equal(product.id,'123');assert.equal(product.description,'Existing description');assert.deepEqual(product.variants.map(v=>v.id),['11','12']);assert.ok(product.images.every(u=>u.startsWith('https://midnight-designs.store/images/factory/123/')));assert.ok(product.variants.every(v=>v.price===49.99&&v.images.length));});
test('publish a completed private update reuses its files, task IDs and saved mockups without resubmitting to Printful',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});
 await assert.rejects(f.call('publish',{source:f.p.id,id:f.job().id,revision:1,confirmPublication:true}),/Wait for/);
 for(let n=0;n<35&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed');
 const before=f.job(),counts=f.counts();
 await assert.rejects(f.call('publish',{source:f.p.id,id:before.id,revision:1}),/Explicitly approve/);
 await assert.rejects(f.call('publish',{source:f.p.id,id:before.id,revision:0,confirmPublication:true}),/newer draft/);
 const r=await f.call('publish',{source:f.p.id,id:before.id,revision:1,confirmPublication:true});assert.equal(r.job.id,before.id);assert.equal(r.job.state,'publishing');assert.equal(r.revision,1);
 for(let n=0;n<20&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.job().document.storeUpdated,true);
 assert.equal(f.counts().puts,counts.puts);assert.equal(f.counts().posts,counts.posts);assert.deepEqual(f.job().document.outputs,before.document.outputs);assert.deepEqual(f.job().document.tasks,before.document.tasks);
 await f.call('publish',{source:f.p.id,id:before.id,revision:1,confirmPublication:true});assert.equal(f.job().state,'completed');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_jobs').get().n,1);
});
test('saved mockups cannot be published after supplier files or the draft change',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});for(let n=0;n<35&&f.job().state!=='completed';n++)await f.tick();const j=f.job();
 f.supplier.sync_variants[0].files[0].id=777;await assert.rejects(f.call('publish',{source:f.p.id,id:j.id,revision:1,confirmPublication:true}),/supplier product changed/);
 const opened=await f.open();opened.document.variants[11].front.layers[0].x=.6;await f.call('save',{source:f.p.id,revision:1,document:opened.document});await assert.rejects(f.call('publish',{source:f.p.id,id:j.id,revision:2,confirmPublication:true}),/newer draft/);assert.equal(f.job().target,'mockups');
});
test('live storefront membership selects store updates despite an older supplier-created factory status',async()=>{
 const {productUpdateTarget,canPublishSavedUpdate}=await import('./public/product-studio-state.js');const p={supplierId:483213237,state:'supplier_created'};
 assert.equal(productUpdateTarget(p),'mockups');assert.equal(productUpdateTarget(p,new Set(['483213237'])),'store');assert.equal(productUpdateTarget({...p,state:'published'}),'store');assert.equal(productUpdateTarget({...p,supplierId:'other'},new Set(['483213237'])),'mockups');
 const j={state:'completed',target:'mockups',printfulUpdated:true,images:[{url:'saved.jpg'}],revision:4};assert.equal(canPublishSavedUpdate(j,4,false),true);assert.equal(canPublishSavedUpdate(j,4,true),false);assert.equal(canPublishSavedUpdate(j,5,false),false);assert.equal(canPublishSavedUpdate({...j,state:'rendering'},4,false),false);
});
test('Printful rate limits retry accepted work without inventing a task key or losing progress',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});f.setRateMockup();for(let n=0;n<40&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.ok(f.job().document.tasks.every(t=>t.key&&t.state==='saved'));assert.equal(f.counts().puts,1);});

test('explicit owner crop permission permits panel-edge edits while protected artwork is held',async()=>{const data=await sharp({create:{width:100,height:100,channels:4,background:'#ff0000'}}).png().toBuffer(),area={width:100,height:100,dpi:100},panel={background:'#000000',layers:[{asset:'art:one',x:0,y:.5,width:.5,allowModify:true}]};const read=async()=>({data,permissions:{reuse:true}});const rendered=await renderStudioPanel(area,panel,read);assert.equal(rendered.width,100);panel.layers[0].allowModify=false;await assert.rejects(renderStudioPanel(area,panel,read),/outside its reviewed safe region/);});

test('larger sleeve artwork discards only black padding while preserving every visible pixel',async()=>{
 const red=await sharp({create:{width:20,height:40,channels:4,background:'#ff0000'}}).png().toBuffer();
 const data=await sharp({create:{width:100,height:100,channels:4,background:'#000000'}}).composite([{input:red,left:40,top:30}]).png().toBuffer();
 const area={width:200,height:100,dpi:100},panel={background:'#000000',layers:[{asset:'art:one',x:.5,y:.5,width:1,allowModify:false}]},read=async()=>({data,permissions:{reuse:true}});
 const rendered=await renderStudioPanel(area,panel,read),pixels=await sharp(rendered.data).raw().toBuffer({resolveWithObject:true});
 assert.equal(rendered.width,200);assert.equal(rendered.height,100);assert.equal(rendered.effectiveDpi,50);
 const at=(x,y)=>Array.from(pixels.data.subarray((y*200+x)*4,(y*200+x)*4+4));
 assert.deepEqual(at(100,20),[255,0,0,255]);assert.deepEqual(at(100,80),[255,0,0,255]);assert.deepEqual(at(20,50),[0,0,0,255]);
 panel.layers[0].y=0;await assert.rejects(renderStudioPanel(area,panel,read),/outside its reviewed safe region/);
 panel.layers[0].y=.5;panel.background='#ffffff';await assert.rejects(renderStudioPanel(area,panel,read),/outside its reviewed safe region/);
});

async function archived(f,wrong=false){
 f.p.jobId='original-job';f.db.exec('CREATE TABLE factory_basic_items(job TEXT,recipe TEXT,cleanup TEXT); CREATE TABLE factory_render_plans(job TEXT,plan TEXT)');
 const area={placement:'front',width:100,height:100,dpi:100},recipe={artworkId:'art1',fit:'contain',scale:50,protect:true,withoutEnlargement:true},data=f.db.prepare('SELECT data FROM factory_artwork').get().data;
 const rendered=await renderArea(area,Buffer.from(data),{...recipe,background:'#000000'},{reuse:true});
 const checksum=wrong?'0'.repeat(64):rendered.sha256,cleanup={verified:true,templates:[21,22].map(variant=>({variant,areas:JSON.stringify([area])})),supplierReceipt:{variants:f.supplier.sync_variants.map(v=>({supplierVariantId:v.id,files:[{placement:'front',supplierFileId:v.files[0].id,sha256:checksum}]}))}};
 f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?)').run('original-job','{}',JSON.stringify(cleanup));f.db.prepare('INSERT INTO factory_render_plans VALUES(?,?)').run('original-job',JSON.stringify({background:'#000000',placements:{front:recipe}}));for(const v of f.supplier.sync_variants)v.files[0].url='https://app.test/factory-print-file/'+'a'.repeat(64);
}
test('archived production geometry opens as editable original layers without guessing at a flattened image',async t=>{const f=await fixture(t);await archived(f);const o=await f.open();assert.equal(o.basePanels['11'].front.layers[0].asset,'art:art1');assert.equal(o.basePanels['11'].front.layers[0].width,.5);assert.equal(o.basePanels['11'].front.layers[0].x,.5);assert.equal(studioProductionPanel({width:100,height:100},{artworkId:'x',tile:true},()=>({width:100,height:100})),null);});
test('expired temporary files recover exact checksummed production pixels before real mockups; supplier files remain unchanged',async t=>{const f=await fixture(t);await archived(f);const d=await f.document();d.variants={};await f.call('finish',{source:f.p.id,revision:0,document:d,target:'mockups'});for(let n=0;n<40&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,0);assert.equal(Object.keys(f.job().document.baseFiles).length,2);assert.ok(f.calls.filter(c=>c.url.includes('create-task')).every(c=>c.body.files.some(f=>f.image_url.startsWith('https://app.test/factory-studio-file/'))));});
test('unchanged jacket panels share a recovery checkpoint before any mockup submission',async t=>{
 const f=await fixture(t);await archived(f);const d=await f.document();d.variants={};await f.call('finish',{source:f.p.id,revision:0,document:d,target:'mockups'});while(f.job().state!=='mockups')await f.tick();const checkpoints=f.counts().backupCount;await f.tick();assert.equal(Object.keys(f.job().document.baseFiles).length,2);assert.equal(f.counts().backupCount-checkpoints,1);assert.equal(f.counts().posts,0);for(const v of f.supplier.sync_variants)assert.equal(f.job().document.baseFiles[v.id+':front'].sourceSupplierFileId,v.files[0].id);await f.tick();assert.equal(f.counts().posts,1);assert.ok(f.job().document.tasks[0].key);
});
test('a changed archived checksum holds generation instead of inventing replacement print files',async t=>{const f=await fixture(t);await archived(f,true);const d=await f.document();d.variants={};await f.call('finish',{source:f.p.id,revision:0,document:d,target:'mockups'});for(let n=0;n<12&&f.job().state!=='failed';n++)await f.tick();assert.equal(f.job().state,'failed');assert.match(f.job().error,/original saved checksum/);assert.equal(f.counts().puts,0);assert.equal(f.counts().posts,0);});
test('an actively queued factory product cannot have supplier files overwritten by the editor',async t=>{const f=await fixture(t);f.p.jobId='active';f.db.exec("CREATE TABLE factory_jobs(id TEXT,status TEXT); INSERT INTO factory_jobs VALUES('active','queued')");await assert.rejects(f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'}),/still being processed/);assert.equal(f.counts().puts,0);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_jobs').get().n,0);});

test('a slow recovery snapshot never blocks draft or Finish acknowledgement and durability remains explicit',async t=>{const f=await fixture(t);let release;f.options.backups.checkpoint=()=>new Promise(resolve=>{release=resolve;});f.restart();const d=await f.document(),r=await f.call('save',{source:f.p.id,revision:0,document:d});assert.equal(r.recoveryPending,true);assert.equal(r.printfulUpdated,false);assert.equal(f.db.prepare('SELECT revision FROM factory_studio_drafts').get().revision,1);assert.equal(f.counts().puts,0);release();await new Promise(resolve=>setImmediate(resolve));});

test('opening uses available supplier template snapshots immediately; Finish still requires live specifications',async t=>{const f=await fixture(t);const live=await f.options.blueprints.load();f.options.blueprints.peek=()=>({...live,source:'snapshot'});let loads=0;f.options.blueprints.load=async()=>{loads++;return live;};f.restart();const opened=await f.open();assert.equal(loads,0);assert.equal(opened.templateSource,'snapshot');await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});assert.equal(loads,1);});

test('a changed supplier print canvas cannot silently reuse the owners previous template review',async t=>{const f=await fixture(t),d=await f.document();const bp=await f.options.blueprints.load();f.options.blueprints.load=async()=>({...bp,printfiles:{...bp.printfiles,printfiles:[{printfile_id:1,width:200,height:100,dpi:100}]}});await assert.rejects(f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'}),/supplier template changed/);assert.equal(f.counts().puts,0);});
test('opening a tracked AI product reads only its own records and design family, without scanning the factory queue',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TABLE factory_basic_items(id TEXT,job TEXT,recipe TEXT,created TEXT,status TEXT);CREATE TABLE factory_listings(job TEXT,supplier_id TEXT,copy TEXT);CREATE TABLE factory_basic_outfit_pieces(id TEXT,item TEXT,outfit TEXT);CREATE TABLE idea_sets(id TEXT,name TEXT,parts TEXT)');
 const recipe={set:{id:'rose',name:'Rose original hoodie'},product:390,name:'Rose hoodie',audience:'unisex',variants:[{size:'S'},{size:'M'}]};f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('item1','job1',JSON.stringify(recipe),'today','supplier_created');f.db.prepare('INSERT INTO factory_listings VALUES(?,?,?)').run('job1','123',JSON.stringify({title:'Rose hoodie'}));f.db.prepare('INSERT INTO factory_basic_outfit_pieces VALUES(?,?,?)').run('one','item1','outfit1');f.db.prepare('INSERT INTO idea_sets VALUES(?,?,?)').run('rose','Rose original hoodie',JSON.stringify({front:{artwork:'art1',name:'Rose front'}}));f.options.editor.library=()=>{throw Error('Full queue must not be loaded');};f.restart();const opened=await f.open();assert.equal(opened.product.id,'piece:one');assert.equal(opened.product.supplierId,'123');assert.equal(opened.originals[0].asset,'art:art1');assert.equal(opened.group.name,'Rose original hoodie');
});

test('supplier garment guides map the native print canvas without changing saved artwork coordinates',async()=>{
 const {templateGeometry,printPoint}=await import('./public/product-template-geometry.js');
 const area={width:5250,height:6750,templateUrl:'/supplier/front',template:{template_width:3000,template_height:3000,print_area_width:2022,print_area_height:2600,print_area_left:489,print_area_top:0}};
 const g=templateGeometry(area);assert.equal(g.mapped,true);assert.equal(g.width,820);assert.equal(g.height,820);
 const center=printPoint(g,(g.print.x+g.print.width/2)/g.width,(g.print.y+g.print.height/2)/g.height);assert.equal(center.inside,true);assert.ok(Math.abs(center.x-.5)<1e-9);assert.ok(Math.abs(center.y-.5)<1e-9);
 assert.equal(printPoint(g,.01,.5).inside,false,'clicking guide annotations cannot move artwork');
 const sleeve={...area,width:5250,height:3000,template:{...area.template,print_area_width:2260,print_area_height:1292,print_area_top:854,print_area_left:370}};
 assert.equal(templateGeometry(sleeve).mapped,true,'sleeves use their own offset and rectangular print area');
 const native=templateGeometry(area,false);assert.equal(native.mapped,false);assert.equal(native.print.x,0);assert.equal(native.print.width,native.width);
 assert.equal(templateGeometry({...area,template:{...area.template,print_area_width:100}}).mapped,false,'incorrect mappings never stretch the saved print file');
 assert.equal(templateGeometry({...area,template:null}).mapped,false);
});

test('flattened back and sleeve images expose saved editable placement drafts without silently changing current supplier artwork',async t=>{
 const f=await fixture(t);await archived(f);for(const v of f.supplier.sync_variants){v.files[0].url=null;v.files[0].preview_url='https://files.cdn.printful.com/current.png';}
 const o=await f.open();assert.equal(o.basePanels['11'],undefined,'changed or flattened supplier images are not silently substituted');assert.equal(o.suggestedPanels['11'].front.layers[0].asset,'art:art1');assert.equal(o.suggestedPanels['11'].front.layers[0].width,.5);assert.equal(f.counts().puts,0);assert.equal(o.document,null,'opening a placement does not save a replacement design');
});

test('Finish queues enlarged owner artwork at its exact saved scale and records actual resolution warnings',async t=>{
 const f=await fixture(t),d=await f.document();d.variants[11].front.layers[0].width=1;
 f.db.prepare('UPDATE factory_artwork SET data=?').run(await sharp({create:{width:50,height:25,channels:4,background:'#ff0000'}}).png().toBuffer());
 const r=await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});assert.equal(r.job.state,'queued');assert.equal(r.job.resolutionWarnings[0].effectiveDpi,50);assert.equal(r.document.variants[11].front.layers[0].width,1);
 for(let n=0;n<15&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,0);assert.equal(f.job().document.variants[11].front.layers[0].width,1);
 const file=f.db.prepare("SELECT * FROM factory_studio_assets WHERE kind='print'").get(),meta=await sharp(await f.options.assets.read(JSON.parse(file.remote).asset)).metadata();assert.equal(meta.width,100);assert.equal(meta.height,100);
});

test('print-quality fit preserves artwork proportions, constrains rotated bounds, and keeps every panel independent',async()=>{
 const {artworkFit}=await import('./public/product-template-geometry.js');const area={width:5250,height:3000,dpi:150},source={width:1758,height:1758};
 const draft={width:.6154,x:.5,y:.5,rotation:0};const fit=artworkFit(area,source,draft);assert.equal(fit.width,1758/5250);assert.equal(fit.x,.5);assert.equal(draft.width,.6154);assert.ok(source.width/(fit.width*area.width)*area.dpi>=150);
 const rotated=artworkFit(area,{width:1758,height:3500},{width:.9,x:0,y:1,rotation:90});assert.ok(rotated.x>0&&rotated.y<1);assert.ok(rotated.width>0);
});

test('durably stored mockup downloads do not block on a full database backup for every image',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});
 for(let n=0;n<25&&!f.job().document.tasks?.some(t=>t.state==='downloading');n++)await f.tick();
 assert.ok(f.job().document.tasks.some(t=>t.state==='downloading'));
 let release;f.options.backups.checkpoint=()=>new Promise(resolve=>{release=resolve;});
 await f.tick();assert.equal(f.job().document.images.length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM factory_studio_assets WHERE kind='mockup' AND remote IS NOT NULL").get().n,1);
 release();await new Promise(resolve=>setImmediate(resolve));
});

test('edited products publish through the existing contents-authorized repository event without requiring Actions write access',async t=>{
 const f=await fixture(t),base=f.options.fetchImpl;f.options.fetchImpl=async(u,o)=>u.includes('/actions/workflows/')?new Response('{}',{status:403}):base(u,o);f.restart();
 await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});for(let n=0;n<45&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.ok(f.calls.some(c=>c.url.endsWith('/dispatches')&&c.body?.event_type==='midnight-basic-publish'));assert.equal(f.calls.some(c=>c.url.includes('/actions/workflows/')),false);
});

test('all six supported placements survive save, reopen and editor restart independently',async t=>{
 const f=await fixture(t),bp=await f.options.blueprints.load(),placements=['front','back','sleeve_left','sleeve_right','hood','pocket'];
 for(const m of bp.printfiles.variant_printfiles)m.placements=Object.fromEntries(placements.map(p=>[p,1]));
 const d=await f.document();d.variants['11']=Object.fromEntries(placements.map((p,i)=>[p,{background:i%2?'#101010':'#000000',layers:[{asset:'art:art1',x:.3+i*.05,y:.35+i*.04,width:.15+i*.03}]}]));
 const saved=await f.call('save',{source:f.p.id,revision:0,document:d});
 assert.deepEqual((await f.open()).document,saved.document);f.restart();const reopened=await f.open();assert.deepEqual(reopened.document,saved.document);
 assert.deepEqual(reopened.variants[0].areas.map(a=>a.placement).sort(),placements.sort());assert.equal(f.counts().puts,0);assert.equal(f.counts().posts,0);
 const edit=structuredClone(reopened.document);edit.variants['11'].back.layers[0].x=.6;
 const second=await f.call('save',{source:f.p.id,revision:1,document:edit});assert.deepEqual(second.document.variants['11'].sleeve_left,saved.document.variants['11'].sleeve_left);assert.deepEqual(second.document.variants['11'].sleeve_right,saved.document.variants['11'].sleeve_right);
 await f.call('finish',{source:f.p.id,revision:2,document:second.document,target:'mockups'});for(let n=0;n<70&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.job().document.outputs.length,6);assert.equal(f.counts().puts,1,'one update to the same supplier variant');assert.equal(f.job().document.storeUpdated,undefined);assert.ok(f.calls.every(c=>!c.url.includes('api.github.com')&&!(c.method==='POST'&&c.url.endsWith('/store/products'))));
});
test('recovery confirmation is for the exact saved revision, and failures never confirm a newer draft',async t=>{
 const f=await fixture(t),releases=[];f.options.backups.checkpoint=()=>new Promise(resolve=>releases.push(resolve));f.restart();
 await f.call('save',{source:f.p.id,revision:0,document:await f.document()});await new Promise(r=>setImmediate(r));assert.equal((await f.draftStatus()).recovery.confirmedRevision,0);
 const d=(await f.open()).document;d.variants['11'].front.layers[0].x=.6;await f.call('save',{source:f.p.id,revision:1,document:d});await new Promise(r=>setImmediate(r));
 releases[0]();await new Promise(r=>setImmediate(r));let status=await f.draftStatus();assert.equal(status.revision,2);assert.equal(status.recovery.confirmedRevision,1);assert.equal(status.recovery.pending,true);
 releases[1]();await new Promise(r=>setImmediate(r));assert.equal((await f.draftStatus()).recovery.confirmedRevision,2);
 f.options.backups.checkpoint=async()=>{throw Error('Backup unavailable');};f.restart();await f.call('save',{source:f.p.id,revision:2,document:d});await new Promise(r=>setImmediate(r));status=await f.draftStatus();assert.equal(status.recovery.confirmedRevision,0);assert.match(status.recovery.error,/Backup unavailable/);
});
test('store updates require explicit publication consent; private Finish never writes a public listing',async t=>{
 const f=await fixture(t),d=await f.document();await assert.rejects(f.call('finish',{source:f.p.id,revision:0,document:d,target:'store'}),/Explicitly approve/);assert.equal(f.job(),null);assert.equal(f.counts().puts,0);
});
test('supplier template guide graphics never enter the exported print pixels',async()=>{
 const data=await sharp({create:{width:100,height:100,channels:4,background:'#ff0000'}}).png().toBuffer(),panel={background:'#000000',layers:[{asset:'art:a',x:.5,y:.5,width:.5}]},read=async()=>({data,permissions:{reuse:true}});
 const plain=await renderStudioPanel({width:100,height:100,dpi:100},panel,read),guided=await renderStudioPanel({width:100,height:100,dpi:100,templateUrl:'https://supplier.test/guide-with-lines.png',template:{width:200,height:200}},panel,read);assert.equal(guided.sha256,plain.sha256);assert.deepEqual(guided.data,plain.data);
});

test('editor explains locks, waits for the exact recovery revision, and never copies layouts to a different print canvas',async()=>{
 const {compatiblePrintArea,draftSaveStatus,editorBlockReason}=await import('./public/product-studio-state.js');
 assert.equal(compatiblePrintArea({width:100,height:200,dpi:150},{width:100,height:200,dpi:150}),true);assert.equal(compatiblePrintArea({width:100,height:200,dpi:150},{width:200,height:200,dpi:150}),false);
 assert.equal(draftSaveStatus({revision:2,recovery:{confirmedRevision:1}},2),'pending');assert.equal(draftSaveStatus({revision:3,recovery:{confirmedRevision:3}},2),'changed');assert.equal(draftSaveStatus({revision:2,recovery:{error:'offline'}},2),'failed');assert.equal(draftSaveStatus({revision:2,recovery:{confirmedRevision:2}},2),'confirmed');
 assert.match(editorBlockReason(true,null,true),/in progress/);assert.match(editorBlockReason(false,{state:'publishing',error:'Waiting for GitHub'},true),/You can edit and Save app draft now/);assert.match(editorBlockReason(false,null,false),/Select Edit artwork/);assert.equal(editorBlockReason(false,{state:'failed'},true),'');assert.match(editorBlockReason(false,null,true,false),/Replace it from the library/);
});

test('reopening an edited product resolves its saved artwork IDs after the collection artwork changes',async t=>{
 const f=await fixture(t),d=await f.document();await f.call('save',{source:f.p.id,revision:0,document:d});
 f.db.prepare('INSERT INTO factory_artwork SELECT ?,name,mime,data,permissions FROM factory_artwork WHERE id=?').run('replacement','art1');
 f.options.editor.library=()=>({pieces:[f.p],products:[],sets:[{id:'rose',name:'Updated collection',parts:{front:{name:'New front',artwork:'replacement'}}}]});f.restart();
 const opened=await f.open();assert.equal(opened.document.variants['11'].front.layers[0].asset,'art:art1');assert.ok(opened.originals.some(a=>a.asset==='art:art1'&&a.width===100&&a.height===100));assert.ok(opened.originals.some(a=>a.asset==='art:replacement'));assert.equal(f.counts().puts,0);
});

test('draft edits remain independent while an older supplier/store update is unfinished',async t=>{
 const f=await fixture(t),submitted=await f.document();
 await f.call('finish',{source:f.p.id,revision:0,document:submitted,target:'store',confirmPublication:true});
 const id=f.job().id;f.db.prepare("UPDATE factory_studio_jobs SET state='publishing',error=? WHERE id=?").run('Waiting for the app automatic GitHub publishing connection.',id);
 const frozen=JSON.stringify(f.job().document),next=structuredClone(submitted);next.variants[11].front.layers[0].x=.25;
 const saved=await f.call('save',{source:f.p.id,revision:1,document:next});assert.equal(saved.revision,2);assert.equal(saved.printfulUpdated,false);
 const opened=await f.open();assert.equal(opened.document.variants[11].front.layers[0].x,.25);assert.equal(opened.job.id,id);assert.equal(opened.job.state,'publishing');assert.equal(JSON.stringify(f.job().document),frozen);
 await assert.rejects(f.call('finish',{source:f.p.id,revision:2,document:next,target:'mockups'}),/unfinished update/);assert.equal(f.counts().puts,0);assert.equal(f.counts().posts,0);
 f.db.prepare("UPDATE factory_studio_jobs SET state='completed' WHERE id=?").run(id);const queued=await f.call('finish',{source:f.p.id,revision:2,document:next,target:'printful'});assert.notEqual(queued.job.id,id);
});


test('Finish preserves unsaved artwork when supplier-template validation rejects the update',async t=>{
 const {finishSavedDraft}=await import('./public/product-studio-state.js'),f=await fixture(t),document=await f.document();document.templateStamp='stale-template';document.variants[11].front.layers[0].x=.3;let saved;
 const api=async(path,data)=>{const r=await f.call(path,data);if(r.error)throw Object.assign(Error(r.error),{issues:r.issues});return r;};
 await assert.rejects(finishSavedDraft({source:f.p.id,revision:0,document,dirty:true,target:'printful',api,onSaved:r=>{saved=r;}}),/Draft revision 1 stored in the app.*supplier template changed/);
 assert.equal(saved.revision,1);assert.equal((await f.open()).document.variants[11].front.layers[0].x,.3);assert.equal(f.job(),null);assert.equal(f.counts().puts,0);
 document.templateStamp=(await f.open()).templateStamp;const result=await finishSavedDraft({source:f.p.id,revision:1,document,dirty:true,target:'printful',api});assert.equal(result.revision,2);assert.equal(result.job.state,'queued');
});

test('a Save receipt from before Finish cannot impersonate a conflicting tab or overwrite current action status',async()=>{
 const {draftSaveStatus}=await import('./public/product-studio-state.js');const status={revision:16,recovery:{confirmedRevision:16}};
 assert.equal(draftSaveStatus(status,15,{currentRevision:16}),'obsolete');assert.equal(draftSaveStatus(status,15,{currentRevision:15,busy:true}),'obsolete');assert.equal(draftSaveStatus(status,15,{currentRevision:15,dirty:true}),'obsolete');assert.equal(draftSaveStatus(status,15,{currentRevision:15}),'changed');
});


test('whole-design sleeve fitting preserves large scale, adjusts position, and passes the renderer without crop permission',async()=>{
 const {wholeArtworkFit}=await import('./public/product-template-geometry.js');
 const png=await sharp({create:{width:100,height:100,channels:4,background:'#000000'}}).composite([{input:await sharp({create:{width:20,height:40,channels:4,background:'#ff0000'}}).png().toBuffer(),left:40,top:30}]).png().toBuffer();
 const area={width:200,height:100,dpi:100,placement:'sleeve_right'},source={width:100,height:100,contentBounds:{x:40,y:30,width:20,height:40}},l={asset:'art:one',x:.5,y:.9,width:1,rotation:0,mirror:false,allowModify:false},read=async()=>({data:png,permissions:{reuse:true}});
 const doc={variants:{v:{sleeve_right:{background:'#000000',layers:[l]}}}},variants=[{id:'v',areas:[area]}];
 const issues=await studioPlacementIssues(variants,doc,read);assert.equal(issues[0].placement,'sleeve_right');assert.match(issues[0].message,/Keep whole design inside/);
 const fitted=wholeArtworkFit(area,source,l);assert.equal(fitted.width,1);assert.ok(fitted.y<l.y);assert.equal(l.y,.9);doc.variants.v.sleeve_right.layers[0]=fitted;assert.deepEqual(await studioPlacementIssues(variants,doc,read),[]);await renderStudioPanel(area,doc.variants.v.sleeve_right,read);
 const smaller=wholeArtworkFit(area,source,{...l,width:2});assert.ok(smaller.width<2);assert.ok(smaller.width>1);
});

test('Finish identifies the overflowing panel before creating a job or touching the supplier',async t=>{
 const f=await fixture(t),d=await f.document();d.variants[11].front.layers[0].y=0;
 const r=await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});assert.match(r.error,/visible artwork/);assert.equal(r.issues[0].placement,'front');assert.equal(f.counts().puts,0);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_jobs').get().n,0);
});

test('large padded long-sleeve artwork renders beyond one canvas width without changing the native canvas',async()=>{
 const png=await sharp({create:{width:100,height:100,channels:4,background:'#000000'}}).composite([{input:await sharp({create:{width:10,height:50,channels:4,background:'#ff0000'}}).png().toBuffer(),left:45,top:25}]).png().toBuffer();
 const area={placement:'sleeve_left',width:3910,height:4445,dpi:150},panel={background:'#000000',layers:[{asset:'art:one',x:.5,y:.5,width:2,allowModify:false}]};
 const rendered=await renderStudioPanel(area,panel,async()=>({data:png,permissions:{reuse:true}}));assert.equal(rendered.width,3910);assert.equal(rendered.height,4445);assert.ok(rendered.effectiveDpi<2);
 const m=await sharp(rendered.data).metadata();assert.equal(m.width,3910);assert.equal(m.height,4445);
 const center=await sharp(rendered.data).extract({left:1955,top:2222,width:1,height:1}).raw().toBuffer();assert.deepEqual(Array.from(center),[255,0,0,255]);
 const edge=await sharp(rendered.data).extract({left:0,top:2222,width:1,height:1}).raw().toBuffer();assert.deepEqual(Array.from(edge),[0,0,0,255]);
 panel.layers[0].y=0;await assert.rejects(renderStudioPanel(area,panel,async()=>({data:png,permissions:{reuse:true}})),/outside its reviewed safe region/);
});

test('larger-than-canvas owner width survives Save, restart, reopening, and supplier update',async t=>{
 const f=await fixture(t),png=await sharp({create:{width:100,height:100,channels:4,background:'#000000'}}).composite([{input:await sharp({create:{width:20,height:40,channels:4,background:'#ff0000'}}).png().toBuffer(),left:40,top:30}]).png().toBuffer();f.db.prepare('UPDATE factory_artwork SET data=? WHERE id=?').run(png,'art1');
 const d=await f.document();d.variants[11].front.layers[0].width=1.5;const saved=await f.call('save',{source:f.p.id,revision:0,document:d});f.restart();const o=await f.open();assert.equal(o.document.variants[11].front.layers[0].width,1.5);await f.call('finish',{source:f.p.id,revision:saved.revision,document:o.document,target:'printful'});
 for(let n=0;n<10&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,0);
});

test('a timed out checkpoint retains the tracked supplier update for a bounded retry',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});while(f.job().state!=='updating_printful')await f.tick();let failOnce=true;
 f.options.backups.checkpoint=async()=>{if(failOnce){failOnce=false;throw new DOMException('The operation was aborted due to timeout','TimeoutError');}};
 await f.tick();assert.equal(f.job().state,'updating_printful');assert.match(f.job().error,/timeout/);assert.equal(f.counts().puts,0);assert.equal(f.job().attempts,1);
 for(let n=0;n<12&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);
});

test('native compositions yield after each render and still reuse exact size mappings',async t=>{
 const f=await fixture(t),bp=await f.options.blueprints.load(),placements=['front','back','sleeve_left','sleeve_right'];
 bp.printfiles.variant_printfiles.forEach(v=>v.placements=Object.fromEntries(placements.map(p=>[p,1])));f.options.stepAssetLimit=4;f.restart();
 const d=await f.document();d.variants[11]=Object.fromEntries(placements.map((p,i)=>[p,{background:'#000000',layers:[{asset:'art:art1',x:.3+i*.1,y:.5,width:.5,rotation:0}]}]));d.variants[12]=structuredClone(d.variants[11]);
 await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});await f.tick();await f.tick();assert.equal(f.job().document.outputs.length,1);
 for(let n=0;n<6&&f.job().state==='rendering';n++)await f.tick();assert.equal(f.job().state,'updating_printful');assert.equal(f.job().document.outputs.length,8);
 for(const p of placements){const a=f.job().document.outputs.filter(x=>x.placement===p);assert.equal(a.length,2);assert.equal(a[0].asset,a[1].asset);}
 assert.equal(f.counts().puts,0);
});
test('supplier processing polls do not wait for another full backup, while the first PUT remains checkpointed',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});while(f.job().state!=='updating_printful')await f.tick();
 let blocked=0;f.options.backups.checkpoint=async()=>{blocked++;throw Object.assign(Error('checkpoint temporarily unavailable'),{status:503});};
 await f.tick();assert.ok(blocked>=1);assert.equal(f.counts().puts,0);assert.equal(f.job().state,'updating_printful');
 f.options.backups.checkpoint=async()=>{};for(let n=0;n<5&&!f.counts().puts;n++)await f.tick();assert.equal(f.counts().puts,1);
 f.supplier.sync_variants[0].files.find(x=>x.type==='front').status='waiting';
 f.options.backups.checkpoint=async()=>{throw Error('a read-only poll started a full backup');};
 await f.tick();assert.equal(f.job().state,'updating_printful');assert.equal(f.job().error,'');assert.equal(f.counts().puts,1);
});
test('a backup failure before mockup POST remains retryable and never invents an uncertain provider submission',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});while(f.job().state!=='mockups')await f.tick();
 f.options.backups.checkpoint=async()=>{throw Object.assign(Error('backup temporarily unavailable'),{status:503});};
 await f.tick();assert.equal(f.counts().posts,0);assert.equal(f.job().state,'mockups');assert.equal(f.job().document.tasks.length,0);
 f.options.backups.checkpoint=async()=>{};for(let n=0;n<20&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().posts,2);
});
test('the production batch saves every returned mockup and publishes the same listing with all images',async t=>{
 const f=await fixture(t),base=f.options.fetchImpl;f.options.stepAssetLimit=4;f.options.fetchImpl=async(u,o)=>{
  if(u.includes('/mockup-generator/task?'))return new Response(JSON.stringify({result:{task_key:new URL(u).searchParams.get('task_key'),status:'completed',mockups:[{variant_ids:[21,22],placement:'front',mockup_url:'https://files.printful.com/front.jpg',extra:Array.from({length:8},(_,i)=>({url:'https://files.printful.com/view'+i+'.jpg',title:'View '+i,option_group:'Flat'}))}]}}));
  if(u.startsWith('https://files.printful.com/')){const n=Number(u.match(/view(\d+)/)?.[1]||10);return new Response(await sharp({create:{width:10,height:10,channels:4,background:{r:n*20,g:30,b:50,alpha:1}}}).png().toBuffer(),{headers:{'Content-Type':'image/png'}});}
  return base(u,o);
 };f.restart();await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});
 for(let n=0;n<30&&!f.job().document.tasks?.some(t=>t.state==='downloading');n++)await f.tick();
 await f.tick();assert.equal(f.job().document.images.length,4);await f.tick();assert.equal(f.job().document.images.length,8);
 for(let n=0;n<30&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.job().document.images.length,9);assert.equal(f.job().document.storeProduct.images.length,9);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,2);
});

test('a newer saved draft keeps its own artwork and can finish after the earlier supplier update completes',async t=>{
 const f=await fixture(t),original=await f.document();await f.call('finish',{source:f.p.id,revision:0,document:original,target:'printful'});
 const revised=structuredClone(original);revised.variants[11].front.layers[0].x=.3;await f.call('save',{source:f.p.id,revision:1,document:revised});
 for(let n=0;n<20&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);
 const opened=await f.open();assert.equal(opened.revision,2);assert.equal(opened.document.variants[11].front.layers[0].x,.3);assert.equal(opened.document.fingerprint,opened.fingerprint);
 const next=await f.call('finish',{source:f.p.id,revision:2,document:opened.document,target:'printful'});assert.equal(next.job.revision,2);assert.equal(next.job.state,'queued');
});
test('the update audit lists saved-only drafts and exact latest supplier jobs without exposing artwork bytes',async t=>{
 const f=await fixture(t),d=await f.document();await f.call('save',{source:f.p.id,revision:0,document:d});
 const read=async()=>{const res={};await factoryProductStudio(f.options).handle({headers:{}},res,ROOT+'/updates','GET',new URL('https://app.test'));return res.data;};
 let s=await read();assert.equal(s.updates[0].draftRevision,1);assert.equal(s.updates[0].job,null);assert.equal(s.updates[0].placements,1);
 await f.call('finish',{source:f.p.id,revision:1,document:d,target:'store',confirmPublication:true});s=await read();assert.equal(s.updates[0].job.id,f.job().id);assert.equal(s.updates[0].job.target,'store');assert.equal(s.updates[0].job.files,0);assert.ok(!JSON.stringify(s).includes('art:art1'));
});

test('independent supplier waits run concurrently, but the same tracked job never runs twice',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});while(f.job().state!=='updating_printful')await f.tick();
 const j=f.job(),d=structuredClone(j.document);d.supplier.sync_product.id=456;f.db.prepare("INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)").run('second','456','piece:two',1,'printful','updating_printful',JSON.stringify(d),j.updated-1);
 const base=f.options.fetchImpl;f.options.fetchImpl=async(u,o)=>u.endsWith('/store/products/456')?new Response(JSON.stringify({result:{...f.supplier,sync_product:{...f.supplier.sync_product,id:456}}})):base(u,o);
 let release,entered=0;const gate=new Promise(r=>release=r);f.options.backups.checkpoint=async()=>{entered++;await gate;throw Object.assign(Error('temporary backup wait'),{status:503});};f.restart();
 const first=f.tick();await new Promise(r=>setImmediate(r));const second=f.tick();await new Promise(r=>setImmediate(r));assert.equal(entered,2);await f.tick();assert.equal(entered,2);assert.equal(f.counts().puts,0);
 release();await Promise.all([first,second]);assert.equal(f.db.prepare("SELECT count(*) n FROM factory_studio_jobs WHERE state='updating_printful'").get().n,2);assert.equal(f.counts().puts,0);
});
test('native image processing remains serial when multiple products are eligible',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});await f.tick();const j=f.job();
 f.db.prepare("INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)").run('second','456','piece:two',1,'printful','rendering',JSON.stringify(j.document),j.updated-1);
 let release,entered=0;const gate=new Promise(r=>release=r),put=f.options.assets.put;f.options.assets.put=async(...a)=>{entered++;await gate;return put(...a);};f.restart();
 const first=f.tick();for(let n=0;n<30&&!entered;n++)await new Promise(r=>setTimeout(r,5));assert.equal(entered,1);await f.tick();assert.equal(entered,1);release();await first;assert.equal(entered,1);
});

test('generated print bytes go directly to verified asset storage instead of churning the database backup',async t=>{
 const f=await fixture(t),put=f.options.assets.put;let failed=false;f.options.assets.put=async(...a)=>{const row=f.db.prepare('SELECT length(data) n,remote FROM factory_studio_assets WHERE id=?').get(a[2]);assert.equal(row.n,0);assert.equal(row.remote,null);if(!failed){failed=true;throw Object.assign(Error('temporary attachment failure'),{status:503});}assert.ok(a[3].length);return put(...a);};
 await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});for(let n=0;n<20&&f.job().state!=='completed';n++)await f.tick();
 assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.equal(f.db.prepare("SELECT count(*) n FROM factory_studio_assets WHERE kind='print'").get().n,1);assert.equal(f.db.prepare('SELECT sum(length(data)) n FROM factory_studio_assets').get().n,0);
});
test('concurrent immutable print downloads share one authenticated read and recover after a failed read',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});while(!f.job().document.outputs.length)await f.tick();
 const a=f.db.prepare("SELECT * FROM factory_studio_assets WHERE kind='print'").get(),read=f.options.assets.read;let calls=0,failRead=true;
 f.options.assets.read=async(...args)=>{calls++;await new Promise(r=>setImmediate(r));if(failRead)throw Object.assign(Error('temporary download failure'),{status:503});return read(...args);};f.restart();
 const studio=factoryProductStudio(f.options),download=async()=>{const res={writeHead(){},end(bytes){this.data=bytes;}};await studio.handle({headers:{}},res,'/factory-studio-file/'+a.capability,'GET',new URL('https://app.test'));return res.data;};
 const failed=await Promise.allSettled([download(),download(),download(),download()]);assert.ok(failed.every(r=>r.status==='rejected'));assert.equal(calls,1);failRead=false;
 const files=await Promise.all([download(),download(),download(),download()]);assert.equal(calls,2);assert.ok(files.every(b=>b.equals(files[0])));assert.equal((await sharp(files[0]).metadata()).width,100);
});

test('recovered panels yield during a slow backup but cannot submit mockups before their checkpoint',async t=>{
 const f=await fixture(t);await archived(f);const d=await f.document();d.variants={};await f.call('finish',{source:f.p.id,revision:0,document:d,target:'mockups'});while(f.job().state!=='mockups')await f.tick();
 let release;f.options.backups.checkpoint=()=>new Promise(r=>release=r);await f.tick();assert.equal(Object.keys(f.job().document.baseFiles).length,2);assert.equal(f.counts().posts,0);release();await new Promise(r=>setImmediate(r));f.options.backups.checkpoint=async()=>{};await f.tick();assert.equal(f.counts().posts,1);
});
test('ready store publication finishes before another product starts expensive rendering',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});while(f.job().state!=='publishing')await f.tick();const j=f.job(),other=structuredClone(j.document);other.outputs=[];
 f.db.prepare("INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)").run('second','456','piece:two',1,'printful','rendering',JSON.stringify(other),j.updated-100000);
 await f.tick();const next=JSON.parse(f.db.prepare('SELECT document FROM factory_studio_jobs WHERE id=?').get(j.id).document);assert.ok(next.images.some(i=>i.storeUrl));assert.equal(JSON.parse(f.db.prepare("SELECT document FROM factory_studio_jobs WHERE id='second'").get().document).outputs.length,0);
});

test('supplier variant writes follow their paced lane without changing the requested file assignments',async t=>{
 const f=await fixture(t);let now=2000000;const waits=[],wire=[],base=f.options.fetchImpl;f.options.clock=()=>now;f.options.supplierWriteGapMs=6600;f.options.sleep=async ms=>{waits.push(ms);now+=ms;};f.options.fetchImpl=async(u,o)=>{if(u.includes('/store/variants/'))wire.push(now);return base(u,o);};f.restart();
 const d=await f.document();d.variants[12]=structuredClone(d.variants[11]);await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});
 for(let n=0;n<20&&f.job().state!=='completed';n++){now+=32000;await f.tick();}
 assert.equal(f.job().state,'completed',f.job().error);assert.equal(wire.length,2);assert.ok(wire[1]-wire[0]>=6600);assert.ok(waits.includes(6600));assert.equal(f.counts().puts,2);
});
test('mockup pacing uses actual request times even when a preparation checkpoint was slow',async t=>{
 const f=await fixture(t);let now=3000000,delayed=false;const wire=[],waits=[],base=f.options.fetchImpl;f.options.clock=()=>now;f.options.mockupWriteGapMs=31000;f.options.sleep=async ms=>{waits.push(ms);now+=ms;};f.options.fetchImpl=async(u,o)=>{if(u.includes('/create-task/'))wire.push(now);return base(u,o);};
 f.options.backups.checkpoint=async()=>{if(!delayed&&f.job()?.state==='mockups'&&f.job().document.tasks?.some(t=>!t.key)){delayed=true;now+=60000;}};f.restart();
 await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});
 for(let n=0;n<20&&f.job().state!=='mockups';n++){now+=16000;await f.tick();}assert.equal(f.job().state,'mockups');
 for(let n=0;n<40&&f.job().state!=='completed';n++){now++;await f.tick();}
 assert.equal(f.job().state,'completed',f.job().error);assert.equal(wire.length,2);assert.ok(wire[1]-wire[0]>=31000);assert.ok(waits.some(ms=>ms>30000));assert.equal(f.counts().posts,2);
});

test('mockup network waits share checkpoints while a separate native render can still progress',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});while(f.job().state!=='mockups')await f.tick();const j=f.job(),other=structuredClone(j.document);other.supplier.sync_product.id=456;
 f.db.prepare("INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)").run('second','456','piece:two',1,'mockups','mockups',JSON.stringify(other),j.updated-1);
 const native=structuredClone(j.document);native.outputs=[];native.tasks=[];native.images=[];f.db.prepare("INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)").run('third','789','piece:three',1,'printful','rendering',JSON.stringify(native),j.updated-2);
 let release,releaseNative,checkpoints=0,renders=0;const gate=new Promise(r=>release=r),nativeGate=new Promise(r=>releaseNative=r),put=f.options.assets.put;
 f.options.backups.checkpoint=async()=>{checkpoints++;await gate;};f.options.assets.put=async(...a)=>{renders++;await nativeGate;return put(...a);};f.restart();
 const first=f.tick();await new Promise(r=>setImmediate(r));const second=f.tick();await new Promise(r=>setImmediate(r));assert.equal(checkpoints,2);
 const third=f.tick();for(let n=0;n<40&&!renders;n++)await new Promise(r=>setTimeout(r,5));assert.equal(renders,1);await f.tick();assert.equal(renders,1);assert.equal(f.counts().posts,0);
 release();releaseNative();await Promise.all([first,second,third]);assert.equal(f.counts().posts,2);for(const id of [j.id,'second'])assert.ok(JSON.parse(f.db.prepare('SELECT document FROM factory_studio_jobs WHERE id=?').get(id).document).tasks.some(t=>t.key));
});


// Native supplier output may legitimately exceed the source artwork pixel cap.
test('stores a native print canvas above 40 megapixels without shrinking the approved layout',async t=>{
 const f=await fixture(t),bp=await f.options.blueprints.load();bp.printfiles.printfiles[0].width=6500;bp.printfiles.printfiles[0].height=6500;
 const d=await f.document();await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});
 await f.tick();await f.tick();assert.notEqual(f.job().state,'failed',f.job().error);
 const out=f.job().document.outputs[0];assert.equal(out.width,6500);assert.equal(out.height,6500);assert.ok(out.asset);
});

test('adding several designs preserves existing layers, proportions and the eight-design boundary',async()=>{
 const {addDesignLayers}=await import('./public/product-studio-state.js');
 const original={background:'#000000',layers:[{asset:'original',x:.2,y:.3,width:.25,rotation:0,mirror:false}]},saved=structuredClone(original),art=[{asset:'one',width:200,height:100},{asset:'two',width:100,height:200}],a={width:1000,height:1000};
 const next=addDesignLayers(original,art,a);assert.deepEqual(original,saved);assert.deepEqual(next.layers[0],saved.layers[0]);assert.equal(next.layers.length,3);assert.notEqual(next.layers[1].x,next.layers[2].x);assert.ok(next.layers[1].width<=.325);assert.equal(addDesignLayers(original,art,a,{replace:true}).layers.length,2);
 const full={background:'#000000',layers:Array.from({length:8},()=>saved.layers[0])};assert.throws(()=>addDesignLayers(full,art,a),/eight designs/);assert.equal(full.layers.length,8);
});

test('two different designs survive Save, reopen and Finish in the same exact print file',async t=>{
 const f=await fixture(t),blue=await sharp({create:{width:100,height:100,channels:4,background:'#0000ff'}}).png().toBuffer();f.db.prepare('INSERT INTO factory_artwork VALUES(?,?,?,?,?)').run('art2','Blue detail','image/png',blue,JSON.stringify({reuse:true,modify:false,crop:false}));
 const d=await f.document();d.variants[11].front.layers=[{asset:'art:art1',x:.25,y:.5,width:.25,rotation:0},{asset:'art:art2',x:.75,y:.5,width:.25,rotation:0}];const saved=await f.call('save',{source:f.p.id,revision:0,document:d});f.restart();assert.deepEqual((await f.open()).document.variants[11].front.layers,saved.document.variants[11].front.layers);
 await f.call('finish',{source:f.p.id,revision:saved.revision,document:saved.document,target:'printful'});for(let n=0;n<15&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);const output=f.job().document.outputs[0],row=f.db.prepare('SELECT remote FROM factory_studio_assets WHERE id=?').get(output.asset),png=await f.options.assets.read(JSON.parse(row.remote).asset),{data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true}),pixel=x=>[...data.subarray((50*info.width+x)*info.channels,(50*info.width+x)*info.channels+3)];assert.deepEqual(pixel(25),[255,0,0]);assert.deepEqual(pixel(75),[0,0,255]);assert.equal(f.counts().puts,1);
});

test('an older render receives a turn instead of starving behind newer mockup and publishing work',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});while(f.job().state!=='publishing')await f.tick();const j=f.job(),other=structuredClone(j.document);other.outputs=[];other.tasks=[];other.images=[];
 f.db.prepare('INSERT INTO factory_studio_jobs(id,supplier,source,revision,target,state,document,updated) VALUES(?,?,?,?,?,?,?,?)').run('waiting-native','456','piece:two',1,'printful','rendering',JSON.stringify(other),j.updated-600000);await f.tick();const row=f.db.prepare("SELECT document FROM factory_studio_jobs WHERE id='waiting-native'").get();assert.equal(JSON.parse(row.document).outputs.length,1);
});

test('studio retries never run before a supplier or storage reset beyond fifteen minutes',async t=>{
 const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});while(f.job().state!=='updating_printful')await f.tick();const before=f.job().updated;f.options.backups.checkpoint=async()=>{throw Object.assign(Error('rate pause'),{status:429,retryAfter:3600});};await f.tick();assert.equal(f.job().state,'updating_printful');assert.ok(f.job().next>=before+3600000);assert.equal(f.counts().puts,0);
});

test('background removal clears only connected solid color and preserves enclosed details and native dimensions',async()=>{
 const {removeArtworkBackground}=await import('./public/product-studio-state.js');
 const w=9,h=9,pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)pixels.set([255,255,255,255],i*4);
 for(let y=2;y<7;y++)for(let x=2;x<7;x++)pixels.set([200,0,20,255],(y*w+x)*4);
 pixels.set([255,255,255,255],(4*w+4)*4);const result=removeArtworkBackground(pixels,w,h,35);
 assert.equal(result.removed,56);assert.equal(pixels[3],0);assert.equal(pixels[(2*w+2)*4+3],255);assert.equal(pixels[(4*w+4)*4+3],255);assert.deepEqual(result.color,[255,255,255]);
 const black=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)black.set([0,0,0,255],i*4);for(let y=2;y<7;y++)for(let x=2;x<7;x++)black.set([200,0,20,255],(y*w+x)*4);black.set([0,0,0,255],(4*w+4)*4);removeArtworkBackground(black,w,h,0);assert.equal(black[3],0);assert.equal(black[(4*w+4)*4+3],255);
});
test('background removal rejects complex scenery, empty subjects and invalid recipes',async()=>{
 const {removeArtworkBackground}=await import('./public/product-studio-state.js');const pixels=new Uint8Array(10*10*4);for(let i=0;i<100;i++)pixels.set(i%2?[255,255,255,255]:[0,0,0,255],i*4);
 assert.throws(()=>removeArtworkBackground(pixels,10,10,35),/several colors/);
 assert.throws(()=>removeArtworkBackground(new Uint8Array(100*4).fill(255),10,10,35),/No distinct artwork/);
 assert.throws(()=>removeArtworkBackground(pixels,10,10,-1),/strength/);
 assert.throws(()=>studioLayers({background:null,layers:[{asset:'art:art1',x:.5,y:.5,width:1,backgroundRemoval:{tolerance:999}}]}),/background removal strength/);
});
test('background removal saves, reopens after restart and renders transparent native files into the same supplier product',async t=>{
 const f=await fixture(t),png=await sharp({create:{width:100,height:100,channels:4,background:'#ffffff'}}).composite([{input:await sharp({create:{width:40,height:40,channels:4,background:'#ff0000'}}).png().toBuffer(),left:30,top:30}]).png().toBuffer();
 f.db.prepare('UPDATE factory_artwork SET data=? WHERE id=?').run(png,'art1');const d=await f.document();d.variants[11].front={background:null,layers:[{asset:'art:art1',x:.5,y:.5,width:1,rotation:0,backgroundRemoval:{tolerance:35}}]};
 const saved=await f.call('save',{source:f.p.id,revision:0,document:d});f.restart();const opened=await f.open();assert.deepEqual(opened.document.variants[11].front.layers[0].backgroundRemoval,{tolerance:35});assert.equal(opened.revision,saved.revision);
 await f.call('finish',{source:f.p.id,revision:saved.revision,document:opened.document,target:'printful'});for(let n=0;n<12&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);
 const output=f.job().document.outputs[0],a=f.db.prepare('SELECT remote FROM factory_studio_assets WHERE id=?').get(output.asset),data=await f.options.assets.read(JSON.parse(a.remote).asset),raw=await sharp(data).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(raw.info.width,100);assert.equal(raw.info.height,100);assert.equal(raw.data[3],0);assert.equal(raw.data[(50*100+50)*4],255);assert.equal(raw.data[(50*100+50)*4+3],255);
 assert.deepEqual(Buffer.from(f.db.prepare('SELECT data FROM factory_artwork WHERE id=?').get('art1').data),png);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,0);assert.equal(f.supplier.sync_variants[0].id,11);assert.equal(f.supplier.sync_variants[0].files.find(x=>x.type==='back').id,41);assert.equal(f.supplier.sync_variants[0].retail_price,'49.99');
 const restored=structuredClone(opened.document.variants[11].front);delete restored.layers[0].backgroundRemoval;const rendered=await renderStudioPanel({width:100,height:100,dpi:100},restored,async()=>({data:png,permissions:{reuse:true}}));const original=await sharp(rendered.data).ensureAlpha().raw().toBuffer();assert.equal(original[0],255);assert.equal(original[3],255);
});
test('background-removal settings belong to individual layers and do not bypass reuse permission',async()=>{
 const white=await sharp({create:{width:20,height:20,channels:4,background:'#ffffff'}}).composite([{input:await sharp({create:{width:8,height:8,channels:4,background:'#ff0000'}}).png().toBuffer(),left:6,top:6}]).png().toBuffer(),blue=await sharp({create:{width:20,height:20,channels:4,background:'#0000ff'}}).png().toBuffer();
 const panel={background:null,layers:[{asset:'one',x:.25,y:.5,width:.5,backgroundRemoval:{tolerance:35}},{asset:'two',x:.75,y:.5,width:.5}]},read=async id=>({data:id==='one'?white:blue,permissions:{reuse:true}});
 const r=await renderStudioPanel({width:40,height:20,dpi:100},panel,read),raw=await sharp(r.data).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0);assert.equal(raw[(10*40+30)*4+2],255);assert.equal(raw[(10*40+30)*4+3],255);
 await assert.rejects(renderStudioPanel({width:40,height:20,dpi:100},panel,async()=>({data:white,permissions:{reuse:false}})),/Allow Reuse/);
});
test('scanline background removal matches independent flood fill around narrow gaps and disconnected regions',async()=>{
 const {removeArtworkBackground}=await import('./public/product-studio-state.js');let random=12345;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2**32;};
 for(let n=0;n<100;n++){const w=15,h=11,p=new Uint8Array(w*h*4).fill(255);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(next()<.4)p.set([200,0,20,255],(y*w+x)*4);p.set([200,0,20,255],(5*w+7)*4);const expected=p.slice(),seen=new Set(),queue=[0];while(queue.length){const i=queue.shift();if(seen.has(i))continue;seen.add(i);if(expected[i*4]!==255)continue;expected[i*4+3]=0;const x=i%w,y=Math.floor(i/w);if(x)queue.push(i-1);if(x+1<w)queue.push(i+1);if(y)queue.push(i-w);if(y+1<h)queue.push(i+w);}removeArtworkBackground(p,w,h,0);assert.deepEqual(p,expected);}
});
