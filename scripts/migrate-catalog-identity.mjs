import {readFile,writeFile} from 'node:fs/promises';
import identity from '../catalog-identity.js';
const read=async f=>JSON.parse(await readFile(f,'utf8')),save=(f,x)=>writeFile(f,JSON.stringify(x,null,2)+'\n');
const catalog=await read('products.json'),manifest=await read('factory-listings.json'),copy=await read('catalog-copy.json');
const count=catalog.products.length;
for(let i=0;i<count;i++){
 const old=catalog.products[i],p=identity.normalize(old);catalog.products[i]=p;
 // Durable editorial copy wins over future supplier title refreshes.
 copy.products[p.id]={...copy.products[p.id],name:p.name,collections:p.collections||[]};
 if(manifest.products[p.id])manifest.products[p.id]=identity.normalize(manifest.products[p.id]);
}
for(const id of Object.keys(manifest.products))manifest.products[id]=identity.normalize(manifest.products[id]);
await save('products.json',catalog);await save('factory-listings.json',manifest);await save('catalog-copy.json',copy);
console.log('Normalized '+count+' products without changing supplier IDs, variants, images or prices.');
