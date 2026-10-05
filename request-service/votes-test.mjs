import {test} from 'node:test';import assert from 'node:assert/strict';import {scryptSync,randomUUID} from 'node:crypto';import {createService} from './server.mjs';
test('Design feedback is mutable, deduplicated, scoped to artwork and private to owner',async()=>{
 const origin='http://localhost:3000',salt='ef'.repeat(16),password='test-owner-design-votes',passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
 const {server}=createService({dbPath:':memory:',origin,passwordHash,secure:false,designCatalog:[{id:'art-one',name:'First artwork',kind:'artwork'},{id:'art-two',name:'Second artwork',kind:'artwork'},{id:'ref-one',name:'Finished mockup',kind:'reference'}]});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,cookie,source=origin)=>{const r=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:source,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],allow:r.headers.get('access-control-allow-origin')};};
 try{assert.equal((await call('design-votes')).status,401);const owner=(await call('owner/login',{password})).cookie,voter=randomUUID();
 const vote=choice=>call('design-votes',{designId:'art-one',voterId:voter,choice},null,'https://midnight-designs.store');
 const first=await vote('like');assert.equal(first.status,200);assert.equal(first.allow,'https://midnight-designs.store');await vote('like');let counts=(await call('design-votes',undefined,owner)).data;assert.equal(counts[0].likes,1);assert.equal(counts.length,2);
 await vote('dislike');counts=(await call('design-votes',undefined,owner)).data;const one=counts.find(x=>x.id==='art-one');assert.equal(one.likes,0);assert.equal(one.dislikes,1);assert.equal(JSON.stringify(counts).includes(voter),false);
 await vote(null);assert.ok((await call('design-votes',undefined,owner)).data.every(x=>x.likes+x.dislikes===0));
 assert.equal((await call('design-votes',{designId:'ref-one',voterId:voter,choice:'like'})).status,400);
 assert.equal((await call('design-votes',{designId:'unknown',voterId:voter,choice:'like'})).status,400);
 assert.equal((await call('design-votes',{designId:'art-one',voterId:voter,choice:'like'},null,'https://evil.example')).status,403);
 const preflight=await fetch(url+'/api/design-votes',{method:'OPTIONS',headers:{Origin:'https://midnight-designs.store','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);
 const wrong=await fetch(url+'/api/owner/login',{method:'OPTIONS',headers:{Origin:'https://midnight-designs.store'}});assert.equal(wrong.status,403);
 }finally{await new Promise(r=>server.close(r));}
});
