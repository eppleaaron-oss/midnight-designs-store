import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {factoryAiMade} from './factory-ai-made.mjs';
import {replacementPayload} from './factory-ai-made-revision.mjs';
import {ownerApproved} from '../scripts/ai-made-policy.mjs';
import {createService} from './server.mjs';
import {scryptSync} from 'node:crypto';
import {aiMadePreviews} from './factory-ai-made-previews.mjs';
const job='11111111-1111-4111-8111-111111111111';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE factory_jobs(id TEXT PRIMARY KEY,title TEXT,employee TEXT,status TEXT);CREATE TABLE factory_basic_items(id TEXT,job TEXT,recipe TEXT,closed INTEGER,status TEXT);CREATE TABLE factory_listings(job TEXT PRIMARY KEY,copy TEXT,supplier_id TEXT,store_id TEXT,status TEXT,error TEXT,updated TEXT);`);
 const copy={title:'Rose Bomber',description:'Original artwork.',category:'jackets',tags:['rose'],collections:['Rose']};
 db.prepare('INSERT INTO factory_jobs VALUES(?,?,?,?)').run(job,'Rose','jackets','completed');db.prepare('INSERT INTO factory_basic_items VALUES(?,?,?,?,?)').run('item',job,JSON.stringify({product:390,set:{name:'Rose'}}),1,'supplier_created');db.prepare('INSERT INTO factory_listings VALUES(?,?,?,?,?,?,?)').run(job,JSON.stringify(copy),'501',null,'supplier_ready','','today');
 const supplier={sync_product:{id:501,external_id:'midnight-factory-'+job,thumbnail_url:'https://files.cdn.printful.com/photo.png'},sync_variants:[{id:61,variant_id:10,synced:true,product:{product_id:390},files:[{id:81,type:'front',status:'ok',url:'https://files.cdn.printful.com/art.png'}]}]};
 const calls=[];let owner=true,sent,checkpoint=0;
 const publishing={ownerSupplier:async()=>supplier,ownerStore:async()=>[],ownerMockups:()=>[],ownerGithub:async(path,o={})=>{calls.push({path,...o});if(path.includes('/contents/')&&!o.method)return null;return {};}};
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 const engine=factoryAiMade({db,publishing,basic:{checkpoint:async()=>{checkpoint++;}},auth:()=>{if(!owner)fail(401,'Owner access required.');},body:async r=>r.payload,send:(r,s,d)=>{sent=d;},fail,limit:()=>{},origin:'http://test'});
 const call=async(path='',payload,origin='http://test')=>{await engine.handle({headers:{origin},payload},{},'/api/owner/ai-factory/ai-made'+path,payload===undefined?'GET':'POST');return sent;};
 return {db,copy,supplier,calls,engine,call,deny:()=>{owner=false;},checkpoints:()=>checkpoint};
}
test('AI Made is owner-only, and listing drafts never publish or touch Printful',async t=>{
 const f=fixture(t);assert.equal((await f.call()).products.length,1);const d=await f.call('/save',{job,revision:0,copy:{...f.copy,title:'Edited Rose'}});assert.equal(d.product.revision,1);assert.equal(f.calls.length,0);assert.equal(f.checkpoints(),1);
 await assert.rejects(f.call('/save',{job,revision:0,copy:f.copy}),/another tab/);await assert.rejects(f.call('/save',{job,revision:1,copy:f.copy},'https://other.test'),/Origin/);f.deny();await assert.rejects(f.call(),e=>e.status===401);
});
test('publication requires reviewed images, explicit confirmation and the unchanged review token',async t=>{
 const f=fixture(t),d=await f.call('/'+job),b={job,revision:0,reviewToken:d.product.reviewToken,confirm:true};
 await assert.rejects(f.call('/approve',{...b,confirm:false}),/confirm/);f.supplier.sync_variants[0].files[0].id=82;await assert.rejects(f.call('/approve',b),/changed/);assert.equal(f.calls.length,0);
 const fresh=await f.call('/'+job);const result=await f.call('/approve',{...b,reviewToken:fresh.product.reviewToken});assert.equal(result.pending,true);const write=f.calls.find(x=>x.method==='PUT');const manifest=JSON.parse(Buffer.from(JSON.parse(write.body).content,'base64').toString());assert.equal(manifest.products['501'].decision,'approved');assert.equal(manifest.products['501'].external,'midnight-factory-'+job);assert.equal(manifest.products['501'].copy.title,'Rose Bomber');assert.ok(f.calls.some(x=>x.path.endsWith('/dispatches')));
});
test('unaccepted supplier files and needs-changes decisions cannot release a product',async t=>{
 const f=fixture(t);f.supplier.sync_variants[0].files[0].status='processing';const d=await f.call('/'+job);await assert.rejects(f.call('/approve',{job,revision:0,reviewToken:d.product.reviewToken,confirm:true}),/accepted print files/);assert.equal(f.calls.length,0);await f.call('/needs-changes',{job,revision:0});assert.equal((await f.call()).products[0].status,'needs_changes');assert.equal(f.calls.length,0);
});
test('same-product artwork updates retain all supplier variant IDs and reject changed products or missing sizes',()=>{
 const d={sync_product:{id:501,external_id:'midnight-factory-original'},sync_variants:[{id:61,variant_id:10,product:{product_id:390}},{id:62,variant_id:11,product:{product_id:390}}]};const p={j:{id:job},copy:{title:'Rose'},selection:{product:390,replaceProduct:{supplierId:'501',external:'midnight-factory-original'}},files:[10,11].map(variant=>({variant,areas:[{placement:'front',file:'file-'+variant}]})),assessment:{variants:[10,11].map(variant=>({variant,priceCents:4599}))}};
 const payload=replacementPayload(d,p,x=>'https://example.com/'+x);assert.deepEqual(payload.sync_variants.map(v=>v.id),[61,62]);assert.equal(payload.sync_product.external_id,'midnight-factory-'+job);assert.equal(payload.sync_variants[0].retail_price,'45.99');p.files.pop();assert.throws(()=>replacementPayload(d,p,String),/every original variant/);d.sync_product.external_id='changed';assert.throws(()=>replacementPayload(d,p,String),/original Printful product changed/);
});
test('a production receipt or listing manifest alone never grants storefront permission',()=>{
 assert.equal(ownerApproved({products:{}},501,'midnight-factory-new'),false);assert.equal(ownerApproved({products:{501:{decision:'approved',external:'old'}}},501,'new'),false);assert.equal(ownerApproved({products:{501:{decision:'needs_changes',external:'new'}}},501,'new'),false);assert.equal(ownerApproved({products:{501:{decision:'approved',external:'new'}}},501,'new'),true);
});

test('the separate page and approval API require owner sign-in even when the rest of the Factory is open',async t=>{
 const salt='ab'.repeat(16),password='local-ai-made-test';
 const service=createService({dbPath:':memory:',origin:'http://localhost:3000',secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),factoryLoginRequired:false});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.server.close(r)));const root='http://127.0.0.1:'+service.server.address().port;
 const page=await fetch(root+'/ai-made',{redirect:'manual'});assert.equal(page.status,302);assert.equal(page.headers.get('location'),'/login?next=ai-made');
 const login=await fetch(root+'/login?next=ai-made',{redirect:'manual'});assert.equal(login.status,200,'the private page never loops through the public Factory redirect');
 assert.equal((await fetch(root+'/api/owner/ai-factory/ai-made')).status,401);
 const signed=await fetch(root+'/api/owner/login',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(signed.status,200);
 const cookie=signed.headers.get('set-cookie').split(';')[0],privatePage=await fetch(root+'/ai-made',{headers:{Cookie:cookie}});assert.equal(privatePage.status,200);assert.match(await privatePage.text(),/Approve &amp; publish|Approve & publish/);
});

test('private review images use accepted native files and resume the same image task without publishing a product',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let creates=0,ready=false;const calls=[];
 const detail={sync_product:{id:501,name:'Rose'},sync_variants:[{id:61,variant_id:10,synced:true,retail_price:'45.99',currency:'USD',size:'M',color:'White',product:{product_id:390},files:[{id:81,type:'front',status:'ok',is_temporary:false,width:4000,height:5000,hash:'accepted-file',preview_url:'https://files.cdn.printful.com/art.png',url:'https://files.cdn.printful.com/art.png'}]}]};
 const pf=async(path,o={})=>{calls.push({path,...o});if(path.includes('/printfiles/'))return {printfiles:[{printfile_id:1,width:4000,height:5000}],variant_printfiles:[{variant_id:10,placements:{front:1}}],options:['Front','Back'],option_groups:['Flat']};if(path.includes('/create-task/')){creates++;return {task_key:'review-1'};}if(path.includes('/task?'))return ready?{status:'completed',mockups:[{variant_ids:[10],mockup_url:'https://files.cdn.printful.com/review.png'}]}:{status:'pending'};throw Error('Unexpected supplier write');};
 const p=aiMadePreviews({db,pf,checkpoint:async()=>{},fail:(s,m)=>{throw Error(m);}});assert.equal((await p.generate(job,detail)).pending,true);assert.equal((await p.generate(job,detail)).pending,true);assert.equal(creates,1);ready=true;assert.equal((await p.generate(job,detail)).pending,false);assert.equal(p.gallery(job,detail).length,1);await p.generate(job,detail);assert.equal(creates,1);assert.ok(calls.every(c=>!c.path.startsWith('store/')));detail.sync_variants[0].files[0].id=82;assert.equal(p.gallery(job,detail).length,0,'changed print files cannot reuse old review pictures');
});
