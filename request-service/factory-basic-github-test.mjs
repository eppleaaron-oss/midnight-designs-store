import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {BasicGithubAssets} from './factory-basic-github.mjs';
import {githubWorkingFixture} from './factory-github-fixture.mjs';
import {startBasicWorker} from './factory-inline-worker.mjs';

const config={repo:'owner/private-data',token:'private-fixture-token',key:Buffer.alloc(32,23)};
test('private working attachments authenticate exact pixels and never delete an unrelated release',async()=>{
 const g=githubWorkingFixture(),store=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),job=randomUUID(),data=Buffer.from('original protected artwork'),sha=createHash('sha256').update(data).digest('hex');
 const file=randomUUID(),saved=await store.put(job,'print',file,data,sha);assert.ok([...g.assets.values()].every(a=>!a.data.includes(data)));
 const replay=await store.put(job,'print',file,data,sha);assert.equal(replay.asset,saved.asset);assert.equal(g.assets.size,1);
 g.corrupt=true;await assert.rejects(store.read(saved.asset,job,'print',file,sha),/authentication/);g.corrupt=false;
 g.releases.get(saved.release).body='A different owner-created release';await assert.rejects(store.remove(job,saved.release),/not the tracked/);assert.equal(g.assets.size,1);
});
test('public repositories are rejected before working files are uploaded',async()=>{
 const g=githubWorkingFixture();g.private=false;const store=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),data=Buffer.from('private');await assert.rejects(store.put(randomUUID(),'print',randomUUID(),data,createHash('sha256').update(data).digest('hex')),/private GitHub/);assert.equal(g.assets.size,0);
});
test('expired signed working-file redirects refresh without leaking credentials or changing authenticated bytes',async()=>{
 const g=githubWorkingFixture(),job=randomUUID(),file=randomUUID(),data=Buffer.from('recover these exact pixels'),sha=createHash('sha256').update(data).digest('hex');
 const initial=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),saved=await initial.put(job,'print',file,data,sha);let downloads=0,redirects=0;
 const store=new BasicGithubAssets(config,{sleep:async()=>{},fetchImpl:async(url,o={})=>{
  const u=new URL(url);if(u.hostname==='api.github.com'&&o.headers.Accept==='application/octet-stream'){redirects++;assert.equal(o.cache,'no-store');assert.ok(u.searchParams.has('download'));return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/'+redirects}});}
  if(u.hostname==='release-assets.githubusercontent.com'){assert.equal(o.headers?.Authorization,undefined);downloads++;return downloads===1?new Response('expired',{status:403}):new Response(g.assets.get(saved.asset).data);}
  return g.fetch(url,o);
 }});assert.deepEqual(await store.read(saved.asset,job,'print',file,sha),data);assert.equal(redirects,2);assert.equal(downloads,2);
});
test('the inline Basic worker uses only loopback, a scoped runtime secret and the existing service',async()=>{
 let args,child=new EventEmitter();child.kill=signal=>{assert.equal(signal,'SIGTERM');queueMicrotask(()=>child.emit('exit',0));};
 const worker=startBasicWorker({server:{address:()=>({port:3000})},token:'fixture-internal-secret-'.repeat(3),spawnImpl(...a){args=a;return child;}});
 assert.equal(args[2].env.FACTORY_BACKEND_URL,'http://127.0.0.1:3000');assert.equal(args[2].env.FACTORY_BASIC_ONLY,'1');assert.equal(args[2].env.OWNER_PASSWORD_HASH,undefined);assert.equal(args[2].env.PRINTFUL_TOKEN,undefined);assert.equal(args[2].env.FACTORY_BACKUP_GITHUB_TOKEN,undefined);await worker.close();
});


