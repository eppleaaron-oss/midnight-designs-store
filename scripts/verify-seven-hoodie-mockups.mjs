import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const baseline=p=>JSON.parse(execFileSync('git',['show','5d8f51015d5cf074e4a263f3c3d2fb345c8bdbc0:'+p],{encoding:'utf8',maxBuffer:40000000}));
const current=await read('products.json'),before=baseline('products.json'),gallery=await read('product-photos.json'),oldGallery=baseline('product-photos.json'),progress=await read('seven-hoodie-mockup-progress.json');
const ids=JSON.parse(await fs.readFile('owner-hoodie-import.json','utf8')).productIds;
assert.equal(ids.length,7);assert.equal(current.products.length,before.products.length);
for(const p of current.products){
 const old=before.products.find(x=>x.id===p.id);assert.ok(old);
 if(!ids.includes(p.id)){assert.deepEqual(p,old);continue;}
 const {images,...rest}=p,{images:oldImages,...oldRest}=old;assert.deepEqual(rest,oldRest);
 const state=progress.products[p.id],entry=gallery.products[p.id];assert.equal(state.status,'complete');assert.equal(entry.studioRevision,p.studioRevision);assert.equal(entry.originalImage,p.image);
 assert.ok(entry.photos.some(x=>x.view==='front'));assert.ok(entry.photos.some(x=>x.view==='back'));
 assert.equal(entry.photos.length,state.photoCount);
 for(const style of state.groups)assert.ok(entry.photos.some(x=>x.style===style),'Missing returned style '+style);
 for(const photo of entry.photos){
 assert.ok(photo.image.startsWith('assets/product-photos/seven-new-hoodies/'+p.id+'-'));
 assert.deepEqual([...photo.storeVariantIds].sort(),p.variants.map(v=>String(v.id)).sort());
 const bytes=await fs.readFile(photo.image);assert.equal(createHash('sha256').update(bytes).digest('hex'),photo.sha256);
 assert.ok(images.includes(photo.image));
 }
 console.log(JSON.stringify({id:p.id,name:p.name,photos:entry.photos.length,styles:state.styles,views:state.views,variants:p.variants.length}));
}
for(const [id,entry] of Object.entries(oldGallery.products))if(!ids.includes(id))assert.deepEqual(gallery.products[id],entry);
console.log('PASS: seven complete galleries, every variant linked, permanent image checksums match; all other products and all prices/options/revisions unchanged.');
