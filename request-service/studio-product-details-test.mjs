import {test} from 'node:test';
import assert from 'node:assert/strict';
import {studioProductDetails,orderedStudioPhotos,applyStudioDetails} from './studio-product-details.mjs';
const fixture=()=>({name:'Night Garden',description:'Original gothic artwork.',collections:['Night Garden'],categoryId:'long-sleeves',variants:{11:{price:45.99,enabled:true},12:{price:46.99,enabled:false}},photoOrder:['back','front'],hiddenPhotos:['side']});
test('details keep exact IDs and validate prices, categories, copy and photo choices',()=>{
 assert.deepEqual(studioProductDetails(fixture(),['11','12']),fixture());
 for(const change of [d=>d.name='',d=>d.categoryId='invented',d=>d.variants[11].price=0,d=>d.variants[11].price=3.14159,d=>delete d.variants[12],d=>d.variants[99]={price:20,enabled:true},d=>d.hiddenPhotos=['https://foreign.test/photo.jpg']]){const d=fixture();change(d);assert.throws(()=>studioProductDetails(d,['11','12']));}
});
test('photo selection keeps order, hides chosen views and preserves the stored original gallery',()=>{
 const images=['front','side','back'].map(sha=>({sha})),before=structuredClone(images);
 assert.deepEqual(orderedStudioPhotos(images,fixture()).map(i=>i.sha),['back','front']);assert.deepEqual(images,before);
});
test('approved details preserve identities and cannot claim an unconfirmed supplier price or stock',()=>{
 const p={id:'1',outfitId:'original-set',studioRevision:'revision-one',variants:[{id:'11',catalogVariantId:21,price:49.99,availability:'active'},{id:'12',catalogVariantId:22,price:49.99,availability:'active'}]},supplier={sync_variants:[{id:11,retail_price:'45.99',availability_status:'out_of_stock'},{id:12,retail_price:'46.99',availability_status:'active'}]};
 const result=applyStudioDetails(p,fixture(),supplier);assert.equal(result.outfitId,p.outfitId);assert.equal(result.detailsRevision,p.studioRevision);assert.deepEqual(result.variants.map(v=>v.id),['11','12']);assert.deepEqual(result.variants.map(v=>v.availability),['out_of_stock','unavailable']);supplier.sync_variants[0].retail_price='1.00';assert.throws(()=>applyStudioDetails(p,fixture(),supplier),/confirmed/);
});
