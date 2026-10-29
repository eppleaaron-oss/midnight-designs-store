import {createHash} from 'node:crypto';

const ROOT='/api/owner/ai-factory/outfit-learning';
const hold=message=>{throw Object.assign(Error(message),{status:409});};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Transfer the visible composition, not an image's empty margins. Each new
// subject keeps its own aspect ratio. Never inherit permission to crop it.
export function transferStudioLayer(layer,from,to,area){
 if(layer.rotation||layer.mirror)hold('This example rotates or mirrors artwork. A separately reviewed mapping is required.');
 const a=from.bounds||{x:0,y:0,width:from.width,height:from.height},b=to.bounds||{x:0,y:0,width:to.width,height:to.height};
 const fw=layer.width*area.width,fh=fw*from.height/from.width;
 const visible={x:layer.x*area.width-fw/2+a.x*fw/from.width,y:layer.y*area.height-fh/2+a.y*fh/from.height,width:a.width*fw/from.width,height:a.height*fh/from.height};
 if(visible.x<-.5||visible.y<-.5||visible.x+visible.width>area.width+.5||visible.y+visible.height>area.height+.5)hold('The reference artwork is clipped. Choose an example with the whole design inside the print canvas.');
 const scale=Math.min(visible.width/b.width,visible.height/b.height),w=to.width*scale,h=to.height*scale,cx=visible.x+visible.width/2,cy=visible.y+visible.height/2;
 const x=cx-(b.x+b.width/2)*scale+w/2,y=cy-(b.y+b.height/2)*scale+h/2;
 const result={asset:to.asset,x:x/area.width,y:y/area.height,width:w/area.width,rotation:0,mirror:false,allowModify:false,...(layer.backgroundRemoval?{backgroundRemoval:layer.backgroundRemoval}:{})};
 if(![result.x,result.y,result.width].every(Number.isFinite)||result.x<0||result.x>1||result.y<0||result.y>1||result.width<.001||result.width>4)hold('This artwork needs its own placement review; it cannot safely inherit the example.');
 return result;
}

