import {chromium} from 'playwright';import assert from 'node:assert/strict';import {scryptSync,randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import {createService} from './server.mjs';
const origin='http://localhost:3034',salt='cd'.repeat(16),password='analytics-browser-fixture',passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');const {server}=createService({dbPath:':memory:',origin,passwordHash,secure:false});await new Promise(r=>server.listen(3034,r));const browser=await chromium.launch(),page=await browser.newPage();
try{const designs=JSON.parse(readFileSync(new URL('./design-catalog.json',import.meta.url))).filter(d=>d.kind!=='reference'),products=JSON.parse(readFileSync(new URL('./product-catalog.json',import.meta.url))),designId=designs[0].id,productId=products[0].id;await page.goto(origin+'/analytics.html');assert.equal(new URL(page.url()).pathname,'/login');assert.equal(new URL(page.url()).search,'?next=analytics');await page.locator('#loginPassword').fill('incorrect-statistics-password');await page.locator('#loginSubmit').click();await page.getByText('Sign-in failed.',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/login');await page.locator('#loginPassword').fill(password);await page.locator('#loginSubmit').click();await page.waitForURL(origin+'/analytics.html');await page.getByText('No activity in this date range',{exact:true}).waitFor();
 await page.route('**/api/owner/store-statistics?*', route => route.fulfill({
   status: 200, json: {traffic: {}, sales: {}, shopping: {}}
 }));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 assert.match(await page.locator('#storeStatsStatus').textContent(),/last successful report/);
 assert.equal(await page.locator('#storeStatsEmpty').isVisible(),false);
 await page.unroute('**/api/owner/store-statistics?*');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Yesterday',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();
 const yesterday = (await page.locator('#storeScope').textContent()).match(/^\d{4}-\d{2}-\d{2}/)[0];
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 await page.getByLabel('Start date',{exact:true}).fill(yesterday);
 await page.getByLabel('End date',{exact:true}).fill(yesterday);
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();
 assert.match(await page.locator('#storeScope').textContent(),new RegExp(yesterday+' to '+yesterday+' · Mountain Time'));
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();
 await page.locator('#storeTrend .stats-chart[aria-label*="by hour"]').first().waitFor({state:'attached'});
 await page.getByLabel('Group by',{exact:true}).selectOption('day');
 await page.locator('#storeTrend .stats-chart[aria-label*="by day"]').first().waitFor({state:'attached'});
 await page.getByLabel('Compare',{exact:true}).selectOption('year');
 await page.getByText('Traffic comparison is outside the retained browsing history.',{exact:true}).waitFor({state:'attached'});
 await page.getByLabel('Compare',{exact:true}).selectOption('off');
 await page.waitForFunction(()=>document.querySelectorAll('#storeTrend .stats-trend-series').length===1);
 await page.getByRole('button',{name:'Yesterday',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();
 assert.equal(await page.locator('#storeTrend .stats-trend-series').count(),1);
 assert.match(await page.locator('#storeTrend .stats-chart').getAttribute('aria-label'),/by day/);
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.getByText('No activity in this date range',{exact:true}).waitFor();


 await page.locator('#linkedDesign option').first().waitFor({state:'attached'});await page.locator('#artwork-report > summary').click();await page.locator('#linkedProduct').selectOption(productId);await page.locator('#linkedDesign').selectOption(designId);await page.getByRole('button',{name:'Add association',exact:true}).click();await page.getByText('Association saved for future product events.',{exact:true}).waitFor();
 const visitorId=randomUUID();for(const type of ['view','like','cart']){const r=await page.request.post(origin+'/api/design-events',{headers:{Origin:'https://midnight-designs.store'},data:{eventId:randomUUID(),visitorId,type,device:'phone',...(type==='cart'?{productId}:{designId})}});assert.equal(r.status(),200);}await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.getElementById('analyticsCoverage').textContent.startsWith('3 consented events'));assert.equal(await page.locator('#analyticsFunnel strong').allTextContents().then(x=>x.join('|')),'1|1|1|Not connected');await page.locator('#funnelDesign').selectOption(designId);assert.equal(await page.locator('#perDesignFunnel strong').count(),4);for(const [width,height]of [[320,700],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#analyticsFunnel').scrollIntoViewIfNeeded();await page.screenshot({path:'qa-design-analytics-'+width+'.png'});}await page.locator('#analyticsDevice').selectOption('desktop');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.getElementById('analyticsCoverage').textContent.startsWith('0 consented events'));assert.equal(await page.locator('#analyticsFunnel strong').first().textContent(),'0');await page.getByRole('button',{name:'Remove association',exact:true}).click();await page.getByText('No confirmed associations yet.',{exact:false}).waitFor();await page.context().clearCookies();await page.getByRole('button',{name:'Apply filters',exact:true}).click();const signIn=page.getByRole('link',{name:'Sign in again',exact:true});await signIn.waitFor();assert.equal(await page.locator('#storeReport').isVisible(),false);assert.equal((await page.request.get(origin+'/api/owner/store-statistics')).status(),401);await signIn.click();await page.waitForURL(origin+'/login?next=analytics');await page.locator('#loginPassword').fill(password);await page.locator('#loginSubmit').click();await page.waitForURL(origin+'/analytics.html');await page.getByText('Verified saved records',{exact:false}).waitFor();console.log('PASS statistics login round trip, rejected password, expired session recovery, private analytics access, associations, strict funnel, screen filters, honest purchase gap and six screen sizes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
