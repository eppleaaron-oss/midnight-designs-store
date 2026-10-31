import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{productPhotoMatches:matches,productPhotoCoverage:coverage,productPhotosForVariant:eligible}=require('../product-photos.js');
test('coverage never invents a front view for a back-only gallery',()=>{
 assert.deepEqual(coverage([{view:'Back'}]),['back']);
 assert.deepEqual(coverage([{view:'Front'},{view:'Right side'}]),['front','right']);
});
test('panel details do not masquerade as whole product sides',()=>{
 for(const view of ['sleeve_left_dtfabric','Right sleeve','Front pocket','Back hood close-up']){
  assert(matches({view},'other'));
  assert.deepEqual(coverage([{view}]),[]);
 }
 assert(matches({view:'Left side'},'left'));
 assert(matches({view:'Front',category:'fit'},'front'));
 assert.deepEqual(coverage([{view:'Supplier preview'}]),[]);
});

test('variant IDs retain color/size isolation across JSON types',()=>{const photos=[{image:'correct',storeVariantIds:[12]},{image:'wrong',storeVariantIds:['13']},{image:'shared'}];assert.deepEqual(eligible(photos,{id:'12'}).map(p=>p.image),['correct','shared']);});
test('artwork enlargement is not another camera angle',()=>{assert(!matches({view:'Back',detail:true},'back'));assert(matches({detail:true},'detail'));});
test('left and right sleeve controls remain independent from whole garment sides',()=>{assert(matches({view:'sleeve_left_dtfabric'},'sleeve_left'));assert(matches({view:'Left Sleeve'},'sleeve_left'));assert(!matches({view:'Right sleeve'},'sleeve_left'));assert(matches({view:'sleeve_right'},'sleeve_right'));assert(!matches({view:'Right back'},'sleeve_right'));assert(!matches({view:'sleeve_right',detail:true},'sleeve_right'));});
