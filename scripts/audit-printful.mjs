import {writeFile,readFile} from 'node:fs/promises';
import {printfulClient} from './printful-client.mjs';
import {normalize} from './sync-printful.mjs';
const endpoint=process.env.PRINTFUL_PRODUCTS_ENDPOINT||'store';if(!['store','sync'].includes(endpoint))throw Error('Invalid products endpoint.');
const get=printfulClient({token:process.env.PRINTFUL_TOKEN,storeId:process.env.PRINTFUL_STORE_ID});
const live=JSON.parse(await readFile('products.json','utf8')),audit={checked:new Date().toISOString(),previouslyListed:live.products.length,products:[],complete:false};
try{
 for(let offset=0;;){const page=await get(endpoint+'/products?limit=100&offset='+offset);if(!Array.isArray(page.result))throw Error('Invalid supplier product list.');audit.supplierTotal=page.paging?.total??null;
  for(const summary of page.result){const detail=(await get(endpoint+'/products/'+summary.id)).result;const product=normalize(detail);audit.products.push({id:String(summary.id),name:detail.sync_product?.name,listed:live.products.some(p=>p.id===String(summary.id)),publishable:!!product,detail});console.log('Read product '+summary.id+' ('+audit.products.length+'/'+audit.supplierTotal+').');}
  offset+=page.result.length;if(!page.result.length||offset>=(page.paging?.total??offset))break;
 }
 audit.complete=true;
}finally{await writeFile('printful-inventory-audit.json',JSON.stringify(audit,null,2)+'\n');}
console.log('Audited '+audit.products.length+' Printful products. No supplier or store products changed.');
