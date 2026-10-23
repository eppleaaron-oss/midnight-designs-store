import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../catalog-photos.js',import.meta.url),'utf8').split('(async()=>')[0];
const ctx=vm.createContext({});vm.runInContext(source,ctx);
test('a gallery from an older revision cannot replace the owner-edited product images',()=>{const p={image:'new-front.jpg',images:['new-front.jpg','new-back.jpg'],studioRevision:'owner-edit-2',variants:[{id:'1'}]},entry={originalImage:p.image,photos:[{image:'old-front.jpg',category:'product',view:'Front',style:'Flat',storeVariantIds:['1']}]};const pair=ctx.catalogPhotoPair(p,entry,'1');assert.equal(pair.first,'new-front.jpg');assert.equal(pair.second,'new-back.jpg');entry.studioRevision=p.studioRevision;assert.equal(ctx.catalogPhotoPair(p,entry,'1').first,'old-front.jpg');});
