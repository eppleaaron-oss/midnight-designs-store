import {test} from 'node:test';import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {createService} from './server.mjs';import {normalizeConfig,planRun,split} from './factory-runs.mjs';

const base={artworkIds:[],garments:['jacket','pants','hoodie','tshirt'],quantity:{mode:'total',total:100},workers:{total:20,mode:'auto'}};

test('production plans split quantities, ratios, workers and colors exactly',()=>{
 assert.deepEqual(split(10,[1,1,1]),[4,3,3]);
 const percent=planRun(normalizeConfig({...base,mix:{mode:'percent',values:{jacket:40,pants:20,hoodie:20,tshirt:20}}}));
 assert.deepEqual(percent.quantities,{jacket:40,pants:20,hoodie:20,tshirt:20});assert.equal(percent.total,100);
 assert.equal(percent.workers.qc,2);assert.equal(Object.values(percent.workers).reduce((a,b)=>a+b,0),20);assert.equal(percent.workers.jacket,7,"18 creator workers split 40/20/20/20");
 assert.deepEqual(percent.colors.jacket,['Black']);
 const each=planRun(normalizeConfig({...base,quantity:{mode:'each',each:{jacket:30,pants:20,hoodie:25,tshirt:25}}}));assert.equal(each.total,100);assert.equal(each.quantities.hoodie,25);
 const shirts=planRun(normalizeConfig({...base,color:{base:'Black',mode:'per-product',perGarment:{tshirt:['Black','Charcoal','Cream']}}}));assert.deepEqual(shirts.colors.tshirt,['Black','Charcoal','Cream']);assert.deepEqual(shirts.colors.pants,['Black']);
 const unlimited=planRun(normalizeConfig({...base,quantity:{mode:'unlimited'},limits:{batch:10,costPerProductCents:25}}));assert.equal(unlimited.unlimited,true);assert.equal(unlimited.total,10);assert.equal(unlimited.estimatedCostCents,null);assert.equal(unlimited.batchCostCents,250);
 const manual=planRun(normalizeConfig({...base,workers:{total:20,mode:'manual',roles:{jacket:8,pants:4,hoodie:4,tshirt:2,qc:2}}}));assert.equal(manual.workers.jacket,8);
 assert.throws(()=>normalizeConfig({...base,mix:{mode:'percent',values:{jacket:50,pants:20,hoodie:20,tshirt:20}}}),/add up to 100/);
 assert.throws(()=>normalizeConfig({...base,workers:{total:20,mode:'manual',roles:{jacket:5}}}),/add up to the total/);
 assert.throws(()=>normalizeConfig({...base,color:{base:'Black',exclude:['Black']}}),/cannot also be excluded/);
 assert.throws(()=>normalizeConfig({...base,garments:['spacesuit']}),/valid clothing/);
});

