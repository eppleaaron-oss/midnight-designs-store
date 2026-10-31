import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),home=require('../homepage.js'),products=JSON.parse(fs.readFileSync('products.json')).products;
const html=fs.readFileSync('index.html','utf8'),ids=html.match(/data-featured="([^"]*)"/)[1].split(','),selected=home.selections(products,ids);
assert.deepEqual(selected.map(p=>p.categoryId),['hoodies','pants','tees','shoes']);assert.equal(home.collections(products,selected).length,3);
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const width of [320,390,768,1440]){
 await page.setViewportSize({width,height:1000});await page.goto('http://localhost:8000/index.html');await page.locator('.opening-product img').waitFor();await page.locator('.home-outfit').first().waitFor();
 assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),ids);
 assert.equal(await page.locator('.home-outfit').count(),3);
 for(const img of await page.locator('main img').all()){await img.evaluate(i=>i.decode());assert.equal(await img.evaluate(i=>getComputedStyle(i).objectFit),'contain');const a=img.locator('..');const href=await a.getAttribute('href');assert(href?.startsWith('product.html?id='));const p=products.find(p=>p.id===new URL(href,'http://localhost').searchParams.get('id'));assert(home.eligible(p));}
 for(const a of await page.locator('.home-outfit>.text-link').all()){const id=new URL(await a.getAttribute('href'),'http://localhost').searchParams.get('outfit');assert(home.collections(products,selected).some(o=>o.id===id));}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);
 await page.screenshot({path:'qa-home-'+width+'.png',fullPage:true});
}
const extra={...structuredClone(products[0]),id:'99999999',name:'New but unfeatured'};
await page.route('**/products.json',r=>r.fulfill({json:{products:[extra,...products].reverse()}}));await page.goto('http://localhost:8000/index.html');await page.locator('.opening-product').waitFor();assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),ids);
await page.unroute('**/products.json');
const held=products.map(p=>ids.includes(p.id)?{...p,approved:false}:p);await page.route('**/products.json',r=>r.fulfill({json:{products:held}}));await page.goto('http://localhost:8000/index.html');await page.getByRole('heading',{name:'The next chapter is coming.'}).waitFor();assert.equal(await page.locator('main img').count(),0,'unapproved selections cannot leak through hero or outfits');
await page.unroute('**/products.json');await page.route('**/products.json',r=>r.fulfill({status:503}));await page.goto('http://localhost:8000/index.html');await page.getByText('The collection could not load.',{exact:true}).waitFor();assert.equal(await page.locator('main img').count(),0);assert.deepEqual(errors,[]);await browser.close();console.log('PASS: manual featured mix, exact product/collection image links, 4 responsive widths, no auto-feature on sync, held and failed catalog states.');
