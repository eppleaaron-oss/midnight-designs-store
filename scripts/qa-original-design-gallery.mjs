import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/feedback-service-config.json',r=>r.fulfill({json:{url:null}}));
const originals=JSON.parse(await readFile('designs.json','utf8'));
const visible=originals.filter(a=>a.kind==='artwork'&&a.visibility!=='private');
await page.goto('http://localhost:8000/designs.html');
await page.locator('.artwork-card').first().waitFor();
while(await page.locator('#moreDesigns').isVisible())await page.locator('#moreDesigns').click();
assert.equal(await page.locator('.artwork-card').count(),89);
for(let index=0;index<visible.length;index++){
 await page.locator('.artwork-card .art-card').nth(index).click();
 const id=await page.locator('#designDialog').getAttribute('data-design-id');
 const family=await page.locator('#designDialog').getAttribute('data-family-id');
 assert.equal(id,visible[index].id);assert.equal(family,visible[index].id);
 assert.equal(await page.locator('#designLarge').getAttribute('src'),visible[index].image);
 assert.match(await page.locator('#chooseDesign').getAttribute('href'),/^request-design\.html\?design=/);
 await page.locator('#closeDesign').click();
}
const fixture=[{...visible[1],familyId:'verified-family',familyName:'Verified source family',sourceRole:'front'},{...visible[2],familyId:'verified-family',familyName:'Verified source family',sourceRole:'back'},{...visible[3],familyId:'verified-family',familyName:'Verified source family',sourceRole:'sleeve_left'},{...originals.find(a=>a.kind==='reference')},{...originals.find(a=>a.visibility==='private')}];
await page.route('**/designs.json',r=>r.fulfill({json:fixture}));
await page.route('**/products.json',r=>r.fulfill({json:{products:[{id:'published',image:'garment.jpg',designFamilyId:'verified-family',variants:[{id:'size'}],collectionName:'Verified collection'},{id:'private',designFamilyId:'verified-family',status:'draft',variants:[{id:'size'}]}]}}));
await page.goto('http://localhost:8000/designs.html');await page.locator('.artwork-card').first().waitFor();assert.equal(await page.locator('.artwork-card').count(),1);
await page.locator('.art-card').click();assert.equal(await page.locator('#designFamilyArtwork button').count(),3);
await page.locator('#designFamilyArtwork button').nth(1).click();assert.equal(await page.locator('#designLarge').getAttribute('src'),visible[2].image);assert.equal(await page.locator('#designDialog').getAttribute('data-design-id'),visible[2].id);
assert.equal(await page.locator('#shopDesign').getAttribute('href'),'shop.html?collection=Verified%20collection');
const request=await page.locator('#chooseDesign').getAttribute('href');assert(request.includes(encodeURIComponent(visible[2].id)));
await page.reload();await page.locator('#designDialog[open]').waitFor();assert.equal(await page.locator('#designLarge').getAttribute('src'),visible[2].image);
for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
await page.goto('http://localhost:8000/'+request);await page.waitForFunction(()=>document.querySelector('#idea').value.includes('Original artwork ID:'));assert((await page.locator('#idea').inputValue()).includes(visible[2].id));
assert.match(await page.locator('#requestStatus').innerText(),/Nothing has been submitted/);
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: all 89 actual original cards, exact source/family selection, distinct shop/request paths, reload and mobile widths.');
