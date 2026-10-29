import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transferStudioLayer,factoryOutfitLearning} from './factory-outfit-learning.mjs';
import {DatabaseSync} from 'node:sqlite';

test('transferred placements measure the visible subject and retain portrait proportions and black margins',()=>{
 const area={width:1000,height:1000},from={width:1000,height:1000,bounds:{x:250,y:250,width:500,height:500}},to={asset:'art:new',width:100,height:200};
 const p=transferStudioLayer({x:.5,y:.5,width:1,allowModify:true},from,to,area);assert.equal(p.width,.25);assert.equal(p.x,.5);assert.equal(p.y,.5);assert.equal(p.allowModify,false);assert.equal(p.asset,'art:new');
 assert.throws(()=>transferStudioLayer({x:.5,y:.5,width:3},from,to,area),/clipped/);assert.throws(()=>transferStudioLayer({x:.5,y:.5,width:1,rotation:20},from,to,area),/rotates/);
});
test('continuation authorization survives restart, freezes example IDs and advances only its unstarted pieces',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE factory_jobs(id TEXT,status TEXT);CREATE TABLE factory_settings(id INTEGER,state TEXT,updated TEXT);INSERT INTO factory_settings VALUES(1,'paused','now');");
 const plans=[{id:'plan',name:'Moon',pieces:[{id:'old',choice:{product:390},item:{listing:{supplier_id:'1'}}},{id:'new',revision:1,choice:{product:390,setId:'moon'},item:null}]}],q={batch:{id:'batch',status:'blocked',target:'printful',plans:[{id:'plan'}]},plans};let creates=0,done=false;
 const basic={batchCurrent:()=>null,githubReady:()=>true,checkpoint:async()=>{}},outfits={snapshot:()=>q,controlBatch:async b=>{assert.equal(b.target,'ai-made');q.batch.target=b.target;q.batch.status='running';}},studio={learningExamples:()=>[{product:390,job:'owner-example',revision:3}],followExample:async(source,example)=>{assert.equal(source,'piece:new');assert.equal(example,'owner-example');creates++;return {id:'update',supplier:'2'};},learningJob:()=>({id:'update',state:done?'completed':'rendering',images:done?2:0,printfulUpdated:false,previewReady:done})};
 const opts={db,basic,outfits,studio,auth:()=>{},body:async r=>r.payload,send:(r,status,data)=>Object.assign(r,{status,data}),fail:(status,msg)=>{throw Object.assign(Error(msg),{status});},limit:()=>{},origin:'https://app.test'};let learning=factoryOutfitLearning(opts),view=learning.inventory(),res={};
 assert.equal(view.missingPieces,1);await learning.handle({headers:{origin:'https://app.test'},payload:{confirm:true,signature:view.signature}},res,'/api/owner/ai-factory/outfit-learning','POST');assert.equal(q.batch.target,'ai-made');assert.equal(res.status,202);
 assert.equal(await learning.follow(q.batch,plans[0].pieces[0],{}),true);assert.equal(creates,0);assert.equal(await learning.follow(q.batch,plans[0].pieces[1],{}),false);assert.equal(creates,1);
 learning=factoryOutfitLearning(opts);assert.equal(await learning.follow(q.batch,plans[0].pieces[1],{}),false);assert.equal(creates,1);done=true;assert.equal(await learning.follow(q.batch,plans[0].pieces[1],{}),true);assert.equal(learning.inventory().learning.completed,1);
});
