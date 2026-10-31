import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {sync} from './sync-printful.mjs';

test('AI draft and private live-product revision survive repeated catalog syncs without reaching store or homepage',async()=>{
 const cwd=process.cwd(),dir=await mkdtemp(join(tmpdir(),'private-ai-release-'));
 const variant=id=>({id:String(id),catalogVariantId:id+100,size:'M',color:'Black',availability:'active',price:40,currency:'USD'});
 const release={id:'1',catalogProductId:390,name:'Approved hoodie',description:'Approved copy',factoryExternalId:'midnight-factory-one',studioRevision:'approved-one',publicationApproval:{state:'approved',revision:'approved-one'},image:'approved.jpg',images:['approved.jpg'],variants:[variant(11)]};
 const privateEdit={...release,name:'PRIVATE EDIT',image:'private.jpg',studioRevision:'private-two',publicationApproval:{state:'draft',revision:'private-two'}};
 const draft={...release,id:'2',name:'PRIVATE AI DRAFT',factoryExternalId:'midnight-factory-two',studioRevision:'draft-two',publicationApproval:{state:'draft',revision:'draft-two'},variants:[variant(21)]};
 const details=[release,draft].map(p=>({sync_product:{id:Number(p.id),name:p.name,external_id:p.factoryExternalId},sync_variants:p.variants.map(v=>({...v,id:Number(v.id),variant_id:v.catalogVariantId,synced:true,availability_status:'active',retail_price:99,files:[{type:'preview',preview_url:'https://example.com/private-supplier.jpg'}]}))}));
 const fetcher=async url=>{const path=new URL(url).pathname;return Response.json({code:200,result:path==='/store/products'?details.map(d=>({id:d.sync_product.id})):details.find(d=>String(d.sync_product.id)===path.split('/').pop()),paging:{total:2}});};
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),home=app.slice(app.indexOf('function homeProducts()'),app.indexOf('\nfunction homeHeroProduct()'));
 const select=products=>vm.runInNewContext(home+';homeProducts().map(p=>p.id)',{PRODUCTS:products,$:()=>({dataset:{latest:'true',featured:'1',featuredBackups:''}}),activeVariant:v=>v.availability==='active'});
 try{
  process.chdir(dir);await writeFile('products.json',JSON.stringify({products:[release]}));await writeFile('factory-listings.json',JSON.stringify({products:{1:privateEdit,2:draft}}));
  for(let attempt=0;attempt<2;attempt++){
   await sync({token:'fixture',fetcher});const products=JSON.parse(await readFile('products.json','utf8')).products;
   assert.deepEqual(products.map(p=>p.id),['1']);assert.equal(products[0].image,'approved.jpg');assert.equal(products[0].studioRevision,'approved-one');assert.equal(products[0].name,'Approved hoodie');assert.equal(products[0].variants[0].price,40);
   assert.deepEqual(Array.from(select(products)),['1']);assert.equal(JSON.parse(await readFile('factory-listings.json','utf8')).products['2'].name,'PRIVATE AI DRAFT');
  }
  assert.deepEqual(Array.from(select([release,{...release,id:'99999'}])),['1'],'Publishing another product never automatically features it');
  assert.deepEqual(Array.from(select([privateEdit])),[],'Even a selected private revision cannot be featured');
 }finally{process.chdir(cwd);await rm(dir,{recursive:true,force:true});}
});
