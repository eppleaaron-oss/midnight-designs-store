import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {factoryProductEditor} from './factory-product-editor.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE factory_basic_items(id TEXT PRIMARY KEY,job TEXT,recipe TEXT,created TEXT,status TEXT);CREATE TABLE factory_listings(job TEXT,supplier_id TEXT,status TEXT,copy TEXT);`);
 const c={setId:'art',product:390,audience:'unisex',sizes:['S','M'],layout:{number:9,assignments:{back:'back'}},allowUnspecifiedAudience:true};
 const piece={id:'piece1',choice:{...c,slotName:'Bomber'},signature:'before',item:null};let checkpoints=0,applied=null,changed=null;
 const outfits={snapshot:()=>({plans:[{id:'outfit',name:'Rose matching collection',pieces:[piece]}],recent:[],active:null,batch:null}),editPiece:(...args)=>{if(piece.item)throw Error('started');applied=args;}};
 const basic={snapshot:()=>({sets:[{id:'art',name:'Rose',parts:{back:{url:'/art.png'}}}]}),currentJob:()=>null,inspect:async c=>{changed?.();return {set:{id:c.setId},product:{id:c.product},audience:c.audience,allowUnspecifiedAudience:c.allowUnspecifiedAudience,variants:c.sizes.map(size=>({size})),numericLayout:c.layout?{input:c.layout,requiresAcceptance:false}:null,inspectionToken:'receipt'};},verifyLayoutReceipt:(c,p)=>{assert.equal(c.inspectionToken,'receipt');assert.ok(p.numericLayout);},inspectionSignature:()=> 'verified',checkpoint:async()=>{checkpoints++;},create:async c=>({id:'new',job:'new-job',choice:c})};
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};let sent;
 const editor=factoryProductEditor({db,basic,outfits,auth:()=>{},body:async req=>req.payload,send:(res,status,data)=>{sent=data;},fail,limit:()=>{},origin:'http://test'});
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

test('an existing-product artwork revision targets the original ID and rejects size changes',async t=>{
 const f=fixture(t),recipe={set:{id:'art',name:'Rose'},product:390,name:'Bomber',audience:'unisex',variants:[{size:'S'},{size:'M'}],layout:{input:f.c.layout}};
 f.db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('made','old-job',JSON.stringify(recipe),'today','supplier_created');f.db.prepare('INSERT INTO factory_listings VALUES(?,?,?,?)').run('old-job','501','supplier_ready',JSON.stringify({title:'Rose Bomber'}));let context;
 f.basic.create=async(c,ctx)=>{context=ctx;return {id:'revision',job:'new-job'};};const d=await f.call('save',{source:'item:made',choice:{...f.c,inspectionToken:'receipt'},note:'Move back higher'});
 await assert.rejects(f.call('revise-existing',{id:d.id,revision:1}),/Confirm/);await f.call('revise-existing',{id:d.id,revision:1,confirm:true});assert.equal(context.replaceProduct.supplierId,'501');assert.equal(context.replaceProduct.external,'midnight-factory-old-job');assert.equal(f.db.prepare('SELECT supplier_id FROM factory_listings').get().supplier_id,'501');
 const wrong=await f.call('save',{source:'item:made',choice:{...f.c,sizes:['S'],inspectionToken:'receipt'},note:''});await assert.rejects(f.call('revise-existing',{id:wrong.id,revision:1,confirm:true}),/every size/);
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
