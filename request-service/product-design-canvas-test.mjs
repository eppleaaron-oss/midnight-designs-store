import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const ctx={window:{}};vm.runInNewContext(readFileSync(new URL('./public/product-design-canvas.js',import.meta.url),'utf8'),ctx);const {fit,point}=ctx.window.MidnightDesignGeometry;
const area={width:4000,height:5000,dpi:200,profile:{reviewed:true,safeRect:{x:200,y:200,width:3600,height:4600},anchors:{left_chest:{x:2500,y:1300}}}},slot={anchor:'left_chest',widthIn:3,heightIn:4},source={width:2000,height:2400};
test('moving and resizing change the actual native print coordinates without distorting source proportions',()=>{
 const original=fit(area,slot,{},source);assert.equal(original.visible.width,600);assert.equal(original.visible.height,720);assert.equal(original.cx,2500);const moved=fit(area,slot,{xIn:10,yIn:12},source);assert.equal(moved.cx,2000);assert.equal(moved.cy,2400);assert.equal(moved.width,original.width);const resized=fit(area,slot,{widthIn:6,heightIn:8,xIn:10,yIn:12},source);assert.equal(resized.width,original.width*2);assert.equal(resized.height,original.height*2);assert.equal(resized.width/resized.height,source.width/source.height);
});
test('visible bounds preserve the full original canvas, and unsafe or unreviewed placement cannot pretend to fit',()=>{
 const g=fit(area,slot,{},source,{x:500,y:400,width:1000,height:1200});assert.equal(g.visible.width,600);assert.equal(g.width,1200);assert.equal(g.x,1900);assert.equal(g.visible.x,2200);assert.equal(fit(area,slot,{xIn:0,yIn:0},source),null);assert.equal(fit({...area,profile:null},slot,{},source),null);const limited=fit(area,slot,{widthIn:40,heightIn:60},source);assert.equal(limited.reduced,true);assert.ok(limited.visible.x>=area.profile.safeRect.x);
});
test('pointer positions use displayed canvas dimensions for both desktop and touch-sized surfaces',()=>{
 const a=point({clientX:160,clientY:300},{left:10,top:50,width:300,height:500},area);assert.equal(a.x,2000);assert.equal(a.y,2500);
});
