import {test} from 'node:test';import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {deflateSync} from 'node:zlib';
import {createService} from './server.mjs';import {imageInfo,classify,PLANS} from './factory-ideas.mjs';import {storeAudit} from './factory-audit.mjs';

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

test('outfits reuse one design set from the store jackets, mapped onto real all-over-print areas',async()=>{
 const origin='http://localhost:3000',storefrontOrigin='https://midnight-designs.store',salt='ab'.repeat(16),password='ideas-test-password-1';
 const files={'a/back.png':full,'a/front.png':full,'a/sleeve.png':strip,'a/mark.png':emblem};
 const designs=[['r1','Raven Back','a/back.png'],['r2','Raven Front','a/front.png'],['r3','Raven Vine','a/sleeve.png'],['r4','Raven Sigil','a/mark.png'],['x1','Loose Sleeve Panel','a/sleeve.png']].map(([id,name,image],k)=>({id,name,category:k<4?'Raven Set':'Sleeve panels',image,kind:'artwork'}));
 const cdn=n=>`https://files.cdn.printful.com/files/${n}.png`;
 const file=(type,n)=>({type,url:cdn(n),preview_url:cdn(n+'-p'),thumbnail_url:cdn(n+'-t'),filename:n+'.png'});
 const products={1:{sync_product:{id:1,name:'Blood Moon Reaper Bomber Jacket'},sync_variants:[{product:{product_id:390},files:[file('front','jf'),file('back','jb'),file('sleeve_left','jsl'),file('sleeve_right','jsr'),file('preview','jprev')]}]},
  2:{sync_product:{id:2,name:'Crimson Throne Recycled Fleece Hoodie'},sync_variants:[{product:{product_id:388},files:[file('front','hf'),file('back','hb'),file('hood','hh')]}]},
  3:{sync_product:{id:3,name:'Mockup only'},sync_variants:[{product:{product_id:328},files:[file('preview','only')]}]}};
 const pfCalls=[],created=[],deleted=[];
 const service=createService({dbPath:':memory:',origin,storefrontOrigin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),
  runSettings:{fetchImpl:async url=>url.endsWith('/designs.json')?new Response(JSON.stringify(designs)):new Response(files[url.slice(storefrontOrigin.length+1)],{headers:{'Content-Type':'image/png'}})},
  ideaSettings:{pace:0,env:{PRINTFUL_TOKEN:'pf-test',PRINTFUL_STORE_ID:'77'},fetchImpl:async(url,o)=>{if(url.includes('api.printful.com'))pfCalls.push([url,o.headers?.Authorization,o.headers?.['X-PF-Store-Id']]);
  if(url.endsWith('/products.json'))return new Response(JSON.stringify({products:[{id:'55',catalogProductId:328,name:'Other Tee',variants:[{size:'M',price:44.5}]}]}));
  if(/store\/products\/@/.test(url))return new Response('{}',{status:404});
  const cat=/api\.printful\.com\/products\/(\d+)$/.exec(url);if(cat)return new Response(JSON.stringify({result:{variants:['S','M','L'].map((size,k)=>({id:Number(cat[1])*10+k,size,color:'White',price:'20.00',in_stock:true}))}}));
  if(o.method==='POST'&&url.endsWith('/store/products')){created.push(JSON.parse(o.body));return new Response(JSON.stringify({result:{id:9000+created.length}}));}
  if(o.method==='DELETE'){deleted.push(url);return new Response('{}');}
  const m=/store\/products\/(\d+)$/.exec(url);return new Response(JSON.stringify({result:m?products[m[1]]:Object.values(products).map(p=>({id:p.sync_product.id,name:p.sync_product.name}))}));}}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,b,source=origin){const r=await fetch(root+path,{method:b?'POST':'GET',headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  assert.equal((await call('/api/owner/ai-factory/ideas')).status,401);
  cookie=(await call('/api/owner/login',{password})).cookie;
  assert.equal((await call('/api/owner/ai-factory/runs/import',{ids:designs.map(d=>d.id)})).data.imported.length,5);
  assert.equal((await call('/api/owner/ai-factory/ideas/settings',{team:12,pool:30,autoMake:false})).status,200);
  let snap=(await call('/api/owner/ai-factory/ideas/printful',{})).data;
  assert.equal(snap.printful.state,'connected');assert.ok(pfCalls.every(([,a,s])=>a==='Bearer pf-test'&&s==='77'));
  assert.deepEqual(snap.sets.map(s=>[s.name,s.jacket,s.source]),[['Blood Moon Reaper',true,'printful'],['Crimson Throne',false,'printful'],['Raven Set',false,'upload']]);
  assert.deepEqual(Object.keys(snap.sets[0].parts).sort(),['back','front','sleeve_left','sleeve_right']);
  assert.deepEqual(Object.keys(snap.sets[2].parts).sort(),['back','front','pocket','sleeve_left','sleeve_right'],'an uploaded collection splits into parts by shape');
  assert.ok(!snap.sets.some(s=>s.name==='Sleeve panels'),'library categories are not sets');

  const sets=new Map(snap.sets.map(s=>[s.id,s]));assert.ok(snap.counts.new>=10);
  for(const i of snap.ideas)for(const p of i.pieces)for(const x of p.placements)assert.ok(sets.get(i.set).parts[x.part],'every part comes from the idea\'s own set');
  const outfit=snap.ideas.find(i=>i.kind==='outfit'&&sets.get(i.set).jacket);assert.ok(outfit,'jacket sets get full outfits');
  assert.equal(outfit.pieces[0].catalog,390,'the outfit starts from the jacket the set came from');
  const jacketOutfits=snap.ideas.filter(i=>i.kind==='outfit'&&sets.get(i.set).jacket);
  assert.ok(jacketOutfits.some(o=>o.pieces.some(p=>p.group==='bottom'&&p.placements.some(x=>/leg/.test(x.area)&&/sleeve/.test(x.part)))),'sleeve art runs down the legs');
  assert.equal(outfit.pieces.filter(p=>p.ready).length,14,'one jacket set goes onto as many publishable items as the owner allows');assert.match(outfit.title,/\(14 items\)$/);
  assert.equal(new Set(outfit.pieces.map(p=>p.catalog)).size,outfit.pieces.length,'no item twice');assert.equal(outfit.pieces[0].why,'Already in your store: this set came from this item.');
  assert.ok(outfit.pieces.find(p=>p.catalog===390).tag,'pieces with a tag print area carry the logo on the tag');
  snap=(await call('/api/owner/ai-factory/ideas/piece',{id:outfit.id,catalog:outfit.pieces[1].catalog})).data;
  const trimmed=snap.ideas.find(i=>i.id===outfit.id);assert.equal(trimmed.pieces.length,outfit.pieces.length-1);assert.match(trimmed.title,/\(13 items\)$/);
  outfit.pieces=trimmed.pieces;
  assert.ok(outfit.pieces.some(p=>p.group==='face'));
  assert.ok(snap.ideas.some(i=>i.kind==='product'&&i.pieces[0].catalog!==390));

  snap=(await call('/api/owner/ai-factory/ideas/approve',{ids:[outfit.id]})).data;
  const made=snap.ideas.find(i=>i.id===outfit.id);assert.equal(made.status,'made',made.error||'');assert.equal(made.jobs,outfit.pieces.length);
  const jobs=(await call('/api/owner/ai-factory/jobs')).data.jobs;assert.equal(jobs.length,outfit.pieces.length);
  for(const j of jobs){assert.match(j.brief,/Design set: Blood Moon Reaper, taken from the store product "Blood Moon Reaper Bomber Jacket"/);assert.ok(j.brief.includes(cdn('jb'))||j.brief.includes(cdn('jf'))||j.brief.includes(cdn('jsl')));assert.ok(!/files\/h[fbh]\.png/.test(j.brief),'no other set is mixed in');assert.match(j.brief,/Base garment color: White/);}
  assert.ok(jobs.every(j=>/Midnight Design logo/.test(j.brief)),'every job puts the logo on the tag');
  assert.ok(jobs.every(j=>!/no part of this set fits here/.test(j.brief)),'Printful outfits only hold items whose every print area is filled');

  // Publishing straight to the store: only pieces that are complete go to Printful, with the logo on the tag.
  const fresh=(await call('/api/owner/ai-factory/ideas')).data,pub=fresh.ideas.find(i=>i.kind==='outfit'&&i.status==='new'&&sets.get(i.set).source==='printful'&&i.pieces.some(p=>p.ready));assert.ok(pub,'a printful outfit has ready pieces');
  assert.ok(pub.pieces.every(p=>p.ready||p.why),'every skipped piece says why');
  snap=(await call('/api/owner/ai-factory/ideas/publish',{ids:[pub.id],wait:true})).data;snap=(await call('/api/owner/ai-factory/ideas')).data;const ready=pub.pieces.filter(p=>p.ready);
  assert.equal(created.length,ready.length);assert.equal(snap.made.filter(m=>m.status==='published').length,ready.length);
  for(const c of created){assert.ok(c.sync_product.name.length>3);assert.equal(c.sync_variants.length,3);const types=c.sync_variants[0].files.map(f=>f.type);assert.equal(new Set(types).size,types.length,'one file per print area');
   assert.ok(c.sync_variants[0].files.every(f=>/^https:\/\//.test(f.url)));}
  assert.ok(created.some(c=>c.sync_variants[0].files.some(f=>/^label/.test(f.type)&&/art-7d5ff833db11\.png$/.test(f.url))),'the logo goes on the tag');
  assert.ok(created.every(c=>!c.sync_variants[0].files.some(f=>f.type==='pocket')),'no pocket from a different item');
  const item=snap.made[0];snap=(await call('/api/owner/ai-factory/ideas/rate',{id:item.id,rating:5,note:'Clean'})).data;assert.equal(snap.made.find(m=>m.id===item.id).rating,5);assert.equal(snap.ratings.count,1);
  assert.equal((await call('/api/owner/ai-factory/ideas/delete',{id:item.id})).status,400);
  snap=(await call('/api/owner/ai-factory/ideas/delete',{id:item.id,confirm:true})).data;assert.ok(!snap.made.some(m=>m.id===item.id));assert.equal(deleted.length,1);

  const raven=snap.sets.find(s=>s.source==='upload');snap=(await call('/api/owner/ai-factory/ideas/set',{id:raven.id,enabled:false})).data;
  assert.ok(!snap.sets.some(s=>s.id===raven.id));assert.ok(!snap.ideas.some(i=>i.set===raven.id&&i.status==='new'));
  assert.equal((await call('/api/owner/ai-factory/ideas/shape',{artwork:'nope',shape:'full'})).status,404);
  snap=(await call('/api/owner/ai-factory/ideas/settings',{team:5,pool:30,autoMake:true})).data;assert.equal(snap.counts.new||0,0,'trusting the team approves what is waiting');
 }finally{await new Promise(r=>service.server.close(r));}
});

test('store check lists what needs fixing on live products',()=>{
 const v=(size,price,availability='active')=>({size,price,availability});
 const products=[{id:'1',catalogProductId:388,name:'Crimson Throne Recycled Fleece Hoodie',category:'Hoodies',images:Array(15).fill('a.jpg'),variants:['S','M','L'].map(s=>v(s,55))},
  {id:'2',catalogProductId:388,name:'Unisex Hoodie',category:'Hoodies',images:['p.png'],variants:[v('M',60)]},
  {id:'3',catalogProductId:328,name:'Terror Tapes Athletic T-Shirt',category:'Tees',images:Array(7).fill('a.jpg'),variants:[v('S',30),v('M',30,'discontinued')]}];
 const copy={1:{description:'x'.repeat(120)},3:{description:'x'.repeat(120)}};
 const printful=[{id:'1',name:'Unisex Hoodie',catalog:388,ignored:false,files:['front','back','sleeve_left','sleeve_right','hood','pocket','label_inside']},
  {id:'2',name:'Unisex Hoodie',catalog:388,ignored:false,files:['front']},{id:'9',name:'Test product',catalog:328,ignored:false,files:['front']}];
 const issues=storeAudit({products,copy,printful,plans:PLANS}),of=id=>issues.filter(i=>i.product===id).map(i=>i.title);
 assert.deepEqual(of('1').filter(t=>t!=='Price differs from the same item'),[],'a finished product passes');
 for(const t of ['No design name','Only one photo','No product description','Missing sizes','Print areas left blank','No logo on the tag','Price differs from the same item'])assert.ok(of('2').includes(t),t);
 assert.ok(of('3').includes('Sizes out of stock'));assert.ok(of('3').includes('Not found in Printful'));assert.ok(of('9').includes('In Printful but not on the store'));
 assert.equal(issues[0].severity,'high','urgent problems first');
});
