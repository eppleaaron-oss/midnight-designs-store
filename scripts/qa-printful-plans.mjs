import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const plans=JSON.parse(fs.readFileSync('printful-plans.json','utf8'));
assert.ok(Object.keys(plans.products).length>0);
for(const p of Object.values(plans.products)){for(const f of p.printfiles.printfiles){assert.ok(f.width>0&&f.height>0&&f.dpi>0);}assert.ok(p.variants.length);}
const b=await chromium.launch({headless:true}),page=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8000/custom.html');await page.getByLabel('Printful size / variant',{exact:true}).locator('option').first().waitFor({state:'attached',timeout:15000});
const panel=page.locator('#printfulPlanStudio');await panel.getByLabel('Artwork picture',{exact:true}).selectOption({index:1});await page.waitForFunction(()=>window.midnightPrintfulPlan?.artwork?.width>0);
const first=await page.evaluate(()=>window.midnightPrintfulPlan);assert.ok(first.catalogVariantId&&first.printfile.width&&first.printfile.height&&first.printfile.dpi);assert.ok(first.artwork.dataURL.startsWith('data:image/png'));assert.equal(first.productionReady,false);
const areas=panel.getByLabel('Printful print area',{exact:true});if(await areas.locator('option').count()>1){const selected=await areas.inputValue();await areas.selectOption({index:1});await page.waitForFunction(()=>!window.midnightPrintfulPlan?.artwork);await areas.selectOption(selected);await page.waitForFunction(()=>window.midnightPrintfulPlan?.artwork?.width>0);}
const dl=page.waitForEvent('download');await panel.getByRole('button',{name:'Download this print-area PNG',exact:true}).click();const file=await dl;const path=await file.path();const png=fs.readFileSync(path);assert.equal(png.readUInt32BE(16),first.printfile.width);assert.equal(png.readUInt32BE(20),first.printfile.height);
for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'qa-printful-plans-'+width+'.png'});}
assert.deepEqual(errors,[]);await b.close();console.log('Verified Printful plan dimensions, artwork isolation, PNG export and mobile layout.');
