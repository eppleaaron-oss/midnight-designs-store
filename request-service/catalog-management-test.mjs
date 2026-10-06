import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {createService} from './server.mjs';
const salt='a'.repeat(32),password='test-owner-password-123',passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
let saved=null,writes=0;
const catalog=[{id:'art-one',name:'One'},{id:'art-two',name:'Two'}];
const {server}=createService({dbPath:':memory:',origin:'http://127.0.0.1:3999',secure:false,passwordHash,catalogToken:'test-token',catalogFetch:async(url,options)=>{if(options.method==='PUT'){writes++;saved=JSON.parse(options.body);return new Response('{}');}return new Response(JSON.stringify({sha:'current-sha',content:Buffer.from(JSON.stringify(catalog)).toString('base64')}));}});
await new Promise(r=>server.listen(3999,'127.0.0.1',r));
const call=(path,data,token,origin='https://midnight-designs.store')=>fetch('http://127.0.0.1:3999/api/owner/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
try{
 assert.equal((await call('delete-design',{designId:'art-one',confirm:true})).status,401);
 assert.equal((await call('catalog-login',{email:'midnightdesign107@gmail.com',password:'wrong'})).status,401);
 const login=await call('catalog-login',{email:'midnightdesign107@gmail.com',password});assert.equal(login.status,200);const {token}=await login.json();
 assert.equal((await call('delete-design',{designId:'art-one',confirm:true},token,'https://evil.example')).status,403);
 assert.equal((await call('delete-design',{designId:'art-one',confirm:false},token)).status,400);
 assert.equal((await call('delete-design',{designId:'missing',confirm:true},token)).status,404);assert.equal(writes,0);
 const response=await call('delete-design',{designId:'art-one',confirm:true},token);assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://midnight-designs.store');
 assert.equal(writes,1);assert.equal(saved.sha,'current-sha');assert.deepEqual(JSON.parse(Buffer.from(saved.content,'base64').toString()),[catalog[1]]);
 console.log('PASS: owner login, origin checks, confirmation, unknown ID, authenticated deletion and catalog conflict protection.');
}finally{await new Promise(r=>server.close(r));}
