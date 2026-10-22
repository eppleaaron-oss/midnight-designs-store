import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {factoryProductEditor,printfulProductEditUrl} from './factory-product-editor.mjs';

function fixture(t,fetchImpl){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE factory_basic_items(id TEXT PRIMARY KEY,job TEXT,recipe TEXT,created TEXT,status TEXT);CREATE TABLE factory_listings(job TEXT,supplier_id TEXT,status TEXT,copy TEXT);`);
 const c={setId:'art',product:390,audience:'unisex',sizes:['S','M'],layout:{number:9,assignments:{back:'back'}},allowUnspecifiedAudience:true};
 const piece={id:'piece1',choice:{...c,slotName:'Bomber'},signature:'before',item:null};let checkpoints=0,applied=null,changed=null;
 const outfits={snapshot:()=>({plans:[{id:'outfit',name:'Rose matching collection',pieces:[piece]}],recent:[],active:null,batch:null}),editPiece:(...args)=>{if(piece.item)throw Error('started');applied=args;}};
 const basic={snapshot:()=>({sets:[{id:'art',name:'Rose',parts:{back:{url:'/art.png'}}}]}),currentJob:()=>null,inspect:async c=>{changed?.();return {set:{id:c.setId},product:{id:c.product},audience:c.audience,allowUnspecifiedAudience:c.allowUnspecifiedAudience,variants:c.sizes.map(size=>({size})),numericLayout:c.layout?{input:c.layout,requiresAcceptance:false}:null,inspectionToken:'receipt'};},verifyLayoutReceipt:(c,p)=>{assert.equal(c.inspectionToken,'receipt');assert.ok(p.numericLayout);},inspectionSignature:()=> 'verified',checkpoint:async()=>{checkpoints++;},create:async c=>({id:'new',job:'new-job',choice:c})};
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};let sent;
 const editor=factoryProductEditor({db,basic,outfits,auth:()=>{},body:async req=>req.payload,send:(res,status,data)=>{sent=data;},fail,limit:()=>{},origin:'http://test',fetchImpl});
 const call=async(path,b)=>{await editor.handle({headers:{origin:'http://test'},payload:b},{},'/api/owner/ai-factory/product-editor/'+path,'POST');return sent;};
 return {db,editor,basic,c,piece,call,change:fn=>{changed=fn;},applied:()=>applied,checkpoints:()=>checkpoints};
}

test('saved numeric revisions survive editor reload and apply to the exact waiting piece',async t=>{
 const f=fixture(t),d=await f.call('save',{source:'piece:piece1',choice:{...f.c,inspectionToken:'receipt'},note:'Chest smaller'});
 assert.equal(d.revision,1);assert.equal(f.checkpoints(),1);assert.equal(f.editor.library().edits[0].choice.layout.number,9);
 await f.call('apply',{id:d.id,revision:1});assert.equal(f.applied()[0],'piece1');assert.equal(f.applied()[1].layout.number,9);assert.equal(f.applied()[2],'verified');
 await assert.rejects(f.call('apply',{id:d.id,revision:0}),/changed/);
 f.piece.item={id:'started'};await assert.rejects(f.call('apply',{id:d.id,revision:1}),/started/);
});

test('missing layout, stale receipt, changed family and a started piece cannot change production',async t=>{
 const f=fixture(t);await assert.rejects(f.call('save',{source:'piece:piece1',choice:{...f.c,layout:null},note:''}),/numeric layout/);
 await assert.rejects(f.call('save',{source:'piece:piece1',choice:{...f.c,inspectionToken:'stale'},note:''}));
 const d=await f.call('save',{source:'piece:piece1',choice:{...f.c,product:999,inspectionToken:'receipt'},note:''});await assert.rejects(f.call('apply',{id:d.id,revision:d.revision}),/garment and design family/);assert.equal(f.applied(),null);
});

test('completed product revisions retain supplier identity and create only an explicitly confirmed copy',async t=>{
 const f=fixture(t),recipe={set:{id:'art',name:'Rose'},product:390,name:'Bomber',audience:'unisex',variants:[{size:'S'},{size:'M'}],layout:{input:f.c.layout}};
 f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('made','old-job',JSON.stringify(recipe),'today','supplier_created');f.db.prepare('INSERT INTO factory_listings VALUES(?,?,?,?)').run('old-job','483352723','supplier_ready',JSON.stringify({title:'Rose Bomber'}));
 const d=await f.call('save',{source:'item:made',choice:{...f.c,inspectionToken:'receipt'},note:'New back'});
 await assert.rejects(f.call('apply',{id:d.id,revision:1}),/revised copy/);await assert.rejects(f.call('create',{id:d.id,revision:1}),/Confirm/);
 const result=await f.call('create',{id:d.id,revision:1,confirm:true});assert.equal(result.item.choice.requestKey,'editor_'+d.id+'_r1');assert.equal(f.db.prepare('SELECT supplier_id FROM factory_listings').get().supplier_id,'483352723');
});

test('editor rejects cross-origin writes and saved revision races',async t=>{
 const f=fixture(t);await assert.rejects(f.editor.handle({headers:{origin:'http://other'},payload:{}},{},'/api/owner/ai-factory/product-editor/save','POST'),/Origin/);
 const d=await f.call('save',{source:'piece:piece1',choice:{...f.c,inspectionToken:'receipt'},note:''});f.change(()=>f.db.prepare('UPDATE factory_product_edits SET revision=2 WHERE id=?').run(d.id));await assert.rejects(f.call('apply',{id:d.id,revision:1}),/during inspection/);assert.equal(f.applied(),null);
});

test('large recovery backups do not block saving, and failures remain visible without claiming durability',async t=>{
 const f=fixture(t);let rejectBackup;f.basic.checkpoint=()=>new Promise((_,reject)=>{rejectBackup=reject;});
 const saved=await f.call('save',{source:'piece:piece1',choice:{...f.c,inspectionToken:'receipt'},note:'Persist recipe promptly'});
 assert.equal(saved.recoveryPending,true);assert.equal(f.editor.library().edits.length,1);assert.equal(f.editor.library().recovery.pending,true);
 rejectBackup(Error('Recovery service unavailable'));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.editor.library().recovery.pending,false);assert.match(f.editor.library().recovery.error,/Recovery service unavailable/);assert.equal(f.editor.library().edits[0].note,'Persist recipe promptly');
});

test('AI Made legacy jobs open their own saved artwork and garment instead of a different product',async t=>{
 const f=fixture(t);
 f.db.exec(`CREATE TABLE idea_made(id TEXT,job TEXT,set_id TEXT,set_name TEXT,catalog INTEGER,name TEXT,status TEXT,printful_id TEXT,created TEXT);CREATE TABLE factory_jobs(id TEXT,gender TEXT);CREATE TABLE factory_job_audiences(job TEXT,selection TEXT);CREATE TABLE factory_job_layouts(job TEXT,layout TEXT);`);
 f.db.prepare('INSERT INTO idea_made VALUES(?,?,?,?,?,?,?,?,?)').run('legacy','legacy-job','art','Rose',390,'Rose Backpack','waiting_input','123','today');
 f.db.prepare('INSERT INTO factory_jobs VALUES(?,?)').run('legacy-job','unisex');f.db.prepare('INSERT INTO factory_job_audiences VALUES(?,?)').run('legacy-job',JSON.stringify({sizes:['S'],allowUnspecifiedAudience:true}));f.db.prepare('INSERT INTO factory_job_layouts VALUES(?,?)').run('legacy-job',JSON.stringify({input:f.c.layout}));
 const p=f.editor.library().products.find(p=>p.id==='made:legacy');assert.equal(p.jobId,'legacy-job');assert.equal(p.supplierId,'123');assert.equal(p.choice.setId,'art');assert.equal(p.choice.product,390);assert.deepEqual(p.choice.sizes,['S']);assert.equal(p.choice.layout.number,9);assert.equal(p.editable,false);
 const draft=await f.call('save',{source:p.id,choice:{...p.choice,inspectionToken:'receipt'},note:'Reduce artwork size'});assert.equal(draft.source,'made:legacy');await assert.rejects(f.call('apply',{id:draft.id,revision:draft.revision}),/revised copy/);
 f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('basic','legacy-job',JSON.stringify({set:{id:'art',name:'Rose'},product:390,name:'Rose Backpack',audience:'unisex',variants:[{size:'S'}]}),'today','supplier_created');assert.equal(f.editor.library().products.filter(p=>p.jobId==='legacy-job').length,1);
});


test('saved storefront media loads through the owner endpoint and reuses its cache',async t=>{
 let reads=0;const f=fixture(t);
 let response;const engine=factoryProductEditor({db:f.db,basic:f.basic,outfits:{snapshot:()=>({plans:[],recent:[]})},auth:()=>{},body:async()=>({}),send:(res,status,d)=>{response=d;},fail:()=>{},limit:()=>{},origin:'http://test',fetchImpl:async url=>{reads++;return {ok:true,json:async()=>url.endsWith('product-photos.json')?{products:{123:{photos:[{image:'assets/front.jpg'}]}}}:{products:[{id:123}]}};}});
 await engine.handle({headers:{}},{},'/api/owner/ai-factory/product-editor/media','GET');assert.deepEqual(response.publishedIds,['123']);assert.equal(response.photos.products[123].photos[0].image,'assets/front.jpg');assert.equal(response.unavailable,false);assert.equal(reads,2);
 await engine.handle({headers:{}},{},'/api/owner/ai-factory/product-editor/media','GET');assert.equal(reads,2);
});


test('native editor links use the existing supplier product and configured store, never a catalog or job ID',()=>{
 assert.equal(printfulProductEditUrl('12345','482918795'),'https://www.printful.com/dashboard/product-templates/published/12345/482918795');
 for(const [store,product]of [['','482918795'],['12345',null],['12345','piece:abc'],['https://other.test','123'],['123','42?redirect=evil']])assert.equal(printfulProductEditUrl(store,product),null);
});


test('native product editor discovers only a single authorized Printful store without exposing its token',async t=>{
 const f=fixture(t);let calls=0,sent;const editor=factoryProductEditor({db:f.db,basic:f.basic,outfits:{snapshot:()=>({plans:[],recent:[]})},auth:()=>{},body:async()=>({}),send:(res,status,data)=>{sent=data;},fail:()=>{},limit:()=>{},origin:'http://test',storeId:'',printfulToken:'test-private-token',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.printful.com/stores');assert.equal(options.headers.Authorization,'Bearer test-private-token');return {ok:true,json:async()=>({result:[{id:12345,name:'Midnight Designs'}]})};}});
 await editor.handle({headers:{}},{},'/api/owner/ai-factory/product-editor','GET');assert.equal(sent.printfulEditorError,null);assert.equal(JSON.stringify(sent).includes('test-private-token'),false);await editor.handle({headers:{}},{},'/api/owner/ai-factory/product-editor','GET');assert.equal(calls,1);
});

test('multiple Printful stores are resolved by the saved supplier product rather than choosing the first account store',async t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('made','job',JSON.stringify({set:{id:'art',name:'Rose'},product:390,name:'Bomber',audience:'unisex',variants:[{size:'M'}]}),'today','supplier_created');f.db.prepare('INSERT INTO factory_listings VALUES(?,?,?,?)').run('job','555','supplier_ready',JSON.stringify({title:'Rose Bomber'}));let sent;
 const editor=factoryProductEditor({db:f.db,basic:f.basic,outfits:{snapshot:()=>({plans:[],recent:[]})},auth:()=>{},body:async()=>({}),send:(res,status,data)=>{sent=data;},fail:()=>{},limit:()=>{},origin:'http://test',storeId:'',printfulToken:'test',fetchImpl:async(url,options)=>url.endsWith('/stores')?{ok:true,json:async()=>({result:[{id:1},{id:2}]})}:options.headers['X-PF-Store-Id']==='1'?{ok:false,status:404}:{ok:true,json:async()=>({result:{sync_product:{id:555}}})}});
 await editor.handle({headers:{}},{},'/api/owner/ai-factory/product-editor','GET');assert.equal(sent.products[0].printfulEditUrl,'https://www.printful.com/dashboard/product-templates/published/2/555');
});
