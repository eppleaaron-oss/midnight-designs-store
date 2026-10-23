import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {githubPublisherIdentity,factoryGithubPublisher,PUBLISHER_AUDIENCE} from './factory-github-publisher.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'test-github-key',alg:'RS256'},now=Date.now();
const claims={iss:'https://token.actions.githubusercontent.com',aud:PUBLISHER_AUDIENCE,repository:'eppleaaron-oss/midnight-designs-store',repository_id:'1393932711',repository_visibility:'public',ref:'refs/heads/main',workflow_ref:'eppleaaron-oss/midnight-designs-store/.github/workflows/basic-github-publisher.yml@refs/heads/main',event_name:'schedule',runner_environment:'github-hosted',run_id:'123456',exp:Math.floor(now/1000)+300,iat:Math.floor(now/1000)-5,nbf:Math.floor(now/1000)-5};
const jwt=(c=claims,key=privateKey,header={alg:'RS256',kid:'test-github-key'})=>{const h=Buffer.from(JSON.stringify(header)).toString('base64url'),p=Buffer.from(JSON.stringify(c)).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),key).toString('base64url');};
const fetchImpl=async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return new Response(JSON.stringify({keys:[jwk]}));};
test('publishing accepts only the signed public main-branch workflow identity',async()=>{
 const identity=githubPublisherIdentity({fetchImpl,clock:()=>now});assert.equal((await identity(jwt())).run_id,'123456');
 for(const changed of [{repository_id:'42'},{repository_visibility:'private'},{ref:'refs/pull/1/merge'},{workflow_ref:'eppleaaron-oss/midnight-designs-store/.github/workflows/other.yml@refs/heads/main'},{aud:'other-app'},{iss:'https://attacker.test'},{event_name:'pull_request'},{exp:Math.floor(now/1000)-1}])await assert.rejects(identity(jwt({...claims,...changed})),e=>e.status===401);
 const attacker=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;await assert.rejects(identity(jwt(claims,attacker)),e=>e.status===401);await assert.rejects(identity(jwt(claims,privateKey,{alg:'HS256',kid:'test-github-key'})),e=>e.status===401);
});
test('the internal publisher hands credentials only to the backend and reports approved work without returning secrets',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE factory_basic_items(id TEXT,job TEXT,closed INTEGER,decision TEXT);CREATE TABLE factory_listings(job TEXT,status TEXT);INSERT INTO factory_basic_items VALUES(\'item\',\'job\',0,\'approved\');');let recorded,result,revoked;
 const module=factoryGithubPublisher({workspace:{async connectPublisher(...args){recorded=args;},disconnectPublisher(run){revoked=run;}},db,body:async req=>req.body,send(_r,status,value){result={status,value};},fail(status,message){throw Object.assign(Error(message),{status});},limit(){},fetchImpl,clock:()=>now});
 const req={headers:{authorization:'Bearer '+jwt(),'x-midnight-github-token':'fixture-github-workflow-token'},body:{action:'connect'}};
 assert.equal(await module.handle(req,{},'/internal/basic-github-publisher','POST'),true);assert.equal(result.value.pending,true);assert.equal(recorded[0],'fixture-github-workflow-token');assert.equal(recorded[1],'123456');assert.ok(!JSON.stringify(result).includes('fixture-github'));
 db.exec("UPDATE factory_basic_items SET closed=1;CREATE TABLE factory_basic_batches(id TEXT,status TEXT);INSERT INTO factory_basic_batches VALUES('authorized','running');");await module.handle(req,{},'/internal/basic-github-publisher','POST');assert.equal(result.value.pending,true,'An authorized production batch retains the existing short-lived connection');db.exec("UPDATE factory_basic_batches SET status='paused'");await module.handle(req,{},'/internal/basic-github-publisher','POST');assert.equal(result.value.pending,false,'Paused batches do not retain idle publishing access');
 db.exec("CREATE TABLE factory_studio_jobs(id TEXT,target TEXT,state TEXT);INSERT INTO factory_studio_jobs VALUES('edited-product','store','publishing');");await module.handle(req,{},'/internal/basic-github-publisher','POST');assert.equal(result.value.pending,true,'Edited store products retain the automatic publishing connection');assert.equal(result.value.studio,true);db.exec("UPDATE factory_studio_jobs SET state='completed'");await module.handle(req,{},'/internal/basic-github-publisher','POST');assert.equal(result.value.pending,false,'Completed edits release idle publishing access');
 req.body={action:'disconnect'};await module.handle(req,{},'/internal/basic-github-publisher','POST');assert.equal(revoked,'123456');await assert.rejects(module.handle({headers:{},body:{}},{},'/internal/basic-github-publisher','POST'),e=>e.status===401);
});


test('publisher remains connected through idle periods, later submissions and transient backend restarts',async()=>{
 const {publisherSession}=await import('./factory-publisher-session.mjs');let now=0,attempt=0;const calls=[],messages=[];
 await publisherSession({minutes:1,clock:()=>now,sleep:async ms=>{now+=ms;},log:m=>messages.push(m),call:async action=>{calls.push(action);if(action==='disconnect')return {};attempt++;if(attempt===2)throw Object.assign(Error('backend restarting'),{status:503});return {pending:attempt>=3};}});
 assert.equal(attempt,4);assert.equal(calls.at(-1),'disconnect');assert.equal(calls.filter(x=>x==='disconnect').length,1);assert.ok(messages.some(m=>m.includes('waiting for the next')));assert.ok(messages.some(m=>m.includes('processing approved')));assert.equal(now,60000);
});
test('publisher shutdown releases its existing connection and never loops past its deadline',async()=>{
 const {publisherSession}=await import('./factory-publisher-session.mjs');let stop=false;const calls=[];
 await publisherSession({minutes:1,call:async action=>{calls.push(action);return {pending:false};},sleep:async()=>{stop=true;},shouldStop:()=>stop});assert.deepEqual(calls,['connect','disconnect']);
 await assert.rejects(publisherSession({minutes:346}),/between 1 and 345/);
});
