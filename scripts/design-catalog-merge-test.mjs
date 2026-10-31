import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{mergeDesignCatalog,isOriginalArtwork}=require('../design-catalog-merge.js');
const art=(id,extra={})=>({id,name:id,kind:'artwork',image:'assets/designs/'+id+'.png',...extra});
const product=(id,extra={})=>({id,name:'Rose Hoodie',image:'images/'+id+'.jpg',variants:[{id:'v'+id}],...extra});
test('product catalog cannot add garment mockups to the original artwork gallery',()=>{assert.deepEqual(mergeDesignCatalog([],[product('hoodie')]),[]);const result=mergeDesignCatalog([art('original')],[product('hoodie')]);assert.equal(result.length,1);assert.equal(result[0].image,'assets/designs/original.png');assert.equal(result[0].shopUrl,null);});
test('explicit family and source roles group without confusing source back with physical panels',()=>{
 const data=[art('sleeve',{familyId:'rose',familyName:'Rose Eclipse',sourceRole:'sleeve_left'}),art('back',{familyId:'rose',sourceRole:'back'}),art('front',{familyId:'rose',sourceRole:'front'})];
 const [family]=mergeDesignCatalog(data,[product('1',{designFamilyId:'rose',collectionName:'Rose Eclipse'}),product('2',{designFamilyId:'rose',status:'draft'})]);
 assert.equal(family.name,'Rose Eclipse');assert.equal(family.id,'front');assert.equal(family.image,data[2].image);assert.deepEqual(family.members.map(a=>a.sourceRole),['sleeve_left','back','front']);assert.deepEqual(family.productIds,['1']);assert.equal(family.shopUrl,'shop.html?collection=Rose%20Eclipse');
});
test('mockups, templates, cutouts and private images cannot leak through catalog merge or failed catalog refresh',()=>{
 for(const a of [art('mockup',{kind:'reference'}),art('panel',{assetType:'print-panel'}),art('guide',{assetType:'template-guide'}),art('private',{visibility:'private'}),art('draft',{status:'Draft'}),art('review',{status:'Ready for review'}),art('wrong',{image:'images/factory/1.jpg'}),art('remote',{image:'https://files.printful.com/front.jpg'})])assert.equal(isOriginalArtwork(a),false);
 assert.deepEqual(mergeDesignCatalog([art('panel',{assetType:'print-panel'})],[]),[]);
});
test('exact duplicate originals collapse with legacy IDs retained; similar names never imply a family',()=>{
 const result=mergeDesignCatalog([art('one',{sourceSha256:'same'}),art('copy',{sourceSha256:'same'}),art('other',{name:'one',sourceSha256:'different'})]);
 assert.equal(result.length,2);assert.deepEqual(result[0].members[0].aliasIds,['copy']);assert.equal(result[1].familyId,'other');
 const families=mergeDesignCatalog([art('front-a',{familyId:'a',sourceSha256:'same'}),art('front-b',{familyId:'b',sourceSha256:'same'})]);assert.equal(families.length,2,'reuse of a source across distinct explicit families retains both memberships');
});
test('real gallery uses retained original files and keeps all existing IDs including private feedback targets',()=>{
 const data=require('../designs.json'),gallery=mergeDesignCatalog(data,require('../products.json').products);
 assert.equal(data.length,111);assert.equal(gallery.length,89);assert.equal(data.filter(a=>a.assetType==='print-panel').length,9);
 for(const family of gallery){assert(isOriginalArtwork(family));assert(existsSync(family.image));assert(!family.catalogDesign);}
 const retained=JSON.parse(readFileSync('request-service/private-design-assets/retained-sources.json'));
 for(const f of retained.files){assert(existsSync(f.retainedPath));assert(!existsSync(f.originalPath));}
 assert.match(readFileSync('_config.yml','utf8'),/\n  - request-service\n/);
});