test('an acknowledged release ID is reused even while the listing omits it',async()=>{
 const g=githubWorkingFixture(),original=g.fetch;let writes=0;const fetchImpl=async(url,o={})=>{const p=new URL(url).pathname;if(p.endsWith('/releases')&&(o.method||'GET')==='GET')return new Response('[]',{headers:{'Content-Type':'application/json'}});if(p.endsWith('/releases')&&o.method==='POST')writes++;return original(url,o);};
 const store=new BasicGithubAssets(config,{fetchImpl,sleep:async()=>{}}),job=randomUUID();const release=await store.release(job);for(const file of ['front','back']){const data=Buffer.from(file),saved=await store.put(job,'print',file,data,createHash('sha256').update(data).digest('hex'));assert.equal(saved.release,release.id);}assert.equal(writes,1,'Stale listings cannot create another release after POST acknowledgement');assert.equal(g.releases.size,1);
});
test('identical authenticated recovery uploads can resume in the canonical release; unrelated working duplicates remain held',async()=>{
 const g=githubWorkingFixture(),store=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),job='recovery-v2-'+'ab'.repeat(32);for(const id of [102,101])g.releases.set(id,{id,draft:true,tag_name:'md-basic-'+job,body:store.body(job)});assert.equal((await store.find(job)).id,101);assert.equal(g.releases.size,2,'Recovery selection never deletes a candidate');
 const working=randomUUID();for(const id of [201,202])g.releases.set(id,{id,draft:true,tag_name:'md-basic-'+working,body:store.body(working)});await assert.rejects(store.find(working),/Duplicate working releases/);g.releases.get(102).body='foreign';await assert.rejects(store.find(job),/not the tracked/);
});

test('storage primary throttling waits for the exact reset and makes no calls during its cooldown',async()=>{
 let now=500000,calls=0;const store=new BasicGithubAssets(config,{clock:()=>now,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'620'}});}});
 await assert.rejects(store.api(''),e=>e.status===429&&e.retryAfter===120&&e.retryAt===620000);await assert.rejects(store.api(''),e=>e.status===429&&e.retryAfter===120);assert.equal(calls,1);now=620000;await assert.rejects(store.api(''),e=>e.status===429);assert.equal(calls,2);
});
test('secondary storage throttling is retryable without disguising permission errors',async()=>{
 const rate=new BasicGithubAssets(config,{fetchImpl:async()=>new Response(JSON.stringify({message:'You have exceeded a secondary rate limit.'}),{status:403})});await assert.rejects(rate.api(''),e=>e.status===429&&e.retryAfter===60);
 const denied=new BasicGithubAssets(config,{fetchImpl:async()=>new Response(JSON.stringify({message:'Resource not accessible by personal access token'}),{status:403})});await assert.rejects(denied.api(''),e=>e.status===409&&/HTTP 403/.test(e.message));assert.equal(denied.retryAt,0);
});


test('working attachment fetch and body timeouts retry the same authenticated asset without another upload',async()=>{
 const g=githubWorkingFixture(),job=randomUUID(),file=randomUUID(),data=Buffer.from('original immutable print bytes'),sha=createHash('sha256').update(data).digest('hex'),initial=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),saved=await initial.put(job,'print',file,data,sha);
 let reads=0;const store=new BasicGithubAssets(config,{sleep:async()=>{},fetchImpl:async(url,o={})=>{if(o.headers?.Accept==='application/octet-stream'){reads++;if(reads===1)throw new DOMException('connection timeout','TimeoutError');if(reads===2)return new Response(new ReadableStream({start(c){c.error(new DOMException('body timeout','AbortError'));}}));}return g.fetch(url,o);}});
 assert.deepEqual(await store.read(saved.asset,job,'print',file,sha),data);assert.equal(reads,3);assert.equal(g.assets.size,1);
});

test('exhausted attachment transport retries remain retryable without accepting unchecked bytes',async()=>{
 const g=githubWorkingFixture(),job=randomUUID(),file=randomUUID(),data=Buffer.from('safe'),sha=createHash('sha256').update(data).digest('hex'),initial=new BasicGithubAssets(config,{fetchImpl:g.fetch,sleep:async()=>{}}),saved=await initial.put(job,'print',file,data,sha);let reads=0;
 const store=new BasicGithubAssets(config,{sleep:async()=>{},fetchImpl:async(url,o={})=>{if(o.headers?.Accept==='application/octet-stream'){reads++;throw new DOMException('slow','TimeoutError');}return g.fetch(url,o);}});
 await assert.rejects(store.read(saved.asset,job,'print',file,sha),e=>e.status===503&&/original ID/.test(e.message));assert.equal(reads,3);assert.equal(g.assets.size,1);
});

test('working storage finds existing files beyond 1000 releases without creating duplicates',async()=>{const store=new BasicGithubAssets(config,{fetchImpl:async()=>{throw Error('unexpected network');}}),job='old-saved-job';let pages=0;store.api=async path=>{pages++;const page=Number(new URL('https://example.test'+path).searchParams.get('page'));return page<=10?Array.from({length:100},(_,i)=>({id:page*100+i,tag_name:'other-'+page+'-'+i})):[{id:9999,draft:true,tag_name:'md-basic-'+job,body:store.body(job)}];};assert.equal((await store.find(job)).id,9999);assert.equal(pages,11);});
