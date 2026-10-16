import {randomUUID} from 'node:crypto';

const ROOT='/api/owner/ai-factory/basic/outfits';

// A persistent plan feeds the existing one-item lane. Waiting pieces hold no
// rendered pixels, supplier drafts or leases; owner review remains per product.
export function factoryBasicOutfits({db,basic,auth,body,send,fail,limit,origin,clock=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_outfit_runs(
  id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
  status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_basic_outfit_pieces(
  id TEXT PRIMARY KEY,outfit TEXT NOT NULL,ordinal INTEGER NOT NULL,role TEXT NOT NULL,
  choice TEXT NOT NULL,signature TEXT NOT NULL,item TEXT,error TEXT NOT NULL DEFAULT '',
  UNIQUE(outfit,ordinal));
 CREATE TABLE IF NOT EXISTS factory_basic_outfit_revisions(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,piece TEXT NOT NULL,item TEXT NOT NULL,choice TEXT NOT NULL,signature TEXT NOT NULL,created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS factory_basic_one_outfit ON factory_basic_outfit_runs((1))
  WHERE status IN ('running','paused','held');`);
 if(!db.prepare('PRAGMA table_info(factory_basic_outfit_pieces)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE factory_basic_outfit_pieces ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const now=()=>new Date(clock()).toISOString(),open=()=>get("SELECT * FROM factory_basic_outfit_runs WHERE status IN ('running','paused','held') LIMIT 1");
 const requestKey=p=>'basic-outfit_'+p.id+(p.revision>1?'_r'+p.revision:'');
 let planning=false,ticking=false;
 function pieces(id) {
  return all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=? ORDER BY ordinal',id).map(p=>{
   const item=p.item&&get('SELECT id,job,status,closed,decision,error,cleanup FROM factory_basic_items WHERE id=?',p.item);
   const job=item?.job&&get('SELECT status,error FROM factory_jobs WHERE id=?',item.job);
   const listing=item?.job&&get('SELECT supplier_id,store_id,status FROM factory_listings WHERE job=?',item.job);
   return {...p,choice:JSON.parse(p.choice),item:item?{...item,jobStatus:job?.status||null,error:item.error||job?.error||'',cleanup:item.cleanup?JSON.parse(item.cleanup):null,listing:listing||null}:null};
  });
 }
 function summary(r) {if(!r)return null;const list=pieces(r.id);return {...r,pieces:list,done:list.filter(p=>p.item?.closed).length,total:list.length,published:list.filter(p=>p.item?.status==='published').length};}
 function snapshot() {return {active:summary(open()),recent:all('SELECT * FROM factory_basic_outfit_runs ORDER BY created DESC,rowid DESC LIMIT 20').map(summary),oneProductAtATime:true,reviewPerPiece:true};}
 function attach(p,item) {
  run('UPDATE factory_basic_outfit_pieces SET item=?,error=\'\' WHERE id=?',item.id,p.id);
  const template=item.job&&get('SELECT templates FROM factory_job_profiles WHERE job=?',item.job);
  if(template)run('INSERT INTO factory_outfit_items(id,outfit,role,template,job,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET template=excluded.template,job=excluded.job,revision=excluded.revision,store_product=NULL,approved=0',p.id,p.outfit,p.role,JSON.parse(template.templates)[0]||'',item.job,p.revision);
 }
 async function tick() {
  if(ticking||planning)return;ticking=true;
  try {
   const r=open();if(!r||r.status!=='running')return;
   if(get('SELECT state FROM factory_settings WHERE id=1').state!=='running')return;
   // Reconcile a crash after Basic saved the new item but before the queue pointer.
   for(const p of all('SELECT * FROM factory_basic_outfit_pieces WHERE outfit=? AND item IS NULL',r.id)) {
    const item=get('SELECT * FROM factory_basic_items WHERE request_key=?',requestKey(p));
    if(item)attach(p,item);
   }
   const list=pieces(r.id);
   for(const p of list.filter(p=>p.item?.closed&&p.item.status==='published')) {
    run('UPDATE factory_outfit_items SET store_product=?,approved=1 WHERE id=?',String(p.item.listing.store_id),p.id);
   }
   const next=list.find(p=>!p.item?.closed);
   if(!next) {
    const published=list.every(p=>p.item?.status==='published'&&p.item.cleanup?.verified);
    run("UPDATE factory_basic_outfit_runs SET status=?,error='',updated=? WHERE id=?",published?'complete':'reviewed',now(),r.id);
    run('UPDATE factory_outfits SET published=? WHERE id=?',Number(published),r.id);
    await basic.checkpoint();return;
   }
   if(next.item)return; // The active item must be reviewed and cleaned first.
   if(get('SELECT id FROM factory_basic_items WHERE closed=0'))return;
   await basic.checkpoint();
   try {
    const item=await basic.create({...next.choice,requestKey:requestKey(next)},{outfitId:r.id,collection:r.name,signature:next.signature});
    attach(next,item);run("UPDATE factory_basic_outfit_runs SET error='',updated=? WHERE id=?",now(),r.id);
    await basic.checkpoint(item.job);
   } catch(e) {
    const item=get('SELECT * FROM factory_basic_items WHERE request_key=?',requestKey(next));if(item)attach(next,item);
    run('UPDATE factory_basic_outfit_pieces SET error=? WHERE id=?',e.message.slice(0,500),next.id);
    run("UPDATE factory_basic_outfit_runs SET status='held',error=?,updated=? WHERE id=?",e.message.slice(0,500),now(),r.id);
    await basic.checkpoint(item?.job);
   }
  } finally {ticking=false;}
 }
 async function create(b) {
  if(typeof b.requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(b.requestKey))fail(400,'A stable outfit request ID is required.');
  const replay=get('SELECT * FROM factory_basic_outfit_runs WHERE request_key=?',b.requestKey);if(replay)return summary(replay);
  if(planning||ticking||open()||get('SELECT id FROM factory_basic_items WHERE closed=0'))fail(409,'Finish the current item or outfit before starting another.');
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!Array.isArray(b.pieces)||b.pieces.length<2||b.pieces.length>11||new Set(b.pieces.map(p=>p.product)).size!==b.pieces.length)fail(400,'Name the outfit and choose 2–11 distinct garments.');
  const blockers=basic.snapshot().blockers;if(blockers.length)fail(409,blockers.map(x=>x.message).join(' '));
  if(get("SELECT id FROM factory_jobs WHERE status IN ('queued','running','retry_wait') LIMIT 1"))fail(409,'Finish or pause existing production before starting an outfit.');
  planning=true;let id;
  try {
   const checked=[];
   for(const piece of b.pieces) {
    const choice={setId:b.setId,audience:b.audience||'unisex',product:piece.product,sizes:piece.sizes||[],adaptArtwork:b.adaptArtwork===true};
    const p=await basic.inspect(choice);checked.push({choice,p,signature:basic.inspectionSignature(p)});
   }
   if(new Set(checked.map(x=>x.p.role)).size!==checked.length)fail(400,'Choose one garment per clothing category for this outfit.');
   if(open()||get('SELECT id FROM factory_basic_items WHERE closed=0')||get("SELECT id FROM factory_jobs WHERE status IN ('queued','running','retry_wait') LIMIT 1"))fail(409,'Production changed while checking this outfit. Refresh before starting.');
   if(get('SELECT count(*) n FROM factory_basic_outfit_runs').n>=100)fail(409,'The 100-outfit planning limit is reached.');
   id=randomUUID();db.exec('BEGIN IMMEDIATE');
   try {
    run('INSERT INTO factory_basic_outfit_runs VALUES(?,?,?,?,?,?,?)',id,b.requestKey,b.name.trim(),'running','',now(),now());
    const set=checked[0].p.set;
    run('INSERT INTO factory_outfits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,id,1,b.name.trim(),'Coordinated original artwork',b.name.trim(),set.name,JSON.stringify(['#000000']),'Keep this design set coordinated; black backgrounds; preserve artwork proportions. Owner review for each piece.',b.audience||'unisex','[]',0,now());
    checked.forEach(({choice,p,signature},ordinal)=>run('INSERT INTO factory_basic_outfit_pieces(id,outfit,ordinal,role,choice,signature) VALUES(?,?,?,?,?,?)',randomUUID(),id,ordinal,p.role,JSON.stringify(choice),signature));
    run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   await basic.checkpoint();
  }finally{planning=false;}
  await tick();return summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',id));
 }
 async function replace(b) {
  if(typeof b.requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(b.requestKey))fail(400,'A stable replacement request ID is required.');
  const replay=get('SELECT piece FROM factory_basic_outfit_revisions WHERE request_key=?',b.requestKey);if(replay){const p=get('SELECT outfit FROM factory_basic_outfit_pieces WHERE id=?',replay.piece);return summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',p.outfit));}
  const p=get('SELECT * FROM factory_basic_outfit_pieces WHERE id=? AND outfit=?',b.pieceId,b.id),item=p?.item&&get('SELECT * FROM factory_basic_items WHERE id=?',p.item);
  if(!p||!item?.closed||item.decision!=='disapproved'||!JSON.parse(item.cleanup||'{}').verified)fail(409,'Only a rejected piece with verified cleanup can be rebuilt.');
  if(planning||ticking||get('SELECT id FROM factory_basic_items WHERE closed=0')||open()&&open().id!==p.outfit)fail(409,'Finish the current piece or outfit before rebuilding this piece.');
  planning=true;
  try {
   const choice={...JSON.parse(p.choice),setId:b.setId,adaptArtwork:b.adaptArtwork===true},checked=await basic.inspect(choice);if(checked.role!==p.role)fail(409,'A replacement must keep the original clothing category.');
   if(get('SELECT id FROM factory_basic_items WHERE closed=0')||open()&&open().id!==p.outfit)fail(409,'Production changed. Refresh before rebuilding this piece.');
   db.exec('BEGIN IMMEDIATE');try{
   run('INSERT INTO factory_basic_outfit_revisions VALUES(?,?,?,?,?,?,?)',randomUUID(),b.requestKey,p.id,item.id,p.choice,p.signature,now());
   run("UPDATE factory_basic_outfit_pieces SET choice=?,signature=?,item=NULL,error='',revision=revision+1 WHERE id=?",JSON.stringify(choice),basic.inspectionSignature(checked),p.id);
   run("UPDATE factory_basic_outfit_runs SET status='running',error='',updated=? WHERE id=?",now(),p.outfit);run('UPDATE factory_outfits SET published=0 WHERE id=?',p.outfit);run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}await basic.checkpoint();
  }finally{planning=false;}
  await tick();return summary(get('SELECT * FROM factory_basic_outfit_runs WHERE id=?',p.outfit));
 }
 return {snapshot,activeId:()=>open()?.id||null,tick,async handle(req,res,path,method) {
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;auth(req,null,true);
  if(method==='GET'&&path===ROOT){send(res,200,snapshot());return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'basic-outfits',30);const b=await body(req);
  if(path===ROOT+'/replace'){send(res,200,await replace(b));return true;}
  if(path===ROOT+'/create'){send(res,200,await create(b));return true;}
  if(path!==ROOT+'/control')fail(404,'Outfit action not found.');
  const r=open();if(!r||r.id!==b.id)fail(404,'Open outfit not found.');
  if(!['pause','resume','cancel'].includes(b.action))fail(400,'Choose pause, resume or cancel.');
  if(b.action==='cancel'&&get('SELECT id FROM factory_basic_items WHERE closed=0'))fail(409,'Finish or disapprove the active item and confirm cleanup before cancelling the remaining outfit.');
  run('UPDATE factory_basic_outfit_runs SET status=?,error=\'\',updated=? WHERE id=?',b.action==='pause'?'paused':b.action==='cancel'?'cancelled':'running',now(),r.id);
  if(b.action==='resume')run("UPDATE factory_settings SET state='running',updated=? WHERE id=1",now());
  await basic.checkpoint(basic.currentJob());if(b.action==='resume')await tick();send(res,200,snapshot());return true;
 }};
}
