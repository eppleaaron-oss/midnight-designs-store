import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {renderArea} from './factory-rendering.mjs';
import {factoryProductStudio,renderStudioPanel,studioLayers,studioProductionPanel} from './factory-product-studio.mjs';
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
 const options={db,editor:{library:()=>({pieces:[p,sibling],products:[],sets:[{id:'rose',name:'Rose original hoodie',parts:{front:{name:'Rose front',artwork:'art1'}}}]})},blueprints:{load:async()=>bp},workflow:{sourceFile:async p=>p.artwork},basic:{storeToken:()=>'store-key'},backups:{connection:()=>null,checkpoint:async()=>{backupCount++;}},auth:()=>{authCalls++;},body:async req=>req.payload,send:(res,status,data)=>{res.data=data;res.status=status;},fail:(status,message)=>{throw Object.assign(Error(message),{status});},limit:()=>{},origin:'https://app.test',fetchImpl,clock:()=>time,token:'secret',assets};
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
test('rendered pixels preserve proportions, black fill, real placement and reject insufficient source resolution',async()=>{const png=await sharp({create:{width:100,height:50,channels:4,background:'#ff0000'}}).png().toBuffer(),a={width:100,height:100,dpi:100};const rendered=await renderStudioPanel(a,{background:'#000000',layers:[{asset:'art:one',x:.5,y:.5,width:.5}]},async()=>({data:png,permissions:{reuse:true}}));const {data,info}=await sharp(rendered.data).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,100);assert.equal(data[0],0);assert.equal(data[(50*100+50)*info.channels],255);await assert.rejects(renderStudioPanel({...a,width:1000,height:1000},{background:'#000000',layers:[{asset:'art:one',x:.5,y:.5,width:.8}]},async()=>({data:png,permissions:{reuse:true}})),/resolution is too low/);});
test('draft revisions reject races; wrong variants and placements never reach Printful',async t=>{const f=await fixture(t),d=await f.document();const saved=await f.call('save',{source:f.p.id,revision:0,document:d});assert.equal(saved.printfulUpdated,false);await assert.rejects(f.call('save',{source:f.p.id,revision:0,document:d}),/another tab/);const wrong=structuredClone(d);wrong.variants[999]=wrong.variants[11];await assert.rejects(f.call('finish',{source:f.p.id,revision:1,document:wrong,target:'printful'}),/does not belong/);assert.equal(f.counts().puts,0);assert.equal(f.db.prepare('SELECT revision FROM factory_studio_drafts').get().revision,1);});
test('Finish updates the same variant, preserves untouched files/options/prices, checkpoints and reopens',async t=>{const f=await fixture(t),d=await f.document(),r=await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});assert.equal(r.job.printfulUpdated,false);await assert.rejects(f.call('finish',{source:f.p.id,revision:1,document:d,target:'printful'}),/unfinished update/);for(let n=0;n<10&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.equal(f.counts().posts,0);assert.equal(f.supplier.sync_variants[0].id,11);assert.equal(f.supplier.sync_variants[0].retail_price,'49.99');assert.equal(f.supplier.sync_variants[0].files.find(f=>f.type==='back').id,41);assert.equal(f.supplier.sync_variants[1].files[0].id,32);assert.ok(f.counts().backupCount>2);const o=await f.open();assert.equal(o.document.fingerprint,o.fingerprint);assert.equal(o.job.printfulUpdated,true);});
test('restart reconciles a lost PUT response without creating or updating a duplicate product',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'printful'});f.setLostPut();for(let n=0;n<4;n++)await f.tick();f.restart();for(let n=0;n<8&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,1);assert.ok(f.calls.every(c=>!(c.url.endsWith('/store/products')&&c.method==='POST')));});
test('real accepted mockup tasks request all supplier styles and save every returned view',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});for(let n=0;n<35&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);const j=f.job().document;assert.equal(j.images.length,2);assert.ok(j.tasks.every(t=>t.key&&t.state==='saved'));assert.ok(f.calls.filter(c=>c.url.includes('create-task')).every(c=>c.body.option_groups.length===2&&c.body.options.length===2));assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_assets WHERE remote IS NOT NULL AND length(data)=0').get().n,2);});
test('a mockup rate limit retries with no false accepted task; uncertain submissions never resubmit',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});f.setLostMockup();for(let n=0;n<15&&f.job().state!=='failed';n++)await f.tick();assert.equal(f.job().state,'failed');assert.equal(f.job().document.tasks[0].key,null);await assert.rejects(f.call('retry',{source:f.p.id,id:f.job().id}),/uncertain outcome/);const before=f.counts().posts;f.restart();await f.tick();assert.equal(f.counts().posts,before);});
test('cross-origin actions fail and original artwork permissions prevent unapproved transforms',async t=>{const f=await fixture(t);await assert.rejects(f.call('open',{source:f.p.id},'https://other.test'),/Origin/);const d=await f.document();d.variants[11].front.layers[0].rotation=20;await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});for(let n=0;n<5&&f.job().state!=='failed';n++)await f.tick();assert.equal(f.job().state,'failed');assert.match(f.job().error,/Modify permission/);assert.equal(f.counts().puts,0);await f.call('cancel',{source:f.p.id,id:f.job().id});assert.equal(f.job().state,'cancelled');});
test('a concurrent Printful change is held before any update; validation rejects nonnumeric layout',async t=>{const f=await fixture(t);const d=await f.document();f.supplier.sync_variants[0].files[0].id=777;await assert.rejects(f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'}),/supplier product changed/);assert.equal(f.counts().puts,0);assert.throws(()=>studioLayers({background:'#000000',layers:[{asset:'art:a',x:NaN,y:.5,width:.5}]}),/Invalid horizontal/);});

test('store publishing retains product/variant IDs and verifies permanently saved photos before success',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'store',confirmPublication:true});for(let n=0;n<45&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.job().document.storeUpdated,true);const product=f.job().document.storeProduct;assert.equal(product.id,'123');assert.equal(product.description,'Existing description');assert.deepEqual(product.variants.map(v=>v.id),['11','12']);assert.ok(product.images.every(u=>u.startsWith('https://midnight-designs.store/images/factory/123/')));assert.ok(product.variants.every(v=>v.price===49.99&&v.images.length));});
test('Printful rate limits retry accepted work without inventing a task key or losing progress',async t=>{const f=await fixture(t);await f.call('finish',{source:f.p.id,revision:0,document:await f.document(),target:'mockups'});f.setRateMockup();for(let n=0;n<40&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.ok(f.job().document.tasks.every(t=>t.key&&t.state==='saved'));assert.equal(f.counts().puts,1);});

test('explicit owner crop permission permits panel-edge edits while protected artwork is held',async()=>{const data=await sharp({create:{width:100,height:100,channels:4,background:'#ff0000'}}).png().toBuffer(),area={width:100,height:100,dpi:100},panel={background:'#000000',layers:[{asset:'art:one',x:0,y:.5,width:.5,allowModify:true}]};const read=async()=>({data,permissions:{reuse:true}});const rendered=await renderStudioPanel(area,panel,read);assert.equal(rendered.width,100);panel.layers[0].allowModify=false;await assert.rejects(renderStudioPanel(area,panel,read),/outside its reviewed safe region/);});

async function archived(f,wrong=false){
 f.p.jobId='original-job';f.db.exec('CREATE TABLE factory_basic_items(job TEXT,recipe TEXT,cleanup TEXT); CREATE TABLE factory_render_plans(job TEXT,plan TEXT)');
 const area={placement:'front',width:100,height:100,dpi:100},recipe={artworkId:'art1',fit:'contain',scale:50,protect:true,withoutEnlargement:true},data=f.db.prepare('SELECT data FROM factory_artwork').get().data;
 const rendered=await renderArea(area,Buffer.from(data),{...recipe,background:'#000000'},{reuse:true});
 const checksum=wrong?'0'.repeat(64):rendered.sha256,cleanup={verified:true,templates:[21,22].map(variant=>({variant,areas:JSON.stringify([area])})),supplierReceipt:{variants:f.supplier.sync_variants.map(v=>({supplierVariantId:v.id,files:[{placement:'front',supplierFileId:v.files[0].id,sha256:checksum}]}))}};
 f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?)').run('original-job','{}',JSON.stringify(cleanup));f.db.prepare('INSERT INTO factory_render_plans VALUES(?,?)').run('original-job',JSON.stringify({background:'#000000',placements:{front:recipe}}));for(const v of f.supplier.sync_variants)v.files[0].url='https://app.test/factory-print-file/'+'a'.repeat(64);
}
test('archived production geometry opens as editable original layers without guessing at a flattened image',async t=>{const f=await fixture(t);await archived(f);const o=await f.open();assert.equal(o.basePanels['11'].front.layers[0].asset,'art:art1');assert.equal(o.basePanels['11'].front.layers[0].width,.5);assert.equal(o.basePanels['11'].front.layers[0].x,.5);assert.equal(studioProductionPanel({width:100,height:100},{artworkId:'x',tile:true},()=>({width:100,height:100})),null);});
test('expired temporary files recover exact checksummed production pixels before real mockups; supplier files remain unchanged',async t=>{const f=await fixture(t);await archived(f);const d=await f.document();d.variants={};await f.call('finish',{source:f.p.id,revision:0,document:d,target:'mockups'});for(let n=0;n<40&&f.job().state!=='completed';n++)await f.tick();assert.equal(f.job().state,'completed',f.job().error);assert.equal(f.counts().puts,0);assert.equal(Object.keys(f.job().document.baseFiles).length,2);assert.ok(f.calls.filter(c=>c.url.includes('create-task')).every(c=>c.body.files.some(f=>f.image_url.startsWith('https://app.test/factory-studio-file/'))));});
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

