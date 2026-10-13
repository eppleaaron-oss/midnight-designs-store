import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {createService} from './server.mjs';
import {factoryDiagnostics} from './factory-diagnostics.mjs';

const base='/api/owner/ai-factory/intelligence',origin='http://localhost:3000',password='diagnostic-fixture-password',salt='b9'.repeat(16),secret='diagnostic-provider-secret-123456';
async function fixture(){
 const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),productionSettings:{storageDurable:true},publishingSettings:{storageDurable:true},editorSettings:{env:{}},pipelineSettings:{env:{}},diagnosticSettings:{}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+service.server.address().port;let cookie='';
 async function call(path,{body,method=body?'POST':'GET',session=cookie}={}){const r=await fetch(root+path,{method,headers:{Origin:origin,...(session?{Cookie:session}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 cookie=(await call('/api/owner/login',{body:{password}})).cookie;
 await call('/api/owner/ai-factory/employee',{body:{id:'hoodies',enabled:true}});
 const job=(await call('/api/owner/ai-factory/enqueue',{body:{title:'Black hoodie',brief:'Fill in Black. API key='+secret,kind:'product',employee:'hoodies',gender:'unisex'}})).data.jobs[0].id;
 service.factoryDiagnostics.setSecrets(()=>[secret]);
 return {service,db:service.db,job,call,close:()=>new Promise(r=>service.server.close(r))};
}

test('diagnostic completion requires actual native files, blueprint receipts and accepted mockup keys; changed inputs become stale',async()=>{
 const c=await fixture();try{
  const {db,job}=c,d=c.service.factoryDiagnostics,id=randomUUID(),stamp=new Date().toISOString(),areas=[{placement:'front',width:2,height:2,dpi:150}],selection={product:328,artworkIds:[],garmentColor:'Black',colorMode:'fabric'};
  db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(id,'Native front',328,10,'default',JSON.stringify(areas),'live',stamp);
  db.prepare('UPDATE factory_job_profiles SET templates=? WHERE job=?').run(JSON.stringify([id]),job);db.prepare('UPDATE factory_job_audiences SET selection=? WHERE job=?').run(JSON.stringify(selection),job);db.prepare('INSERT INTO factory_render_plans VALUES(?,?,?)').run(job,JSON.stringify({garmentColor:'Black',colorMode:'fabric'}),stamp);
  let stages=d.snapshot(job).stages;const state=name=>stages.find(s=>s.id===name).state;
  assert.equal(state('garment-color'),'waiting','written instructions and a black plan do not verify color');assert.equal(state('blueprint-validated'),'waiting');assert.equal(state('print-files'),'waiting');
  db.prepare('INSERT INTO factory_job_checkpoints VALUES(?,?,?,?)').run(job,'supplier',JSON.stringify({verified:true,product:328,variantIds:[10]}),Date.now());d.checkpoint(job,'supplier');
  stages=d.snapshot(job).stages;assert.equal(state('garment-color'),'done');assert.equal(state('blueprint-validated'),'done');
  const png=await sharp({create:{width:2,height:2,channels:4,background:'black'}}).png().toBuffer();db.prepare('INSERT INTO factory_print_files VALUES(?,?,?,?,?,?,?,?)').run('fixture-print',id,'front',2,2,png,createHash('sha256').update(png).digest('hex'),stamp);
  stages=d.snapshot(job).stages;assert.equal(state('print-files'),'done');assert.equal(state('artwork-edited'),'skipped','an uploaded print file is not a saved edit');
  db.prepare("INSERT INTO factory_mockup_tasks(job,variant,product,state,request_hash,created,updated) VALUES(?,10,328,'pending','fixture',?,?)").run(job,Date.now(),Date.now());stages=d.snapshot(job).stages;assert.equal(state('mockup-requested'),'waiting','pending text without an accepted key is insufficient');
  db.prepare("UPDATE factory_mockup_tasks SET task_key='accepted-fixture',accepted=?,checked=? WHERE job=?").run(Date.now(),Date.now(),job);stages=d.snapshot(job).stages;assert.equal(state('mockup-requested'),'done');assert.equal(state('mockup-retrieved'),'pending');
  db.prepare('UPDATE factory_print_drafts SET technique=? WHERE id=?').run('changed',id);stages=d.snapshot(job).stages;assert.equal(state('blueprint-validated'),'stale');assert.equal(state('garment-color'),'stale');
  db.prepare('INSERT INTO factory_print_files VALUES(?,?,?,?,?,?,?,?)').run('wrong-width-print',id,'front',3,2,png,createHash('sha256').update(png).digest('hex'),new Date(Date.now()+1000).toISOString());stages=d.snapshot(job).stages;assert.equal(state('print-files'),'held');
 }finally{await c.close();}
});

test('failed API receipts retain exact errors but remove keys, binary payloads and signed links; private inspection is read-only and persists',async()=>{
 const c=await fixture();try{const d=c.service.factoryDiagnostics;let calls=0;
  const wrapped=d.wrapFetch(async()=>{calls++;return new Response(JSON.stringify({error:{code:'unsupported_placement',message:'Hood is unsupported '+secret},data:{placement:'hood'},b64_json:'privatepixels',api_key:secret,url:'https://files.example/a?X-Amz-Signature=private-signature',file:'/factory-print-file/'+'a'.repeat(64)}),{status:400,headers:{'Content-Type':'application/json','x-pf-request-id':'receipt-42','retry-after':'60'}});});
  await d.withJob(c.job,'mockups',async()=>{const response=await wrapped('https://api.printful.com/mockup-generator/create-task/328',{method:'POST',headers:{Authorization:'Bearer '+secret}});assert.match(await response.text(),new RegExp(secret),'production still receives its untouched response');return {wait:'Supplier rejected placement'};});
  const path=base+'/job/'+c.job+'/stage/mockup-requested',detail=await c.call(path);assert.equal(detail.status,200);assert.equal(detail.data.stage.state,'failed');const receipt=detail.data.events.find(e=>e.kind==='api');assert.equal(receipt.details.response.error.code,'unsupported_placement');assert.equal(receipt.details.response.data.placement,'hood');assert.equal(receipt.details.headers['x-pf-request-id'],'receipt-42');assert.equal(receipt.details.headers['retry-after'],'60');
  for(const text of [JSON.stringify(detail.data),JSON.stringify(c.db.prepare('SELECT message,details FROM factory_diagnostic_events').all())])for(const denied of [secret,'privatepixels','private-signature','a'.repeat(64)])assert.ok(!text.includes(denied),denied);
  assert.equal(calls,1);assert.equal((await c.call(path,{session:''})).status,401);assert.equal((await c.call(path,{method:'POST',body:{}})).status,405);assert.equal((await c.call(base+'/job/'+c.job+'/stage/imaginary')).status,404);assert.equal((await c.call(base+'/job/'+c.job+'/acceptance',{session:''})).status,401);
  const restored=factoryDiagnostics({db:c.db,secrets:()=>[secret],fail:(status,message)=>{throw Object.assign(Error(message),{status});}});assert.equal(restored.detail(c.job,'mockup-requested').events.find(e=>e.kind==='api').details.httpStatus,400);
  const report=(await c.call(base+'/job/'+c.job+'/acceptance')).data;assert.equal(report.status,'blocked');assert.ok(report.checks.some(x=>x.id==='live-receipts'&&!x.passed));assert.equal((await c.call('/api/owner/ai-factory/publishing/mode',{body:{mode:'automatic',confirm:true}})).status,409);assert.equal(calls,1,'reading evidence cannot repeat supplier operations');
 }finally{await c.close();}
});

test('concurrent job receipts stay isolated, unknown writes never become success, bounded responses and pagination retain older products',async()=>{
 const c=await fixture();try{const d=c.service.factoryDiagnostics,second=(await c.call('/api/owner/ai-factory/enqueue',{body:{title:'Second hoodie',brief:'Test',kind:'product',employee:'hoodies',gender:'unisex'}})).data.jobs.find(j=>j.id!==c.job).id;
  const wrapped=d.wrapFetch(async url=>String(url).includes('/328')?new Response(JSON.stringify({result:{task_key:'one'}}),{headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify({result:{task_key:'two'}}),{headers:{'Content-Type':'application/json'}}));
  await Promise.all([c.job,second].map((job,i)=>d.withJob(job,'mockups',async()=>{await wrapped('https://api.printful.com/mockup-generator/create-task/'+(328+i),{method:'POST'});return {defer:true};})));
  assert.equal(d.detail(c.job,'mockup-requested').events.find(e=>e.kind==='api').details.response.result.task_key,'one');assert.equal(d.detail(second,'mockup-requested').events.find(e=>e.kind==='api').details.response.result.task_key,'two');
  await assert.rejects(d.withJob(second,'mockups',()=>d.withStage('mockup-requested',()=>d.wrapFetch(async()=>{throw Error('Connection lost after submission');})('https://api.printful.com/mockup-generator/create-task/329',{method:'POST'}))));assert.equal(d.detail(second,'mockup-requested').stage.state,'uncertain');
  await d.withJob(c.job,'mockups',async()=>{await d.wrapFetch(async()=>new Response('x'.repeat(140000)))('https://api.printful.com/mockup-generator/task?task_key=one');return {defer:true};});assert.equal(d.detail(c.job,'mockup-retrieved').events.find(e=>e.kind==='api').details.responseTruncated,true);
  const row=c.db.prepare('SELECT * FROM factory_jobs WHERE id=?').get(c.job),columns=Object.keys(row),insert=c.db.prepare('INSERT INTO factory_jobs('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');for(let i=0;i<53;i++)insert.run(...columns.map(k=>k==='id'?randomUUID():k==='title'?'Older product '+i:row[k]));
  const page=(await c.call(base+'/production')).data;assert.equal(page.jobs.length,50);assert.equal(page.total,55);assert.ok(page.next);const older=(await c.call(base+'/production?before='+page.next)).data;assert.equal(older.jobs.length,5);assert.ok(older.jobs.some(j=>j.id===c.job));assert.equal((await c.call(base+'/production?q=does-not-exist')).data.total,0);assert.equal((await c.call(base+'/production?before=invalid')).status,400);assert.equal((await c.call(base+'/production',{session:''})).status,401);
 }finally{await c.close();}
});
