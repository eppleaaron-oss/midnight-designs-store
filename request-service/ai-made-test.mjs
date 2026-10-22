import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function media(fetch=()=>{}){const context={window:{},location:{origin:'https://backend.test'},URL,AbortSignal,fetch};vm.runInNewContext(readFileSync(new URL('./public/ai-made-data.js',import.meta.url),'utf8'),context);return context.window.MidnightMadeMedia;}
test('AI Made matches permanent photos to the exact supplier ID and keeps all views',()=>{
 const m=media(),index={products:{123:{photos:[{image:'assets/front.jpg',view:'Front'},{image:'assets/back.jpg',view:'Back'}],originalImage:'https://cdn.test/original.png'},456:{photos:[{image:'assets/wrong.jpg'}]}}};
 const images=m.images({supplierId:123},index);assert.equal(images.length,3);assert.equal(images[0].url,'https://midnight-designs.store/assets/front.jpg');assert.equal(images[1].label,'Back');assert.equal(m.images({supplierId:999},index).length,0);
 assert.equal(m.state({supplierId:'123',state:'waiting_input'},new Set(['123'])),'published');assert.equal(m.state({supplierId:'456',state:'supplier_created'},new Set(['123'])),'supplier_created');
});
test('saved factory mockups remain available when store photos fail; loading cannot claim publication',async()=>{
 const m=media(async()=>{throw Error('offline');}),loaded=await m.load();assert.equal(loaded.unavailable,true);assert.equal(loaded.publishedIds.size,0);
 const images=m.images({made:{mockupStatus:{images:[{url:'/saved.jpg'}]},thumb:'/saved.jpg'}},loaded.photos);assert.equal(images.length,1);assert.equal(images[0].url,'/saved.jpg');
});
test('photo loading accepts the published catalog and never infers publication from photos alone',async()=>{
 const m=media(async url=>({ok:true,json:async()=>url.endsWith('products.json')?{products:[{id:123}]}:{products:{456:{photos:[]}}}})),loaded=await m.load();assert.equal(loaded.publishedIds.has('123'),true);assert.equal(loaded.publishedIds.has('456'),false);
});