test('Finish preflights low-resolution layouts without queuing or locking editing, and failed drafts remain saveable',async t=>{
 const f=await fixture(t),d=await f.document();d.variants[11].front.layers[0].width=1;
 f.db.prepare('UPDATE factory_artwork SET data=?').run(await sharp({create:{width:50,height:25,channels:4,background:'#ff0000'}}).png().toBuffer());
 const r=await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});assert.match(r.error,/Print quality check/);assert.equal(r.issues[0].effectiveDpi,50);assert.equal(f.job(),null);assert.equal(f.counts().puts,0);
 d.variants[11].front.layers[0].width=.4;await f.call('finish',{source:f.p.id,revision:0,document:d,target:'printful'});
 const old=f.job(),progress={...old.document,failureStage:'rendering'};f.db.prepare("UPDATE factory_studio_jobs SET state='failed',document=? WHERE id=?").run(JSON.stringify(progress),old.id);
 const saved=await f.call('save',{source:f.p.id,revision:1,document:d});assert.equal(saved.revision,2);assert.equal((await f.open()).job.canRevise,true);
 await f.call('finish',{source:f.p.id,revision:2,document:d,target:'printful'});assert.equal(f.db.prepare('SELECT state FROM factory_studio_jobs WHERE id=?').get(old.id).state,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_studio_jobs').get().n,2);assert.equal(f.counts().puts,0);
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
