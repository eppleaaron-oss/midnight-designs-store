import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {createService} from './server.mjs';
import {FACTORY_PAGES,factoryAuthFor,factoryLoginIsRequired} from './factory-access.mjs';

const origin='http://127.0.0.1:3044',password='factory-access-fixture',salt='cd'.repeat(16),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
async function service(t,loginRequired){const c=createService({dbPath:':memory:',origin,passwordHash,secure:false,factoryLoginRequired:loginRequired,factorySettings:{token:null},blueprintSettings:{token:null},publishingSettings:{token:null,githubToken:null},ideaSettings:{env:{},catalog:[]}});await new Promise(r=>c.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>c.server.close(r)));const base='http://127.0.0.1:'+c.server.address().port;const call=(path,data,headers={})=>fetch(base+path,{method:data?'POST':'GET',redirect:'manual',headers:{...(data?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});return {...c,call};}

test('Factory pages, assets and ordinary controls open without a login, email, password or owner cookie',async t=>{
 const c=await service(t,false);
 for(const path of FACTORY_PAGES){const r=await c.call(path);assert.equal(r.status,200,path);assert.equal(r.headers.get('set-cookie'),null);const html=await r.text();assert.match(html,/data-factory-public="true"/);assert.match(html,/factory-access\.js/);assert.equal(/id="login(Email|Password)"/.test(html),false);}
 for(const path of ['/factory.js','/factory-access.js','/factory-storage.js','/factory-artwork-editor.js'])assert.equal((await c.call(path)).status,200,path);
 for(const path of ['jobs','layouts','artwork','production','publishing','pricing','employees','history','intelligence','ideas','runs','editor','storage'])assert.equal((await c.call('/api/owner/ai-factory/'+path)).status,200,path);
 const start=await c.call('/api/owner/ai-factory/control',{action:'start'});assert.equal(start.status,409,'Missing production prerequisites still hold the factory');const stop=await c.call('/api/owner/ai-factory/control',{action:'stop'});assert.equal(stop.status,200);assert.equal((await stop.json()).settings.state,'stopped');assert.equal(c.db.prepare('SELECT count(*) n FROM sessions').get().n,0,'Factory access does not create a master session');
});
test('anonymous Factory artwork uploads and file downloads work and history identifies access without sign-in',async t=>{
 const c=await service(t,false),png=await sharp({create:{width:32,height:32,channels:4,background:'#222222'}}).png().toBuffer(),upload=await c.call('/api/owner/ai-factory/artwork/upload',{name:'Raven',collection:'Night',scope:'collection',target:'',product:null,placements:['front'],instructions:'Keep original artwork',permissions:{reuse:true,recolor:false,crop:false,modify:false},files:[{filename:'raven.png',base64:png.toString('base64')}]});assert.equal(upload.status,200);const artwork=(await upload.json()).artworks[0],file=await c.call(artwork.url);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);const row=c.db.prepare('SELECT actor FROM factory_history_events ORDER BY seq DESC LIMIT 1').get();assert.equal(JSON.parse(row.actor).type,'public_factory');assert.equal(c.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});
test('opening the Factory leaves customer requests, exports, analytics and the separate master login protected',async t=>{
 const c=await service(t,false);await c.call('/api/owner/ai-factory/jobs');for(const path of ['/api/requests','/api/owner/export','/api/owner/ai-factory/../export'])assert.equal((await c.call(path)).status,401,path);assert.equal((await c.call('/analytics.html')).status,302);
 const master=await c.call('/login');assert.equal(master.status,200);assert.match(await master.text(),/id="loginPassword"/);const logged=await c.call('/api/owner/login',{password});assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];assert.equal((await c.call('/api/requests',undefined,{Cookie:cookie})).status,200);
 assert.equal((await c.call('/api/owner/ai-factory/control',{action:'pause'},{Origin:'https://unrelated.test'})).status,403,'Request validation remains active');assert.equal((await c.call('/api/owner/ai-factory/control',{action:'invented-action'})).status,400);
});
test('Factory-specific login URLs skip the form while default private mode still requires sign-in',async t=>{
 const open=await service(t,false);for(const next of ['ai-factory','ai-artwork','ai-intelligence','ai-history','ai-employees']){const r=await open.call('/login?next='+next);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/'+next);}assert.equal((await open.call('/login?next=https://unrelated.test')).status,200);
 const closed=await service(t,undefined);assert.equal((await closed.call('/ai-factory')).status,302);assert.equal((await closed.call('/factory-access.js')).status,401);assert.equal((await closed.call('/api/owner/ai-factory/jobs?FACTORY_LOGIN_REQUIRED=false')).status,401);assert.equal((await closed.call('/login?next=ai-factory')).status,200);
});
test('public Factory authorization is scoped to its exact API namespace and login configuration is explicit',()=>{
 let checks=0;const auth=factoryAuthFor({loginRequired:false,origin,auth(){checks++;return 'normal authorization';}});assert.equal(auth({url:'/api/owner/ai-factory/jobs'},null,true).factoryPublic,true);for(const url of ['/api/owner/ai-factory-elsewhere','/api/owner/export','/internal/factory/claim','/api/requests'])assert.equal(auth({url},null,true),'normal authorization');assert.equal(checks,4);assert.equal(factoryLoginIsRequired(),true);assert.equal(factoryLoginIsRequired('true'),true);assert.equal(factoryLoginIsRequired('false'),true,'Production cannot make owner tools public through the legacy environment flag');assert.throws(()=>factoryLoginIsRequired('0'));
});

test('AI Made has its own protected page and preserves its destination after login',async t=>{
 const c=await service(t,true);const r=await c.call('/ai-made');assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/login?next=ai-made');
 for(const path of ['/ai-made.js','/ai-made.css'])assert.equal((await c.call(path)).status,401);
 const logged=await c.call('/api/owner/login',{password}),cookie=logged.headers.get('set-cookie').split(';')[0];
 const gallery=await c.call('/ai-made',undefined,{Cookie:cookie});assert.equal(gallery.status,200);assert.match(await gallery.text(),/id="productGallery"/);
 for(const path of ['/ai-made.js','/ai-made.css'])assert.equal((await c.call(path,undefined,{Cookie:cookie})).status,200);
 const dashboard=await c.call('/ai-factory',undefined,{Cookie:cookie}),html=await dashboard.text();assert.match(html,/href="\/ai-made"/);assert.doesNotMatch(html,/id="madeGrid"/);
});

 test('AI Made saved-product feed does not wait for a supplier scan and follows factory authorization',async t=>{
 const closed=await service(t,true);assert.equal((await closed.call('/api/owner/ai-factory/ideas/made')).status,401);
 const open=await service(t,false),r=await open.call('/api/owner/ai-factory/ideas/made');assert.equal(r.status,200);assert.deepEqual(await r.json(),{made:[]});
});

test('the product editor and all imported modules are served with the same Factory access policy',async t=>{
 const open=await service(t,false),html=await (await open.call('/product-studio')).text();for(const id of ['width','x','y']){const input=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(input,id+' input exists');assert.match(input,/step="0\.01"/,id+' accepts hundredths of an inch');}assert.match(html,/<p id="actionStatus"[^>]*role="status"/,'Save and Finish results stay beside the action buttons');const script=await open.call('/product-studio.js');assert.equal(script.status,200);const source=await script.text(),imports=[...source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map(m=>'/'+m[1]);assert.ok(imports.includes('/product-studio-state.js'));assert.match(source,/status.textContent=t/,'Action results update the inline status as well as the page header');
 for(const path of imports){const r=await open.call(path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/javascript/);assert.ok((await r.text()).length>100,path);}
 const closed=await service(t,true);for(const path of ['/product-studio.js',...imports])assert.equal((await closed.call(path)).status,401,path+' remains protected on private installations');
});

test('AI Made serves its photo helper before the gallery in one protected script and bundles its styles',async t=>{
 const c=await service(t,false),html=await(await c.call('/ai-made')).text();assert.match(html,/<script src="\/ai-made.js" defer>/);assert.doesNotMatch(html,/<script src="\/(ai-made-data|factory-mockup-view).js"/);
 const js=await(await c.call('/ai-made.js')).text();assert.ok(js.indexOf('window.MidnightMadeMedia=')>=0);assert.ok(js.indexOf('window.MidnightMadeMedia=')<js.indexOf("api('product-editor/library')"));assert.match(js,/window.mdMockups=/);
 const css=await(await c.call('/ai-made.css')).text();assert.match(css,/\.fx-header/);assert.match(css,/\.am-grid/);assert.match(css,/color-scheme:dark/);
 assert.equal((await c.call('/api/owner/ai-factory/product-editor/library')).status,200);
 const closed=await service(t,true);assert.equal((await closed.call('/ai-made.js')).status,401);assert.equal((await closed.call('/api/owner/ai-factory/product-editor/library')).status,401);
});

test('sign-in preserves the exact editor product, selected placement and variant',async t=>{
 const {ownerLoginDestination}=await import('./public/login-destination.js'),c=await service(t,true),query='source=piece%3Atest-product&placement=sleeve_right&variant=1234';
 const r=await c.call('/product-studio?'+query);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/login?next=product-studio&'+query);assert.equal(ownerLoginDestination(new URL(r.headers.get('location'),'https://app.test').search),'/product-studio?'+query);
 for(const next of ['ai-made','product-editor','ai-factory-basic','ai-intelligence'])assert.ok(ownerLoginDestination('?next='+next));
 assert.equal(ownerLoginDestination('?next=https://evil.test'),null);assert.equal(ownerLoginDestination('?next=product-studio&source=//evil.test&placement=../secret&variant=x'),'/product-studio');
 const helper=await c.call('/login-destination.js');assert.equal(helper.status,200);assert.match(helper.headers.get('content-type'),/javascript/);
});
