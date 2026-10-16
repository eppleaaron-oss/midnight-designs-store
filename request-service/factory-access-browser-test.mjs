import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {createService} from './server.mjs';

const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const origin='http://localhost:3045',salt='ed'.repeat(16),{server}=createService({dbPath:':memory:',origin,passwordHash:salt+':'+scryptSync('access-browser-fixture',salt,64).toString('hex'),secure:false,factoryLoginRequired:false,factorySettings:{token:null},blueprintSettings:{token:null},publishingSettings:{token:null,githubToken:null},ideaSettings:{env:{},catalog:[]}});await new Promise(r=>server.listen(3045,r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_PATH?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']:[]}),page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
try{
 for(const path of ['/ai-factory','/ai-factory/basic','/ai-factory/tools','/ai-artwork','/ai-intelligence','/ai-history','/ai-employees']){const r=await page.goto(origin+path);assert.equal(r.status(),200);await page.waitForFunction(()=>document.body.dataset.factoryPublic==='true'&&!document.querySelector('#logout,#factoryLogout'));assert.equal(page.url(),origin+path);assert.equal(await page.locator('#loginEmail,#loginPassword').count(),0);}
 assert.equal((await page.request.get(origin+'/api/requests')).status(),401);assert.equal((await page.context().cookies()).some(c=>c.name==='midnight_session'),false);
 await page.goto(origin+'/login?next=ai-factory');await page.getByRole('heading',{name:'AI Factory',exact:true,level:1}).waitFor();assert.equal(page.url(),origin+'/ai-factory');
 for(const [width,height]of [[320,700],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);}
 await page.route(origin+'/api/owner/ai-factory/runs',route=>route.fulfill({status:401,json:{error:'Supplier credentials were rejected.'}}));await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Supplier credentials were rejected.'));assert.equal(page.url(),origin+'/ai-factory','Supplier errors do not cause a login loop');assert.equal(await page.locator('#loginPassword').count(),0);
 assert.deepEqual(pageErrors,[],'Factory pages have no uncaught browser errors');
 console.log('PASS no-login Factory pages and controls, no owner cookie, customer isolation, supplier-error display and six screen sizes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