// A finite, owner-started continuation. Completed products are retained; only
// unstarted slots enter this run. No path in this module publishes a listing.
export function factoryOutfitLearning({db,basic,outfits,studio,auth,body,send,fail,limit,origin,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_outfit_learning(batch TEXT PRIMARY KEY,pieces TEXT NOT NULL,examples TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_outfit_learning_jobs(piece TEXT PRIMARY KEY,batch TEXT NOT NULL,supplier TEXT NOT NULL,example TEXT NOT NULL,job TEXT NOT NULL,created INTEGER NOT NULL);`);
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a);
 let starting=false;
 function inventory(){
  const q=outfits.snapshot(),b=q.batch,scope=b?.scope?new Set(b.scope.pieceIds):null;
  const pieces=q.plans.filter(p=>b?.plans.some(x=>x.id===p.id)).flatMap(p=>p.pieces.filter(x=>!scope||scope.has(x.id)).map(x=>({...x,collection:p.name}))),pending=pieces.filter(p=>!p.item);
  const learned=b&&get('SELECT * FROM factory_outfit_learning WHERE batch=?',b.id),examples=studio.learningExamples(),jobs=all('SELECT * FROM factory_outfit_learning_jobs ORDER BY created');
  const groups=q.plans.filter(p=>b?.plans.some(x=>x.id===p.id)).map(p=>({id:p.id,name:p.name,total:p.pieces.filter(x=>!scope||scope.has(x.id)).length,created:p.pieces.filter(x=>(!scope||scope.has(x.id))&&x.item?.listing?.supplier_id).length}));
  const byProduct=new Map(examples.map(e=>[e.product,e]));
  return {batch:b?{id:b.id,status:b.status,target:b.target,error:b.error}:null,collections:groups,missingPieces:pending.length,collectionsWithoutOutfits:groups.filter(g=>g.created===0).length,examples,missingExampleProducts:[...new Set(pending.map(p=>p.choice.product))].filter(id=>!byProduct.has(id)),learning:learned?{created:learned.created,total:JSON.parse(learned.pieces).length,completed:jobs.filter(j=>j.batch===b.id&&studio.learningJob(j.job)?.state==='completed').length,jobs:jobs.filter(j=>j.batch===b.id).map(j=>({...j,result:studio.learningJob(j.job)}))}:null,publication:'AI Made only. Owner approval is required for the store.',rules:['Use only this hoodie’s original artwork.','Follow the saved example for this exact garment and size.','Keep the visible artwork proportions and positioning.','No automatic scene tiling, exterior brand logos or inherited crop permission.','Missing artwork or a changed template holds that piece.'],signature:hash([b?.id,pending.map(p=>[p.id,p.choice.setId,p.choice.product,p.revision]),examples.map(e=>[e.product,e.job,e.revision])])};
 }
 async function start(b){
  if(starting)hold('An outfit continuation is being saved.');starting=true;
  try{
   const view=inventory();if(b.confirm!==true||b.signature!==view.signature)hold('Refresh the hoodie and placement preview before starting.');
   if(!view.batch||!['paused','blocked'].includes(view.batch.status)||basic.batchCurrent())hold('Pause new production and finish the active product before starting this continuation.');
   if(view.missingExampleProducts.length)hold('These supplier products have no completed owner placement example: '+view.missingExampleProducts.join(', '));
   if(get("SELECT id FROM factory_jobs WHERE status IN ('running','queued','retry_wait') LIMIT 1"))hold('Finish the current worker step before starting this continuation.');
   if(!basic.githubReady())hold('The existing private working storage must be ready.');
   db.prepare("UPDATE factory_settings SET state='paused' WHERE id=1").run();
   const existing=get('SELECT * FROM factory_outfit_learning WHERE batch=?',view.batch.id);
   if(existing){await outfits.controlBatch({id:view.batch.id,action:'resume',target:'ai-made',confirm:true});db.prepare("UPDATE factory_settings SET state='running' WHERE id=1").run();await basic.checkpoint();return inventory();}
   const q=outfits.snapshot(),scope=q.batch.scope?new Set(q.batch.scope.pieceIds):null,pieces=q.plans.filter(p=>q.batch.plans.some(x=>x.id===p.id)).flatMap(p=>p.pieces).filter(p=>(!scope||scope.has(p.id))&&!p.item);
   // Persist the immutable example IDs before enabling the worker. A restart
   // never selects a different design or repeats an accepted Printful task.
   db.prepare('INSERT INTO factory_outfit_learning VALUES(?,?,?,?)').run(view.batch.id,JSON.stringify(pieces.map(p=>p.id)),JSON.stringify(view.examples),clock());
   await basic.checkpoint();await outfits.controlBatch({id:view.batch.id,action:'resume',target:'ai-made',confirm:true});
   db.prepare("UPDATE factory_settings SET state='running',updated=? WHERE id=1").run(new Date(clock()).toISOString());await basic.checkpoint();return inventory();
  }finally{starting=false;}
 }
 async function follow(batch,p,item){
  const r=get('SELECT * FROM factory_outfit_learning WHERE batch=?',batch.id);if(!r)hold('The AI Made continuation has no saved owner authorization.');
  if(!JSON.parse(r.pieces).includes(p.id))return true; // Earlier finished pieces stay untouched.
  let tracked=get('SELECT * FROM factory_outfit_learning_jobs WHERE piece=?',p.id);
  if(tracked){const job=studio.learningJob(tracked.job);if(!job)hold('The saved outfit update is missing. Reconcile it before retrying.');if(job.state==='failed'||job.state==='cancelled')hold('Outfit update '+job.id+': '+(job.error||job.state));return job.state==='completed'&&(job.previewReady||job.printfulUpdated)&&job.images>0;}
  const example=JSON.parse(r.examples).find(e=>e.product===p.choice.product);if(!example)hold('No saved owner example for this garment.');
  const job=await studio.followExample('piece:'+p.id,example.job);
  db.prepare('INSERT INTO factory_outfit_learning_jobs VALUES(?,?,?,?,?,?)').run(p.id,batch.id,String(job.supplier),example.job,job.id,clock());await basic.checkpoint();return false;
 }
 return {inventory,follow,async handle(req,res,path,method){if(path!==ROOT)return false;auth(req,null,true);if(method==='GET'){send(res,200,inventory());return true;}if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'outfit-learning',6);send(res,202,await start(await body(req)));return true;}};
}
