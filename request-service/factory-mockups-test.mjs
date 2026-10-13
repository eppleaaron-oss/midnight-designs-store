import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {factoryMockups,mockupImages,mockupImageURL} from './factory-mockups.mjs';

const s3='https://printful-upload.s3-accelerate.amazonaws.com/tmp/';
const fault=(message,status=409,printfulStatus)=>Object.assign(Error(message),{status,printfulStatus});
async function fixture({path=':memory:',variants=[101],submit,results,fetchImage,verifyPrintFile,durable=true,allowed=true}={}){
 const db=new DatabaseSync(path);db.exec(`CREATE TABLE IF NOT EXISTS factory_mockups(id TEXT PRIMARY KEY,job TEXT NOT NULL,variant INTEGER NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_publish_operations(job TEXT NOT NULL,operation TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,created INTEGER NOT NULL,PRIMARY KEY(job,operation));
 CREATE TABLE IF NOT EXISTS factory_listings(job TEXT PRIMARY KEY,status TEXT,error TEXT,updated TEXT);INSERT OR IGNORE INTO factory_listings VALUES('job','supplier_created','','');`);
 const png=await sharp({create:{width:16,height:12,channels:3,background:'#222222'}}).png().toBuffer(),jpeg=await sharp(png).jpeg().toBuffer();let clock=1000000,calls=[],downloads=[],permit=allowed,live=true;
 const p={j:{id:'job'},listing:{supplier_id:'501'},selection:{product:71},files:variants.map(variant=>({product:71,variant,technique:'DTG',areas:[{placement:'front',file:'file-'+variant,width:4000,height:4000,sha256:'pixels-'+variant}]}))};
 const get=(sql,...a)=>db.prepare(sql).get(...a),run=(sql,...a)=>db.prepare(sql).run(...a),operation=(job,key)=>get('SELECT * FROM factory_publish_operations WHERE job=? AND operation=?',job,key),begin=(job,key)=>run("INSERT INTO factory_publish_operations VALUES(?,?,'uncertain',NULL,?)",job,key,clock),done=(job,key,ref)=>run("UPDATE factory_publish_operations SET status='confirmed',reference=? WHERE job=? AND operation=?",ref,job,key);
 const opts={db,verifyPrintFile,storageDurable:durable,clock:()=>clock,operation,begin,done,checked:()=>{if(!permit)throw fault('Print files or permissions need review');return p;},link:file=>'https://backend.example/factory-print-file/'+file,validateVariant:async(_,d)=>assert.ok(variants.includes(d.variant)),
  pf:async(path,o)=>{calls.push({path,body:o?.body?JSON.parse(o.body):null});if(o?.method==='POST'){const variant=JSON.parse(o.body).variant_ids[0];return submit?submit(variant):{task_key:'gt-'+variant,status:'pending'};}const key=new URL('https://api.printful.com/'+path).searchParams.get('task_key'),variant=Number(key.slice(3));return results?results(key):{task_key:key,status:'completed',mockups:[{variant_ids:[variant],placement:'front',mockup_url:s3+variant+'.png'}]};},
  fetchImpl:async(url,o)=>{downloads.push(String(url));assert.equal(o.redirect,'error');if(!live)throw Error('Temporary provider URLs are no longer accessible');return fetchImage?fetchImage(String(url),png,jpeg):new Response(png,{headers:{'Content-Type':'image/png'}});}};
 let engine=factoryMockups(opts);
 return {db,p,png,jpeg,calls,downloads,engine,advance:ms=>clock+=ms,disable:()=>permit=false,offline:()=>live=false,execute:()=>engine.execute('job',()=>{if(!permit)throw fault('Factory paused or worker lease revoked');}),snapshot:()=>engine.snapshot('job'),recover:()=>{engine=factoryMockups(opts);return engine;},close:()=>db.close()};
}

test('documented S3 URLs and extra angles are accepted; arbitrary hosts and wrong variants are rejected',()=>{
 assert.equal(mockupImageURL(s3+'front.png'),s3+'front.png');assert.throws(()=>mockupImageURL('https://some-other-bucket.s3-accelerate.amazonaws.com/a.png'),/unsupported/);assert.throws(()=>mockupImageURL('https://files.cdn.printful.com.evil.example/a.png'),/unsupported/);assert.throws(()=>mockupImageURL('http://127.0.0.1/a.png'),/unsupported/);assert.throws(()=>mockupImageURL('https://name:password@files.cdn.printful.com/a.png'),/unsupported/);
 const output={mockups:[{variant_ids:[101],placement:'front',mockup_url:s3+'primary.png',extra:[{url:s3+'primary.png',title:'Duplicate'},{url:s3+'model.jpg',title:'Front',option_group:"Women's"}]},{variant_ids:[999],placement:'back',mockup_url:s3+'wrong.png'}]};const images=mockupImages(output,101);assert.equal(images.length,2);assert.equal(images[1].style,"Women's");assert.throws(()=>mockupImages(output,202),/no mockups/);
});

