import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {createService} from './server.mjs';

const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const origin='http://localhost:3046',salt='af'.repeat(16),products=[{id:328,title:'All-Over Print Unisex T-Shirt',type_name:'T-Shirt',type:'CUT-SEW',currency:'USD'},{id:390,title:'All-Over Print Unisex Bomber Jacket',type_name:'Jacket',type:'CUT-SEW',currency:'USD'}];
const response=result=>new Response(JSON.stringify({result}));
const fetchImpl=async url=>{
 url=String(url);if(url.endsWith('/products'))return response(products);
 if(url.includes('/v2/catalog-products/'))return new Response(JSON.stringify({data:{type:'CUT-SEW',techniques:[{key:'cut-sew',is_default:true}]}}));
 if(/\/products\/\d+$/.test(url))return response({product:products.find(p=>url.endsWith('/'+p.id)),variants:[{id:3280,size:'S',color:'White',price:'15.00',in_stock:true},{id:3281,size:'M',color:'White',price:'16.00',in_stock:true}]});
 if(url.includes('/printfiles/'))return response({available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:12,height:8,dpi:150}],variant_printfiles:[3280,3281].map(id=>({variant_id:id,placements:{front:1,back:1}})),option_groups:["Men's",'Flat']});
 if(url.includes('/templates/'))return response({templates:[],variant_mapping:[]});throw Error('Unexpected browser fixture request: '+url);
};
const service=createService({dbPath:':memory:',origin,passwordHash:salt+':'+scryptSync('basic-browser-fixture',salt,64).toString('hex'),secure:false,factoryLoginRequired:false,factorySettings:{token:'fixture',fetchImpl},blueprintSettings:{token:'fixture',fetchImpl,plans:{products:{}}},publishingSettings:{token:'fixture',githubToken:null},ideaSettings:{env:{},catalog:[]}});
await new Promise(r=>service.server.listen(3046,r));
const art=await sharp({create:{width:120,height:140,channels:4,background:'#2c3330'}}).composite([{input:Buffer.from('<svg width="120" height="140"><path d="M60 16 96 104 24 104Z" fill="none" stroke="#c4dda0" stroke-width="3"/><circle cx="60" cy="72" r="17" fill="none" stroke="#e4dfd0" stroke-width="2"/></svg>')}]).png().toBuffer();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_PATH?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']:[]}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const uploaded=await page.request.post(origin+'/api/owner/ai-factory/artwork/upload',{headers:{Origin:origin},data:{name:'Cathedral front',collection:'Cathedral test set',scope:'collection',target:'',product:null,placements:['front'],instructions:'Preserve artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'front.png',base64:art.toString('base64')}]}});assert.equal(uploaded.status(),200);const id=(await uploaded.json()).artworks[0].id;
 service.db.prepare('INSERT INTO idea_sets(id,source,name,product,parts,jacket,updated) VALUES(?,?,?,?,?,?,?)').run('pf:browser','printful','Cathedral','Cathedral Bomber Jacket',JSON.stringify({front:{artwork:id,name:'Cathedral front',url:'/api/owner/ai-factory/artwork/'+id+'/file',thumb:'/api/owner/ai-factory/artwork/'+id+'/file'}}),1,new Date().toISOString());
 const response=await page.goto(origin+'/ai-factory/basic');assert.equal(response.status(),200);await page.getByRole('heading',{name:'Keep it basic.'}).waitFor();await page.getByRole('button',{name:/Cathedral From/}).click();await page.locator('#garment').selectOption('328');await page.getByRole('button',{name:'Check garment & template',exact:true}).click();await page.getByText('Black fill only: back.',{exact:true}).waitFor();
 assert.equal(await page.locator('#create').isDisabled(),true,'real missing storage/worker keeps production held');assert.equal(await page.locator('#garmentDetails input:checked').count(),2);assert.equal(await page.locator('#loginEmail,#loginPassword,#logout,#factoryLogout').count(),0);
 for(const [width,height]of [[320,700],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No Basic horizontal overflow at '+width);}
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/midnight-basic-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/midnight-basic-phone.png',fullPage:true});
 await page.locator('#setSearch').fill('no matching set');assert.equal(await page.locator('#sets .design-card').count(),0);await page.getByText('No sets match this search.',{exact:true}).waitFor();
 await page.goto(origin+'/ai-factory');await page.getByRole('link',{name:'Basic',exact:true}).click();await page.getByRole('heading',{name:'Keep it basic.'}).waitFor();assert.ok(page.url().endsWith('/ai-factory/basic'));
 assert.equal((await page.request.get(origin+'/api/requests')).status(),401);assert.deepEqual(errors,[]);console.log('PASS Basic navigation, real supplier template selection, fixed black recipe, truthful blockers, no login, customer isolation and six screen sizes');
}finally{await browser.close();await new Promise(r=>service.server.close(r));}
