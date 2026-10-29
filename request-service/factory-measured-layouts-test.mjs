import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {measurementLibrary,measuredAreaStamp,reviewedLayerRegion} from './factory-measured-layouts.mjs';
import {variantAreas} from './factory-blueprints.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const lib=measurementLibrary(db),bp={source:'live',effectiveTechnique:'cut-sew',printfiles:{printfiles:[{printfile_id:1,width:1800,height:2400,dpi:150}],variant_printfiles:[21,22].map(variant_id=>({variant_id,placements:{front:1,back:1}}))},layouts:{templates:[],variant_mapping:[]}},panel={background:'#000000',layers:[{asset:'art:raven',x:.5,y:.4,width:.25,rotation:0,mirror:false,allowModify:false}]},document={supplier:{sync_variants:[{id:11,variant_id:21,size:'M'},{id:12,variant_id:22,size:'L'}]},variants:{11:{front:panel,back:{background:'#000000',layers:[]}},12:{front:panel,back:{background:'#000000',layers:[]}}}},p={product:{id:390},variants:[{id:21,size:'M'},{id:22,size:'L'}],audience:'unisex',role:'hoodies'};
 let now=1;const record=(extra={})=>lib.record({source:'piece:one',supplier:'123',revision:1,product:{id:390,type:'Hoodie'},blueprint:bp,document,decision:'approved',name:'Owner raven',parts:{front:'art:raven'},readArtwork:async()=>({width:1200,height:1800,name:'Raven',bounds:{x:0,y:0,width:1200,height:1800}}),clock:()=>now++,...extra});return {db,lib,bp,document,p,record};
}
test('approved measurements retain full native panels, numeric layers, size variants and original artwork assignment',async t=>{
 const f=fixture(t),r=await f.record(),layer=r.example.variants[0].panels.front.layers[0];assert.equal(layer.widthIn,3);assert.equal(layer.heightIn,4.5);assert.equal(layer.xIn,6);assert.equal(layer.yIn,6.4);assert.equal(layer.effectiveDpi,400);assert.equal(layer.part,'front');assert.equal(r.example.variants[0].panels.front.width,1800);assert.equal(r.example.variants.length,2);
 const [l]=f.lib.layouts(f.p,f.bp);assert.equal(l.compatible,true);assert.equal(l.slots[0].placement,'front');assert.equal(l.slots[0].measurements[22].xIn,6);assert.equal(l.pattern,false);assert.equal(l.number,1000+r.id);assert.equal(f.lib.snapshot().counts.approved,1);
 assert.equal((await f.record()).id,r.id,'retry keeps one record');assert.equal(f.lib.list().length,1);
});
test('changed template metadata, selected size and printing method prevent automatic reuse',async t=>{
 const f=fixture(t);await f.record();const altered=structuredClone(f.bp);altered.printfiles.printfiles[0].height=2500;assert.equal(f.lib.layouts(f.p,altered)[0].compatible,false);assert.match(f.lib.layouts(f.p,altered)[0].reasons.join(' '),/template changed/);
 assert.equal(f.lib.layouts({...f.p,variants:[{id:23,size:'XL'}]},f.bp)[0].compatible,false);assert.equal(f.lib.layouts(f.p,{...f.bp,effectiveTechnique:'embroidery'})[0].compatible,false);assert.deepEqual(f.lib.layouts({...f.p,product:{id:391}},f.bp),[]);assert.deepEqual(f.lib.layouts({...f.p,audience:'children'},f.bp),[]);
 const a=variantAreas(f.bp,21)[0];assert.notEqual(measuredAreaStamp(a),measuredAreaStamp({...a,template:{template_id:1,print_area_left:1}}));
});
test('rejected and corrected revisions remain in history and stop their previous approved rule',async t=>{
 const f=fixture(t),approved=await f.record();await f.record({decision:'rejected',note:'Scene overlaps pocket.'});assert.deepEqual(f.lib.layouts(f.p,f.bp),[]);await f.record({revision:2,decision:'correction',note:'Move hero above pocket.'});assert.deepEqual(f.lib.layouts(f.p,f.bp),[]);const corrected=await f.record({revision:2,decision:'approved'});assert.ok(corrected.parent);assert.equal(f.lib.layouts(f.p,f.bp)[0].exampleId,corrected.id);assert.equal(f.lib.list().length,4);assert.equal(f.lib.snapshot().counts.rejected,1);assert.equal(approved.state,'approved');
});
test('unsupported transforms and backgrounds are recorded truthfully but cannot become an automatic Basic recipe',async t=>{
 const f=fixture(t);f.document.variants[11].front.layers[0].rotation=10;f.document.variants[11].front.background='#ff0000';const r=await f.record();assert.equal(r.example.variants[0].panels.front.layers[0].rotation,10);assert.equal(f.lib.layouts(f.p,f.bp)[0].compatible,false);assert.match(r.example.issues.join(' '),/transformed/);assert.match(r.example.issues.join(' '),/black/);
});
test('a safe region is never inferred from canvas dimensions or another template',t=>{
 const f=fixture(t),a=variantAreas(f.bp,21)[0],rect={x:200,y:300,width:400,height:500};assert.equal(reviewedLayerRegion(f.db,390,'cut-sew',a,rect),null);f.db.exec('CREATE TABLE factory_basic_geometry(product INTEGER,technique TEXT,placement TEXT,stamp TEXT,profile TEXT)');f.db.prepare('INSERT INTO factory_basic_geometry VALUES(?,?,?,?,?)').run(390,'cut-sew','front',measuredAreaStamp(a),JSON.stringify({reviewed:true,safeRect:{x:100,y:100,width:1000,height:1000}}));assert.ok(reviewedLayerRegion(f.db,390,'cut-sew',a,rect));assert.equal(reviewedLayerRegion(f.db,390,'cut-sew',a,{...rect,x:1000}),null);assert.equal(reviewedLayerRegion(f.db,390,'cut-sew',{...a,width:1900},rect),null);
});
