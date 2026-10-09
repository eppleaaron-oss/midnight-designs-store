import {test} from 'node:test';import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {deflateSync} from 'node:zlib';
import {createService} from './server.mjs';import {imageInfo,classify} from './factory-ideas.mjs';

// Minimal RGBA PNG: an opaque rectangle (x,y,w,h) on a transparent canvas, optionally with holes every few pixels.
function png(W,H,[x,y,w,h],sparse=false){
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c>>>1^(c&1?0xedb88320:0);}return ~c>>>0;};
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
 const raw=Buffer.alloc((W*4+1)*H);for(let r=0;r<H;r++){raw[r*(W*4+1)]=r%2?2:0;}
 // Write unfiltered pixels, then apply the Up filter on odd rows so the decoder's unfiltering is exercised.
 const px=Buffer.alloc(W*4*H);for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)if(!sparse||(r%12===0||c%12===0)){const o=(r*W+c)*4;px[o]=200;px[o+3]=255;}
 for(let r=0;r<H;r++)for(let i=0;i<W*4;i++){const v=px[r*W*4+i],up=r?px[(r-1)*W*4+i]:0;raw[r*(W*4+1)+1+i]=r%2?(v-up)&255:v;}
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const strip=png(120,120,[50,0,20,120]),full=png(100,120,[5,5,90,110]),emblem=png(100,100,[20,20,60,60],true);

test('design shapes come from the visible pixels, not the canvas',()=>{
 const s=imageInfo(strip);assert.equal(s.width,120);assert.deepEqual([s.box.w,s.box.h],[20,120]);
 assert.equal(classify(s).shape,'strip');assert.equal(classify(imageInfo(full)).shape,'full');assert.equal(classify(imageInfo(emblem)).shape,'emblem');
 assert.equal(classify(imageInfo(full),'Midnight Crest Logo').shape,'emblem');
 assert.equal(classify(null).shape,'full');
});

test('the idea team drafts outfits and items, and approved ideas become factory jobs',async()=>{
 const origin='http://localhost:3000',storefrontOrigin='https://midnight-designs.store',salt='ab'.repeat(16),password='ideas-test-password-1';
 const files={'a/hero1.png':full,'a/hero2.png':full,'a/strip1.png':strip,'a/strip2.png':strip,'a/mark.png':emblem};
 const designs=[['h1','Blood Moon','a/hero1.png'],['h2','Raven Gate','a/hero2.png'],['s1','Thorn Vine','a/strip1.png'],['s2','Chain Line','a/strip2.png'],['m1','Crescent Sigil','a/mark.png']].map(([id,name,image])=>({id,name,category:'Gothic',image,kind:'artwork'}));
 const service=createService({dbPath:':memory:',origin,storefrontOrigin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),
  runSettings:{fetchImpl:async url=>url.endsWith('/designs.json')?new Response(JSON.stringify(designs)):new Response(files[url.slice(storefrontOrigin.length+1)],{headers:{'Content-Type':'image/png'}})}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,b,source=origin){const r=await fetch(root+path,{method:b?'POST':'GET',headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  assert.equal((await call('/api/owner/ai-factory/ideas')).status,401);
  cookie=(await call('/api/owner/login',{password})).cookie;
  assert.equal((await call('/api/owner/ai-factory/runs/import',{ids:designs.map(d=>d.id)})).data.imported.length,5);
  let snap=(await call('/api/owner/ai-factory/ideas')).data;
  const shape=Object.fromEntries(snap.designs.map(d=>[d.name,d.shape]));
  assert.deepEqual(shape,{'Blood Moon':'full','Raven Gate':'full','Thorn Vine':'strip','Chain Line':'strip','Crescent Sigil':'emblem'});

  assert.equal((await call('/api/owner/ai-factory/ideas/settings',{team:12,pool:30,autoMake:false})).status,200);
  snap=(await call('/api/owner/ai-factory/ideas/generate',{})).data;
  assert.ok(snap.counts.new>=8,'the team drafts a batch of ideas');assert.ok(snap.counts.new<=12,'one idea per worker per cycle');
  const ideas=snap.ideas,outfit=ideas.find(i=>i.kind==='outfit');assert.ok(outfit,'full outfits are drafted');assert.ok(ideas.some(i=>i.kind==='product'));
  assert.ok(outfit.pieces.length>=3);assert.ok(outfit.pieces.some(p=>p.garment==='hat'));assert.ok(outfit.pieces.some(p=>['pants','joggers','shorts'].includes(p.garment)));
  const byId=Object.fromEntries(snap.designs.map(d=>[d.id,d.shape]));
  for(const i of ideas)for(const p of i.pieces)for(const x of p.placements){
   if(/sleeve|leg|side/.test(x.zone)&&x.role==='strip')assert.equal(byId[x.artwork],'strip',`${x.zone} must hold a strip`);
   if(x.role==='hero')assert.equal(byId[x.artwork],'full','heroes are full designs');
   assert.notEqual(byId[x.artwork]==='strip'&&/^(back|front|front-left|hood|tongue)$/.test(x.zone),true,'strips never go on fronts or backs');
   assert.equal(new Set(p.placements.map(y=>y.zone)).size,p.placements.length,'one design per placement');
  }
  assert.equal((await call('/api/owner/ai-factory/ideas/approve',{ids:[outfit.id]},'https://evil.example')).status,403);
  snap=(await call('/api/owner/ai-factory/ideas/approve',{ids:[outfit.id]})).data;
  const made=snap.ideas.find(i=>i.id===outfit.id);assert.equal(made.status,'made',made.error||'');assert.equal(made.jobs,outfit.pieces.length);
  const jobs=(await call('/api/owner/ai-factory/jobs')).data.jobs;assert.equal(jobs.length,outfit.pieces.length);
  const hatJob=jobs.find(j=>j.employee==='headwear');assert.ok(hatJob);assert.match(hatJob.brief,/FILL OPTION REQUIRED|fill option OFF/);assert.match(hatJob.brief,/Placement plan \(one design per placement\)/);assert.match(hatJob.brief,/Part of a full outfit/);assert.match(hatJob.brief,/Industry placement playbook/);

  const other=snap.ideas.find(i=>i.status==='new');snap=(await call('/api/owner/ai-factory/ideas/dismiss',{ids:[other.id]})).data;assert.ok(!snap.ideas.some(i=>i.id===other.id));
  const sigil=snap.designs.find(d=>d.name==='Crescent Sigil');snap=(await call('/api/owner/ai-factory/ideas/shape',{artwork:sigil.id,shape:'full'})).data;
  assert.equal(snap.designs.find(d=>d.id===sigil.id).shape,'full');assert.equal(snap.designs.find(d=>d.id===sigil.id).override,true);
  assert.equal((await call('/api/owner/ai-factory/ideas/shape',{artwork:sigil.id,shape:'banana'})).status,400);
  snap=(await call('/api/owner/ai-factory/ideas/settings',{team:5,pool:30,autoMake:true})).data;assert.equal(snap.counts.new||0,0,'trusting the team approves what is waiting');
 }finally{await new Promise(r=>service.server.close(r));}
});
