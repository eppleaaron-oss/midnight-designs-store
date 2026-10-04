import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='http://localhost:8000/';
const products=JSON.parse(fs.readFileSync('products.json')).products;
const product=products.find(p=>p.variants.some(v=>v.availability==='active'&&v.size));
const choices=products.flatMap(p=>p.variants.filter(v=>v.availability==='active'&&v.size).slice(0,1).map(v=>({productId:p.id,variantId:v.id,qty:2}))).slice(0,3);
const pages=['index','shop','product','cart','designs','catalog','custom','shipping','returns','contact','order-help','master','pricing','layout','ai-designer','admin'];
const viewports=[[320,568],[390,844],[844,390],[768,1024],[1024,768],[1280,720],[1920,1080]];
const browser=await chromium.launch(),page=await browser.newPage(),errors=[],failures=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin);await page.evaluate(items=>localStorage.setItem('midnightCartV2',JSON.stringify(items)),choices);
async function inspect(label){
 const issues=await page.evaluate(()=>{
  const small=[...document.querySelectorAll('button,select,input:not([type=checkbox]):not([type=radio]),summary,.btn,nav[aria-label="Main navigation"] a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>e.id||e.className||e.tagName);
  return{width:innerWidth,scroll:document.documentElement.scrollWidth,small};
 });
 if(issues.scroll>issues.width+1||issues.small.length)failures.push({label,...issues});
}
for(const [width,height] of viewports){
 await page.setViewportSize({width,height});
 for(const id of pages){
  await page.goto(origin+id+'.html'+(id==='product'?'?id='+product.id:''),{waitUntil:'domcontentloaded'});
  if(id==='product')await page.waitForSelector('#variant:not([disabled])');
  if(id==='cart')await page.waitForSelector('.item');
  if(id==='shop')await page.waitForSelector('.product-card');
  if(id==='custom'){await page.waitForSelector('#itemSelect option',{state:'attached'});if([390,844,1024].includes(width)){await page.locator('#galleryArtwork').selectOption('blood-moon-reaper');await page.waitForSelector('#selectedArtwork img');await page.locator('#conceptCanvas').scrollIntoViewIfNeeded();const b=await page.locator('#conceptCanvas').boundingBox();const before=await page.locator('#artX').inputValue();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.55);await page.mouse.up();assert.notEqual(await page.locator('#artX').inputValue(),before,'Studio drag works at '+width+'x'+height);}}
  if(id==='layout')await page.waitForSelector('.page-card');
  await page.waitForTimeout(120);
  await inspect(id+' '+width+'x'+height);
  const menu=page.locator('.support-menu');if(await menu.count()){await menu.locator('summary').click();await inspect(id+' help '+width+'x'+height);for(const a of await menu.locator('nav a').all())assert.ok((await a.boundingBox()).height>=44);await menu.locator('summary').click();}
  if(id==='contact'){await page.locator('#supportEmail').fill('customer@example.test');await page.locator('#supportMessage').fill('Responsive design request');await page.locator('#supportForm button').click();await page.waitForSelector('#messagePreview:visible');await inspect('prepared contact '+width+'x'+height);}
  if(id==='cart'){assert.equal(await page.locator('.item').count(),3);assert.equal(await page.locator('button',{hasText:'Checkout coming soon'}).isDisabled(),true);}
  if(['cart','custom','shop'].includes(id)&&[390,844,1024,1920].includes(width))await page.screenshot({path:'qa-responsive-'+id+'-'+width+'x'+height+'.png',fullPage:true});
 }
 console.log('Checked '+pages.length+' pages at '+width+'x'+height);
}
const photos=JSON.parse(fs.readFileSync('product-photos.json')).products;
const withPhotos=products.find(p=>photos[p.id]?.originalImage===p.image);
for(const [width,height]of [[390,844],[844,390],[1024,768]]){
 await page.setViewportSize({width,height});
 await page.goto(origin+'product.html?id='+withPhotos.id);await page.waitForSelector('.photo-enlarge');await page.locator('.photo-enlarge').click();await page.waitForSelector('dialog[open]');await inspect('photo dialog '+width+'x'+height);const bounds=await page.locator('dialog[open]').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.ok(bounds.height<=height);await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 await page.goto(origin+'designs.html');await page.waitForSelector('.art-card');await page.locator('.art-card').first().click();await page.waitForSelector('dialog[open]');await inspect('design dialog '+width+'x'+height);await page.keyboard.press('Escape');
 await page.goto(origin+'layout.html');await page.waitForSelector('.page-card');await page.getByRole('button',{name:'Open options for Store',exact:true}).click();await page.waitForSelector('#pageActions[open]');await inspect('layout dialog '+width+'x'+height);await page.locator('#actionDetails').click();await page.waitForSelector('#inspectorBody details');await inspect('layout inspector '+width+'x'+height);
}
fs.writeFileSync('qa-responsive-report.json',JSON.stringify({viewports,pages,failures,errors},null,2));
await browser.close();assert.deepEqual(failures,[],'Responsive geometry and touch controls');assert.deepEqual(errors,[],'Browser exceptions');
console.log('PASS: portrait/landscape phones and tablets, laptop/desktop, populated cart, contact form, help menus, photo/design/layout dialogs and owner-source layouts. Owner pages stay excluded from public deployment.');
