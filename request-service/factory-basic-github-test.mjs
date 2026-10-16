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
test('the inline Basic worker uses only loopback, a scoped runtime secret and the existing service',async()=>{
 let args,child=new EventEmitter();child.kill=signal=>{assert.equal(signal,'SIGTERM');queueMicrotask(()=>child.emit('exit',0));};
 const worker=startBasicWorker({server:{address:()=>({port:3000})},token:'fixture-internal-secret-'.repeat(3),spawnImpl(...a){args=a;return child;}});
 assert.equal(args[2].env.FACTORY_BACKEND_URL,'http://127.0.0.1:3000');assert.equal(args[2].env.FACTORY_BASIC_ONLY,'1');assert.equal(args[2].env.OWNER_PASSWORD_HASH,undefined);assert.equal(args[2].env.PRINTFUL_TOKEN,undefined);assert.equal(args[2].env.FACTORY_BACKUP_GITHUB_TOKEN,undefined);await worker.close();
});
