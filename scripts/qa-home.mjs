import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const products=JSON.parse(fs.readFileSync('products.json')).products;
const active=p=>p.variants.some(v=>v.availability==='active'&&v.size?.trim());
const latest=list=>list.filter(active).sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,4).map(p=>p.id);
const browser=await chromium.launch(), page=await browser.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));
for(const [width,height] of [[320,844],[390,844],[768,1024],[1440,1000],[844,390]]){
 await page.setViewportSize({width,height});await page.goto('http://localhost:8000/index.html');
 await page.waitForSelector('#grid .product-card');await page.locator('.opening-image').evaluate(img=>img.decode());
 assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),latest([...products]));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow at '+width);
 const src=await page.locator('.opening-image').evaluate(img=>img.currentSrc);
 assert.ok(src.endsWith(width<=600?'skate-shop-mobile.webp':'skate-shop-banner.webp'));
 assert.equal(await page.locator('.opening-image').getAttribute('fetchpriority'),'high');
 assert.equal(await page.locator('.hero-actions a[href="shop.html"]').count(),1);
 assert.ok((await page.locator('.hero-actions a').boundingBox()).height>=44);
 for(const nav of await page.locator('.links a').all())assert.equal(await nav.isVisible(),true);
 for(const tile of await page.locator('.category-tile').all()){
  await tile.locator('img').evaluate(img=>img.decode());
  const href=await tile.getAttribute('href');assert.ok(fs.existsSync(href.split('?')[0]));
 }
 for(const card of await page.locator('#grid .product-card').all()){
  const id=await card.getAttribute('data-product-id'),product=products.find(p=>p.id===id);
  assert.ok(product);assert.ok((await card.locator('.price').innerText()).includes('$'));
  assert.equal(new URL(await card.locator('.product-image').getAttribute('href'),'http://localhost').searchParams.get('id'),id);
 }
 await page.screenshot({path:'qa-home-'+width+'.png',fullPage:true});
}
await page.locator('.category-tile').first().click();await page.waitForSelector('.product-card');
assert.ok((await page.locator('#grid .product-card h3').allTextContents()).every(name=>/hoodie/i.test(name)));
await page.route('**/products.json',r=>r.fulfill({json:{products:[...products].reverse()}}));
await page.goto('http://localhost:8000/index.html');await page.waitForSelector('#grid .product-card');
assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),latest([...products]));
await page.unroute('**/products.json');
const unavailable=structuredClone(products);for(const p of unavailable)for(const v of p.variants)v.availability='not_available';
await page.route('**/products.json',r=>r.fulfill({json:{products:unavailable}}));
await page.goto('http://localhost:8000/index.html');await page.getByText('No matching pieces.',{exact:true}).waitFor();
assert.equal(await page.locator('#grid .product-card').count(),0);assert.equal(await page.locator('.opening-image').isVisible(),true);
await page.unroute('**/products.json');await page.route('**/products.json',r=>r.fulfill({status:503,body:'Unavailable'}));
await page.goto('http://localhost:8000/index.html');await page.getByText('The collection could not load.',{exact:true}).waitFor();
assert.equal(await page.locator('.hero-actions a').isVisible(),true);assert.deepEqual(errors,[]);
await browser.close();console.log('PASS: skate-shop banner crops, latest available products, responsive layout, category filters, price links, catalog reordering and unavailable/error states.');
