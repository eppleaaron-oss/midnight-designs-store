import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {createService} from './server.mjs';

const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const origin='http://localhost:3042',password='storage-browser-local-fixture',salt='de'.repeat(16),{server}=createService({dbPath:':memory:',origin,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),secure:false,factorySettings:{token:null},blueprintSettings:{token:null},publishingSettings:{token:null,githubToken:null},ideaSettings:{env:{},catalog:[]}});
await new Promise(r=>server.listen(3042,r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_PATH?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']:[]}),page=await browser.newPage();
let state={configured:true,repository:'owner/private-factory-data',running:false,initialized:false,lastSaved:null,commit:null,bytes:0,unsavedChanges:true,error:'',retryAt:null,conflict:false,intervalSeconds:300,liveQueueStorage:false};const posted=[];
try{
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+'/api/owner/ai-factory/storage')).status(),401);assert.equal((await anonymous.request.get(origin+'/factory-storage.js')).status(),401);await anonymous.close();
 assert.equal((await page.request.post(origin+'/api/owner/login',{headers:{Origin:origin},data:{password}})).status(),200);
 await page.route(origin+'/api/owner/ai-factory/storage**',async route=>{const r=route.request();if(r.method()==='POST'){posted.push(r.postDataJSON());state={...state,running:true};}await route.fulfill({status:r.method()==='POST'?202:200,json:state});});
 await page.clock.install();await page.goto(origin+'/ai-factory');await page.getByText('No completed Factory backup exists yet.',{exact:true}).waitFor();assert.equal(await page.locator('#backupNow').textContent(),'Save first backup');page.once('dialog',dialog=>dialog.accept());await page.locator('#backupNow').click();await page.getByText('Uploading encrypted backup. Waiting for GitHub confirmation…',{exact:true}).waitFor();assert.deepEqual(posted,[{initialize:true}]);assert.equal(await page.locator('#backupNow').isDisabled(),true);assert.equal(await page.locator('#backupStatus').textContent().then(t=>t.includes('Last saved')),false);
 state={...state,running:false,initialized:true,lastSaved:'2026-10-15T21:00:00Z',commit:'a'.repeat(40),bytes:2097152,unsavedChanges:false};await page.clock.runFor(15000);await page.getByText('No unsaved database changes detected.',{exact:false}).waitFor();assert.equal(await page.locator('#backupNow').textContent(),'Save backup now');assert.match(await page.locator('#backupDetails').textContent(),/aaaaaaaaaaaa/);
 for(const [width,height]of [[320,700],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);}
 state={...state,error:'GitHub changed during backup. The existing snapshot was preserved; owner review is required.',conflict:true};await page.clock.runFor(15000);await page.getByText(state.error,{exact:true}).waitFor();assert.equal(await page.locator('#backupNow').isDisabled(),true);
 console.log('PASS private backup controls, explicit initialization, pending/confirmed/conflict states and six screen sizes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
