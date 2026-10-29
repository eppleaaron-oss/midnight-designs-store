import {importApproved} from './publication-policy.mjs';
import catalogIdentity from '../catalog-identity.js';
import {writeFile,mkdir,rename,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {printfulClient} from './printful-client.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function normalize(detail){
 const p=detail.sync_product;if(!p||p.is_ignored)return null;
 const variants=(detail.sync_variants||[]).filter(v=>v.synced&&!v.is_ignored&&v.availability_status!=='discontinued'&&Number(v.retail_price)>0&&v.currency).map(v=>({id:String(v.id),name:v.name,price:Number(v.retail_price),currency:v.currency,catalogVariantId:v.variant_id||null,size:typeof v.size==='string'&&v.size.trim()?v.size:null,color:v.color||null,colorCode:v.color_code||null,availability:v.availability_status||'unknown'}));
 if(!variants.length)return null;
 const previews=(detail.sync_variants||[]).flatMap(v=>(v.files||[]).filter(f=>f.type==='preview').map(f=>f.preview_url||f.url)).filter(u=>typeof u==='string'&&u.startsWith('https://'));
 const name=p.name||'Midnight Designs',category='';
 const image=previews[0]||p.thumbnail_url||'';
 const catalogProductId=(detail.sync_variants||[]).find(v=>v.product?.product_id)?.product.product_id;return catalogIdentity.normalize({id:String(p.id),catalogProductId,name,category,image,images:[...new Set(previews)].slice(0,12),variants});
}
export async function sync({token=process.env.PRINTFUL_TOKEN,storeId=process.env.PRINTFUL_STORE_ID,endpoint=process.env.PRINTFUL_PRODUCTS_ENDPOINT||'store',output='products.json',fetcher=fetch}={}){
 if(!token)throw Error('Configure the PRINTFUL_TOKEN GitHub Actions secret before syncing.');
 if(!['store','sync'].includes(endpoint))throw Error('PRINTFUL_PRODUCTS_ENDPOINT must be store or sync.');
 const get=printfulClient({token,storeId,fetcher});
 let excluded=[];try{const data=JSON.parse(await readFile('catalog-exclusions.json','utf8'));if(!Array.isArray(data.productIds))throw Error('Invalid exclusions');excluded=data.productIds;}catch(error){if(error.code!=='ENOENT')throw error;}let factory={products:{}};try{factory=JSON.parse(await readFile('factory-listings.json','utf8'));if(!factory.products||typeof factory.products!=='object')throw Error('Invalid factory manifest');}catch(error){if(error.code!=='ENOENT')throw error;}if(!Array.isArray(factory.withdrawn||[]))throw Error('Invalid factory withdrawal list');let previous={products:[]};try{previous=JSON.parse(await readFile(output,'utf8'));if(!Array.isArray(previous.products))throw Error('Invalid saved catalog');}catch(error){if(error.code!=='ENOENT')throw error;}const saved=new Map(previous.products.map(p=>[String(p.id),p]));const products=[];let offset=0;let withheld=0;
 while(true){const page=await get(endpoint+'/products?limit=100&offset='+offset);if(!Array.isArray(page.result))throw Error('Unexpected Printful product list.');for(const summary of page.result){if(summary.is_ignored)continue;const detail=await get(endpoint+'/products/'+encodeURIComponent(summary.id));if((factory.withdrawn||[]).includes(String(summary.id))){withheld++;continue;}const factoryId=detail.result?.sync_product?.external_id;if(typeof factoryId==='string'&&factoryId.startsWith('midnight-factory-')&&!factory.products[String(summary.id)]){withheld++;continue;}const product=normalize(detail.result);if(product&&!excluded.includes(product.id)){const approved=factory.products[product.id]||saved.get(product.id);if(!approved||!importApproved(approved,saved.get(product.id))){withheld++;continue;}const liveVariants=new Map(product.variants.map(v=>[v.id,v]));if(approved.factoryExternalId&&approved.factoryExternalId!==factoryId){withheld++;continue;}products.push({...approved,variants:approved.variants.map(v=>({...v,availability:liveVariants.get(String(v.id))?.availability||'unavailable'}))});}await sleep(150)}offset+=page.result.length;if(!page.result.length||offset>=(page.paging?.total??offset))break}
 if(!products.length&&!withheld)throw Error('No publishable store products were found. Add product templates to the selected Printful store and set positive retail prices/currencies, then retry. Existing catalog was preserved.');
 for(let i=products.length-1;i>=0;i--){const p=products[i],f=factory.products[p.id];if(!f)continue;if(!f.factoryExternalId?.startsWith('midnight-factory-')||!f.description||!f.image||!Array.isArray(f.variants)||!f.variants.length)throw Error('Incomplete approved factory listing');const ids=new Set(p.variants.map(v=>v.id));if(f.variants.some(v=>!ids.has(v.id))){products.splice(i,1);continue;}products[i]={...f,variants:f.variants.map(v=>({...v,availability:p.variants.find(x=>x.id===v.id).availability}))};}
 for(let i=0;i<products.length;i++)products[i]=catalogIdentity.normalize(products[i]);
 const currencies=new Set(products.flatMap(p=>p.variants.map(v=>v.currency)));if(currencies.size>1)throw Error('The store needs one retail currency. Existing catalog was preserved.');
 await mkdir(new URL('../',pathToFileURL(output)),{recursive:true});await writeFile(output+'.tmp',JSON.stringify({updatedAt:new Date().toISOString(),lastSyncedAt:new Date().toISOString(),products},null,2)+'\n');await rename(output+'.tmp',output);console.log('Imported '+products.length+' products.');return products;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)sync().catch(error=>{console.error(error.message);process.exitCode=1});