test('no generation claim or duplicate submission without an accepted key; active requests cannot be reconciled early',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=await fixture({submit:async()=>{await wait;return {status:'pending'};}});
 try{const running=f.execute();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.snapshot().generating,false);assert.match(f.snapshot().label,/acceptance not confirmed/);assert.throws(()=>f.engine.assertReconcile('job','mockup-101'),/still active/);release();assert.match((await running).wait,/unconfirmed/);assert.equal(f.snapshot().tasks[0].task_key,null);assert.equal(f.snapshot().generating,false);assert.match((await f.execute()).wait,/valid task key|uncertain/);assert.equal(f.calls.length,1);f.recover();await f.execute();assert.equal(f.calls.length,1,'restart cannot replay an uncertain request');
 }finally{release();f.close();}
});

test('pending status requires saved acceptance and respects first-poll timing and stale-status disclosure',async()=>{
 const f=await fixture({results:key=>({task_key:key,status:'pending'})});try{assert.equal((await f.execute()).defer,true);const snapshot=f.snapshot();assert.equal(snapshot.generating,true);assert.equal(snapshot.tasks[0].task_key,'gt-101');assert.equal(snapshot.tasks[0].supplier_status,'pending');assert.ok(snapshot.tasks[0].accepted);await f.execute();assert.equal(f.calls.length,1,'do not poll immediately');f.advance(10000);assert.equal((await f.execute()).defer,true);assert.equal(f.calls.length,2);f.advance(121000);assert.equal(f.snapshot().generating,false);assert.match(f.snapshot().label,/last known pending/);f.advance(2*3600000);assert.match((await f.execute()).wait,/two hours/);assert.equal(f.snapshot().tasks[0].state,'timed_out');assert.equal(f.snapshot().generating,false);
 }finally{f.close();}
});

test('primary and extra images resume in batches, survive restart/expired URLs and stay attached to the exact variant',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mockup-images-')),path=join(dir,'mockups.sqlite'),f=await fixture({path,results:key=>({task_key:key,status:'completed',mockups:[{variant_ids:[101],placement:'front',mockup_url:s3+'primary.png',extra:[{url:s3+'front.jpg',title:'Front',option_group:'Flat'},{url:s3+'back.png',title:'Back',option_group:'Lifestyle'}]},{variant_ids:[999],placement:'back',mockup_url:s3+'foreign.png'}]}),fetchImage:(url,png,jpeg)=>new Response(url.endsWith('.jpg')?jpeg:png,{headers:{'Content-Type':url.endsWith('.jpg')?'image/jpeg':'image/png'}})});
 try{await f.execute();assert.equal(f.calls[0].path,'mockup-generator/create-task/71');assert.deepEqual(f.calls[0].body.variant_ids,[101]);assert.equal(f.calls[0].body.files[0].position.width,4000);assert.equal(f.calls[0].body.files[0].image_url,'https://backend.example/factory-print-file/file-101');f.advance(10000);assert.equal((await f.execute()).defer,true);assert.equal(f.snapshot().saved,0,'partial sets are not attached as finished product images');assert.equal(f.snapshot().tasks[0].staged,2);f.recover();assert.equal((await f.execute()).mockupsSaved,true);assert.equal(f.snapshot().saved,3);assert.equal(f.calls.filter(c=>c.body).length,1);assert.equal(f.downloads.length,3);assert.ok(f.snapshot().images.every(i=>i.variant===101&&i.task_key==='gt-101'&&i.sha256&&i.width===16));assert.equal(f.snapshot().images.some(i=>i.url.includes('amazonaws')),false,'private previews use saved backend bytes');assert.equal(f.snapshot().images[1].style,'Flat');
  f.offline();const calls=f.calls.length;f.recover();assert.equal((await f.execute()).mockupsSaved,true);assert.equal(f.calls.length,calls);assert.equal(f.engine.verifiedGallery('job',[101]).length,3,'completed mockups do not depend on temporary URLs');assert.equal(f.db.prepare('SELECT count(*) n FROM factory_mockup_downloads').get().n,0);
 }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});

test('one failed image preserves valid staged bytes, retries the download and never requests another task',async()=>{
 let fail=true;const f=await fixture({results:key=>({task_key:key,status:'completed',mockups:[{variant_ids:[101],placement:'front',mockup_url:s3+'front.png',extra:[{url:s3+'back.png',title:'Back'}]}]}),fetchImage:(url,png)=>{if(url.includes('back')&&fail){fail=false;return new Response('temporary error',{status:503});}return new Response(png,{headers:{'Content-Type':'image/png'}});}});
 try{await f.execute();f.advance(10000);await assert.rejects(f.execute(),/download failed/);assert.equal(f.snapshot().saved,0);assert.equal(f.snapshot().tasks[0].staged,1);assert.equal((await f.execute()).mockupsSaved,true);assert.equal(f.snapshot().saved,2);assert.equal(f.downloads.filter(u=>u.includes('front')).length,1);assert.equal(f.calls.filter(c=>c.body).length,1);
 }finally{f.close();}
});

