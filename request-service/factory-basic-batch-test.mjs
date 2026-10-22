import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {factoryBasicBatch} from './factory-basic-batch.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`
 CREATE TABLE factory_settings(id INTEGER PRIMARY KEY,state TEXT);INSERT INTO factory_settings VALUES(1,'running');
 CREATE TABLE factory_basic_outfit_runs(id TEXT PRIMARY KEY,name TEXT,status TEXT,created TEXT);
 CREATE TABLE factory_basic_outfit_pieces(id TEXT PRIMARY KEY,outfit TEXT,ordinal INTEGER,role TEXT,choice TEXT,signature TEXT,item TEXT,error TEXT,revision INTEGER);
 CREATE TABLE factory_basic_items(id TEXT PRIMARY KEY,request_key TEXT UNIQUE,recipe_key TEXT,recipe TEXT,decision TEXT,closed INTEGER,status TEXT,cleanup TEXT,job TEXT,created TEXT);
 CREATE TABLE factory_listings(job TEXT PRIMARY KEY,store_id TEXT);
 CREATE TABLE factory_outfit_items(id TEXT PRIMARY KEY,outfit TEXT,role TEXT,template TEXT,job TEXT,revision INTEGER,store_product TEXT,approved INTEGER);CREATE TABLE factory_outfits(id TEXT PRIMARY KEY,published INTEGER DEFAULT 0);`);
 const run=(q,...a)=>db.prepare(q).run(...a),get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a);
 let made=0,approved=0,saves=0,ready=false,inspectError=null,crash=false;
 const active=()=>get('SELECT * FROM factory_basic_items WHERE closed=0');
 function addPlan(id,set='source:'+id,products=[1,2]){run('INSERT INTO factory_basic_outfit_runs VALUES(?,?,?,?)',id,id,'planned',new Date().toISOString());run('INSERT INTO factory_outfits(id) VALUES(?)',id);products.forEach((product,i)=>run('INSERT INTO factory_basic_outfit_pieces VALUES(?,?,?,?,?,?,NULL,?,1)',id+'_'+i,id,i,'shirts',JSON.stringify({product,setId:set}),'',''));}
 const attach=(p,item)=>{run('UPDATE factory_basic_outfit_pieces SET item=? WHERE id=?',item.id,p.id);run("INSERT OR IGNORE INTO factory_outfit_items(id,outfit,role,template,job,revision,approved) VALUES(?,?,?,'','',1,0)",p.id,p.outfit,p.role);};
 const summary=r=>{if(!r)return null;const pieces=all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',r.id).map(p=>{const i=p.item&&get('SELECT * FROM factory_basic_items WHERE id=?',p.item);return {...p,item:i?{...i,cleanup:i.cleanup?JSON.parse(i.cleanup):null}:null};});return {...r,pieces,total:pieces.length,published:pieces.filter(p=>p.item?.status==='published').length};};
 const basic={currentJob:()=>active()?.job||null,batchCurrent:()=>{const a=active();return a?{...a,canApprove:ready}:null;},checkpoint:async()=>{saves++;},inspect:async choice=>{if(inspectError?.(choice))throw Error('Template no longer matches the source.');return {numericLayout:{requiresAcceptance:false},choice};},inspectionSignature:p=>'signature:'+p.choice.product,
  async create(choice,context){assert.equal(context.signature,'signature:'+choice.product);assert.ok(get('SELECT id FROM factory_basic_outfit_runs WHERE id=?',context.outfitId));const id='made'+(++made);run('INSERT INTO factory_basic_items VALUES(?,?,?,?,NULL,0,?,NULL,?,?)',id,choice.requestKey,'frozen:'+id,JSON.stringify({set:{id:choice.setId},product:choice.product,outfitId:context.outfitId}),'producing','job:'+id,new Date().toISOString());if(crash)throw Error('Response lost after item save');return get('SELECT * FROM factory_basic_items WHERE id=?',id);},
  async approveBatch(id,key){const a=active();assert.equal(a.id,id);assert.equal(a.recipe_key,key);assert.equal(ready,true);approved++;run("UPDATE factory_basic_items SET decision='approved',status='publishing' WHERE id=?",id);ready=false;}
 };
 let clock=Date.now();const options={db,basic,summary,attach,open:()=>null,clock:()=>clock};let batch=factoryBasicBatch(options);
 const recipes=[1,2].map(product=>({product,layout:{number:5},sizes:[],audience:'unisex'}));
 const start=(ids=['p'])=>batch.start({confirm:true,requestKey:'requested-collection-batch-v1',planIds:ids,recipes,acceptMissingModel:true});
 function finish(){const a=active();run("UPDATE factory_basic_items SET status='published',closed=1,cleanup=? WHERE id=?",JSON.stringify({verified:true}),a.id);run('INSERT INTO factory_listings VALUES(?,?)',a.job,'store:'+a.id);}
 return {db,run,get,all,addPlan,basic,start,finish,recipes,advance:ms=>{clock+=ms;},counts:()=>({made,approved,saves}),setReady:()=>{ready=true;},failInspection:fn=>{inspectError=fn;},loseResponse:()=>{crash=true;},restart:()=>{batch=factoryBasicBatch(options);return batch;},get batch(){return batch;}};
}

test('a finite batch publishes its exact pieces, waits for cleanup, and resumes from SQLite',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();await f.batch.tick();assert.equal(f.counts().made,1);await f.batch.tick();assert.equal(f.counts().approved,0);
 f.setReady();await f.restart().tick();assert.equal(f.counts().approved,1);await f.batch.tick();assert.equal(f.counts().made,1,'Publication must retain the one active item');f.finish();await f.batch.tick();assert.equal(f.counts().made,2);
 f.setReady();await f.batch.tick();f.finish();await f.batch.tick();assert.equal(f.batch.snapshot().status,'complete');assert.equal(f.batch.snapshot().published,2);await f.start();assert.equal(f.counts().made,2,'The same request cannot create another batch');
});

test('previously published standalone pieces are adopted without creating duplicate supplier jobs',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.run('INSERT INTO factory_basic_items VALUES(?,?,?,?,?,1,?,?,?,?)','existing','standalone','existing-key',JSON.stringify({set:{id:'source:p'},product:1}),'approved','published',JSON.stringify({verified:true}),'job:existing','2026-01-01');f.run('INSERT INTO factory_listings VALUES(?,?)','job:existing','store:existing');await f.start();await f.batch.tick();assert.equal(f.counts().made,1);assert.equal(f.get('SELECT item FROM factory_basic_outfit_pieces WHERE id=?','p_0').item,'existing');assert.equal(f.batch.snapshot().published,1);
});

test('a missing original or changed native template is held while other authorized pieces can proceed',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('missing','unresolved:stag');f.addPlan('p');f.failInspection(c=>c.product===1);await f.start(['missing','p']);await f.batch.tick();assert.equal(f.counts().made,1);assert.equal(f.batch.snapshot().holds.length,3);assert.equal(JSON.parse(f.get("SELECT recipe FROM factory_basic_items WHERE id='made1'").recipe).product,2);
 f.setReady();await f.batch.tick();f.finish();await f.batch.tick();assert.equal(f.batch.snapshot().status,'blocked');assert.equal(f.batch.snapshot().published,1,'Held requests cannot be counted as published');
});

test('pause and cancellation preserve the active item and never authorize unrelated owner work',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();const id=f.batch.snapshot().id;await f.batch.control({id,action:'pause'});await f.batch.tick();assert.equal(f.counts().made,0);await f.batch.control({id,action:'resume'});await f.batch.tick();await assert.rejects(f.batch.control({id,action:'cancel'}),/Finish the current item/);
 f.run("DELETE FROM factory_basic_batch_items");f.run("UPDATE factory_basic_items SET request_key='unrelated',recipe=?",JSON.stringify({set:{id:'source:p'},product:1,outfitId:'other'}));f.setReady();await f.batch.tick();assert.equal(f.counts().approved,0);
});

test('a crash between saving an item and its batch pointer recovers only the exact frozen request',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();f.loseResponse();await f.batch.tick();assert.equal(f.counts().made,1);f.run('DELETE FROM factory_basic_batch_items');f.run('UPDATE factory_basic_outfit_pieces SET item=NULL');f.setReady();await f.restart().tick();assert.equal(f.counts().made,1);assert.equal(f.counts().approved,1);
});

test('authorization cannot expand to an unrelated product when resuming held work',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();await assert.rejects(f.batch.control({id:f.batch.snapshot().id,action:'resume',recipes:[{product:999,layout:{number:5},sizes:[],audience:'unisex'}]}),/outside the authorized/);assert.equal(f.counts().made,0);
});

test('batch charges apply only to its exact frozen product and failures hold the batch',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.recipes[0].charges={verified:true,extraCents:0,shippingCents:null,source:'Verified included print'};await f.start();await f.batch.tick();const read=f.basic.batchCurrent;f.basic.batchCurrent=()=>({...read(),pricing:{status:'held'}});let called=0;
 f.basic.confirmBatchCharges=async(id,key,charges)=>{called++;assert.equal(id,'made1');assert.equal(key,'frozen:made1');assert.equal(charges.extraCents,0);throw Error('Fresh USD supplier quotes are required.');};await f.batch.tick();assert.equal(called,1);assert.equal(f.batch.snapshot().status,'blocked');assert.match(f.batch.snapshot().error,/Fresh USD/);assert.equal(f.counts().approved,0);
});


test('an explicitly mapped supplier default source reaches the frozen native layout without changing another collection',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('stag','pf:stag');f.recipes[0].layout={number:1,assignments:{front:'front',back:'back',sleeve_left:null}};
 const p=f.get('SELECT choice FROM factory_basic_outfit_pieces WHERE id=?','stag_0');f.run('UPDATE factory_basic_outfit_pieces SET choice=? WHERE id=?',JSON.stringify({...JSON.parse(p.choice),sourceParts:{front:'default'}}),'stag_0');
 const inspect=f.basic.inspect;f.basic.inspect=async choice=>{assert.deepEqual(choice.layout.assignments,{front:'default',back:'back',sleeve_left:null});assert.equal(choice.setId,'pf:stag');return inspect(choice);};
 await f.start(['stag']);await f.batch.tick();assert.equal(f.counts().made,1);assert.equal(f.batch.snapshot().recipes[0].layout.assignments.front,'front','The shared recipe remains unchanged');
});

test('supplier-only pieces advance the finite batch without being counted as storefront published',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();f.run("UPDATE factory_basic_batches SET target='printful'");await f.batch.tick();
 for(let i=0;i<2;i++){const c=f.basic.batchCurrent();f.run("UPDATE factory_basic_items SET closed=1,status='supplier_created',decision='supplier_only',cleanup=? WHERE id=?",JSON.stringify({verified:true,retainedSupplierProduct:'printful:'+i}),c.id);await f.batch.tick();}
 const s=f.batch.snapshot();assert.equal(s.status,'complete');assert.equal(s.printfulCreated,2);assert.equal(s.published,0);assert.equal(f.counts().approved,0);assert.equal(f.counts().made,2);
});

test('a narrowed outfit batch retains started work, every design family and the exact total across restarts',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.addPlan('q');await f.start(['p','q']);await f.batch.tick();
 const id=f.batch.snapshot().id;
 await assert.rejects(f.batch.control({id,action:'pause',scope:{pieceIds:['p_0','q_0'],total:2}}),/Pause the existing/);
 await f.batch.control({id,action:'pause'});
 await assert.rejects(f.batch.control({id,action:'pause',scope:{pieceIds:['p_1','q_0'],total:2}}),/started and completed/);
 await assert.rejects(f.batch.control({id,action:'pause',scope:{pieceIds:['p_0'],total:1}}),/every design family/);
 await assert.rejects(f.batch.control({id,action:'pause',scope:{pieceIds:['p_0','q_0'],total:230}}),/total must equal/);
 const scoped=await f.batch.control({id,action:'pause',scope:{pieceIds:['p_0','q_0'],total:2}});assert.equal(scoped.total,2);assert.equal(scoped.collectionTotal,2);assert.equal(scoped.plans[0].total,1);
 await assert.rejects(f.batch.control({id,action:'pause',scope:{pieceIds:['p_0','p_1','q_0'],total:3}}),/only narrow/);
 f.restart();assert.equal(f.batch.snapshot().total,2);await f.batch.control({id,action:'resume'});f.finish();await f.batch.tick();assert.equal(f.basic.batchCurrent().request_key,'basic-outfit_q_0');f.finish();await f.batch.tick();assert.equal(f.batch.snapshot().status,'complete');assert.equal(f.counts().made,2);assert.equal(f.get('SELECT item FROM factory_basic_outfit_pieces WHERE id=?','p_1').item,null);
});

test('assistant outfit layouts override shared recipes only for selected unstarted pieces and survive restart',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.addPlan('q');await f.start(['p','q']);const id=f.batch.snapshot().id;
 const layout={number:9,assignments:{back:'back'},overrides:{back:{widthIn:7,heightIn:9}},scaleMode:'fixed',measureVisible:true,acceptReduction:true};
 await assert.rejects(f.batch.control({id,action:'pause',designPlans:[{pieceId:'p_0',layout,note:'One scene on the back, no repeats.'}]}),/Pause new/);
 await f.batch.control({id,action:'pause'});
 await assert.rejects(f.batch.control({id,action:'pause',designPlans:[{pieceId:'p_0',layout,note:'Valid first plan.'},{pieceId:'outside',layout,note:'Invalid second plan.'}]}),/selected pieces/);
 assert.equal(JSON.parse(f.get('SELECT choice FROM factory_basic_outfit_pieces WHERE id=?','p_0').choice).designerPlan,undefined,'invalid requests save no partial plans');
 await f.batch.control({id,action:'pause',designPlans:[{pieceId:'p_0',layout,note:'One scene on the back, no repeats.'}]});f.restart();
 const prior=f.basic.inspect;f.basic.inspect=async c=>{assert.equal(c.layout.number,9);assert.equal(c.designerPlan.planner,'assistant');return prior(c);};await f.batch.control({id,action:'resume'});await f.batch.tick();assert.equal(f.counts().made,1);
 await f.batch.control({id,action:'pause'});await assert.rejects(f.batch.control({id,action:'pause',designPlans:[{pieceId:'p_0',layout,note:'Change started work.'}]}),/have not started/);
 assert.equal(JSON.parse(f.get('SELECT choice FROM factory_basic_outfit_pieces WHERE id=?','q_0').choice).designerPlan,undefined);assert.equal(f.batch.snapshot().recipes[0].layout.number,5);
});

test('owner editor recipes override batch defaults, preserve source families, and cannot edit started pieces',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();
 const choice={product:1,setId:'source:p',audience:'unisex',sizes:['M'],layout:{number:9,assignments:{back:'back'}}};
 f.batch.editPiece('p_0',choice,'inspected','Larger back');
 const saved=JSON.parse(f.get("SELECT choice FROM factory_basic_outfit_pieces WHERE id='p_0'").choice);assert.equal(saved.ownerRecipe.layout.number,9);assert.deepEqual(saved.ownerRecipe.sizes,['M']);
 let observed;const create=f.basic.create;f.basic.create=async(c,ctx)=>{observed=c;return create(c,ctx);};await f.batch.tick();assert.equal(observed.layout.number,9);assert.deepEqual(observed.sizes,['M']);
 assert.throws(()=>f.batch.editPiece('p_0',choice,'inspected',''),/already started/);assert.throws(()=>f.batch.editPiece('p_1',{...choice,product:2,setId:'other'},'bad',''),/original garment and design family/);
});

test('temporary preflight outages back off durably and resume the same selected piece',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();const inspect=f.basic.inspect;let calls=0;
 f.basic.inspect=async c=>{calls++;if(calls===1)throw Object.assign(Error('Printful is temporarily unreachable. The same selection can be retried.'),{status:503});return inspect(c);};
 await f.batch.tick();assert.equal(f.batch.snapshot().status,'running');assert.equal(f.counts().made,0);assert.equal(f.batch.snapshot().holds.length,0);assert.equal(f.batch.snapshot().retries[0].attempts,1);
 await f.restart().tick();assert.equal(calls,1);f.advance(30001);await f.batch.tick();assert.equal(f.counts().made,1);assert.equal(f.basic.batchCurrent().request_key,'basic-outfit_p_0');assert.equal(f.batch.snapshot().retries.length,0);
});
test('legacy network holds recover automatically only for authorized unstarted pieces',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();const id=f.batch.snapshot().id;
 f.run("UPDATE factory_basic_batches SET status='blocked',error='fetch failed'");f.run('INSERT INTO factory_basic_batch_holds VALUES(?,?,?)',id,'p_0','Printful is temporarily unreachable. The same selection can be retried.');
 await f.batch.tick();assert.equal(f.batch.snapshot().status,'running');assert.equal(f.batch.snapshot().holds.length,0);assert.equal(f.counts().made,0);f.advance(30001);await f.restart().tick();assert.equal(f.counts().made,1);
});
test('connection retries stop at their limit and cannot silently reset after restart',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();let calls=0;f.basic.inspect=async()=>{calls++;throw TypeError('fetch failed');};
 for(let n=0;n<8;n++){f.advance(700000);await f.batch.tick();}assert.equal(calls,8);assert.equal(f.batch.snapshot().status,'blocked');assert.equal(f.batch.snapshot().retries[0].attempts,8);assert.equal(f.counts().made,0);f.advance(700000);await f.restart().tick();assert.equal(calls,8);assert.match(f.batch.snapshot().error,/retry limit exhausted/);
});
test('uncertain supplier results and foreign pieces never become automatic network retries',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.addPlan('other');await f.start();const id=f.batch.snapshot().id;
 f.run("UPDATE factory_basic_batches SET status='blocked'");f.run('INSERT INTO factory_basic_batch_holds VALUES(?,?,?)',id,'other_0','fetch failed');await f.batch.tick();assert.equal(f.batch.snapshot().status,'blocked');assert.equal(f.counts().made,0);
 f.run('DELETE FROM factory_basic_batch_holds');f.run('INSERT INTO factory_basic_batch_holds VALUES(?,?,?)',id,'p_0','Supplier result is uncertain. Reconcile before retry.');await f.restart().tick();assert.equal(f.batch.snapshot().status,'blocked');assert.equal(f.batch.snapshot().retries.length,0);
});
test('a network error after an item is saved adopts its original key without scheduling another creation',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');await f.start();const create=f.basic.create;f.basic.create=async(...args)=>{await create(...args);throw TypeError('fetch failed');};
 await f.batch.tick();assert.equal(f.counts().made,1);assert.equal(f.batch.snapshot().retries.length,0);assert.equal(f.get('SELECT item FROM factory_basic_outfit_pieces WHERE id=?','p_0').item,'made1');await f.restart().tick();assert.equal(f.counts().made,1);
});
test('a temporary quote outage retries the existing item while preserving verified-charge requirements',async t=>{
 const f=fixture();t.after(()=>f.db.close());f.addPlan('p');f.recipes[0].charges={verified:true,extraCents:0,shippingCents:null,source:'Verified included print'};await f.start();await f.batch.tick();const read=f.basic.batchCurrent;let calls=0;f.basic.batchCurrent=()=>({...read(),pricing:{status:'held'}});
 f.basic.confirmBatchCharges=async(id,key)=>{assert.equal(id,'made1');assert.equal(key,'frozen:made1');calls++;if(calls===1)throw TypeError('fetch failed');};await f.batch.tick();assert.equal(f.batch.snapshot().status,'running');await f.restart().tick();assert.equal(calls,1);f.advance(30001);await f.batch.tick();assert.equal(calls,2);assert.equal(f.counts().made,1);assert.equal(f.counts().approved,0);assert.equal(f.batch.snapshot().retries.length,0);
});
