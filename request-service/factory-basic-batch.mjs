import {randomUUID} from 'node:crypto';

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
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const now=()=>new Date(clock()).toISOString(),active=()=>get("SELECT * FROM factory_basic_batches WHERE status IN ('running','paused','blocked') LIMIT 1");
 let busy=false;
 function snapshot(row){const r=row||active()||get('SELECT * FROM factory_basic_batches ORDER BY created DESC LIMIT 1');if(!r)return null;
  const plans=JSON.parse(r.plans).map(id=>summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',id))).filter(Boolean),items=plans.flatMap(p=>p.pieces);
  return {...r,plans:plans.map(p=>({id:p.id,name:p.name,total:p.total,published:p.published})),recipes:JSON.parse(r.recipes),acceptMissingModel:!!r.accept_missing_model,total:items.length,published:items.filter(p=>p.item?.status==='published'&&p.item.cleanup?.verified).length,activeItem:items.find(p=>p.item&&!p.item.closed)?.item.id||null,holds:all('SELECT piece,reason FROM factory_basic_batch_holds WHERE batch=?',r.id)};
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
   run("INSERT INTO factory_basic_batches VALUES(?,?,?,?, 'running',?,NULL,'',?,?)",id,b.requestKey,JSON.stringify(b.planIds),JSON.stringify(b.recipes),Number(b.acceptMissingModel===true),now(),now());
   for(const plan of plans)for(const p of all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',plan.id))run("INSERT OR IGNORE INTO factory_outfit_items(id,outfit,role,template,job,revision,approved) VALUES(?,?,?,'','',?,0)",p.id,p.outfit,p.role,p.revision);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  await basic.checkpoint();return snapshot();
 }
 function hold(batch,p,reason){const message=String(reason).slice(0,500);run('INSERT INTO factory_basic_batch_holds VALUES(?,?,?) ON CONFLICT(batch,piece) DO UPDATE SET reason=excluded.reason',batch,p.id,message);run('UPDATE factory_basic_outfit_pieces SET error=? WHERE id=?',message,p.id);}
 async function tick(){if(busy)return;const r=active();if(!r||r.status!=='running'||get('SELECT state FROM factory_settings WHERE id=1').state!=='running')return;busy=true;
  try{
   const current=basic.batchCurrent();
   if(current){let authorization=get('SELECT recipe_key FROM factory_basic_batch_items WHERE batch=? AND item=?',r.id,current.id);
    if(!authorization){const recipe=JSON.parse(get('SELECT recipe FROM factory_basic_items WHERE id=?',current.id).recipe),plans=JSON.parse(r.plans);
     const piece=all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=?',recipe.outfitId||'').find(p=>plans.includes(p.outfit)&&current.request_key==='basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'')&&recipe.product===JSON.parse(p.choice).product&&recipe.set.id===JSON.parse(p.choice).setId);
     if(piece){attach(piece,current);run('INSERT INTO factory_basic_batch_items VALUES(?,?,?)',r.id,current.id,current.recipe_key);authorization={recipe_key:current.recipe_key};await basic.checkpoint(current.job);}else return;
    }
    const frozen=JSON.parse(get('SELECT recipe FROM factory_basic_items WHERE id=?',current.id).recipe),charges=JSON.parse(r.recipes).find(p=>p.product===frozen.product)?.charges;
    if(current.pricing?.status==='held'&&charges){try{await basic.confirmBatchCharges(current.id,authorization.recipe_key,charges);}catch(e){run("UPDATE factory_basic_batches SET status='blocked',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);await basic.checkpoint();}return;}
    if(current.canApprove){try{await basic.approveBatch(current.id,authorization.recipe_key,{acceptMissingModel:!!r.accept_missing_model});}catch(e){run("UPDATE factory_basic_batches SET status='blocked',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);}}return;
   }
   const recipes=new Map(JSON.parse(r.recipes).map(p=>[p.product,p]));let changed=false;
   for(const planId of JSON.parse(r.plans)){
    const plan=get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',planId);if(!plan)continue;
    for(const raw of all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=? ORDER BY ordinal',planId)){
     const p={...raw,choice:JSON.parse(raw.choice)},key='basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'');
     let item=p.item?get('SELECT * FROM factory_basic_items WHERE id=?',p.item):get('SELECT * FROM factory_basic_items WHERE request_key=?',key);
     if(!item){
      // Reuse previously completed standalone pieces from this same source set.
      item=all("SELECT * FROM factory_basic_items WHERE decision='approved' AND closed=1 AND status='published' ORDER BY created").find(i=>{const recipe=JSON.parse(i.recipe);return recipe.set.id===p.choice.setId&&recipe.product===p.choice.product&&JSON.parse(i.cleanup||'{}').verified;});
     }
     if(item){if(!p.item){attach(p,item);changed=true;}
      if(item.closed&&item.status==='published'&&JSON.parse(item.cleanup||'{}').verified){const listing=get('SELECT store_id FROM factory_listings WHERE job=?',item.job);run('UPDATE factory_outfit_items SET store_product=?,approved=1 WHERE id=?',listing?.store_id||null,p.id);run('DELETE FROM factory_basic_batch_holds WHERE batch=? AND piece=?',r.id,p.id);continue;}
      if(!item.closed)return;hold(r.id,p,'This piece was rejected or has not completed verified cleanup.');changed=true;continue;
     }
     if(get('SELECT piece FROM factory_basic_batch_holds WHERE batch=? AND piece=?',r.id,p.id))continue;
     const recipe=recipes.get(p.choice.product);if(!recipe){hold(r.id,p,'Product-specific native layout is not prepared. No product was created.');changed=true;continue;}
     if(p.choice.setId.startsWith('unresolved:')){hold(r.id,p,'Original artwork set is missing. A garment screenshot cannot be used as print artwork.');changed=true;continue;}
     try{
      const layout=p.choice.sourceParts?{...recipe.layout,assignments:Object.fromEntries(Object.entries(recipe.layout.assignments||{}).map(([slot,part])=>[slot,p.choice.sourceParts[part]||part]))}:recipe.layout;
      const choice={...p.choice,...recipe,setId:p.choice.setId,layout},checked=await basic.inspect(choice);
      if(!checked.numericLayout||checked.numericLayout.requiresAcceptance)throw Error('The actual artwork needs a newly inspected size or placement.');
      const signature=basic.inspectionSignature(checked);run("UPDATE factory_basic_outfit_pieces SET choice=?,signature=?,error='' WHERE id=?",JSON.stringify(choice),signature,p.id);
      run('UPDATE factory_basic_batches SET current_plan=?,error=\'\',updated=? WHERE id=?',planId,now(),r.id);await basic.checkpoint();
      const made=await basic.create({...choice,requestKey:key},{outfitId:planId,collection:plan.name,signature});attach(p,made);
      const saved=get('SELECT recipe_key FROM factory_basic_items WHERE id=?',made.id);run('INSERT OR IGNORE INTO factory_basic_batch_items VALUES(?,?,?)',r.id,made.id,saved.recipe_key);await basic.checkpoint(made.job);return;
     }catch(e){
      // A timed-out response may still have saved its item. Attach that exact
      // request before another tick; never manufacture another supplier key.
      const saved=get('SELECT * FROM factory_basic_items WHERE request_key=?',key);if(saved){attach(p,saved);run('INSERT OR IGNORE INTO factory_basic_batch_items VALUES(?,?,?)',r.id,saved.id,saved.recipe_key);await basic.checkpoint(saved.job);return;}
      hold(r.id,p,e.message);changed=true;
     }
    }
    const finished=summary(plan);if(finished.pieces.every(p=>p.item?.status==='published'&&p.item.cleanup?.verified))run('UPDATE factory_outfits SET published=1 WHERE id=?',planId);
   }
   const report=snapshot(),complete=report.published===report.total;run('UPDATE factory_basic_batches SET status=?,current_plan=NULL,error=?,updated=? WHERE id=?',complete?'complete':'blocked',complete?'':'Unfinished products are held with their exact reasons.',now(),r.id);changed=true;
   if(changed)await basic.checkpoint();
  }finally{busy=false;}
 }
 async function control(b){const r=active();if(!r||r.id!==b.id)throw Error('Publication batch not found.');if(!['pause','resume','cancel'].includes(b.action))throw Error('Choose pause, resume or cancel.');
  if(b.action==='cancel'&&basic.batchCurrent())throw Error('Finish the current item before cancelling the remaining batch.');
  if(b.recipes!==undefined){if(b.action!=='resume'||!Array.isArray(b.recipes)||!b.recipes.length||b.recipes.length>19||new Set(b.recipes.map(p=>p.product)).size!==b.recipes.length)throw Error('Supply distinct recipes while resuming this batch.');
   const allowed=new Set(JSON.parse(r.plans).flatMap(id=>all('SELECT choice FROM factory_basic_outfit_pieces WHERE outfit=?',id).map(p=>JSON.parse(p.choice).product)));
   if(b.recipes.some(p=>!allowed.has(p.product)||!p.layout||!Array.isArray(p.sizes)||typeof p.audience!=='string'))throw Error('A resumed recipe is outside the authorized product slots.');run('UPDATE factory_basic_batches SET recipes=? WHERE id=?',JSON.stringify(b.recipes),r.id);}
  if(b.action==='resume')run('DELETE FROM factory_basic_batch_holds WHERE batch=?',r.id);
  run('UPDATE factory_basic_batches SET status=?,error=\'\',updated=? WHERE id=?',b.action==='pause'?'paused':b.action==='cancel'?'cancelled':'running',now(),r.id);await basic.checkpoint();return snapshot();
 }
 return {start,tick,control,snapshot,inProgress:()=>!!active(),activeOutfit:()=>active()?.current_plan||null};
}
