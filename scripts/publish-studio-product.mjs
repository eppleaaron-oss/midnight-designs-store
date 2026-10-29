import {importApproved,ownerApproved} from './publication-policy.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function applyStudioUpdates(catalog,manifest,{supplier='',revision='',excluded=[],clock=Date.now}={}){
 if(!Array.isArray(catalog.products)||!manifest.products||!Array.isArray(manifest.withdrawn||[]))throw Error('Invalid catalog or approved manifest.');
 if(supplier&&(!/^\d+$/.test(supplier)||!uuid.test(revision)))throw Error('Invalid edited product identity.');
 const candidates=supplier?[supplier]:Object.keys(manifest.products).filter(id=>manifest.products[id].studioRevision&&(catalog.products.some(p=>p.id===id&&p.studioRevision!==manifest.products[id].studioRevision)||!catalog.products.some(p=>p.id===id)&&ownerApproved(manifest.products[id])));
 const result=structuredClone(catalog),changed=[];
 for(const id of candidates){
  let p=result.products.find(p=>p.id===id);const f=manifest.products[id];
  if(!f||!uuid.test(f.studioRevision||'')||supplier&&f.studioRevision!==revision)throw Error('A matching approved existing product edit is required.');
  if((manifest.withdrawn||[]).includes(id)||excluded.includes(id))throw Error('This product was withdrawn or excluded.');
  if(!p){
   if(!ownerApproved(f)||!/^\d+$/.test(id)||!f.name?.trim()||!f.description?.trim()||!Number.isInteger(f.catalogProductId)||!Array.isArray(f.variants)||!f.variants.length||f.variants.some(v=>!/^\d+$/.test(v.id)||!Number.isInteger(v.catalogVariantId)||!v.size||!v.color||v.currency!=='USD'||!(v.price>0)||!['active','out_of_stock','unavailable'].includes(v.availability)))throw Error('A complete owner-approved new product is required.');
   p={...structuredClone(f),studioRevision:undefined,studioUpdated:undefined};result.products.push(p);
  }
  if(p.studioRevision===f.studioRevision)continue;
  if(!importApproved(f,p))throw Error('Explicit owner approval for this exact revision is required.');
  if(!p.factoryExternalId?.startsWith('midnight-factory-')||p.factoryExternalId!==f.factoryExternalId||p.catalogProductId!==f.catalogProductId||f.id!==id)throw Error('Existing supplier product identity changed.');
  if(!Number.isFinite(f.studioUpdated)||f.studioUpdated<=0||p.studioUpdated>f.studioUpdated)throw Error('A newer product edit exists.');
  const image=url=>{let u;try{u=new URL(url);}catch{}if(!u||u.origin!=='https://midnight-designs.store'||u.search||u.hash||!u.pathname.startsWith('/images/factory/'+id+'/')||!/^\/images\/factory\/\d+\/[a-f0-9]{64}\.(jpg|png)$/.test(u.pathname))throw Error('A permanent verified product image is required.');return url;};
  if(!Array.isArray(f.images)||!f.images.length||f.images.length>256||!f.images.includes(f.image))throw Error('Edited mockup images are incomplete.');
  f.images.forEach(image);
  if(!Array.isArray(f.variants)||f.variants.length!==p.variants.length||new Set(f.variants.map(v=>v.id)).size!==p.variants.length)throw Error('Existing product variants changed.');
  const variants=p.variants.map(v=>{const a=f.variants.find(a=>a.id===v.id);if(!a||a.catalogVariantId!==v.catalogVariantId||a.price!==v.price||a.currency!==v.currency||!Array.isArray(a.images)||!a.images.length||!a.images.includes(a.image)||a.images.some(u=>!f.images.includes(u)))throw Error('Existing variant identity, price or mockup mapping changed.');a.images.forEach(image);return {...v,image:a.image,images:a.images};});
  Object.assign(p,{image:f.image,images:f.images,variants,studioRevision:f.studioRevision,studioUpdated:f.studioUpdated,publicationApproval:f.publicationApproval});changed.push(id);
 }
 if(changed.length)result.updatedAt=new Date(clock()).toISOString();return {catalog:result,changed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const read=path=>readFile(path,'utf8').then(JSON.parse);
 const [catalog,manifest,exclusions]=await Promise.all([read('products.json'),read('factory-listings.json'),read('catalog-exclusions.json').catch(e=>{if(e.code==='ENOENT')return {productIds:[]};throw e;})]);
 const result=applyStudioUpdates(catalog,manifest,{supplier:process.env.STUDIO_SUPPLIER||'',revision:process.env.STUDIO_REVISION||'',excluded:exclusions.productIds});
 if(result.changed.length){await writeFile('products.json.tmp',JSON.stringify(result.catalog,null,2)+'\n');await rename('products.json.tmp','products.json');}
 console.log('Applied verified edits to '+result.changed.length+' existing products: '+result.changed.join(', '));
}
