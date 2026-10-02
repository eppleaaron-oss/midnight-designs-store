import {writeFile,mkdir,rename,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {applyPrices} from './pricing.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function normalize(detail){
 const p=detail.sync_product;if(!p||p.is_ignored)return null;
 const variants=(detail.sync_variants||[]).filter(v=>v.synced&&!v.is_ignored&&v.availability_status!=='discontinued'&&Number(v.retail_price)>0&&v.currency).map(v=>({id:String(v.id),name:v.name,price:Number(v.retail_price),currency:v.currency,availability:v.availability_status||'unknown'}));
 if(!variants.length)return null;
 const previews=(detail.sync_variants||[]).flatMap(v=>(v.files||[]).filter(f=>f.type==='preview').map(f=>f.preview_url||f.url)).filter(u=>typeof u==='string'&&u.startsWith('https://'));
 const name=p.name||'Midnight Designs';let category=/hoodie|sweatshirt|crewneck/i.test(name)?'Hoodies & sweatshirts':/jacket|coat/i.test(name)?'Outerwear':/shirt|tee/i.test(name)?'Tees':/leggings|pants|shorts|joggers/i.test(name)?'Bottoms':/backpack|bag|bandana|hat|beanie/i.test(name)?'Accessories':'Other pieces';
 const image=previews[0]||p.thumbnail_url||'';
 const catalogProductId=(detail.sync_variants||[]).find(v=>v.product?.product_id)?.product.product_id;return {id:String(p.id),catalogProductId,name,category,image,images:[...new Set(previews)].slice(0,12),variants};
}
export async function sync({token=process.env.PRINTFUL_TOKEN,storeId=process.env.PRINTFUL_STORE_ID,endpoint=process.env.PRINTFUL_PRODUCTS_ENDPOINT||'store',output='products.json',fetcher=fetch}={}){
 if(!token)throw Error('Configure the PRINTFUL_TOKEN GitHub Actions secret before syncing.');
 if(!['store','sync'].includes(endpoint))throw Error('PRINTFUL_PRODUCTS_ENDPOINT must be store or sync.');
 async function get(path){for(let attempt=0;attempt<4;attempt++){const response=await fetcher('https://api.printful.com/'+path,{headers:{Authorization:'Bearer '+token,...(storeId?{'X-PF-Store-Id':storeId}:{})},signal:AbortSignal.timeout(30000)});if(response.status===429||response.status>=500){await sleep((attempt+1)*2000);continue}if(!response.ok)throw Error('Printful request failed (HTTP '+response.status+'). Check the token scope, store ID and endpoint.');const data=await response.json();if(data.code!==200)throw Error('Printful did not return a successful response.');return data}throw Error('Printful is temporarily unavailable. Retry the sync later.')}
 let excluded=[];try{const data=JSON.parse(await readFile('catalog-exclusions.json','utf8'));if(!Array.isArray(data.productIds))throw Error('Invalid exclusions');excluded=data.productIds;}catch(error){if(error.code!=='ENOENT')throw error;}const products=[];let offset=0;
 while(true){const page=await get(endpoint+'/products?limit=100&offset='+offset);if(!Array.isArray(page.result))throw Error('Unexpected Printful product list.');for(const summary of page.result){if(summary.is_ignored)continue;const detail=await get(endpoint+'/products/'+encodeURIComponent(summary.id));const product=normalize(detail.result);if(product&&!excluded.includes(product.id))products.push(product);await sleep(150)}offset+=page.result.length;if(!page.result.length||offset>=(page.paging?.total??offset))break}
 if(!products.length&&!excluded.length)throw Error('No publishable store products were found. Add product templates to the selected Printful store and set positive retail prices/currencies, then retry. Existing catalog was preserved.');
 let overrides={prices:{}};try{overrides=JSON.parse(await readFile('pricing-overrides.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}applyPrices(products,overrides);
 let copy={products:{}};try{copy=JSON.parse(await readFile('catalog-copy.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}for(const p of products){if(copy.products?.[p.id])Object.assign(p,copy.products[p.id]);p.url='products/'+p.id+'.html';}
 const currencies=new Set(products.flatMap(p=>p.variants.map(v=>v.currency)));if(currencies.size>1)throw Error('The store needs one retail currency. Existing catalog was preserved.');
 await mkdir(new URL('../',pathToFileURL(output)),{recursive:true});await writeFile(output+'.tmp',JSON.stringify({updatedAt:new Date().toISOString(),products},null,2)+'\n');await rename(output+'.tmp',output);console.log('Imported '+products.length+' products.');return products;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)sync().catch(error=>{console.error(error.message);process.exitCode=1});
