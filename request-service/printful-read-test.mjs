import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {createPrintfulReader} from './printful-read.mjs';
import {factoryBlueprints} from './factory-blueprints.mjs';
import {createService} from './server.mjs';
import {factoryIdeas} from './factory-ideas.mjs';

test('supplier reads share in-flight responses, pace from real headers and preserve Retry-After across callers',async()=>{
 let time=1000,calls=0,limited=false;const slept=[],reader=createPrintfulReader({clock:()=>time,sleep:async ms=>{slept.push(ms);time+=ms;},random:()=>0});
 const impl=async()=>{calls++;return limited?new Response('{}',{status:429,headers:{'Retry-After':'37'}}):new Response('{"result":true}',{headers:{'X-RateLimit-Limit':'120','X-RateLimit-Remaining':'90'}});};
 const options={headers:{Authorization:'Bearer fixture'}};
 const responses=await Promise.all([reader('https://api.printful.com/products/1',options,impl),reader('https://api.printful.com/products/1',options,impl)]);assert.equal(calls,1);assert.deepEqual(await Promise.all(responses.map(r=>r.json())),[{result:true},{result:true}]);
 await reader('https://api.printful.com/products/2',options,impl);assert.ok(slept[0]>=500,'catalog reads follow the supplier-advertised rate');
 limited=true;await assert.rejects(reader('https://api.printful.com/products/3',options,impl),e=>e.status===429&&e.retryAfter===37);const before=calls;
 await assert.rejects(reader('https://api.printful.com/products/4',options,impl),e=>e.status===429&&e.retryAfter===37);assert.equal(calls,before,'another caller cannot send during the cooldown');
 time+=37000;limited=false;assert.equal((await reader('https://api.printful.com/products/4',options,impl)).status,200);assert.equal(calls,before+1);
 assert.throws(()=>reader('https://api.printful.com/store/products',{...options,method:'POST'},impl),/GET/,'supplier writes are never replayed by this read helper');
});

test('a depleted successful response protects the next request until the supplier window resets',async()=>{
 let time=0,calls=0;const read=createPrintfulReader({clock:()=>time,sleep:async ms=>{time+=ms;},random:()=>0}),impl=async()=>{calls++;return new Response('{}',{headers:{'X-RateLimit-Limit':'120','X-RateLimit-Remaining':'0','X-RateLimit-Reset':'12'}});};
 assert.equal((await read('https://api.printful.com/products/1',{},impl)).status,200);await assert.rejects(read('https://api.printful.com/products/2',{},impl),e=>e.retryAfter===12);assert.equal(calls,1);time=12000;assert.equal((await read('https://api.printful.com/products/2',{},impl)).status,200);
});

test('a blueprint 429 remains retryable and never becomes a cached snapshot or unsupported garment',async()=>{
 let time=0,limited=true,productReads=0;const db=new DatabaseSync(':memory:'),read=createPrintfulReader({clock:()=>time,sleep:async ms=>{time+=ms;},random:()=>0});
 const fetchImpl=async url=>{if(url.endsWith('/products/71')){productReads++;if(limited)return new Response('{}',{status:429,headers:{'Retry-After':'7'}});return Response.json({result:{product:{title:'Unisex shirt',type:'DTG'},variants:[]}});}if(url.includes('/v2/'))return Response.json({data:{techniques:[{key:'dtg',is_default:true}]}});return Response.json({result:{}});};
 const engine=factoryBlueprints({db,read,fetchImpl,token:'fixture',plans:{products:{71:{catalogProductId:71,name:'Stored shirt'}}},fail:(status,message)=>{throw Object.assign(Error(message),{status});}});
 try{await assert.rejects(engine.load(71),e=>e.status===429&&e.retryAfter===7);time+=7000;limited=false;assert.equal((await engine.load(71)).source,'live');assert.equal(productReads,2,'a retry immediately rechecks the real supplier instead of reusing a 15-minute failure');}finally{db.close();}
});

test('the live owner API exposes supplier cooldown and overlapping store imports issue only one scan',async t=>{
 const origin='http://localhost:3000',salt='ab'.repeat(16);let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let lists=0,details=0;
 const supplier=async url=>{if(String(url).includes('midnight-designs.store'))return Response.json({products:[]});if(String(url).includes('store/products?')){lists++;return Response.json({result:[{id:1}]});}if(String(url).endsWith('store/products/1')){details++;entered();await gate;return Response.json({result:{sync_product:{id:1,name:'Existing item'},sync_variants:[]}});}return new Response('{}',{status:429,headers:{'Retry-After':'9'}});};
 const service=createService({dbPath:':memory:',origin,secure:false,factoryLoginRequired:false,passwordHash:salt+':'+scryptSync('rate-test',salt,64).toString('hex'),factorySettings:{token:'fixture',fetchImpl:supplier},ideaSettings:{env:{PRINTFUL_TOKEN:'fixture'},fetchImpl:supplier,catalog:[]}});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.server.close(r)));const base='http://127.0.0.1:'+service.server.address().port;
 const catalog=await fetch(base+'/api/owner/ai-factory/creator-catalog');assert.equal(catalog.status,429);assert.ok(Number(catalog.headers.get('Retry-After'))>=9);assert.match((await catalog.json()).error,/Printful rate limit/);
 const ideas=factoryIdeas({db:service.db,origin,manager:{},env:{PRINTFUL_TOKEN:'independent-import-fixture'},fetchImpl:supplier,catalog:[]});
 const first=ideas.refreshPrintful();await ready;const second=ideas.refreshPrintful();release();await Promise.all([first,second]);assert.equal(lists,1);assert.equal(details,1);
});

test('queued catalog and mockup reads receive their full network timeout after pacing',async()=>{
 const read=createPrintfulReader({sleep:async()=>{await new Promise(r=>setTimeout(r,35));}});let calls=0;
 const impl=async(url,options)=>{calls++;assert.ok(options.signal);assert.equal(options.signal.aborted,false,'queue wait must not consume the network timeout');assert.equal(options.timeoutMs,undefined,'reader-only options never reach fetch');return Response.json({result:true},{headers:{'X-RateLimit-Limit':'120'}});};
 await read('https://api.printful.com/products/1',{timeoutMs:10},impl);
 const result=await read('https://api.printful.com/products/2',{timeoutMs:10},impl);
 assert.equal(result.status,200);assert.equal(calls,2);
});

test('supplier read cancellation is honored before transmission and failed reads do not poison the lane',async()=>{
 const read=createPrintfulReader(),controller=new AbortController();controller.abort();let calls=0;
 const impl=async(url,{signal})=>{calls++;if(url.endsWith('/slow'))return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});setTimeout(resolve,30,Response.json({result:true}));});return Response.json({result:true});};
 await assert.rejects(read('https://api.printful.com/products/cancelled',{signal:controller.signal},impl),e=>e.status===503);assert.equal(calls,0);
 await assert.rejects(read('https://api.printful.com/products/slow',{timeoutMs:5},impl),e=>e.status===503);
 assert.equal((await read('https://api.printful.com/products/recovered',{},impl)).status,200);assert.equal(calls,2);
});
