import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{mergeDesignCatalog}=require('../design-catalog-merge.js');
const product=(id,extra={})=>({id,name:'Rose Hoodie',image:'images/'+id+'.jpg',variants:[{id:'v'+id}],...extra});
test('every public product is represented, collections group without changing artwork IDs',()=>{
 const art={id:'art-original',image:'original.png',kind:'artwork'};
 const result=mergeDesignCatalog([art],[product('1',{collectionName:'Rose'}),product('2',{collectionName:'Rose'}),product('3')]);
 assert.equal(result.length,3);assert.equal(result[2],art);assert.deepEqual(result[0].productIds,['1','2']);assert.equal(result[0].kind,'reference');assert.equal(result[0].shopUrl,'shop.html?collection=Rose');assert.equal(result[1].shopUrl,'products/3.html');
});
test('unapproved, incomplete and rejected records cannot leak into Designs',()=>{
 assert.deepEqual(mergeDesignCatalog([],['draft','rejected','failed','pending'].map(status=>product(status,{status})).concat([product('x',{approved:false}),product('y',{published:false}),product('z',{variants:[]})])),[]);
});
test('original hoodie preview wins and newer published photos replace stale photos on next load',()=>{
 const data=[product('shoe',{collectionName:'Rose'}),product('hoodie',{collectionName:'Rose',sourceProductId:'hoodie',image:'new.jpg'})];
 const result=mergeDesignCatalog([],data);assert.equal(result[0].image,'new.jpg');assert.equal(result[0].catalogDesign,true);
});
test('real catalog coverage',()=>{
 const products=require('../products.json').products,artworks=require('../designs.json'),merged=mergeDesignCatalog(artworks,products);
 const ids=new Set(merged.flatMap(d=>d.productIds||[]));assert.equal(ids.size,products.length);for(const a of artworks)assert(merged.includes(a));console.log(JSON.stringify({artworks:artworks.length,productDesignCards:merged.length-artworks.length,coveredProducts:ids.size}));
});
