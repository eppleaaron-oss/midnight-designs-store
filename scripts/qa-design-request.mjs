import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch(),page=await browser.newPage(),errors=[],posts=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
for(const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){
 await page.setViewportSize({width,height});await page.goto('http://localhost:8000/request-design.html');
 await page.locator('#garment').selectOption('Hoodie');await page.locator('#style').selectOption('Gothic');
 for(const [id,value] of [['idea','Original raven under a red moon'],['colors','Bone white and red'],['name','Test customer'],['email','customer@example.test'],['budget','150'],['designText','AFTER HOURS'],['deadline','2026-11-30']])await page.locator('#'+id).fill(value);
 await page.getByRole('button',{name:'Review design request',exact:true}).click();assert.match(await page.locator('#requestStatus').innerText(),/at least one/);
 await page.locator('input[name=placement][value=Back]').check();await page.locator('input[name=placement][value="Left sleeve"]').check();
 await page.locator('#references').setInputFiles({name:'raven.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=','base64')});
 assert.equal(await page.locator('#referencePreviews img').count(),1);
 await page.getByRole('button',{name:'Review design request',exact:true}).click();
 const brief=await page.locator('#requestBrief').inputValue();for(const text of ['Hoodie','Gothic','Back, Left sleeve','150','2026-11-30','AFTER HOURS','raven.png'])assert.ok(brief.includes(text));
 const href=await page.locator('#sendRequest').getAttribute('href');assert.ok(href.startsWith('mailto:midnightdesign107@gmail.com?'));
 assert.ok(decodeURIComponent(href).includes('Original raven'));
 assert.match(await page.locator('#sendInstructions').innerText(),/Nothing has been sent/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#downloadBrief').click();assert.equal((await downloadPromise).suggestedFilename(),'midnight-design-request.txt');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'qa-request-review-'+width+'.png'});
 await page.locator('#editRequest').click();assert.equal(await page.locator('#requestReview').isVisible(),false);
 await page.locator('#clearReferences').click();assert.equal(await page.locator('#referencePreviews img').count(),0);
 await page.locator('#references').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.match(await page.locator('#referenceStatus').innerText(),/Choose up to 5/);
 await page.screenshot({path:'qa-request-form-'+width+'.png',fullPage:true});
}
assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);await browser.close();console.log('PASS: request fields, placements, reference validation, complete email brief, download, edit and six responsive sizes. No server submission claimed.');
