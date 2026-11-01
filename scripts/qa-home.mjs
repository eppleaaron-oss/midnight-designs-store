import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),home=require('../homepage.js'),products=JSON.parse(fs.readFileSync('products.json')).products,html=fs.readFileSync('index.html','utf8'),ids=html.match(/data-featured="([^"]*)"/)[1].split(',');
assert.equal(home.selections(products,ids).length,4);assert.deepEqual(home.selections(products,ids).map(p=>p.categoryId),['tees','pants','shoes','bags']);
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await page.goto('http://localhost:8000/index.html');await page.locator('.campaign-view').first().waitFor();await page.locator('#campaignMini a').last().waitFor();
assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),ids);
for(const img of await page.locator('#grid img,#campaignMini img').all())await img.evaluate(i=>i.decode());
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);
assert.equal(await page.getByRole('heading',{name:'After the Last Light.'}).count(),1);
assert.equal(await page.locator('.campaign-mini a').count(),3);
assert((await page.getByRole('link',{name:'Explore hoodies →',exact:true}).getAttribute('href')).includes('type=Hoodies'));
await page.screenshot({path:'qa-home-'+width+'.png',fullPage:true});}
const extra={...structuredClone(products[0]),id:'99999999',name:'New but unfeatured'};await page.route('**/products.json',r=>r.fulfill({json:{products:[extra,...products].reverse()}}));await page.goto('http://localhost:8000/index.html');await page.locator('.campaign-view').first().waitFor();assert.deepEqual(await page.locator('#grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId)),ids);await page.unroute('**/products.json');
await page.route('**/products.json',r=>r.fulfill({json:{products:products.map(p=>ids.includes(p.id)?{...p,approved:false}:p)}}));await page.goto('http://localhost:8000/index.html');await page.getByText('No matching pieces.',{exact:true}).waitFor();assert.equal(await page.locator('#grid .product-card').count(),0);assert.equal(await page.locator('#campaignMini a').count(),0);assert.deepEqual(errors,[]);await browser.close();console.log('PASS: reference landing page, actual published products/prices, 4 responsive sizes, hoodie navigation, manual feature order and private approval protection.');
