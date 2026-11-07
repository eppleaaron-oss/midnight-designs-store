import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {printfulClient} from './printful-client.mjs';
import {normalize} from './sync-printful.mjs';
import {information} from './product-information.mjs';
import identity from '../catalog-identity.js';
const ids=JSON.parse(await readFile('owner-hoodie-import.json','utf8')).productIds;
assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
const catalog=JSON.parse(await readFile('products.json','utf8'));
const before=structuredClone(catalog.products);
const specs=JSON.parse(await readFile('product-information.json','utf8'));
const get=printfulClient({token:process.env.PRINTFUL_TOKEN,storeId:process.env.PRINTFUL_STORE_ID});
const endpoint=process.env.PRINTFUL_PRODUCTS_ENDPOINT||'store';
assert(['store','sync'].includes(endpoint));
const excluded=JSON.parse(await readFile('catalog-exclusions.json','utf8')).productIds;
const imported=[], now=new Date().toISOString();
for(const id of ids){
 assert(!excluded.includes(id),'Product is explicitly hidden: '+id);
 const detail=(await get(endpoint+'/products/'+id)).result;
 assert.equal(String(detail.sync_product.id),id);
 assert(!detail.sync_product.is_ignored);
 assert(!String(detail.sync_product.external_id).startsWith('midnight-factory-'),'Private factory products require their existing review workflow');
 let p=normalize(detail);
 assert(p&&p.categoryId==='hoodies','Not a publishable hoodie: '+id);
 assert(p.variants.every(v=>v.currency==='USD'&&v.price>0&&v.size&&v.availability==='active'));
 const cat=(await get('products/'+p.catalogProductId)).result;
 assert(/hoodie/i.test(cat.product.title));
 const variantById=new Map(cat.variants.map(v=>[String(v.id),v]));
 p.variants=p.variants.map(v=>{
   const base=variantById.get(String(v.catalogVariantId));assert(base&&base.size);
   return {...v,size:base.size,color:base.color||null,colorCode:base.color_code||null};
 });
 const name=p.name.replace(/^\*\*|\*\*$/g,'').replace(/\s*\?+\s*$/,'').trim();
 const revision='owner-printful-import-'+id+'-20261107';
 p=identity.normalize({...p,name,ownerEditedDetails:true,supplierCatalogTitle:cat.product.title,
   studioRevision:revision,publicationApproval:{state:'approved',revision,approvedAt:now,source:'Owner requested publication of the seven saved new Printful hoodies; eighth remains a draft'},
   createdAt:now,description:name+'. '+information(cat).description});
 assert(p.image.startsWith('https://'));
 // Save the actual supplier garment preview permanently, without recoloring or compositing.
 const response=await fetch(p.image,{signal:AbortSignal.timeout(30000)});assert(response.ok);
 const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length>1000);
 const type=response.headers.get('content-type')||'';assert(type.startsWith('image/'));
 const ext=type.includes('png')?'png':type.includes('webp')?'webp':'jpg';
 await mkdir('assets/product-photos/owner-hoodies',{recursive:true});
 const path='assets/product-photos/owner-hoodies/'+id+'.'+ext;
 await writeFile(path,bytes);
 p.supplierPreview=p.image;p.image=path;p.images=[path];
 specs.products[String(p.catalogProductId)]=information(cat);
 imported.push(p);
}
const map=new Map(imported.map(p=>[p.id,p]));
catalog.products=before.map(p=>map.get(p.id)||p);
for(const p of imported)if(!before.some(x=>x.id===p.id))catalog.products.push(p);
for(const old of before)if(!ids.includes(old.id))assert.deepEqual(catalog.products.find(p=>p.id===old.id),old);
assert.equal(new Set(catalog.products.map(p=>p.id)).size,catalog.products.length);
assert.equal(catalog.products.length,before.length+ids.filter(id=>!before.some(p=>p.id===id)).length);
catalog.updatedAt=now;catalog.lastSyncedAt=now;specs.updatedAt=now;
await writeFile('products.json',JSON.stringify(catalog,null,2)+'\n');
await writeFile('product-information.json',JSON.stringify(specs,null,2)+'\n');
const report={importedAt:now,beforeCount:before.length,afterCount:catalog.products.length,unchangedOtherProducts:before.filter(p=>!ids.includes(p.id)).length,products:imported.map(p=>({id:p.id,name:p.name,variants:p.variants.length,sizes:p.variants.map(v=>v.size),minimumPrice:Math.min(...p.variants.map(v=>v.price)),maximumPrice:Math.max(...p.variants.map(v=>v.price)),image:p.image}))};
await writeFile('owner-hoodie-import-report.json',JSON.stringify(report,null,2)+'\n');
console.log('OWNER_HOODIE_IMPORT '+JSON.stringify(report));
