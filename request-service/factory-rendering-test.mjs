import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {scryptSync,createHash} from 'node:crypto';
import {renderArea,factoryRendering} from './factory-rendering.mjs';
import {createService} from './server.mjs';
import {pngDimensions} from './factory-blueprints.mjs';

const allow={reuse:true,crop:true,modify:true,recolor:false};
const area={placement:'front',width:12,height:8,dpi:150};
async function artwork(){return sharp({create:{width:24,height:12,channels:4,background:'#ff0000'}}).png().toBuffer();}
async function pixels(buffer){return sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
const pixel=(raw,x,y)=>[...raw.data.subarray((y*raw.info.width+x)*4,(y*raw.info.width+x)*4+4)];

test('backend produces native PNG pixels, black fill, placement, transparency and DPI',async()=>{
 const original=await artwork(),before=createHash('sha256').update(original).digest('hex');
 const out=await renderArea(area,original,{background:'Black',fit:'contain'},allow),raw=await pixels(out.data);
 assert.deepEqual(pngDimensions(out.data),{width:12,height:8});assert.deepEqual(pixel(raw,0,0),[0,0,0,255]);assert.deepEqual(pixel(raw,6,4),[255,0,0,255]);
 assert.equal((await sharp(out.data).metadata()).density,150);assert.ok(out.effectiveDpi>=150);
 const transparent=await renderArea(area,original,{background:null,fit:'contain'},allow);assert.deepEqual(pixel(await pixels(transparent.data),0,0),[0,0,0,0]);
 const moved=await renderArea(area,original,{background:'#000000',fit:'contain',scale:50,x:25},allow);const m=await pixels(moved.data);assert.deepEqual(pixel(m,2,4),[0,0,0,255]);assert.deepEqual(pixel(m,9,4),[255,0,0,255]);
 const fill=await renderArea(area,null,{background:'Black'});assert.deepEqual(pixel(await pixels(fill.data),11,7),[0,0,0,255]);
 assert.equal(createHash('sha256').update(original).digest('hex'),before,'original image bytes are unchanged');
});

test('rendering respects crop/modify rights, proportions and source resolution',async()=>{
 const source=await artwork();
 await assert.rejects(renderArea(area,source,{fit:'cover'},{...allow,crop:false}),/Crop permission/);
 await assert.rejects(renderArea(area,source,{mirror:true},{...allow,modify:false}),/Modify permission/);
 await assert.rejects(renderArea(area,source,{x:25},{...allow,crop:false}),/clips artwork/);
 await assert.rejects(renderArea(area,source,{fit:'fill'},allow),/proportions/);
 await assert.rejects(renderArea({...area,width:120,height:80},source,{},allow),/resolution is too low/);
 await assert.rejects(renderArea(area,source,{fit:'cover',protect:true},allow),/pixel protection/);
 await assert.rejects(renderArea({...area,width:100000,height:100000},source,{},allow),/rendering limit/);
 const tiled=await renderArea(area,source,{background:'Black',tile:true,scale:50,spacing:100},allow);const raw=await pixels(tiled.data);assert.ok(pixel(raw,6,4)[0]>200);
});

test('owner rendering saves actual files once and holds invalid batches without partial writes',async()=>{
 const origin='http://localhost:3000',salt='ac'.repeat(16),password='render-test-password';
 const native={catalogProductId:328,name:'All-Over Print Unisex Test T-Shirt',variants:[{id:10,name:'White M',size:'M',color:'White'}],printfiles:{available_placements:{front:'Front',back:'Back'},printfiles:[{printfile_id:1,width:12,height:8,dpi:150}],variant_printfiles:[{variant_id:10,placements:{front:1,back:1}}]},layouts:{templates:[],variant_mapping:[]}};
 const workerToken='renderer-worker-token-'.repeat(3);
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),blueprintSettings:{plans:{products:{328:native}},token:'supplier-test',fetchImpl:async url=>{if(url.includes('/v2/'))return new Response(JSON.stringify({data:{type:'CUT-SEW',techniques:[{key:'cut-sew',is_default:true}]}}));return new Response(JSON.stringify({result:url.includes('/printfiles/')?native.printfiles:url.includes('/templates/')?native.layouts:{product:{title:native.name,type:'CUT-SEW'},variants:native.variants}}));}},productionSettings:{workerToken,storageDurable:true},factorySettings:{token:'supplier-test',fetchImpl:async url=>new Response(JSON.stringify({result:url.endsWith('/products')?[{id:328,title:native.name,type_name:'T-Shirt'}]:{variants:native.variants}}))}});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+service.server.address().port;let cookie;
 async function call(path,body,source=origin){const r=await fetch(root+path,{method:body?'POST':'GET',headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  assert.equal((await call('/api/owner/ai-factory/rendering/draft/00000000-0000-0000-0000-000000000000',{})).status,401);
  cookie=(await call('/api/owner/login',{password})).cookie;
  const upload=await call('/api/owner/ai-factory/artwork/upload',{name:'Red graphic',collection:'Rendering test',scope:'collection',target:'',product:null,placements:['front','back'],instructions:'Keep original colors.',permissions:allow,files:[{filename:'red.png',base64:(await artwork()).toString('base64')}]});assert.equal(upload.status,200);const id=upload.data.artworks[0].id;
  const draft=await call('/api/owner/ai-factory/blueprints/draft',{title:'Test tee',product:328,variant:10,technique:'default',placements:['front','back']});assert.equal(draft.status,200);
  const url='/api/owner/ai-factory/rendering/draft/'+draft.data.id,plan={background:'Black',placements:{front:{artworkId:id,fit:'contain'},back:{fillOnly:true}}};
  assert.equal((await call(url,plan,'https://evil.example')).status,403);
  assert.equal((await call(url,{background:'Black',placements:{front:{artworkId:id},hood:{artworkId:id}}})).status,409);
  assert.equal((await call('/api/owner/ai-factory/blueprints')).data.drafts[0].files.length,0);
  const done=await call(url,plan);assert.equal(done.status,200,done.data.error);assert.equal(done.data.rendered,2);assert.equal(done.data.reviewRequired,true);
  const repeat=await call(url,plan);assert.equal(repeat.data.rendered,0);assert.deepEqual(repeat.data.files.map(f=>f.id),done.data.files.map(f=>f.id));
  const changed=await call(url,{...plan,background:'Cream'});assert.equal(changed.data.rendered,2);const restored=await call(url,plan);assert.equal(restored.data.rendered,2,'an older cached recipe must not leave newer files from another recipe active');
  const r=await fetch(root+done.data.files[0].url,{headers:{Cookie:cookie}});const data=Buffer.from(await r.arrayBuffer());assert.deepEqual(pngDimensions(data),{width:12,height:8});assert.deepEqual(pixel(await pixels(data),0,0),[0,0,0,255]);
  const assigned=await call('/api/owner/ai-factory/creator-profile',{id:'shirts',instructions:'Use native dimensions',templates:[draft.data.id]});assert.equal(assigned.status,200,assigned.data.error);assert.equal(service.db.prepare('SELECT templates FROM factory_creator_profiles WHERE id=?').get('shirts').templates,JSON.stringify([draft.data.id]));
  await call('/api/owner/ai-factory/budget',{dailyBudget:100,totalBudget:100});
  const config={name:'Pixel workflow',artworkIds:[id],garments:['tshirt'],quantity:{mode:'each',each:{tshirt:2}},workers:{total:1},duration:{mode:'queue'},color:{base:'Black'},placement:{continueAcrossPanels:false,mirrorSleeves:false},limits:{batch:2},output:'products'};
  const started=await call('/api/owner/ai-factory/runs/start',{config});assert.equal(started.status,200,started.data.error);
  const jobs=(await call('/api/owner/ai-factory/jobs')).data.jobs;assert.equal(jobs.length,2);
  assert.ok(jobs.every(j=>j.audienceSelection.product===328),'one assigned supplier product is carried into the job: '+JSON.stringify(jobs.map(j=>({id:j.id,templates:j.assignedTemplates,selection:j.audienceSelection}))));
  assert.notEqual(jobs[0].assignedTemplates[0],draft.data.id);assert.notEqual(jobs[0].assignedTemplates[0],jobs[1].assignedTemplates[0],'every product owns its print-file sets');
  async function machine(operation,b={}){const r=await fetch(root+'/internal/factory/'+operation,{method:'POST',headers:{Authorization:'Bearer '+workerToken,'Content-Type':'application/json'},body:JSON.stringify({worker:'pixel-worker',...b})});return r.json();}
  await machine('heartbeat');assert.equal((await call('/api/owner/ai-factory/control',{action:'start'})).status,200);
  let working;
  for(const stage of ['validate','supplier','files']){const lease=await machine('claim');assert.equal(lease.step,stage,lease.reason);working=lease.job;const result=await machine('step',{job:lease.job,lease:lease.lease});assert.equal(result.status,'queued',JSON.stringify(result));}
  const profile=jobs.find(j=>j.id===working),saved=(await call('/api/owner/ai-factory/blueprints')).data.drafts.find(d=>d.id===profile.assignedTemplates[0]);assert.equal(saved.files.length,2,'worker created every required native print file from the run settings');
  const back=saved.files.find(f=>f.placement==='back'),rendered=await fetch(root+back.url,{headers:{Cookie:cookie}});const backPixels=await pixels(Buffer.from(await rendered.arrayBuffer()));assert.deepEqual(pixel(backPixels,0,0),[0,0,0,255]);assert.deepEqual(pixel(backPixels,6,4),[255,0,0,255]);
  const nonAop=factoryRendering({db:service.db,plans:{products:{328:{name:'DTG Unisex T-Shirt'}}}});await assert.rejects(nonAop.renderJob(working),/Live Printful/,'a print rectangle is not treated as a garment color');
 }finally{await new Promise(resolve=>service.server.close(resolve));}
});
