import {test} from 'node:test';import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {createService} from './server.mjs';

test('owner login health never exposes the hash, and the Brain feeds every production brief',async()=>{
 const origin='http://localhost:3000',storefrontOrigin='https://midnight-designs.store',salt='ef'.repeat(16),password='brain-test-password-1',hash=scryptSync(password,salt,64).toString('hex');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
 const designs=[{id:'art-1',name:'Blood Moon',category:'Celestial',image:'assets/designs/art-1.png',kind:'artwork'},{id:'art-2',name:'Raven Gate',category:'Celestial',image:'assets/designs/art-2.png',kind:'artwork'}];
 const probed=[];
 const env={OPENAI_API_KEY:'sk-test-not-real',PRINTFUL_TOKEN:'pf-test-not-real'};
 const service=createService({dbPath:':memory:',origin,storefrontOrigin,secure:false,passwordHash:salt+':'+hash,
  runSettings:{fetchImpl:async url=>url.endsWith('/designs.json')?new Response(JSON.stringify(designs)):new Response(png,{headers:{'Content-Type':'image/png'}})},
  intelligenceSettings:{env,fetchImpl:async(url,o)=>{if(url===storefrontOrigin+'/products.json')return new Response(JSON.stringify({products:[{id:'p1',name:'Unisex zip hoodie',category:'Hoodies',image:'https://files.cdn.printful.com/p1.png'},{id:'p2',name:'Classic tee',category:'T-shirts',image:'https://files.cdn.printful.com/p2.png'}]}));if(url===storefrontOrigin+'/designs.json')return new Response(JSON.stringify([...designs,{id:'ref-1',name:'Reaper jacket mockup',category:'Mockups',image:'assets/designs/ref-1.jpg',kind:'reference'}]));probed.push([url,o.headers.Authorization]);return url.includes('openai')?new Response(JSON.stringify({data:[{id:'gpt-image-1'},{id:'gpt-4o'}]})):new Response('{}',{status:401});}}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,b,source=origin){const r=await fetch(root+path,{method:b?'POST':'GET',headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});const text=await r.text();return {status:r.status,text,data:JSON.parse(text),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  const health=await call('/health/owner');assert.equal(health.status,200);assert.equal(health.data.hashFormatValid,true);assert.match(health.data.hashFingerprint,/^[0-9a-f]{4}…[0-9a-f]{4}$/);
  for(const secret of [hash,salt,password,hash.slice(0,16),hash.slice(-16)])assert.ok(!health.text.includes(secret),'health must not leak hash, salt or password');

  assert.equal((await call('/api/owner/ai-factory/intelligence')).status,401);
  assert.equal((await fetch(root+'/ai-intelligence',{redirect:'manual'})).status,302);
  cookie=(await call('/api/owner/login',{password})).cookie;
  const page=await fetch(root+'/ai-intelligence',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/intelligence\.js/);

  let brain=(await call('/api/owner/ai-factory/intelligence')).data;
  assert.ok(brain.rules.length>=5);assert.ok(brain.rules.some(r=>r.locked));assert.equal(brain.counts.rules,brain.rules.length);
  const provider=brain.components.find(c=>c.id==='provider');assert.equal(provider.ok,true);
  assert.ok(!JSON.stringify(brain).includes('sk-test-not-real'),'status never echoes keys');
  assert.equal(brain.components.find(c=>c.id==='worker').ok,false);

  const locked=brain.rules.find(r=>r.locked);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{id:locked.id,delete:true})).status,409);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{id:locked.id,section:locked.section,title:'Changed',body:'Changed'})).status,409);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{section:'brand-dna',title:'Skulls',body:'Prefer anatomical skull detail over cartoon skulls.'},'https://evil.example')).status,403);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{section:'brand-dna',title:'Skulls',body:'Prefer anatomical skull detail over cartoon skulls.'})).status,200);
  brain=(await call('/api/owner/ai-factory/intelligence')).data;const added=brain.rules.find(r=>r.title==='Skulls');assert.ok(added);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{id:added.id,locked:true})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{id:added.id,delete:true})).status,409);
  assert.equal((await call('/api/owner/ai-factory/intelligence/rule',{id:added.id,locked:false})).status,200);

  assert.equal((await call('/api/owner/ai-factory/intelligence/garment',{garment:'jacket',profile:{density:[5,2],hierarchy:'x',color:'Black',placement:{}}})).status,400);
  assert.equal((await call('/api/owner/ai-factory/intelligence/garment',{garment:'jacket',profile:{density:[3,6],hierarchy:'Hero on the back, accents on sleeves.',color:'Black',placement:{back:'Hero'}}})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/garment',{garment:'jacket',locked:true})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/garment',{garment:'jacket',profile:{density:[1,2],hierarchy:'x',color:'Black',placement:{}}})).status,409);
  const know=(await call('/api/owner/ai-factory/intelligence/knowledge/jacket')).data.text;assert.match(know,/Skulls/);assert.match(know,/Hero on the back/);

  assert.equal((await call('/api/owner/ai-factory/intelligence/memory',{kind:'preference',text:'Owner likes red moons.'})).status,200);
  brain=(await call('/api/owner/ai-factory/intelligence')).data;const mem=brain.memories.find(m=>m.text==='Owner likes red moons.');assert.ok(mem);
  assert.equal((await call('/api/owner/ai-factory/intelligence/memory',{id:mem.id,delete:true})).status,200);
  assert.ok(!(await call('/api/owner/ai-factory/intelligence')).data.memories.some(m=>m.id===mem.id));

  const diag=(await call('/api/owner/ai-factory/intelligence/diagnose',{})).data;
  const state=id=>diag.results.find(r=>r.id===id)?.state;
  assert.equal(state('auth'),'pass');assert.equal(state('generation'),'pass');assert.equal(state('printful'),'fail');assert.equal(state('worker'),'not_configured');
  assert.ok(probed.some(([u,a])=>u.startsWith('https://api.openai.com/')&&a==='Bearer sk-test-not-real'));
  assert.ok(!JSON.stringify(diag).includes('not-real'));

  await call('/api/owner/ai-factory/runs/import',{ids:['art-1','art-2']});
  const artworkIds=(await call('/api/owner/ai-factory/runs')).data.artwork.map(a=>a.id);
  const sandbox=(await call('/api/owner/ai-factory/intelligence/test',{prompt:'Design a charcoal jacket with this raven.',garment:'jacket',artworkIds})).data;
  assert.equal(sandbox.garment,'Jackets');assert.match(sandbox.colorPlan,/Charcoal\. FILL OPTION REQUIRED/);assert.equal(new Set(sandbox.placement.filter(z=>z.artwork).map(z=>z.zone)).size,sandbox.placement.filter(z=>z.artwork).length);assert.equal(sandbox.placement.find(z=>z.zone==='back')?.artwork,sandbox.artwork[0]);
  assert.equal((await call('/api/owner/ai-factory/runs')).data.jobs.length,0,'the sandbox never queues work');

  const store=(await call('/api/owner/ai-factory/intelligence/store')).data.items;
  assert.deepEqual(store.map(x=>[x.id,x.kind,x.garment]),[['product:p1','product','ziphoodie'],['product:p2','product','tshirt'],['design:art-1','design',null],['design:art-2','design',null],['design:ref-1','mockup','jacket']]);
  assert.equal(store[4].image,storefrontOrigin+'/assets/designs/ref-1.jpg');
  assert.equal((await call('/api/owner/ai-factory/intelligence/reference',{add:['product:nope']})).status,404);
  assert.equal((await call('/api/owner/ai-factory/intelligence/reference',{add:['product:p1','design:ref-1','product:p2']})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/reference',{id:'product:p2',delete:true})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/reference',{id:'design:ref-1',garment:'jacket',note:'Big back hero, small chest mark.'})).status,200);
  brain=(await call('/api/owner/ai-factory/intelligence')).data;assert.deepEqual(brain.references.map(r=>r.id).sort(),['design:ref-1','product:p1']);assert.equal(brain.counts.references,2);
  assert.ok((await call('/api/owner/ai-factory/intelligence/store')).data.items.find(x=>x.id==='design:ref-1').pinned);
  const jacketKnow=(await call('/api/owner/ai-factory/intelligence/knowledge/jacket')).data.text;assert.match(jacketKnow,/Reaper jacket mockup \(mockup\): Big back hero/);assert.ok(!jacketKnow.includes('Unisex zip hoodie'),'references for other garments stay out');
  assert.match(jacketKnow,/One design per placement/);assert.match(jacketKnow,/When to place a design/);assert.match(jacketKnow,/fill option/);

  const white=(await call('/api/owner/ai-factory/intelligence/test',{prompt:'A white jacket.',garment:'jacket',artworkIds:artworkIds.slice(0,1)})).data;
  assert.match(white.colorPlan,/White\. Use the plain white garment with the fill option OFF/);
  const named=white.placement.filter(z=>z.artwork);assert.equal(named.length,1,'one design means one placement, no filler repeats');assert.equal(named[0].zone,'back');
  assert.ok(white.placement.filter(z=>!z.artwork).every(z=>/^Leave empty/.test(z.reason)));

  const started=await call('/api/owner/ai-factory/runs/start',{config:{name:'Brain Run',artworkIds,garments:['ziphoodie'],quantity:{mode:'total',total:2},workers:{total:4,mode:'auto'},color:{base:'Black'}}});assert.equal(started.status,200,started.text);
  const jobs=(await call('/api/owner/ai-factory/jobs')).data.jobs;assert.equal(jobs.length,2);
  assert.match(jobs[0].brief,/Base garment color: Black/);assert.match(jobs[0].brief,/FILL OPTION REQUIRED: switch on the fill option in Black/);assert.match(jobs[0].brief,/Placement plan \(one design per placement\):\n- back \(Hero\): /);assert.match(jobs[0].brief,/Unisex zip hoodie \(store product\)/);assert.ok(!jobs[0].brief.includes('Reaper jacket mockup'));assert.equal(jobs[0].brief.match(/FILL OPTION REQUIRED/g).length,1);assert.ok(jobs.every(j=>j.brief.length<6000),'brief fits without truncation');
  const backs=jobs.map(j=>/- back \(Hero\): (.*)/.exec(j.brief)[1]),fronts=jobs.map(j=>/- front-left \(Secondary\): (.*)/.exec(j.brief)[1]);assert.notEqual(backs[0],fronts[0],'hero and secondary are different designs');assert.match(jobs[0].brief,/Skulls/);

  assert.equal((await call('/api/owner/ai-factory/intelligence/feedback',{job:jobs[0].id,kind:'never'})).status,200);
  assert.equal((await call('/api/owner/ai-factory/intelligence/feedback',{job:'missing',kind:'good'})).status,404);
  const life=(await call('/api/owner/ai-factory/intelligence/job/'+jobs[0].id)).data;
  assert.equal(life.run.number,1);assert.equal(life.stages[0].name,'Brief');assert.ok(life.log.some(e=>/Owner feedback/.test(e.text)));
  assert.ok((await call('/api/owner/ai-factory/intelligence')).data.memories.some(m=>m.kind==='failure'||m.job===jobs[0].id));
 }finally{await new Promise(r=>service.server.close(r));}
});
