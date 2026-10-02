import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const origin='http://localhost:8000';
for(const width of [390,1440]){
 await page.setViewportSize({width,height:width===390?844:1000});
 for(const path of ['index.html','shop.html','product.html?id=476651184','cart.html','designs.html','custom.html','layout.html','ai-designer.html']){
  await page.goto(origin+'/'+path);await page.locator('h1').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.ok((await page.locator('body').evaluate(n=>getComputedStyle(n).fontFamily)).includes('DM Sans'),path+' body font');
  assert.ok((await page.locator('h1').first().evaluate(n=>getComputedStyle(n).fontFamily)).includes('Barlow Condensed'),path+' display font');
  assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(20, 20, 19)');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path+' overflow');
  if(path==='shop.html'){await page.waitForSelector('.product-image img');assert.equal(await page.locator('#category').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(29, 29, 26)');assert.equal(await page.locator('.product-image').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(233, 227, 214)');}
  if(path.startsWith('product.html')){await page.waitForSelector('#gallery[data-ready="true"]');assert.equal(await page.locator('.photo-thumbnail[aria-pressed=true]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(233, 227, 214)');assert.equal(await page.locator('.visual').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(233, 227, 214)');}
  if(path==='designs.html'){await page.waitForSelector('.art-card img');assert.equal(await page.locator('.art-card').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(8, 8, 8)');}
  if(path==='layout.html'){await page.waitForSelector('.page-card');assert.equal(await page.locator('.page-card').first().evaluate(n=>getComputedStyle(n).borderRadius),'0px');}
  if(['index.html','shop.html','product.html?id=476651184','designs.html','layout.html'].includes(path))await page.screenshot({path:'qa-brand-'+path.split('.')[0]+'-'+width+'.png'});
 }
}
assert.deepEqual(errors,[]);await browser.close();console.log('Brand fonts, palette, photograph frames, artwork backgrounds, owner cards and responsive pages passed.');
