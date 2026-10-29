import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function media(fetch=()=>{}){const context={window:{},location:{origin:'https://backend.test'},URL,AbortSignal,fetch};vm.runInNewContext(readFileSync(new URL('./public/ai-made-data.js',import.meta.url),'utf8'),context);return context.window.MidnightMadeMedia;}
test('gallery wording distinguishes new verified mockups from an earlier product revision',()=>{
 const m=media(),row={supplierId:'123',update:{job:{id:'current',state:'verifying_store',revision:2},draftRevision:2}},index={products:{123:{studioRevision:'current'}}};
 assert.match(m.photoNote(row,index),/completed Printful mockups/);assert.match(m.updateStatus(row.update),/verifying store/);index.products['123'].studioRevision='older';assert.match(m.photoNote(row,index),/do not confirm this draft/);
});
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
 const m=media(async url=>{assert.equal(url,'/api/owner/ai-factory/product-editor/media');return {ok:true,json:async()=>({publishedIds:['123'],photos:{products:{456:{photos:[]}}}})};}),loaded=await m.load();assert.equal(loaded.publishedIds.has('123'),true);assert.equal(loaded.publishedIds.has('456'),false);
});

test('an edited gallery never appends previews or mockups from an earlier supplier design',()=>{
 const m=media(),row={supplierId:'123',made:{thumb:'https://cdn.test/old.jpg',mockupStatus:{images:[{url:'https://cdn.test/old-back.jpg'}]}}},index={products:{123:{studioRevision:'latest',originalImage:'https://cdn.test/old-original.jpg',photos:[{image:'images/factory/123/new-front.jpg',view:'Front'},{image:'images/factory/123/new-back.jpg',view:'Back'}]}}};
 const photos=m.images(row,index);assert.equal(photos.length,2);assert.ok(photos.every(p=>p.url.includes('/images/factory/123/new-')));
});

test('AI Made distinguishes unfinished edits and private mockups from live storefront updates',async()=>{
 const vm=await import('node:vm'),{readFile}=await import('node:fs/promises'),context={window:{},URL,location:{origin:'https://app.test'}};vm.runInNewContext(await readFile(new URL('./public/ai-made-data.js',import.meta.url),'utf8'),context);const status=context.window.MidnightMadeMedia.updateStatus;
 assert.match(status({draftRevision:2,job:{revision:1,state:'completed',storeUpdated:true}}),/not applied/);
 assert.match(status({draftRevision:2,job:{revision:2,state:'failed',error:'Storage full'}}),/Storage full/);
 assert.match(status({draftRevision:2,job:{revision:2,state:'publishing'}}),/in progress/);
 assert.match(status({draftRevision:2,job:{revision:2,state:'completed',storeUpdated:false}}),/awaiting your approval/);
 assert.equal(status({draftRevision:2,job:{revision:2,state:'completed',storeUpdated:true}}),'');
});

test('known mockup view names open their exact print placement without guessing generic views',()=>{const m=media();assert.equal(m.placement('Back'),'back');assert.equal(m.placement('front_dtfabric · Flat'),'front');assert.equal(m.placement('left sleeve'),'left_sleeve');assert.equal(m.placement('right_sleeve'),'right_sleeve');assert.equal(m.placement('Lifestyle'),null);assert.equal(m.placement('Backpack'),null);assert.equal(m.placement(undefined),null);});
test('publication badges follow the refreshed catalog and cannot retain an old published state',()=>{const m=media();assert.equal(m.state({supplierId:'123',state:'supplier_created'},new Set(['123']),true),'published');assert.equal(m.state({supplierId:'123',state:'published'},new Set(),true),'supplier_created');assert.equal(m.state({supplierId:'123',state:'published'},new Set(['123']),false),'publication_unverified');});
test('a publication refresh requests fresh media and carries explicit verification',async()=>{const m=media(async url=>{assert.equal(url,'/api/owner/ai-factory/product-editor/media?refresh=1');return {ok:true,json:async()=>({photos:{products:{}},publishedIds:['123'],publicationVerified:true})};}),loaded=await m.load(true);assert.equal(loaded.publicationVerified,true);assert.equal(loaded.publishedIds.has('123'),true);});
