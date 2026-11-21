import {createHash,randomUUID} from 'node:crypto';
const ROOT='/api/owner/ai-factory/tapestries';
const roles=['front','back'];
const digest=data=>createHash('sha256').update(data).digest('hex');
const parse=s=>JSON.parse(s||'{}');
// Preparation records are private and cannot authorize publication or supplier orders.
// Never infer original artwork roles from upload order or a supplier preview URL.
export function factoryTapestries({db,auth,body,send,fail,limit,origin,checkpoint=async()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_tapestry_editions(
 id TEXT PRIMARY KEY,collection_id TEXT NOT NULL,collection_name TEXT NOT NULL,
 edition TEXT NOT NULL CHECK(edition IN ('front','back')),revision INTEGER NOT NULL,
 document TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,
 UNIQUE(collection_id,edition));
 CREATE TABLE IF NOT EXISTS factory_tapestry_history(
 edition TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,created TEXT NOT NULL,
 PRIMARY KEY(edition,revision));`);
 const has=t=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
 const all=(s,...a)=>db.prepare(s).all(...a),get=(s,...a)=>db.prepare(s).get(...a);
 function collections(){
  const groups=new Map(),sets=has('idea_sets')?all('SELECT * FROM idea_sets'):[];
  const add=(id,name,setId=null)=>{if(!groups.has(id))groups.set(id,{id,name,setIds:[],outfitIds:[]});const c=groups.get(id);if(setId&&!c.setIds.includes(setId))c.setIds.push(setId);return c;};
  // Include all outfits, including unpublished and newer runs; no pagination limit.
  if(has('factory_outfits'))for(const o of all('SELECT * FROM factory_outfits')){
   const setIds=new Set();
   if(has('factory_basic_outfit_pieces'))for(const p of all('SELECT choice FROM factory_basic_outfit_pieces WHERE outfit=?',o.id)){const c=parse(p.choice);if(c.setId)setIds.add(c.setId);}
   const matches=sets.filter(s=>setIds.has(s.id)||s.name===o.artwork_collection||s.name===o.collection);
   const key=matches.length===1?'set:'+matches[0].id:'outfit:'+o.id;
   const c=add(key,o.collection||o.name);c.outfitIds.push(o.id);for(const s of matches)if(!c.setIds.includes(s.id))c.setIds.push(s.id);
  }
  for(const s of sets){const linked=[...groups.values()].find(g=>g.setIds.includes(s.id));if(!linked)add('set:'+s.id,s.name,s.id);}
  if(has('factory_artwork'))for(const a of all("SELECT DISTINCT collection FROM factory_artwork WHERE kind='original'"))if(![...groups.values()].some(g=>g.name===a.collection||g.setIds.some(id=>sets.find(s=>s.id===id)?.name===a.collection)))add('art:'+a.collection,a.collection);
  return [...groups.values()];
 }
 function candidates(c,role){
  if(!has('factory_artwork'))return [];
  // An explicit source role in the original filename/name is required. Existing
  // idea_sets.parts may have been guessed by uploadSets and is not provenance.
  return all("SELECT * FROM factory_artwork WHERE kind='original' AND collection=?",c.name).filter(a=>{
   const name=a.name+' '+a.filename;
   return new RegExp('(?:^|[^a-z])'+role+'(?:[^a-z]|$)','i').test(name)&&!/(mockup|screenshot|template|print.panel|preview)/i.test(name)&&!new RegExp('(?:^|[^a-z])'+(role==='front'?'back':'front')+'(?:[^a-z]|$)','i').test(name);
  }).map(a=>({id:a.id,name:a.name,sha256:a.sha256,url:'/api/owner/ai-factory/artwork/'+a.id+'/file'}));
 }
 function source(id,c){
  if(!has('factory_artwork'))return null;
  const a=get('SELECT * FROM factory_artwork WHERE id=?',id);
  if(!a||a.kind!=='original'||a.original!==a.id||a.collection!==c.name||!a.data?.length||digest(a.data)!==a.sha256||parse(a.permissions).reuse!==true||/(mockup|screenshot|template|print.panel|preview)/i.test(a.name+' '+a.filename))return null;
  return a;
 }
 function view(r,c){
  const d=parse(r.document),problems=[];
  if(!d.artworkId)problems.push(candidates(c,r.edition).length>1?'More than one original matches this role. Assign the exact original.':'Original '+r.edition.toUpperCase()+' artwork has not been explicitly assigned.');
  else if(!source(d.artworkId,c)||source(d.artworkId,c).sha256!==d.artworkSha256)problems.push('Assigned original is missing, belongs to another collection, has changed bytes, or does not permit reuse.');
  // Do not label a private preparation record as a created supplier product.
  problems.push('Supplier inventory has not been reconciled for duplicates.');
  problems.push('Live size-specific templates, safe areas and bleed require verification before rendering.');
  problems.push('Pilot front/back production files, pricing and permanent mockups have not passed full workflow verification.');
  return {...r,document:d,status:'blocked',reasons:problems,candidates:candidates(c,r.edition),supplierProductCreated:false,storeListingPublished:false};
 }
 function snapshot(){const groups=collections();return {collections:groups.map(c=>({...c,front:edition(c,'front'),back:edition(c,'back')})),pilotVerified:false,publication:'Private preparation only; owner approval required.',implementationStage:'preparation',blocker:'Supplier reconciliation and a verified tapestry production profile are required.'};}
 function edition(c,role){const r=get('SELECT * FROM factory_tapestry_editions WHERE collection_id=? AND edition=?',c.id,role);return r?view(r,c):{status:'blocked',reasons:['Private edition has not been prepared.'],candidates:candidates(c,role)};}
 async function prepare(){
  const date=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{for(const c of collections())for(const role of roles){const matches=candidates(c,role),id=randomUUID(),d={name:c.name+' — '+(role==='front'?'Front':'Back')+' Artwork Tapestry',description:c.name+' original '+role+' artwork, adapted as a separate indoor wall tapestry edition.',artworkId:matches.length===1?matches[0].id:null,artworkSha256:matches.length===1?matches[0].sha256:null,catalogProductId:973,layout:{fit:'contain',repeat:false,stretch:false,background:'#000000'},sizes:[],prices:{},mockups:[]};db.prepare('INSERT OR IGNORE INTO factory_tapestry_editions VALUES(?,?,?,?,?,?,?,?)').run(id,c.id,c.name,role,1,JSON.stringify(d),date,date);}
   db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  await checkpoint();return snapshot();
 }
 async function save(b){
  const r=get('SELECT * FROM factory_tapestry_editions WHERE id=?',b.id);if(!r)fail(404,'Tapestry edition not found.');if(b.revision!==r.revision)fail(409,'This edition changed. Reload before saving.');
  const c=collections().find(c=>c.id===r.collection_id);if(!c)fail(409,'Collection link is missing.');const d=parse(r.document),p=b.changes;
  if(!p||Object.keys(p).some(k=>!['name','description','artworkId','background'].includes(k)))fail(400,'Unsupported tapestry draft field.');
  for(const [key,max]of [['name',200],['description',6000]])if(key in p){if(typeof p[key]!=='string'||!p[key].trim()||p[key].length>max)fail(400,'Invalid '+key+'.');d[key]=p[key].trim();}
  if('background'in p){if(!/^#[a-f0-9]{6}$/i.test(p.background))fail(400,'Use a six-digit background color.');d.layout.background=p.background;}
  if('artworkId'in p){const a=source(p.artworkId,c);if(!a)fail(409,'Select a preserved original in this collection with reuse permission.');d.artworkId=a.id;d.artworkSha256=a.sha256;}
  const date=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT INTO factory_tapestry_history VALUES(?,?,?,?)').run(r.id,r.revision,r.document,date);
   const result=db.prepare('UPDATE factory_tapestry_editions SET document=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(JSON.stringify(d),date,r.id,r.revision);if(!result.changes)fail(409,'Edition changed. Reload before saving.');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}await checkpoint();return view(get('SELECT * FROM factory_tapestry_editions WHERE id=?',r.id),c);
 }
 return {snapshot,prepare,save,async handle(req,res,path,method){
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;auth(req,null,true);
  if(method==='GET'&&path===ROOT){send(res,200,snapshot());return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'tapestries',20);
  if(path===ROOT+'/prepare'){await body(req);send(res,200,await prepare());return true;}
  if(path===ROOT+'/save'){send(res,200,await save(await body(req)));return true;}
  fail(409,'Tapestry production is blocked until the supplier inventory, original roles and pilot workflow are verified.');
 }};
}
