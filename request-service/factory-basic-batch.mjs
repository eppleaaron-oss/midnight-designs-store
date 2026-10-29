import {randomUUID} from 'node:crypto';

export function temporaryBatchFailure(error){
 const message=typeof error==='string'?error:error?.message||'';
 if(/uncertain|reconcil|authentication|checksum|identity mismatch|retry limit exhausted/i.test(message))return false;
 return error?.status===429||[502,504].includes(error?.status)||['ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code||error?.code)||/^(fetch failed$|Printful is temporarily unreachable[.!]|GitHub working storage is unavailable[.!]|GitHub store connection is unavailable[.!]|request timed out|connect timeout)/i.test(message);
}

// Explicit owner authorization for a named, finite set of existing collection
// requests. This never enables the factory's global automatic publishing mode.
export function factoryBasicBatch({db,basic,summary,attach,open,clock=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_batches(
  id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,plans TEXT NOT NULL,recipes TEXT NOT NULL,
  status TEXT NOT NULL,accept_missing_model INTEGER NOT NULL,current_plan TEXT,error TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS factory_basic_one_batch ON factory_basic_batches((1)) WHERE status IN ('running','paused','blocked');
 CREATE TABLE IF NOT EXISTS factory_basic_batch_holds(batch TEXT NOT NULL,piece TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(batch,piece));
 CREATE TABLE IF NOT EXISTS factory_basic_batch_items(batch TEXT NOT NULL,item TEXT NOT NULL,recipe_key TEXT NOT NULL,PRIMARY KEY(batch,item));`);
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_batch_retries(batch TEXT NOT NULL,piece TEXT NOT NULL,attempts INTEGER NOT NULL,next_attempt INTEGER NOT NULL,error TEXT NOT NULL,PRIMARY KEY(batch,piece));`);
 if(!db.prepare('PRAGMA table_info(factory_basic_batches)').all().some(c=>c.name==='target'))db.exec("ALTER TABLE factory_basic_batches ADD COLUMN target TEXT NOT NULL DEFAULT 'storefront'");
 if(!db.prepare('PRAGMA table_info(factory_basic_batches)').all().some(c=>c.name==='scope'))db.exec("ALTER TABLE factory_basic_batches ADD COLUMN scope TEXT");
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const now=()=>new Date(clock()).toISOString(),active=()=>get("SELECT * FROM factory_basic_batches WHERE status IN ('running','paused','blocked') LIMIT 1");
 let busy=false,follower=null;
 const selected=(r,p)=>!r.scope||JSON.parse(r.scope).pieceIds.includes(p.id);
 function snapshot(row){const r=row||active()||get('SELECT * FROM factory_basic_batches ORDER BY created DESC LIMIT 1');if(!r)return null;
  const plans=JSON.parse(r.plans).map(id=>summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',id))).filter(Boolean),items=plans.flatMap(p=>p.pieces).filter(p=>selected(r,p)),scope=r.scope?JSON.parse(r.scope):null;
  return {...r,scope,retries:all('SELECT piece,attempts,next_attempt,error FROM factory_basic_batch_retries WHERE batch=?',r.id),newTotal:items.length,existingCount:scope?.existingIds.length||0,collectionTotal:items.length+(scope?.existingIds.length||0),plans:plans.map(p=>({id:p.id,name:p.name,total:p.pieces.filter(piece=>selected(r,piece)).length,published:p.pieces.filter(piece=>selected(r,piece)&&piece.item?.status==='published'&&piece.item.cleanup?.verified).length,printfulCreated:p.pieces.filter(piece=>selected(r,piece)&&piece.item?.cleanup?.verified&&['published','supplier_created'].includes(piece.item.status)).length})),printfulCreated:items.filter(p=>p.item?.cleanup?.verified&&['published','supplier_created'].includes(p.item.status)).length,recipes:JSON.parse(r.recipes),acceptMissingModel:!!r.accept_missing_model,total:items.length,published:items.filter(p=>p.item?.status==='published'&&p.item.cleanup?.verified).length,activeItem:items.find(p=>p.item&&!p.item.closed)?.item.id||null,holds:all('SELECT piece,reason FROM factory_basic_batch_holds WHERE batch=?',r.id)};
 }
 async function start(b){
  if(b.confirm!==true||typeof b.requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(b.requestKey))throw Error('Confirm this finite publication batch with a stable request key.');
  const replay=get('SELECT * FROM factory_basic_batches WHERE request_key=?',b.requestKey);if(replay)return snapshot(replay);
  if(active()||open()||basic.batchCurrent())throw Error('Finish the active item or batch before starting another.');
  if(!Array.isArray(b.planIds)||!b.planIds.length||b.planIds.length>90||new Set(b.planIds).size!==b.planIds.length)throw Error('Choose distinct saved collection requests.');
  const plans=b.planIds.map(id=>get("SELECT * FROM factory_basic_outfit_runs WHERE id=? AND status='planned'",id));if(plans.some(p=>!p))throw Error('A selected saved request is unavailable.');
  if(!Array.isArray(b.recipes)||!b.recipes.length||b.recipes.length>19||new Set(b.recipes.map(r=>r.product)).size!==b.recipes.length)throw Error('Supply distinct inspected product recipes.');
  for(const recipe of b.recipes){if(!Number.isSafeInteger(recipe.product)||!recipe.layout||!Array.isArray(recipe.sizes)||typeof recipe.audience!=='string')throw Error('Every product needs an exact numeric layout, audience and size selection.');
   if(!plans.some(p=>all('SELECT choice FROM factory_basic_outfit_pieces WHERE outfit=?',p.id).some(x=>JSON.parse(x.choice).product===recipe.product)))throw Error('A recipe is outside the selected collection requests.');}
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{
   run("INSERT INTO factory_basic_batches(id,request_key,plans,recipes,status,accept_missing_model,current_plan,error,created,updated) VALUES(?,?,?,?, 'running',?,NULL,'',?,?)",id,b.requestKey,JSON.stringify(b.planIds),JSON.stringify(b.recipes),Number(b.acceptMissingModel===true),now(),now());
   for(const plan of plans)for(const p of all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',plan.id))run("INSERT OR IGNORE INTO factory_outfit_items(id,outfit,role,template,job,revision,approved) VALUES(?,?,?,'','',?,0)",p.id,p.outfit,p.role,p.revision);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  await basic.checkpoint();return snapshot();
 }
 function hold(batch,p,reason){const message=String(reason).slice(0,500);run('INSERT INTO factory_basic_batch_holds VALUES(?,?,?) ON CONFLICT(batch,piece) DO UPDATE SET reason=excluded.reason',batch,p.id,message);run('UPDATE factory_basic_outfit_pieces SET error=? WHERE id=?',message,p.id);}
 async function retry(r,p,error){
  const previous=get('SELECT * FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,p.id),attempts=(previous?.attempts||0)+1,message=String(error.message||error).slice(0,500);
  const next=clock()+Math.max(Math.min(600000,30000*2**Math.min(attempts-1,5)),Math.max(0,Number(error.retryAfter)||0)*1000);
  run('INSERT INTO factory_basic_batch_retries VALUES(?,?,?,?,?) ON CONFLICT(batch,piece) DO UPDATE SET attempts=excluded.attempts,next_attempt=excluded.next_attempt,error=excluded.error',r.id,p.id,attempts,next,message);
  if(attempts>=8){hold(r.id,p,'Temporary connection retry limit exhausted: '+message);run("UPDATE factory_basic_batches SET status='blocked',error=?,updated=? WHERE id=?",'Temporary connection retry limit exhausted. Review the saved selection before resuming.',now(),r.id);}
  else {run('DELETE FROM factory_basic_batch_holds WHERE batch=? AND piece=?',r.id,p.id);run("UPDATE factory_basic_batches SET status='running',error=?,updated=? WHERE id=?",'Temporary connection failure. Retry '+attempts+'/8 at '+new Date(next).toISOString()+': '+message,now(),r.id);}
  await basic.checkpoint();
 }
 async function tick(){if(busy)return;const r=active();if(!r||get('SELECT state FROM factory_settings WHERE id=1').state!=='running')return;
  // Older versions stored preflight outages as permanent holds. Recover only
  // unstarted, selected pieces; never clear an uncertain supplier operation.
  if(r.status==='blocked'&&!basic.batchCurrent()){
   const held=all('SELECT piece,reason FROM factory_basic_batch_holds WHERE batch=?',r.id);
   const safe=held.length&&held.every(h=>{const p=get('SELECT * FROM factory_basic_outfit_pieces WHERE id=?',h.piece);return p&&!p.item&&JSON.parse(r.plans).includes(p.outfit)&&selected(r,p)&&temporaryBatchFailure(h.reason)&&!get('SELECT * FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,p.id)&&!get('SELECT id FROM factory_basic_items WHERE request_key=?','basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:''));});
   if(safe){busy=true;try{for(const h of held)await retry(r,{id:h.piece},Error(h.reason));}finally{busy=false;}return;}
  }
  if(r.status!=='running')return;busy=true;
  try{
   const current=basic.batchCurrent();
   if(current){let authorization=get('SELECT recipe_key FROM factory_basic_batch_items WHERE batch=? AND item=?',r.id,current.id);
    if(!authorization){const recipe=JSON.parse(get('SELECT recipe FROM factory_basic_items WHERE id=?',current.id).recipe),plans=JSON.parse(r.plans);
     const piece=all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',recipe.outfitId||'').find(p=>plans.includes(p.outfit)&&current.request_key==='basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'')&&recipe.product===JSON.parse(p.choice).product&&recipe.set.id===JSON.parse(p.choice).setId);
     if(piece){attach(piece,current);run('INSERT INTO factory_basic_batch_items VALUES(?,?,?)',r.id,current.id,current.recipe_key);authorization={recipe_key:current.recipe_key};await basic.checkpoint(current.job);}else return;
    }
    const currentPiece=get('SELECT id FROM factory_basic_outfit_pieces WHERE item=?',current.id),waiting=currentPiece&&get('SELECT next_attempt FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,currentPiece.id);if(waiting&&clock()<waiting.next_attempt)return;
    const frozen=JSON.parse(get('SELECT recipe FROM factory_basic_items WHERE id=?',current.id).recipe),charges=JSON.parse(r.recipes).find(p=>p.product===frozen.product)?.charges;
    if(current.pricing?.status==='held'&&charges){try{await basic.confirmBatchCharges(current.id,authorization.recipe_key,charges);if(currentPiece)run('DELETE FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,currentPiece.id);}catch(e){if(currentPiece&&temporaryBatchFailure(e)){await retry(r,currentPiece,e);return;}run("UPDATE factory_basic_batches SET status='blocked',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);await basic.checkpoint();}return;}
    if(!['printful','ai-made'].includes(r.target)&&current.canApprove)run("UPDATE factory_basic_batches SET error=? WHERE id=?",'Private preview ready in AI Made. Approve this individual product before store publication.',r.id);return;
   }
   const recipes=new Map(JSON.parse(r.recipes).map(p=>[p.product,p]));let changed=false;
   for(const planId of JSON.parse(r.plans)){
    const plan=get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',planId);if(!plan)continue;
    for(const raw of all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=? ORDER BY ordinal',planId)){
     if(!selected(r,raw))continue;
     const p={...raw,choice:JSON.parse(raw.choice)},key='basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'');
     let item=p.item?get('SELECT * FROM factory_basic_items WHERE id=?',p.item):get('SELECT * FROM factory_basic_items WHERE request_key=?',key);
     if(!item){
      // Reuse previously completed standalone pieces from this same source set.
      item=all("SELECT * FROM factory_basic_items WHERE decision='approved' AND closed=1 AND status='published' ORDER BY created").find(i=>{const recipe=JSON.parse(i.recipe);return recipe.set.id===p.choice.setId&&recipe.product===p.choice.product&&JSON.parse(i.cleanup||'{}').verified;});
     }
     if(item){if(!p.item){attach(p,item);changed=true;}
      if(item.closed&&(item.status==='published'||['printful','ai-made'].includes(r.target)&&item.status==='supplier_created')&&JSON.parse(item.cleanup||'{}').verified){if(r.target==='ai-made'){try{if(!follower||!await follower(r,p,item))return;}catch(e){if(temporaryBatchFailure(e)){await retry(r,p,e);return;}hold(r.id,p,e.message);changed=true;continue;}}const listing=get('SELECT store_id FROM factory_listings WHERE job=?',item.job);run('UPDATE factory_outfit_items SET store_product=?,approved=? WHERE id=?',listing?.store_id||null,Number(item.status==='published'),p.id);run('DELETE FROM factory_basic_batch_holds WHERE batch=? AND piece=?',r.id,p.id);continue;}
      if(!item.closed)return;hold(r.id,p,'This piece was rejected or has not completed verified cleanup.');changed=true;continue;
     }
     if(get('SELECT piece FROM factory_basic_batch_holds WHERE batch=? AND piece=?',r.id,p.id))continue;
     const backoff=get('SELECT next_attempt FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,p.id);if(backoff&&clock()<backoff.next_attempt)return;
     const recipe=recipes.get(p.choice.product);if(!recipe){hold(r.id,p,'Product-specific native layout is not prepared. No product was created.');changed=true;continue;}
     if(p.choice.setId.startsWith('unresolved:')){hold(r.id,p,'Original artwork set is missing. A garment screenshot cannot be used as print artwork.');changed=true;continue;}
     try{
      const planned=p.choice.ownerRecipe?.layout||p.choice.designerPlan?.layout||recipe.layout;
      const layout=p.choice.sourceParts?{...planned,assignments:Object.fromEntries(Object.entries(planned.assignments||{}).map(([slot,part])=>[slot,p.choice.sourceParts[part]||part]))}:planned;
      const choice={...p.choice,...recipe,...(p.choice.ownerRecipe||{}),setId:p.choice.setId,layout},checked=await basic.inspect(choice);
      if(!checked.numericLayout||checked.numericLayout.requiresAcceptance)throw Error('The actual artwork needs a newly inspected size or placement.');
      const signature=basic.inspectionSignature(checked);run("UPDATE factory_basic_outfit_pieces SET choice=?,signature=?,error='' WHERE id=?",JSON.stringify(choice),signature,p.id);
      run('UPDATE factory_basic_batches SET current_plan=?,error=\'\',updated=? WHERE id=?',planId,now(),r.id);await basic.checkpoint();
      const made=await basic.create({...choice,requestKey:key},{outfitId:planId,collection:plan.name,signature});attach(p,made);
      const saved=get('SELECT recipe_key FROM factory_basic_items WHERE id=?',made.id);run('INSERT OR IGNORE INTO factory_basic_batch_items VALUES(?,?,?)',r.id,made.id,saved.recipe_key);run('DELETE FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,p.id);await basic.checkpoint(made.job);return;
     }catch(e){
      // A timed-out response may still have saved its item. Attach that exact
      // request before another tick; never manufacture another supplier key.
      const saved=get('SELECT * FROM factory_basic_items WHERE request_key=?',key);if(saved){attach(p,saved);run('INSERT OR IGNORE INTO factory_basic_batch_items VALUES(?,?,?)',r.id,saved.id,saved.recipe_key);run('DELETE FROM factory_basic_batch_retries WHERE batch=? AND piece=?',r.id,p.id);await basic.checkpoint(saved.job);return;}
      if(temporaryBatchFailure(e)){await retry(r,p,e);return;}
      hold(r.id,p,e.message);changed=true;
     }
    }
    const finished=summary(plan);if(finished.pieces.every(p=>p.item?.status==='published'&&p.item.cleanup?.verified))run('UPDATE factory_outfits SET published=1 WHERE id=?',planId);
   }
   const report=snapshot(),complete=(['printful','ai-made'].includes(r.target)?report.printfulCreated:report.published)===report.total&&(r.target!=='ai-made'||report.holds.length===0);run('UPDATE factory_basic_batches SET status=?,current_plan=NULL,error=?,updated=? WHERE id=?',complete?'complete':'blocked',complete?'':'Unfinished products are held with their exact reasons.',now(),r.id);changed=true;
   if(changed)await basic.checkpoint();
  }finally{busy=false;}
 }
 async function control(b){const r=active();if(!r||r.id!==b.id)throw Error('Publication batch not found.');if(!['pause','resume','cancel'].includes(b.action))throw Error('Choose pause, resume or cancel.');
  if(b.action==='cancel'&&basic.batchCurrent())throw Error('Finish the current item before cancelling the remaining batch.');
  if(b.designPlans!==undefined){
   if(b.action!=='pause'||r.status!=='paused'||busy)throw Error('Pause new production before saving designer plans.');
   if(!Array.isArray(b.designPlans)||!b.designPlans.length||b.designPlans.length>600||new Set(b.designPlans.map(p=>p.pieceId)).size!==b.designPlans.length)throw Error('Supply distinct selected outfit pieces.');
   const allowed=new Map(JSON.parse(r.plans).flatMap(id=>all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',id)).filter(p=>selected(r,p)).map(p=>[p.id,p]));
   const updates=b.designPlans.map(plan=>{const piece=allowed.get(plan.pieceId);
    if(!piece||piece.item||get('SELECT id FROM factory_basic_items WHERE request_key=?','basic-outfit_'+piece.id+(piece.revision>1?'_r'+piece.revision:'')))throw Error('Designer plans may change only selected pieces that have not started.');
    if(!plan.layout||!Number.isSafeInteger(plan.layout.number)||typeof plan.note!=='string'||!plan.note.trim()||plan.note.length>1500||JSON.stringify(plan.layout).length>10000)throw Error('Each designer plan needs a measured layout and a design explanation.');
    if(plan.layout.scaleMode!=='fixed'||plan.layout.measureVisible!==true||plan.layout.acceptReduction!==true)throw Error('Designer layouts must preserve proportions and accept only printable size fitting.');
    const choice=JSON.parse(piece.choice);return {piece,choice:{...choice,designerPlan:{planner:'assistant',version:'midnight-outfit-designer-1',layout:plan.layout,note:plan.note.trim(),created:now()}}};
   });
   db.exec('BEGIN IMMEDIATE');try{for(const {piece,choice}of updates)run("UPDATE factory_basic_outfit_pieces SET choice=?,signature='',error='' WHERE id=?",JSON.stringify(choice),piece.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   run('DELETE FROM factory_basic_batch_holds WHERE batch=? AND piece IN (SELECT value FROM json_each(?))',r.id,JSON.stringify(updates.map(p=>p.piece.id)));
  }
  if(b.scope!==undefined){
   if(b.action!=='pause'||r.status!=='paused')throw Error('Pause the existing batch before narrowing its scope.');
   const ids=b.scope?.pieceIds;
   if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Choose distinct existing pieces.');
   const plans=JSON.parse(r.plans).map(id=>summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',id))).filter(Boolean),pieces=plans.flatMap(p=>p.pieces),allowed=new Set(pieces.filter(p=>selected(r,p)).map(p=>p.id));
   if(ids.some(id=>!allowed.has(id)))throw Error('Scope can only narrow the current authorized pieces.');
   if(pieces.some(p=>p.item&&!ids.includes(p.id)))throw Error('Keep all started and completed pieces in this batch scope.');
   if(plans.some(p=>!p.pieces.some(piece=>ids.includes(piece.id))))throw Error('Keep every design family represented.');
   const existingIds=[...new Set(plans.flatMap(p=>p.reusedProducts||[]).map(p=>String(p.id)))];
   if(!Number.isSafeInteger(b.scope.total)||b.scope.total!==ids.length+existingIds.length)throw Error('The total must equal selected pieces plus reused original products.');
   run('UPDATE factory_basic_batches SET scope=? WHERE id=?',JSON.stringify({pieceIds:ids,existingIds,total:b.scope.total}),r.id);
   run('DELETE FROM factory_basic_batch_holds WHERE batch=? AND piece NOT IN (SELECT value FROM json_each(?))',r.id,JSON.stringify(ids));
  }
  if(b.recipes!==undefined){if(b.action!=='resume'||!Array.isArray(b.recipes)||!b.recipes.length||b.recipes.length>19||new Set(b.recipes.map(p=>p.product)).size!==b.recipes.length)throw Error('Supply distinct recipes while resuming this batch.');
   const allowed=new Set(JSON.parse(r.plans).flatMap(id=>all('SELECT choice FROM factory_basic_outfit_pieces WHERE outfit=?',id).map(p=>JSON.parse(p.choice).product)));
   if(b.recipes.some(p=>!allowed.has(p.product)||!p.layout||!Array.isArray(p.sizes)||typeof p.audience!=='string'))throw Error('A resumed recipe is outside the authorized product slots.');run('UPDATE factory_basic_batches SET recipes=? WHERE id=?',JSON.stringify(b.recipes),r.id);}
  if(b.target!==undefined){if(!['printful','ai-made'].includes(b.target)||b.confirm!==true||b.action!=='resume')throw Error('Confirm the finite Printful-only batch explicitly.');if(get('SELECT state FROM factory_settings WHERE id=1').state!=='paused'||get("SELECT id FROM factory_jobs WHERE status='running' LIMIT 1"))throw Error('Pause and finish the worker step before changing destination.');run('UPDATE factory_basic_batches SET target=? WHERE id=?',b.target,r.id);}
  if(b.action==='resume'){run('DELETE FROM factory_basic_batch_holds WHERE batch=?',r.id);run('DELETE FROM factory_basic_batch_retries WHERE batch=?',r.id);}
  run('UPDATE factory_basic_batches SET status=?,error=\'\',updated=? WHERE id=?',b.action==='pause'?'paused':b.action==='cancel'?'cancelled':'running',now(),r.id);await basic.checkpoint();return snapshot();
 }
 function editPiece(id,choice,signature,note){
  if(busy)throw Object.assign(Error('The factory is saving a production step. Try applying this edit again shortly.'),{status:409});
  const p=get('SELECT * FROM factory_basic_outfit_pieces WHERE id=?',id);
  if(!p||p.item||get('SELECT id FROM factory_basic_items WHERE request_key=?','basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'')))throw Object.assign(Error('This piece already started. Its production recipe is preserved.'),{status:409});
  const old=JSON.parse(p.choice);if(old.product!==choice.product||old.setId!==choice.setId)throw Object.assign(Error('Keep the original garment and design family for this waiting piece.'),{status:409});
  run("UPDATE factory_basic_outfit_pieces SET choice=?,signature=?,error='' WHERE id=?",JSON.stringify({...old,layout:choice.layout,ownerRecipe:{...choice,inspectionToken:null},editorNote:note}),signature,id);
  run('DELETE FROM factory_basic_batch_holds WHERE piece=?',id);
 }
 return {setFollower(f){follower=f;},editPiece,start,tick,control,snapshot,inProgress:()=>!!active(),activeOutfit:()=>active()?.current_plan||null};
}
