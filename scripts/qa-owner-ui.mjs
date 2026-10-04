import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
const page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
for(const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1024,768],[1280,720],[1920,1080]]){
 await page.setViewportSize({width,height});
 await page.goto('http://localhost:8000/master.html');
 await page.locator('#productRows .master-row').first().waitFor();
 const menu=page.locator('.owner-menu-toggle');
 assert.equal(await menu.getAttribute('aria-expanded'),'false');
 await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');
 const bounds=await page.locator('.master-tabs').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
 await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');
 await menu.click();await page.locator('.master-tabs a[href="#products"]').click();assert.equal(await menu.getAttribute('aria-expanded'),'false');
 assert.ok(await page.locator('#designRows .master-row').count()<=20);
 const designs=await page.request.get('http://localhost:8000/designs.json').then(r=>r.json());
 await page.locator('#designSearch').fill(designs.at(-1).id);
 assert.equal(await page.locator('#designRows .master-row').count(),1);
 await page.locator('#designRows button').click();assert.equal(await page.locator('#manageId').inputValue(),designs.at(-1).id);
 await page.locator('#closeManage').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'qa-owner-master-'+width+'.png'});
 await page.goto('http://localhost:8000/pricing.html');await page.locator('#rows tr').first().waitFor();
 const input=page.locator('#rows tr').first().locator('input').first();
 await input.fill('25');await input.press('Tab');
 assert.equal(await page.locator('#rows tr').first().locator('input').nth(1).evaluate(e=>e===document.activeElement),true);
 assert.equal(await page.locator('#rows tr').count(),20);
 const next=page.locator('.owner-pagination button').last();await next.click();
 assert.match(await page.locator('#count').innerText(),/showing 21/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(width<=850){const inputBounds=await page.locator('#rows tr input').first().boundingBox();assert.ok(inputBounds.height>=44);}
 await page.screenshot({path:'qa-owner-pricing-'+width+'.png'});
}
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: owner menu, pagination, dialog, editing focus and seven responsive viewports.');
