import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs';
const excluded=fs.readFileSync('_config.yml','utf8').split('\n').filter(l=>l.startsWith('  - ')).map(l=>l.slice(4));
for(const path of excluded)assert.equal(fs.existsSync('_site/'+path),false,'Excluded asset leaked: '+path);
for(const file of ['ai-design','pricing','manage-catalog']){const text=fs.readFileSync('.github/workflows/'+file+'.yml','utf8');assert.ok(text.includes("if: github.ref == 'refs/heads/main' && github.actor == github.repository_owner"));assert.ok(text.includes('workflow_dispatch:'));assert.ok(!text.includes('pull_request_target:'));}
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const root='http://localhost:8001';
for(const path of ['master.html','pricing.html','layout.html','ai-designer.html','master.js','pricing.js','ai-designer.js','ai-preview-config.json','order-email-templates.json','assets/layout-preview/master.png','docs/admin-access.md','scripts/ai-design.mjs']){const r=await page.request.get(root+'/'+path);assert.equal(r.status(),404,'Direct access allowed: '+path);}
for(const path of ['index.html','shop.html','designs.html','custom.html','catalog.html','product.html?id=476651184','cart.html','shipping.html','returns.html','contact.html','order-help.html']){
 await page.goto(root+'/'+path);const nav=page.locator('nav[aria-label="Main navigation"]');assert.deepEqual(await nav.locator('a').allTextContents(),['Store','Designs','Create yours']);
 assert.equal(await page.locator('a[href*="master.html"],a[href*="pricing.html"],a[href*="layout.html"],a[href*="ai-designer.html"]').count(),0,path+' owner link');
 assert.equal(await page.locator('script[src*="ai-designer"],script[src*="master.js"],script[src*="pricing.js"]').count(),0);
 if(path==='shop.html'){await page.waitForSelector('.product-card');assert.equal(await page.locator('.product-card').count(),21);}
 if(path==='custom.html'){await page.waitForSelector('#itemSelect option',{state:'attached'});assert.ok(await page.locator('#itemSelect option').count()>0);assert.equal(await page.locator('#artUpload').count(),1);assert.ok(await page.locator('canvas').count()>0);assert.equal(await page.locator('#createAiPreview').count(),0);}
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path);await page.setViewportSize({width:1440,height:1000});
}
await page.goto(root+'/admin.html');assert.equal(await page.locator('input[type=password],form').count(),0);assert.ok((await page.locator('main').innerText()).includes('not published'));assert.equal(await page.getByRole('link',{name:'Open GitHub owner controls',exact:false}).getAttribute('href'),'https://github.com/eppleaaron-oss/midnight-designs-store/actions');await page.screenshot({path:'qa-admin-access.png'});
await page.goto(root+'/404.html');assert.ok((await page.locator('h1').innerText()).toLowerCase().includes('page unavailable'));await page.goto(root+'/index.html');await page.screenshot({path:'qa-public-navigation.png'});assert.deepEqual(errors,[]);await browser.close();console.log('Built deployment: owner pages/assets absent and 404, owner-only workflows, customer navigation, products, manual custom studio and responsive public pages passed.');
