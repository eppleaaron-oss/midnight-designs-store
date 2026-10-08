import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {sync} from './sync-printful.mjs';
const cwd=process.cwd(),dir=await mkdtemp(join(tmpdir(),'midnight-sync-'));
const variant=(id,price=25,status='active')=>({id,synced:true,retail_price:price,currency:'USD',variant_id:100+id,size:'M',color:'White',availability_status:status});
const detail=(id,variants)=>({sync_product:{id,name:'Test shirt'},sync_variants:variants});
let dataset=[detail(1,[variant(11)])],failure=false;
const fetcher=async url=>{
 if(failure)return {ok:false,status:401};
 const path=new URL(url).pathname;
 const result=path==='/store/products'?dataset.map(x=>({id:x.sync_product.id})):dataset.find(x=>String(x.sync_product.id)===path.split('/').pop());
 return {ok:true,status:200,json:async()=>({code:200,result,...(Array.isArray(result)?{paging:{total:result.length}}:{})})};
};
try{
 process.chdir(dir);
 await writeFile('catalog-copy.json',JSON.stringify({products:{1:{name:'Our design',variants:[{id:'wrong'}]}}}));
 await sync({token:'fixture',fetcher});
 const first=JSON.parse(await readFile('products.json','utf8'));
 assert.equal(first.products[0].name,'Our design');assert.equal(first.products[0].variants[0].id,'11');
 assert(Number.isFinite(Date.parse(first.lastSyncedAt)));
 dataset=[detail(1,[variant(11,31,'out_of_stock'),variant(12,32,'active')]),detail(2,[variant(21,40)])];
 await sync({token:'fixture',fetcher});
 const second=JSON.parse(await readFile('products.json','utf8'));
 assert.equal(second.products.length,2);assert.equal(second.products[0].variants[0].price,31);assert.equal(second.products[0].variants[0].availability,'out_of_stock');
 assert(second.lastSyncedAt>first.lastSyncedAt);
 await writeFile('pricing-overrides.json',JSON.stringify({prices:{11:55}}));
 await sync({token:'fixture',fetcher});assert.equal(JSON.parse(await readFile('products.json','utf8')).products[0].variants[0].price,55);
 const factoryDetail=detail(3,[variant(31,39.99)]);factoryDetail.sync_product.external_id='midnight-factory-test';dataset.push(factoryDetail);await sync({token:'fixture',fetcher});assert.equal(JSON.parse(await readFile('products.json','utf8')).products.some(p=>p.id==='3'),false,'Unapproved supplier drafts stay private');
 await writeFile('factory-listings.json',JSON.stringify({products:{3:{id:'3',name:'Approved factory tee',description:'Approved description',factoryExternalId:'midnight-factory-test',image:'https://example.com/mockup.png',images:['https://example.com/mockup.png'],variants:[{id:'31',catalogVariantId:131,size:'M',color:'White',currency:'USD',price:39.99,availability:'active'}]}}}));await sync({token:'fixture',fetcher});assert.equal(JSON.parse(await readFile('products.json','utf8')).products.find(p=>p.id==='3').description,'Approved description');
 const good=await readFile('products.json','utf8');
 failure=true;await assert.rejects(sync({token:'fixture',fetcher}),/HTTP 401/);assert.equal(await readFile('products.json','utf8'),good);
 failure=false;dataset=[];await assert.rejects(sync({token:'fixture',fetcher}),/No publishable/);assert.equal(await readFile('products.json','utf8'),good);
 await assert.rejects(sync({token:'',fetcher}),/Configure/);assert.equal(await readFile('products.json','utf8'),good);
 console.log('PASS: new products, changed prices/availability, protected variants, retail overrides, honest sync timestamps, failure preservation.');
}finally{process.chdir(cwd);await rm(dir,{recursive:true,force:true});}