test('owner production runs import library art, queue jobs in batches, save presets and stop',async()=>{
 const origin='http://localhost:3000',storefrontOrigin='https://midnight-designs.store',salt='cd'.repeat(16),password='runs-test-password-1';
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
 const designs=[{id:'art-1',name:'Blood Moon',category:'Celestial & gothic',image:'assets/designs/art-1.png',thumbnail:'assets/designs/art-1-thumb.png',kind:'artwork'},{id:'art-2',name:'Raven Gate',category:'Celestial & gothic',image:'assets/designs/art-2.png',kind:'artwork'},{id:'ref-1',name:'Mockup',category:'x',image:'a.png',kind:'reference'}];
 const fetched=[];
 const service=createService({dbPath:':memory:',origin,storefrontOrigin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),runSettings:{fetchImpl:async url=>{fetched.push(url);return url.endsWith('/designs.json')?new Response(JSON.stringify(designs)):new Response(png,{headers:{'Content-Type':'image/png'}});}}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,b,source=origin){const r=await fetch(root+path,{method:b?'POST':'GET',headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],csp:r.headers.get('content-security-policy')};}
 try{
  assert.equal((await call('/api/owner/ai-factory/runs')).status,401);
  cookie=(await call('/api/owner/login',{password})).cookie;
  const page=await fetch(root+'/ai-factory',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/factory\.js/);assert.match(page.headers.get('content-security-policy'),/img-src[^;]*https:\/\/midnight-designs\.store/);
  assert.equal((await fetch(root+'/ai-factory/tools',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(root+'/ai-factory',{redirect:'manual'})).status,302);

  const library=await call('/api/owner/ai-factory/runs/library');assert.deepEqual(library.data.designs.map(d=>d.id),['art-1','art-2']);assert.equal(library.data.designs[0].thumbnail,storefrontOrigin+'/assets/designs/art-1-thumb.png');
  assert.equal((await call('/api/owner/ai-factory/runs/import',{ids:['art-1']},'https://evil.example')).status,403);
  const imported=await call('/api/owner/ai-factory/runs/import',{ids:['art-1','art-2','missing']});assert.deepEqual(imported.data.imported,['art-1','art-2']);assert.equal(imported.data.errors.length,1);
  assert.ok(fetched.includes(storefrontOrigin+'/assets/designs/art-1.png'));
  const again=await call('/api/owner/ai-factory/runs/import',{ids:['art-1']});assert.deepEqual(again.data.imported,['art-1']);
  let snap=(await call('/api/owner/ai-factory/runs')).data;assert.equal(snap.artwork.length,2);const artworkIds=snap.artwork.map(a=>a.id);

  const plan=await call('/api/owner/ai-factory/runs/plan',{config:{artworkIds,garments:['jacket','pants'],quantity:{mode:'total',total:12},workers:{total:20,mode:'auto'}}});
  assert.equal(plan.status,200);assert.equal(plan.data.plan.total,12);
  const config={name:'Midnight Jacket Run',artworkIds,garments:['jacket','pants'],quantity:{mode:'each',each:{jacket:6,pants:3}},workers:{total:20,mode:'auto'},limits:{batch:5},color:{base:'Black'}};
  assert.equal((await call('/api/owner/ai-factory/runs/start',{config:{...config,artworkIds:[]}})).status,400);
  const started=await call('/api/owner/ai-factory/runs/start',{config});assert.equal(started.status,200,JSON.stringify(started.data));
  snap=started.data;assert.equal(snap.active.number,1);assert.equal(snap.active.name,'Midnight Jacket Run');
  assert.equal(snap.jobs.length,5,'only one batch is queued at a time');assert.equal(snap.active.counts.planned,4);
  assert.ok(snap.jobs.every(j=>j.color==='Black'&&j.number===1&&j.stage==='Queued'));
  const jobs=(await call('/api/owner/ai-factory/jobs')).data.jobs;assert.match(jobs[0].brief,/Base garment color: Black\. Fill or dye the garment itself/);assert.ok(jobs.every(j=>['jackets','pants'].includes(j.employee)));
  assert.equal((await call('/api/owner/ai-factory/runs/start',{config})).status,409,'one active run at a time');
  assert.equal(snap.interrupted,null);

  const preset=await call('/api/owner/ai-factory/runs/preset',{name:'Midnight Jacket Run',config});assert.equal(preset.data.presets.length,1);assert.deepEqual(preset.data.presets[0].config.artworkIds,[]);
  const kept=await call('/api/owner/ai-factory/runs/preset',{name:'Midnight Jacket Run',config,keepDesigns:true});assert.equal(kept.data.presets.length,1);assert.deepEqual(kept.data.presets[0].config.artworkIds,artworkIds);
  assert.equal((await call('/api/owner/ai-factory/runs/preset-delete',{id:kept.data.presets[0].id})).data.presets.length,0);

  const paused=await call('/api/owner/ai-factory/runs/control',{id:snap.active.id,action:'pause'});assert.equal(paused.data.active.status,'paused');
  const stopped=await call('/api/owner/ai-factory/runs/control',{id:snap.active.id,action:'stop'});assert.equal(stopped.data.active,null);assert.equal(stopped.data.runs[0].status,'stopped');
  const copy=await call('/api/owner/ai-factory/runs/duplicate',{id:snap.active.id});assert.equal(copy.data.config.name,'Midnight Jacket Run');
 }finally{await new Promise(r=>service.server.close(r));}
});
