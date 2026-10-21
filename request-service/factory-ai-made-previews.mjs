import {createHash} from 'node:crypto';
import {normalize} from '../scripts/sync-printful.mjs';
import {requests,candidates} from '../scripts/sync-approved-printful-media.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const previewSignature=detail=>hash({external:detail?.sync_product?.external_id,variants:detail?.sync_variants?.map(v=>({id:v.id,variant:v.variant_id,files:v.files?.filter(f=>f.type!=='preview').map(f=>({id:f.id,url:f.url,type:f.type,hash:f.hash,status:f.status}))}))});
export function aiMadePreviews({db,pf,checkpoint,fail,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS factory_ai_made_previews(job TEXT NOT NULL,key TEXT NOT NULL,signature TEXT NOT NULL,task TEXT,state TEXT NOT NULL,images TEXT NOT NULL,error TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(job,key));');
 const now=()=>new Date(clock()).toISOString();
 function gallery(job,detail){return db.prepare("SELECT images FROM factory_ai_made_previews WHERE job=? AND signature=? AND state='ready'").all(job,previewSignature(detail)).flatMap(r=>JSON.parse(r.images));}
 async function generate(job,detail,{retry=false}={}){
  const product=normalize(detail);if(!product)fail(409,'Printful has no synced, priced variants to preview.');const mapping=await pf('mockup-generator/printfiles/'+product.catalogProductId),jobs=requests(product,detail,mapping,true),signature=previewSignature(detail);
  if(!jobs.length)fail(409,'No verified native print mapping is available.');
  // One task per click keeps supplier calls bounded; completed views are retained.
  for(const j of jobs){let r=db.prepare('SELECT * FROM factory_ai_made_previews WHERE job=? AND key=?').get(job,j.key);
   if(r?.signature===signature&&r.state==='ready'){if(!retry)continue;r=null;}
   if(r?.state==='submitting'&&!retry)fail(409,'The image-task submission is unconfirmed. Use Retry review images to request another image-only task; no product is recreated.');
   if(r?.task&&r.signature===signature){const task=await pf('mockup-generator/task?task_key='+encodeURIComponent(r.task));if(task?.status==='pending')return {pending:true,note:'Printful is generating the private review images. Check again shortly.'};if(task?.status!=='completed'){db.prepare("UPDATE factory_ai_made_previews SET state='failed',error=?,updated=? WHERE job=? AND key=?").run(String(task?.error||'Image task failed'),now(),job,j.key);if(!retry)fail(409,'The image task failed. Retry review images.');}else{const images=candidates(task,j.retail.catalogVariantId).map(c=>({url:c.url,title:c.view||c.style||'Review mockup'}));if(!images.length)fail(409,'Printful returned no images for the selected variant.');db.prepare("UPDATE factory_ai_made_previews SET state='ready',images=?,error='',updated=? WHERE job=? AND key=?").run(JSON.stringify(images),now(),job,j.key);await checkpoint();return {pending:jobs.some(x=>!db.prepare("SELECT key FROM factory_ai_made_previews WHERE job=? AND key=? AND signature=? AND state='ready'").get(job,x.key,signature)),note:'Review images saved. Check again if additional color views are pending.'};}}
   db.prepare("INSERT OR REPLACE INTO factory_ai_made_previews VALUES(?,?,?,NULL,'submitting','[]','',?)").run(job,j.key,signature,now());await checkpoint();
   try{const task=await pf('mockup-generator/create-task/'+product.catalogProductId,{method:'POST',body:JSON.stringify(j.payload)});if(!task?.task_key)fail(502,'Printful did not return an image task ID.');db.prepare("UPDATE factory_ai_made_previews SET task=?,state='pending',updated=? WHERE job=? AND key=?").run(task.task_key,now(),job,j.key);await checkpoint();return {pending:true,note:'Review images requested. Check again shortly; the product is still private.'};}catch(e){if([400,401,403,404,422,429].includes(e.printfulStatus))db.prepare("UPDATE factory_ai_made_previews SET state='failed',error=?,updated=? WHERE job=? AND key=?").run(e.message,now(),job,j.key);throw e;}
  }
  return {pending:false,note:'All requested review views are ready.'};
 }
 return {gallery,generate};
}
