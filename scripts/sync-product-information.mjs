import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {information} from './product-information.mjs';
export async function enrich({token=process.env.PRINTFUL_TOKEN,storeId=process.env.PRINTFUL_STORE_ID,endpoint=process.env.PRINTFUL_PRODUCTS_ENDPOINT||'store',fetcher=fetch}={}){
 if(!token)throw Error('Product information sync requires the protected supplier token.');if(!['store','sync'].includes(endpoint))throw Error('Invalid products endpoint.');
 const catalog=JSON.parse(await readFile('products.json','utf8'));const specs={},byId=new Map();
 const headers={Authorization:'Bearer '+token,...(storeId?{'X-PF-Store-Id':storeId}:{})};
 async function get(path){for(let i=0;i<5;i++){const r=await fetcher('https://api.printful.com/'+path,{headers,signal:AbortSignal.timeout(30000)});if(r.status===429||r.status>=500){await new Promise(r=>setTimeout(r,(i+1)*3000));continue}if(!r.ok)throw Error('Product information request failed: HTTP '+r.status);const d=await r.json();if(d.code!==200)throw Error('Product information response invalid.');return d.result}throw Error('Product information service unavailable.');}
 for(const p of catalog.products){const detail=await get(endpoint+'/products/'+encodeURIComponent(p.id));const ids=new Set(detail.sync_variants.map(v=>v.product?.product_id).filter(Boolean));if(ids.size!==1)throw Error('Product requires manual verification of mixed catalog types: '+p.id);const id=[...ids][0];p.catalogProductId=id;
  if(!byId.has(id)){const r=await get('products/'+id);byId.set(id,r);specs[id]=information(r)}
  const variants=byId.get(id).variants;
  for(const v of p.variants){const sync=detail.sync_variants.find(x=>String(x.id)===String(v.id));const base=variants.find(x=>String(x.id)===String(sync?.variant_id));if(!base)throw Error('Variant specifications missing for '+v.id);Object.assign(v,{catalogVariantId:base.id,size:base.size||null,color:base.color||null,colorCode:base.color_code||null});}
  await new Promise(r=>setTimeout(r,400));
 }
 const metadata={updatedAt:new Date().toISOString(),products:specs};
 // Keep retail prices, artwork and availability exactly as supplied by the store catalog.
 await writeFile('product-information.json.tmp',JSON.stringify(metadata,null,2)+'\n');await writeFile('products.json.tmp',JSON.stringify(catalog,null,2)+'\n');await rename('product-information.json.tmp','product-information.json');await rename('products.json.tmp','products.json');console.log('Verified information for '+catalog.products.length+' products and '+catalog.products.reduce((n,p)=>n+p.variants.length,0)+' store variants.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)enrich().catch(e=>{console.error(e.message);process.exitCode=1});
