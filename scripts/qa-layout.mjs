import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true}),p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://localhost:8000/master.html');assert.ok(await p.getByRole('link',{name:'Layout',exact:true}).count()>=1);
await p.goto('http://localhost:8000/layout.html');await p.waitForFunction(()=>document.getElementById('headline').value.length>0);
await p.locator('#headline').fill('Preview headline');await p.locator('#featuredCount').selectOption('9');await p.locator('#previewLayout').click();
const frame=p.frameLocator('#layoutPreview');await frame.locator('.hero-copy h1').filter({hasText:'Preview headline'}).waitFor();await frame.locator('#grid .product-card').nth(8).waitFor();
await p.locator('#prepareLayout').click();assert.equal(JSON.parse(await p.locator('#layoutPayload').inputValue()).featuredCount,9);
await p.locator('#mobileLayout').click();assert.equal(await p.locator('#layoutPreview').evaluate(e=>e.style.width),'390px');
await p.goto('http://localhost:8000/index.html');await p.locator('#grid .product-card').nth(5).waitFor();assert.equal(await p.locator('#grid .product-card').count(),6);assert.notEqual(await p.locator('.hero-copy h1').textContent(),'Preview headline');
await p.waitForFunction(()=>document.querySelector('.links a[href="ai-designer.html"]').hidden);assert.equal(await p.locator('.links a[href="ai-designer.html"]').isVisible(),false);
for(const width of [1440,390]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'qa-layout-'+width+'.png'});}
assert.deepEqual(errors,[]);await b.close();console.log('Layout preview, draft isolation, navigation and mobile checks passed');
