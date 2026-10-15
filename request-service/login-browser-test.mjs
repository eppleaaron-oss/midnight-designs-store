import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {createService} from './server.mjs';

const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const salt='ef'.repeat(16),password='login-fixture',origin='http://localhost:3037';
const {server}=createService({dbPath:':memory:',origin,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),secure:false,factorySettings:{token:null},blueprintSettings:{token:null},publishingSettings:{token:null,githubToken:null},ideaSettings:{env:{},catalog:[]}});
await new Promise(r=>server.listen(3037,r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_PATH?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']:[]}),page=await browser.newPage(),submissions=[];
page.on('request',r=>{if(r.url()===origin+'/api/owner/login'&&r.method()==='POST')submissions.push(r.postDataJSON());});
try{
 await page.goto('http://127.0.0.1:8000/index.html');
 await page.locator('.support-menu summary').click();
 await page.locator('.support-menu').getByRole('link',{name:'Login',exact:true}).click();
 await page.getByText('Sign-in is not available yet.',{exact:false}).waitFor();
 assert.equal(await page.locator('#signIn').isVisible(),false);
 assert.equal(await page.locator('body').textContent().then(t=>/master|midnightdesign107/i.test(t)),false);
 await page.goto(origin+'/ai-factory');
 await page.waitForURL(origin+'/login?next=ai-factory');
 assert.equal(await page.locator('input[type=email],#loginEmail').count(),0,'Factory login does not ask for an email');
 assert.equal(await page.locator('#loginPassword').getAttribute('autocomplete'),'current-password');
 await page.locator('#loginPassword').fill('incorrect-password');
 await page.locator('#loginSubmit').click();
 await page.getByText('Sign-in failed.',{exact:true}).waitFor();
 assert.equal(await page.locator('#loginPassword').inputValue(),'');
 for(const [width,height]of [[320,700],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){
  await page.setViewportSize({width,height});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.locator('#loginPassword').fill(password);
 await page.locator('#loginSubmit').click();
 await page.waitForURL(origin+'/ai-factory');
 await page.getByRole('heading',{name:'AI Factory',exact:true,level:1}).waitFor();
 assert.deepEqual(submissions,[{password:'incorrect-password'},{password}],'Only the password is submitted');
 const anonymous=await browser.newContext();
 assert.equal((await anonymous.request.get(origin+'/api/owner/ai-factory/layouts')).status(),401);
 await anonymous.close();
 console.log('PASS password-only Factory login, rejected password, authenticated redirect, owner-only access and six screen sizes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
