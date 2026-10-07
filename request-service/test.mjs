import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from './server.mjs';

test('Private conversations, access isolation, exact approvals, revocation and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'midnight-messages-')),origin='http://localhost:3000',password='test-only-owner-password',salt='ab'.repeat(16),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');let service,url;
 async function boot(){service=createService({dbPath:join(dir,'requests.sqlite'),origin,passwordHash,secure:false});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+service.server.address().port;}
 async function call(path,{body,cookie,originHeader=origin}={}){const r=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:originHeader,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.arrayBuffer();return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  await boot();assert.equal((await call('requests')).status,401);
  assert.equal((await call('owner/login',{body:{password:'wrong'}})).status,401);
  assert.equal((await call('owner/login',{body:{password},originHeader:'https://evil.example'})).status,403);
  const denied=await fetch(url+'/ai-factory',{redirect:'manual'});assert.equal(denied.status,302);assert.equal(denied.headers.get('location'),'/login?next=ai-factory');assert.equal((await fetch(url+'/ai-factory.js')).status,401);assert.equal((await call('owner/ai-factory/jobs')).status,401);
  const owner=(await call('owner/login',{body:{password}})).cookie;assert.ok(owner);assert.equal((await fetch(url+'/ai-factory',{headers:{Cookie:owner}})).status,200);assert.equal((await call('owner/ai-factory/jobs',{cookie:owner})).status,200);
  const brief={type:'Custom design request',title:'Raven hoodie',name:'Customer',email:'customer@example.test',brief:'Original back raven; red and bone white',status:'Completed'};
  const a=(await call('requests',{body:brief})).data,b=(await call('requests',{body:{...brief,title:'Second private request'}})).data;
  const access=async link=>await call('access',{body:{token:new URL(link).hash.slice(8)}});
  const customer=(await access(a.link)).cookie,other=(await access(b.link)).cookie;assert.equal((await fetch(url+'/ai-factory',{headers:{Cookie:customer},redirect:'manual'})).status,302);assert.equal((await call('owner/ai-factory/jobs',{cookie:customer})).status,403);
  assert.equal((await call('requests/'+a.id,{cookie:customer})).data.status,'New');
  assert.equal((await call('requests/'+b.id,{cookie:customer})).status,404);
  assert.equal((await call('requests',{cookie:customer})).status,403);
  assert.equal((await call('requests/'+a.id+'/status',{cookie:customer,body:{status:'Completed'}})).status,403);
  assert.equal((await call('requests/'+a.id+'/messages',{cookie:customer,body:{body:'Can the moon be larger?',role:'owner'}})).status,201);
  assert.equal((await call('requests/'+a.id+'/messages',{cookie:owner,body:{body:'Yes, I will send a revised preview.'}})).status,201);
  let thread=(await call('requests/'+a.id,{cookie:customer})).data;assert.equal(thread.messages.at(-2).role,'customer');assert.equal(thread.messages.at(-1).role,'owner');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
  assert.equal((await call('requests/'+a.id+'/attachments',{cookie:customer,body:{name:'bad.png',mime:'image/png',data:Buffer.from('<svg onload=alert(1)>').toString('base64')}})).status,400);
  const attachment=(await call('requests/'+a.id+'/attachments',{cookie:owner,body:{name:'raven-v1.png',mime:'image/png',data:png}})).data.id;
  assert.equal((await call('attachments/'+attachment,{cookie:other})).status,404);assert.equal((await call('attachments/'+attachment)).status,401);
  assert.equal((await call('requests/'+a.id+'/design',{cookie:customer,body:{attachment}})).status,403);
  const revision=(await call('requests/'+a.id+'/design',{cookie:owner,body:{attachment,note:'Moon enlarged'}})).data.revision;
  assert.equal((await call('requests/'+a.id+'/approve',{cookie:owner,body:{revision,confirm:true}})).status,403);
  assert.equal((await call('requests/'+a.id+'/approve',{cookie:customer,body:{revision:'old-version',confirm:true}})).status,409);
  assert.equal((await call('requests/'+a.id+'/approve',{cookie:customer,body:{revision,confirm:true}})).status,200);
  const nextRevision=(await call('requests/'+a.id+'/design',{cookie:owner,body:{attachment,note:'Version two'}})).data.revision;
  thread=(await call('requests/'+a.id,{cookie:customer})).data;assert.equal(thread.approved,null);assert.equal(thread.status,'Customer Review');
  assert.equal((await call('requests/'+a.id+'/approve',{cookie:customer,body:{revision,confirm:true}})).status,409);
  assert.equal((await call('requests/'+a.id+'/revision',{cookie:customer,body:{body:'More faded texture please'}})).status,200);
  assert.equal((await call('requests/'+a.id,{cookie:owner})).data.status,'Revision Requested');
  const final=(await call('requests/'+a.id+'/design',{cookie:owner,body:{attachment}})).data.revision;
  assert.notEqual(final,nextRevision);
  assert.equal((await call('requests/'+a.id+'/approve',{cookie:customer,body:{revision:final,confirm:true}})).status,200);
  assert.equal((await call('requests/'+a.id+'/status',{cookie:owner,body:{status:'Ready for Production'}})).status,409);
  assert.equal((await call('requests/'+a.id+'/status',{cookie:owner,body:{status:'Ready for Production',productionChecked:true}})).status,200);
  assert.equal((await call('requests/'+a.id+'/status',{cookie:owner,body:{status:'Completed'}})).status,200);
  assert.equal((await call('requests/'+b.id+'/status',{cookie:owner,body:{status:'Completed'}})).status,409);
  const fresh=(await call('requests/'+a.id+'/invite',{cookie:owner,body:{}})).data.link;
  assert.equal((await call('requests/'+a.id,{cookie:customer})).status,401);assert.equal((await access(a.link)).status,401);
  const newCustomer=(await access(fresh)).cookie;assert.equal((await call('requests/'+a.id,{cookie:newCustomer})).status,200);
  assert.equal((await call('owner/export',{cookie:newCustomer})).status,403);const backup=(await call('owner/export',{cookie:owner})).data;assert.equal(backup.requests.length,2);assert.equal(backup.attachments[0].data,png);assert.equal(JSON.stringify(backup).includes(passwordHash),false);
  await new Promise(r=>service.server.close(r));await boot();thread=(await call('requests/'+a.id,{cookie:newCustomer})).data;assert.equal(thread.status,'Completed');assert.equal(thread.approved,final);assert.ok(thread.messages.some(m=>m.kind==='revision'));assert.equal((await call('attachments/'+attachment,{cookie:newCustomer})).status,200);
  const staticSecret=await fetch(url+'/server.mjs');assert.equal(staticSecret.status,404);
 }finally{await new Promise(r=>service.server.close(r));rmSync(dir,{recursive:true,force:true});}
});
