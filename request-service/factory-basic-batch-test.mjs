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
 const options={db,basic,summary,attach,open:()=>null};let batch=factoryBasicBatch(options);
 const recipes=[1,2].map(product=>({product,layout:{number:5},sizes:[],audience:'unisex'}));
 const start=(ids=['p'])=>batch.start({confirm:true,requestKey:'requested-collection-batch-v1',planIds:ids,recipes,acceptMissingModel:true});
 function finish(){const a=active();run("UPDATE factory_basic_items SET status='published',closed=1,cleanup=? WHERE id=?",JSON.stringify({verified:true}),a.id);run('INSERT INTO factory_listings VALUES(?,?)',a.job,'store:'+a.id);}
 return {db,run,get,all,addPlan,basic,start,finish,recipes,counts:()=>({made,approved,saves}),setReady:()=>{ready=true;},failInspection:fn=>{inspectError=fn;},loseResponse:()=>{crash=true;},restart:()=>{batch=factoryBasicBatch(options);return batch;},get batch(){return batch;}};
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
