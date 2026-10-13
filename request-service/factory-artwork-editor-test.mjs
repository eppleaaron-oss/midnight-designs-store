import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {scryptSync,createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from './server.mjs';
import {analyzeArtwork,deterministicEdit} from './factory-image-processing.mjs';
import {checkedArtwork} from './factory-artwork-permissions.mjs';
import {factoryArtworkEditor} from './factory-artwork-editor.mjs';
import {factoryRendering,renderArea} from './factory-rendering.mjs';

const allow={reuse:true,modify:true,recolor:true,crop:true},origin='http://localhost:3000',password='editor-test-password',salt='cd'.repeat(16),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex'),workerToken='editor-worker-fixture-'.repeat(3),base='/api/owner/ai-factory/';
const defaults={enabled:false,removeBackground:false,tolerance:35,recolor:null,resize:null,protect:false,creative:null,fitSource:true};
const creative={...defaults,creative:{action:'edit',prompt:'Coordinate this raven with silver gothic artwork.',size:'1024x1024',quality:'medium',background:'transparent',references:[]}};
const env={OPENAI_API_KEY:'not-a-real-provider-key-for-tests',FACTORY_AI_IMAGE_MODEL:'gpt-image-1.5',FACTORY_AI_IMAGE_TEXT_INPUT_CENTS_PER_MILLION:'500',FACTORY_AI_IMAGE_INPUT_CENTS_PER_MILLION:'1000',FACTORY_AI_IMAGE_OUTPUT_CENTS_PER_MILLION:'4000',FACTORY_AI_IMAGE_MAX_EDIT_CENTS:'200'};
const usage={input_tokens:100,input_tokens_details:{text_tokens:40,image_tokens:60},output_tokens:100};
async function fixture(){const width=32,height=24,data=Buffer.alloc(width*height*4,255);for(let y=5;y<19;y++)for(let x=7;x<25;x++){const i=(y*width+x)*4;data[i]=200;data[i+1]=0;data[i+2]=0;}for(let y=9;y<13;y++)for(let x=12;x<16;x++){const i=(y*width+x)*4;data[i]=255;data[i+1]=255;data[i+2]=255;}return sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();}
async function transparent(){return (await deterministicEdit(await fixture(),{...defaults,removeBackground:true},allow)).data;}
async function pixels(data){return sharp(data).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
const pixel=(p,x,y)=>[...p.data.subarray((y*p.info.width+x)*4,(y*p.info.width+x)*4+4)];
const providerResponse=(data,u=usage)=>new Response(JSON.stringify({data:[{b64_json:data.toString('base64')}],...(u?{usage:u}:{})}),{headers:{'Content-Type':'application/json','x-request-id':'image-request-fixture'}});
async function setup(options={}){
 let clock=Date.now();const service=createService({dbPath:':memory:',origin,passwordHash,secure:false,productionSettings:{storageDurable:true,workerToken,clock:()=>clock},factorySettings:{token:null},artworkEngineSettings:{env:{}},editorSettings:{env:{},storageDurable:true,...options.editorSettings},...options});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,data,{machine=false,anonymous=false,from=origin}={}){const r=await fetch(root+path,{method:data?'POST':'GET',headers:{Origin:from,...(!anonymous&&cookie?{Cookie:cookie}:{}),...(machine?{Authorization:'Bearer '+workerToken}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const type=r.headers.get('content-type')||'';return {status:r.status,data:type.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 cookie=(await call('/api/owner/login',{password})).cookie;
 const machine=(op,data={})=>call('/internal/factory/'+op,{worker:'editor-fixture',...data},{machine:true});
 async function upload(collection='Night'){const png=await fixture(),r=await call(base+'artwork/upload',{name:'Raven graphic',collection,scope:'collection',target:'',product:null,placements:['front','back','left-sleeve','right-sleeve','hood'],instructions:'Preserve the subject.',permissions:allow,files:[{filename:'raven.png',base64:png.toString('base64')}]});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.artworks.find(a=>a.collection===collection&&a.kind==='original').id;}
 async function start(){await call(base+'budget',{dailyBudget:2000,totalBudget:5000});await machine('heartbeat');const r=await call(base+'control',{action:'start'});assert.equal(r.status,200,JSON.stringify(r.data));}
 async function step(job){const lease=(await machine('claim')).data;assert.equal(lease.job,job,JSON.stringify(lease));return (await machine('step',{job,lease:lease.lease})).data;}
 async function queue(artworkId,recipe){const r=await call(base+'editor/queue',{artworkId,recipe,confirmProvider:true});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.job;}
 return {...service,root,call,machine,upload,start,step,queue,advance:ms=>clock+=ms,close:async()=>{await service.artworkEditor.idle();await new Promise(resolve=>service.server.close(resolve));await Promise.resolve();}};
}

test('flat background removal preserves enclosed subject features, aspect ratio and original bytes',async()=>{
 const data=await fixture(),before=createHash('sha256').update(data).digest('hex'),analysis=await analyzeArtwork(data);assert.equal(analysis.background.color,'#ffffff');assert.equal(analysis.background.flat,true);assert.deepEqual(analysis.subject.bounds,{x:7,y:5,width:18,height:14});
 const edited=await deterministicEdit(data,{...defaults,removeBackground:true},allow),p=await pixels(edited.data);assert.deepEqual(pixel(p,0,0),[255,255,255,0]);assert.equal(pixel(p,13,10)[3],255,'enclosed white details remain');assert.equal(pixel(p,8,6)[0],200);
 const resized=await deterministicEdit(data,{...defaults,resize:{width:16,height:16}},allow),meta=await sharp(resized.data).metadata();assert.equal(meta.width,16);assert.equal(meta.height,12);const large=await deterministicEdit(data,{...defaults,resize:{width:200,height:200}},allow);assert.equal((await sharp(large.data).metadata()).width,32,'resize does not fabricate source pixels');
 const tinted=await deterministicEdit(data,{...defaults,recolor:'#0000ff'},allow),blue=pixel(await pixels(tinted.data),8,6);assert.ok(blue[2]>blue[0]);assert.equal(createHash('sha256').update(data).digest('hex'),before);
 await assert.rejects(deterministicEdit(data,{...defaults,protect:true,removeBackground:true},allow),/protection/);await assert.rejects(deterministicEdit(data,{...defaults,removeBackground:true},{...allow,modify:false}),/Modify/);await assert.rejects(deterministicEdit(data,{...defaults,recolor:'#ff0000'},{...allow,recolor:false}),/Recolor/);
 const gradient=await sharp({create:{width:32,height:24,channels:4,background:'#000000'}}).raw().toBuffer();for(let y=0;y<24;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;gradient[i]=x*8;gradient[i+1]=y*10;gradient[i+2]=x*8;}const complex=await sharp(gradient,{raw:{width:32,height:24,channels:4}}).png().toBuffer();await assert.rejects(deterministicEdit(complex,{...defaults,removeBackground:true,tolerance:10},allow),/not a reliable flat/);
});

test('private editor permissions and encrypted app provider setup survive recovery without exposing keys',async()=>{
 const c=await setup();try{
  assert.equal((await c.call(base+'editor',undefined,{anonymous:true})).status,401);assert.equal((await c.call('/factory-artwork-editor.js',undefined,{anonymous:true})).status,401);const page=await fetch(c.root+'/ai-artwork',{redirect:'manual'});assert.equal(page.status,302);
  assert.equal((await c.call(base+'editor/settings',{rules:defaults},{from:'https://wrong.example'})).status,403);
  const key='owner-provider-fixture-not-a-real-api-key';const saved=await c.call(base+'editor/provider',{config:{model:'gpt-image-1.5',text:500,image:1000,output:4000,maximum:200},apiKey:key,verifiedRates:true});assert.equal(saved.status,200);assert.equal(saved.data.provider.connected,true);assert.equal(JSON.stringify(saved.data).includes(key),false);
  const secret=c.db.prepare('SELECT secret FROM factory_editor_provider').get().secret;assert.equal(secret.includes(key),false);assert.equal(c.db.prepare("SELECT after_json FROM factory_history_events WHERE entity='factory_editor_provider' ORDER BY seq DESC LIMIT 1").get().after_json.includes(key),false);
  const art=await c.upload();const edited=await c.artworkEditor.edit('test-edit',art,{...defaults,removeBackground:true});assert.notEqual(edited.version,art);assert.equal(checkedArtwork(c.db,edited.version).original,art);c.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({...allow,reuse:false}),art);assert.equal(checkedArtwork(c.db,edited.version).effectivePermissions.reuse,false);await assert.rejects(c.artworkEditor.edit('revoked',edited.version,{...defaults,recolor:'#ffffff'}),/Reuse/);
 }finally{await c.close();}
});

test('artwork jobs use the persistent worker and finish without Printful or publishing stages',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-editor-')),dbPath=join(dir,'requests.sqlite');let c=await setup({dbPath});let art,job,version;
 try{art=await c.upload();job=await c.queue(art,{...defaults,removeBackground:true});await c.start();assert.equal((await c.step(job)).status,'queued');assert.equal((await c.step(job)).status,'queued');assert.equal((await c.step(job)).status,'completed');version=c.db.prepare('SELECT result FROM factory_editor_tasks WHERE job=?').get(job).result;
  assert.equal(c.db.prepare('SELECT count(*) n FROM factory_listings WHERE job=?').get(job).n,0);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_job_checkpoints WHERE job=?').get(job).n,3);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_usage').get().n,0);await c.close();
  c=await setup({dbPath});const next=await c.queue(art,{...defaults,removeBackground:true});await c.start();for(let i=0;i<3;i++)await c.step(next);assert.equal(c.db.prepare('SELECT result FROM factory_editor_tasks WHERE job=?').get(next).result,version,'restart reuses immutable edited pixels');assert.equal(c.db.prepare('SELECT count(*) n FROM factory_editor_versions').get().n,1);
 }finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});

test('creative image edits send permitted originals, preserve output, settle usage and reuse one result across jobs',async()=>{
 let calls=0;const output=await transparent(),c=await setup({editorSettings:{env,storageDurable:true,fetchImpl:async(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/images/edits');const b=JSON.parse(o.body);assert.match(b.prompt,/PRIMARY RULE: Midnight Designs is design-first/);assert.match(b.prompt,/Small chest graphics are thematic artwork/);assert.equal(b.model,'gpt-image-1.5');assert.equal(b.input_fidelity,'high');assert.equal(b.n,1);assert.equal(b.background,'transparent');assert.ok(b.images[0].image_url.startsWith('data:image/png;base64,'));assert.equal(b.output_format,'png');return providerResponse(output);}}});
 try{const art=await c.upload();await c.start();const first=await c.queue(art,creative);await c.step(first);await c.step(first);assert.equal((await c.step(first)).status,'retry_wait');await c.artworkEditor.idle();c.advance(31000);assert.equal((await c.step(first)).status,'completed');assert.equal(calls,1);const version=c.db.prepare('SELECT result FROM factory_editor_tasks WHERE job=?').get(first).result;assert.equal(Buffer.compare(Buffer.from(checkedArtwork(c.db,art).data),await fixture()),0);
  const next=await c.queue(art,{...creative,enabled:true});for(let i=0;i<3;i++)await c.step(next);assert.equal(calls,1,'same pixels and instructions do not repeat a paid edit');assert.equal(c.db.prepare('SELECT result FROM factory_editor_tasks WHERE job=?').get(next).result,version);assert.equal(c.db.prepare('SELECT sum(amount) n FROM factory_usage').get().n,1);assert.equal((await c.call(base+'editor/result/'+c.db.prepare('SELECT fingerprint FROM factory_editor_cache').get().fingerprint,undefined,{anonymous:true})).status,401);
 }finally{await c.close();}
});

test('an in-flight image request keeps a concurrency slot and rejects premature cost reconciliation',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>release=resolve),output=await transparent(),c=await setup({editorSettings:{env,storageDurable:true,fetchImpl:async()=>{calls++;await pending;return providerResponse(output);}}});
 try{const art=await c.upload(),first=await c.queue(art,creative);await c.queue(art,{...creative,creative:{...creative.creative,prompt:'A different collection treatment'}});await c.start();await c.step(first);await c.step(first);await c.step(first);const claim=(await c.machine('claim')).data;assert.equal(claim.job,null);assert.match(claim.reason,/Concurrency/);const effect=c.db.prepare('SELECT id FROM factory_production_effects').get().id;assert.equal((await c.call(base+'production/reconcile',{id:effect,outcome:'no_effect',verified:true})).status,409);
  c.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({...allow,modify:false}),art);release();await c.artworkEditor.idle();await assert.rejects(c.artworkEditor.edit(first,art,creative),/Modify/);assert.ok(c.db.prepare('SELECT data FROM factory_editor_cache').get().data,'charged image is retained even after permission revocation');assert.equal(calls,1);
 }finally{release();await c.close();}
});

test('missing image usage keeps output and reservation until owner reconciliation, without another paid call',async()=>{
 const output=await transparent();let calls=0;const c=await setup({editorSettings:{env,storageDurable:true,fetchImpl:async()=>{calls++;return providerResponse(output,null);}}});
 try{const art=await c.upload();await c.start();const job=await c.queue(art,creative);assert.equal((await c.artworkEditor.edit(job,art,creative)).defer,true);await c.artworkEditor.idle();await assert.rejects(c.artworkEditor.edit(job,art,creative),/usage could not be verified/);const row=c.db.prepare('SELECT * FROM factory_editor_cache').get();assert.equal(row.state,'unsettled');assert.ok(row.data);assert.equal((await c.call(base+'production/reconcile',{id:row.effect,outcome:'no_effect',verified:true})).status,409);assert.equal((await c.call(base+'production/reconcile',{id:row.effect,outcome:'confirmed',verified:true,providerId:'verified-billing-fixture',actualCost:2})).status,200);const saved=await c.artworkEditor.edit(job,art,creative);assert.ok(saved.version);assert.equal(calls,1);assert.equal(c.db.prepare('SELECT sum(amount) n FROM factory_usage').get().n,2);
 }finally{await c.close();}
});

test('uncertain provider outcomes survive restart and are never blindly repeated',async()=>{
 let calls=0;const c=await setup({editorSettings:{env,storageDurable:true,fetchImpl:async()=>{calls++;throw Error('Connection lost after submitting');}}});
 try{const art=await c.upload();await c.start();const job=await c.queue(art,creative);await c.artworkEditor.edit(job,art,creative);await c.artworkEditor.idle();await assert.rejects(c.artworkEditor.edit(job,art,creative),/Connection lost/);const recovered=factoryArtworkEditor({db:c.db,artwork:{},env,fetchImpl:async()=>{calls++;throw Error('Recovery must not call provider');},clock:Date.now});await assert.rejects(recovered.edit(job,art,creative),/Connection lost/);assert.equal(calls,1);assert.equal(c.db.prepare('SELECT status FROM factory_production_effects').get().status,'pending_confirmation');
 }finally{await c.close();}
});

test('charged invalid transparency is preserved for review and rejected requests require explicit retry',async()=>{
 let invalid=true,calls=0;const c=await setup({editorSettings:{env,storageDurable:true,fetchImpl:async()=>{calls++;return invalid?providerResponse(await fixture()):new Response('{}',{status:401});}}});
 try{const art=await c.upload();await c.start();const job=await c.queue(art,creative);await c.artworkEditor.edit(job,art,creative);await c.artworkEditor.idle();await assert.rejects(c.artworkEditor.edit(job,art,creative),/requested transparency/);assert.ok(c.db.prepare('SELECT data FROM factory_editor_cache').get().data);assert.equal(calls,1);invalid=false;const other={...creative,creative:{...creative.creative,prompt:'Separate rejected request'}};const rejected=await c.queue(art,other);await c.artworkEditor.edit(rejected,art,other);await c.artworkEditor.idle();await assert.rejects(c.artworkEditor.edit(rejected,art,other),/explicitly retry/);assert.equal(calls,2,'worker retries do not loop rejected provider calls');
 }finally{await c.close();}
});

test('creative changes respect protection, references, budgets and provider readiness before spending',async()=>{
 const c=await setup();try{const art=await c.upload(),other=await c.upload('Other');await assert.rejects(c.artworkEditor.edit('protected',art,{...creative,protect:true}),/protection/);await assert.rejects(c.artworkEditor.edit('reference',art,{...creative,creative:{...creative.creative,references:[other]}}),/same collection/);await assert.rejects(c.artworkEditor.edit('disconnected',art,creative),/backend OPENAI/);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_production_effects').get().n,0);assert.equal((await c.call(base+'editor/queue',{artworkId:art,recipe:creative})).status,400);assert.equal((await c.call(base+'editor/settings',{rules:{...creative,enabled:true}})).status,400);
 }finally{await c.close();}
});

test('automatic product editing coordinates one saved version across all native panels and exports exact pixels',async()=>{
 const c=await setup();try{
  const art=await c.upload(),job=randomUUID(),draft=randomUUID(),date=new Date().toISOString(),placements=['front','back','sleeve_left','sleeve_right','hood'],areas=placements.map(placement=>({placement,width:64,height:48,dpi:150}));
  c.db.prepare("INSERT INTO factory_jobs(id,title,kind,employee,gender,brief,status,created,updated) VALUES(?,?,'product','shirts','unisex',?,'queued',?,?)").run(job,'Coordinated hoodie','Use the same subject on matching panels',date,date);c.db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(job,'Keep proportions',JSON.stringify([draft]));c.db.prepare('INSERT INTO factory_job_audiences VALUES(?,?)').run(job,JSON.stringify({product:328,artworkIds:[art],garmentColor:'Black'}));c.db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(draft,'Native hoodie',328,10,'cut-sew',JSON.stringify(areas),'live',date);
  const live={source:'live',catalogType:'CUT-SEW',effectiveTechnique:'cut-sew',name:'All-Over Print Hoodie',variants:[{id:10,color:'White',size:'M'}],printfiles:{printfiles:[{printfile_id:1,width:64,height:48,dpi:150}],variant_printfiles:[{variant_id:10,placements:Object.fromEntries(placements.map(p=>[p,1]))}]},layouts:{}};
  const renderer=factoryRendering({db:c.db,blueprints:{load:async()=>live}});renderer.setEditor(c.artworkEditor);renderer.savePlan(job,{colorMode:'print',garmentColor:'Black',background:'Black',artworkEdits:{...defaults,enabled:true,removeBackground:true},placements:Object.fromEntries(placements.map(p=>[p,{artworkId:art,fit:'contain',protect:false}]))});
  const first=await renderer.renderJob(job);assert.equal(first.files.length,5);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_editor_versions').get().n,1);const selection=JSON.parse(c.db.prepare('SELECT selection FROM factory_job_audiences WHERE job=?').get(job).selection);assert.notEqual(selection.artworkIds[0],art);for(const f of first.files){const png=Buffer.from(c.db.prepare('SELECT data FROM factory_print_files WHERE id=?').get(f.id).data),p=await pixels(png);assert.deepEqual(pixel(p,0,0),[0,0,0,255]);assert.equal(p.info.width,64);assert.equal(p.info.height,48);assert.equal((await sharp(png).metadata()).density,150);}assert.equal((await renderer.renderJob(job)).rendered,0,'resumes saved edits and separate files without duplicates');
  c.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({...allow,reuse:false}),art);await assert.rejects(renderer.renderJob(job),/Reuse/);
  const high=await sharp({create:{width:2000,height:1000,channels:4,background:'#aa0000'}}).png().toBuffer();const exact=await renderArea({width:4000,height:4000,dpi:300},high,{background:'#000000',fit:'contain',scale:50},allow),meta=await sharp(exact.data).metadata();assert.equal(meta.width,4000);assert.equal(meta.height,4000);assert.equal(meta.density,300);assert.equal(exact.effectiveDpi,300);
 }finally{await c.close();}
});