test('supplier failures, wrong task keys, wrong variants and corrupt image bytes never become finished mockups',async()=>{
 for(const [result,fetchImage,error] of [
  [key=>({task_key:key,status:'failed',error:'Unsupported print configuration'}),undefined,/failed/],
  [()=>({task_key:'wrong-key',status:'completed',mockups:[]}),undefined,/different mockup task/],
  [key=>({task_key:key,status:'completed',mockups:[{variant_ids:[999],mockup_url:s3+'wrong.png'}]}),undefined,/no mockups/],
  [key=>({task_key:key,status:'completed',mockups:[{variant_ids:[101],mockup_url:s3+'bad.png'}]}),()=>new Response(Buffer.from('not-a-valid-image'),{headers:{'Content-Type':'image/png'}}),/integrity/]
 ]){const f=await fixture({results:result,fetchImage});try{await f.execute();f.advance(10000);try{const output=await f.execute();assert.match(output.wait,error);}catch(e){assert.match(e.message,error);}assert.equal(f.snapshot().saved,0);assert.equal(f.snapshot().generating,false);assert.equal(f.calls.filter(c=>c.body).length,1);assert.throws(()=>f.engine.verifiedGallery('job',[101]),/Verified saved/);}finally{f.close();}}
});

test('unknown outcomes require reconciliation; confirmed failures can retry with preserved task-key history and limits',async()=>{
 let accepted=false;const f=await fixture({submit:()=>{if(!accepted)throw fault('Response lost after submission',502);return {task_key:'gt-failed',status:'failed',error:'Supplier rejected the artwork'};}});
 try{await assert.rejects(f.execute(),/Response lost/);assert.equal(f.snapshot().generating,false);await f.execute();assert.equal(f.calls.length,1);assert.throws(()=>f.engine.retry('job',101,{regenerate:true,confirm:true}),/Unknown submissions/);f.engine.reconcile('job','mockup-101','no_effect');f.db.prepare("DELETE FROM factory_publish_operations WHERE job='job'").run();accepted=true;f.advance(31000);assert.match((await f.execute()).wait,/failed/);assert.equal(f.snapshot().history[0].task_key,'gt-failed');assert.equal(f.snapshot().history[0].supplier_status,'failed');f.engine.retry('job',101,{regenerate:true,confirm:true});assert.equal(f.snapshot().tasks[0].task_key,null);assert.equal(f.snapshot().history[0].task_key,'gt-failed','replacement work retains its earlier task key');f.db.prepare("UPDATE factory_mockup_tasks SET attempts=5 WHERE job='job'").run();f.advance(31000);await assert.rejects(f.execute(),/retry limit/);
 }finally{f.close();}
});

test('durable print storage, unchanged approved files, variant identity and supplier throttling gate submissions',async()=>{
 const ephemeral=await fixture({durable:false});try{await assert.rejects(ephemeral.execute(),/Persistent/);assert.equal(ephemeral.calls.length,0);}finally{ephemeral.close();}
 const blocked=await fixture({verifyPrintFile:async()=>{throw fault('Persistent print-file URL is unavailable');}});try{await assert.rejects(blocked.execute(),/print-file URL/);assert.equal(blocked.calls.length,0);assert.equal(blocked.snapshot().tasks[0].state,'blocked');assert.equal(blocked.snapshot().generating,false);}finally{blocked.close();}
 const f=await fixture({variants:[101,202]});try{await f.execute();f.advance(10000);const r=await f.execute();assert.equal(r.defer,true);assert.equal(f.snapshot().saved,1);assert.equal(f.calls.filter(c=>c.body).length,1,'new-store submission interval prevents a second immediate request');f.advance(21000);await f.execute();assert.equal(f.calls.filter(c=>c.body).length,2);assert.deepEqual(f.calls.filter(c=>c.body).map(c=>c.body.variant_ids),[[101],[202]]);f.advance(10000);assert.equal((await f.execute()).mockupsSaved,true);assert.deepEqual(new Set(f.snapshot().images.map(m=>m.variant)),new Set([101,202]));f.p.files[0].areas[0].sha256='changed-file';await assert.rejects(f.execute(),/Print files changed/);f.disable();await assert.rejects(f.execute(),/permissions/);
 }finally{f.close();}
});


test('Printful 429 delays a known rejected submission without claiming acceptance or immediately resubmitting',async()=>{
 let attempts=0;const f=await fixture({submit:()=>{attempts++;if(attempts===1)throw Object.assign(fault('Printful rate limit',429,429),{retryAfter:60});return {task_key:'gt-101',status:'pending'};}});
 try{await assert.rejects(f.execute(),/rate limit/);assert.equal(f.snapshot().generating,false);assert.equal(f.snapshot().tasks[0].task_key,null);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_publish_operations').get().n,0);assert.equal((await f.execute()).defer,true);f.advance(59999);await f.execute();assert.equal(attempts,1);f.advance(1);await f.execute();assert.equal(attempts,2);assert.equal(f.snapshot().generating,true);}
 finally{f.close();}
});
