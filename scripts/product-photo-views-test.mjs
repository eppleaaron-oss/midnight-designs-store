import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{productPhotoMatches:matches,productPhotosForVariant:eligible}=require('../product-photos.js');
test('model photos retain front, back, left and right filters independently of model category',()=>{
 for(const [view,filter] of [['Front','front'],['Back','back'],['sleeve_left_dtfabric','left'],['Right side','right']]){const p={view,category:'fit'};assert(matches(p,filter));assert(matches(p,'fit'));assert(!matches(p,'other'));}
});
test('unknown angles are available without inventing a front/back label',()=>{assert(matches({view:'Supplier preview'},'other'));assert(!matches({view:'Supplier preview'},'front'));assert(!matches({view:'back',detail:true},'back'));assert(matches({detail:true},'detail'));});
test('variant IDs match regardless of JSON number/string representation, without borrowing other sizes',()=>{const photos=[{image:'correct',storeVariantIds:[12]},{image:'wrong',storeVariantIds:['13']},{image:'shared'}];assert.deepEqual(eligible(photos,{id:'12'}).map(p=>p.image),['correct','shared']);});
