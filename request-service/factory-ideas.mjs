import {randomUUID,createHash} from 'node:crypto';import {inflateSync} from 'node:zlib';
import {GARMENTS,fillInstruction} from './factory-runs.mjs';

// The idea team: sorts every design by shape, then keeps a pool of product and full-outfit ideas built from
// proven streetwear layouts. The owner approves ideas in bulk; approved ideas become ordinary factory jobs.
// Nothing here is a trained model: shapes come from the image itself and layouts from the playbook below.

// ---------- design shape ----------
// Reads width and height (and, for PNG, where the visible pixels are) straight from the file.
export function imageInfo(buf){
 if(buf.length>24&&buf.readUInt32BE(0)===0x89504e47)return png(buf);
 if(buf[0]===0xff&&buf[1]===0xd8){for(let i=2;i+9<buf.length;){if(buf[i]!==0xff){i++;continue;}const m=buf[i+1],len=buf.readUInt16BE(i+2);if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return {width:buf.readUInt16BE(i+7),height:buf.readUInt16BE(i+5),box:null};i+=2+len;}return null;}
 if(buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP'){const t=buf.toString('ascii',12,16);
  if(t==='VP8X')return {width:1+buf.readUIntLE(24,3),height:1+buf.readUIntLE(27,3),box:null};
  if(t==='VP8L'){const b=buf.readUInt32LE(21);return {width:1+(b&0x3fff),height:1+((b>>14)&0x3fff),box:null};}
  if(t==='VP8 ')return {width:buf.readUInt16LE(26)&0x3fff,height:buf.readUInt16LE(28)&0x3fff,box:null};}
 return null;
}
function png(buf){
 let w=0,h=0,depth=0,type=0,interlace=0,trns=null;const idat=[];
 for(let i=8;i+8<=buf.length;){const len=buf.readUInt32BE(i),t=buf.toString('ascii',i+4,i+8),d=buf.subarray(i+8,i+8+len);
  if(t==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);depth=d[8];type=d[9];interlace=d[12];}else if(t==='tRNS')trns=d;else if(t==='IDAT')idat.push(d);else if(t==='IEND')break;i+=12+len;}
 const info={width:w,height:h,box:null};
 const channels={0:1,2:3,3:1,4:2,6:4}[type];
 if(depth!==8||interlace||!channels||w*h>40e6)return info;
 if(type!==4&&type!==6&&!(type===3&&trns))return {...info,box:{x:0,y:0,w,h,fill:1}};
 let raw;try{raw=inflateSync(Buffer.concat(idat));}catch{return info;}
 const stride=w*channels;let prev=Buffer.alloc(stride),cur=Buffer.alloc(stride),x0=w,y0=h,x1=-1,y1=-1,solid=0;
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)],row=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
  for(let x=0;x<stride;x++){const a=x>=channels?cur[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;let v=row[x];
   if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
   cur[x]=v&255;}
  for(let x=0;x<w;x++){const alpha=type===3?(trns[cur[x]]??255):cur[x*channels+channels-1];if(alpha>32){solid++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
  [prev,cur]=[cur,prev];}
 if(x1<0)return {...info,box:{x:0,y:0,w:0,h:0,fill:0}};
 const bw=x1-x0+1,bh=y1-y0+1;return {...info,box:{x:x0,y:y0,w:bw,h:bh,fill:solid/(bw*bh)}};
}
// strip: long and thin, made for sleeves, legs and shoe sides. emblem: a small mark or logo for chests, hats and sleeve hits.
// full: a main graphic for fronts, backs, hats, masks and accessories.
export function classify(info,name=''){
 if(!info||!info.width)return {shape:'full',reason:'Size unknown, treated as a full design.'};
 const w=info.box?.w||info.width,h=info.box?.h||info.height,ratio=Math.max(w,h)/Math.max(1,Math.min(w,h));
 if(/\b(sleeves?|legs?|stripes?|bands?|borders?|strips?)\b/i.test(name))return {shape:'strip',reason:'Named as a sleeve, leg or stripe design, so it runs down sleeves, legs and shoe sides.'};
 if(/\b(pocket|chest)\b/i.test(name))return {shape:'emblem',reason:'Named as pocket or chest art, so it sits small on the chest.'};
 if(ratio>=2.2)return {shape:'strip',reason:`${h>w?'Tall':'Wide'} design (${ratio.toFixed(1)} to 1), so it fits sleeves, legs and shoe sides.`};
 if(/\b(logo|emblem|badge|crest|monogram|icon|mark|patch|seal)\b/i.test(name))return {shape:'emblem',reason:'Named like a logo or badge, so it works as a chest, hat or sleeve mark.'};
 if(info.box&&info.box.fill<0.18&&ratio<1.6)return {shape:'emblem',reason:'Light, open design, so it reads best small, like a chest or hat mark.'};
 return {shape:'full',reason:'Solid main graphic, so it leads on fronts, backs, hats and accessories.'};
}
export const SHAPES=[['full','Full design'],['strip','Strip (sleeves and legs)'],['emblem','Emblem (chest and hat marks)']];

// ---------- playbook ----------
// Layouts the big streetwear and sportswear brands use again and again. Each one names which shape goes where.
const TOPS=['tshirt','longsleeve','sweatshirt','hoodie','ziphoodie','jacket'],BOTTOMS=['pants','joggers','shorts'];
const front=g=>['ziphoodie','jacket'].includes(g)?'front-left':'front';
export const PLAYBOOK=[
 {id:'back-hero-chest',label:'Back hero with a chest mark',for:TOPS,needs:['full'],plan:g=>[['back','hero','Oversized back print, up to 14 by 16 inches'],[front(g),'mark','Small left-chest version, about 3.5 to 4 inches wide']]},
 {id:'full-front',label:'Full front statement',for:['tshirt','longsleeve','sweatshirt','hoodie'],needs:['full'],plan:()=>[['front','hero','Centered full-front print, 10 to 12 inches wide']]},
 {id:'back-sleeve-run',label:'Back hero with a sleeve run',for:TOPS.filter(g=>g!=='tshirt'),needs:['full','strip'],plan:g=>[['back','hero','Oversized back print'],['left-sleeve','strip','Runs the length of the sleeve along the outer seam'],[front(g),'mark','Small chest mark']]},
 {id:'mirrored-sleeves',label:'Mirrored sleeves with a clean body',for:['longsleeve','hoodie','ziphoodie','jacket','sweatshirt'],needs:['strip'],plan:()=>[['left-sleeve','strip','Full sleeve run'],['right-sleeve','strip','Mirror of the left sleeve']]},
 {id:'clean-back',label:'Clean front, statement back',for:TOPS,needs:['full'],plan:()=>[['back','hero','Large back print only; the front stays clean']]},
 {id:'hood-hit',label:'Back hero with a hood hit',for:['hoodie','ziphoodie','jacket'],needs:['full'],plan:g=>[['back','hero','Oversized back print'],['hood','mark','Small mark on the hood']]},
 {id:'leg-run',label:'Leg run',for:BOTTOMS,needs:['strip'],plan:()=>[['left-leg','strip','Runs down the outer seam of the left leg']]},
 {id:'mirrored-legs',label:'Mirrored leg runs',for:['pants','joggers'],needs:['strip'],plan:()=>[['left-leg','strip','Outer seam run'],['right-leg','strip','Mirror of the left leg']]},
 {id:'hip-mark',label:'Small hip mark',for:BOTTOMS,needs:[],plan:()=>[['left-leg','mark','Small mark high on the left thigh']]},
 {id:'hat-front',label:'Front center hat mark',for:['hat'],needs:[],plan:()=>[['front','mark','Centered on the front panel, about 2 to 2.5 inches tall']]},
 {id:'mask-print',label:'Mask print',for:['facemask'],needs:[],plan:()=>[['front','hero','Fills the mask face; keep faces and text off the fold']]},
 {id:'shoe-sides',label:'Side panel runs',for:['shoes'],needs:['strip'],plan:()=>[['left-side','strip','Runs along the outer side panel'],['right-side','strip','Mirror on the other shoe'],['tongue','mark','Small tongue mark']]},
 {id:'accessory-front',label:'Front print',for:['accessory'],needs:[],plan:()=>[['front','hero','Main front print']]}
];
const PALETTES=[['Black','Black','Black'],['Black','Charcoal','Black'],['Charcoal','Black','Black'],['Black','Black','Charcoal']];

export function factoryIdeas({db,auth,body,send,fail,limit,origin,manager,brain=null,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS idea_artwork(artwork TEXT PRIMARY KEY,width INTEGER,height INTEGER,shape TEXT NOT NULL,reason TEXT NOT NULL,override TEXT,analyzed TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idea_ideas(id TEXT PRIMARY KEY,signature TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,title TEXT NOT NULL,hero TEXT,pieces TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,jobs TEXT NOT NULL DEFAULT '[]',error TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idea_settings(id INTEGER PRIMARY KEY CHECK(id=1),team INTEGER NOT NULL,pool INTEGER NOT NULL,auto_make INTEGER NOT NULL);
 INSERT OR IGNORE INTO idea_settings VALUES(1,20,40,0);`);
 const all=(q,...a)=>db.prepare(q).all(...a),get=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a),now=()=>new Date(clock()).toISOString();
 const garment=id=>GARMENTS.find(g=>g.id===id);
 const settings=()=>{const s=get('SELECT * FROM idea_settings WHERE id=1');return {team:s.team,pool:s.pool,autoMake:!!s.auto_make};};

 function analyze(max=25){
  const rows=all("SELECT a.id,a.name,a.data FROM factory_artwork a LEFT JOIN idea_artwork i ON i.artwork=a.id WHERE a.kind='original' AND i.artwork IS NULL LIMIT ?",max);
  for(const r of rows){let info=null;try{info=imageInfo(Buffer.from(r.data));}catch{}const c=classify(info,r.name);run('INSERT OR REPLACE INTO idea_artwork VALUES(?,?,?,?,?,NULL,?)',r.id,info?.width||null,info?.height||null,c.shape,c.reason,now());}
  return rows.length;
 }
 const designs=()=>all("SELECT a.id,a.name,a.collection,a.created,i.width,i.height,coalesce(i.override,i.shape) shape,i.shape detected,i.override,i.reason FROM factory_artwork a JOIN idea_artwork i ON i.artwork=a.id WHERE a.kind='original' ORDER BY a.created DESC");

 // Build one idea's pieces. Strips only go on sleeves, legs and shoe sides; a mark uses an emblem when there is one, otherwise a small version of the hero.
 function piece(g,layout,hero,pick,color){
  const placements=[];
  for(const [zone,role,note] of layout.plan(g)){
   const d=role==='hero'?hero:role==='strip'?pick('strip'):pick('emblem')||hero;if(!d)return null;
   placements.push({zone,role,artwork:d.id,name:d.name,note:role==='mark'&&d.id===hero?.id?note+' (a small version of the hero, on purpose)':note});
  }
  return {garment:g,label:garment(g).single,color,layout:layout.label,placements};
 }
 function compose(hero,pool,seed,kind){
  const same=s=>pool.filter(d=>d.shape===s&&d.id!==hero.id),near=s=>{const list=same(s),own=list.filter(d=>d.collection===hero.collection);return own.length?own:list;};
  let n=seed;const pick=s=>{const list=near(s);return list.length?list[(n++)%list.length]:null;};
  const layoutsFor=g=>PLAYBOOK.filter(l=>l.for.includes(g)&&l.needs.every(s=>s==='full'||near(s).length));
  const [top,bottom,head]=PALETTES[seed%PALETTES.length];
  if(kind==='outfit'){
   const topG=['jacket','hoodie','ziphoodie','tshirt','longsleeve','sweatshirt'][seed%6],bottomG=['joggers','pants','shorts'][seed%3];
   const order=[['hat',head],['facemask',head],[topG,top],[bottomG,bottom],['shoes',bottom]];
   const pieces=[];for(const [g,color] of order){const ls=layoutsFor(g);if(!ls.length)continue;const l=ls[(seed+pieces.length)%ls.length],p=piece(g,l,hero,pick,color);if(p)pieces.push(p);}
   if(pieces.length<3)return null;
   return {kind:'outfit',title:`${hero.name} outfit: ${pieces.map(p=>p.label.toLowerCase()).join(', ')}`,pieces,reason:`Head-to-toe set built around ${hero.name}. Every piece shares the hero or a design from the same collection, in a ${top.toLowerCase()} palette.`};
  }
  const gs=GARMENTS.map(g=>g.id).filter(g=>layoutsFor(g).length),g=gs[seed%gs.length],ls=layoutsFor(g),l=ls[Math.floor(seed/gs.length)%ls.length],p=piece(g,l,hero,pick,top);
  return p&&{kind:'product',title:`${hero.name} ${p.label.toLowerCase()}: ${l.label.toLowerCase()}`,pieces:[p],reason:`${l.label} is a proven layout for ${garment(g).label.toLowerCase()}.`};
 }
 const signature=idea=>createHash('sha256').update(JSON.stringify(idea.pieces.map(p=>[p.garment,p.color,p.layout,p.placements.map(x=>[x.zone,x.artwork])]))).digest('hex');

 // One working cycle: sort new designs, then each idea worker drafts one idea while the pool has room.
 function generate({force=false}={}){
  analyze();const s=settings(),pool=designs();
  const heroes=pool.filter(d=>d.shape==='full'),waiting=get("SELECT count(*) n FROM idea_ideas WHERE status='new'").n;
  let room=Math.min(s.team,force?s.team:s.pool-waiting),made=0;if(room<=0||!heroes.length)return 0;
  const counts=new Map(all('SELECT hero,count(*) n FROM idea_ideas GROUP BY hero').map(r=>[r.hero,r.n]));
  heroes.sort((a,b)=>(counts.get(a.id)||0)-(counts.get(b.id)||0)||b.created.localeCompare(a.created));
  for(let tries=0;room>0&&tries<s.team*6;tries++){
   const hero=heroes[tries%heroes.length],k=counts.get(hero.id)||0,seed=k+tries,idea=compose(hero,pool,seed,k%3===0?'outfit':'product');
   counts.set(hero.id,k+1);if(!idea)continue;
   const t=now(),r=run('INSERT OR IGNORE INTO idea_ideas(id,signature,kind,title,hero,pieces,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),signature(idea),idea.kind,idea.title.slice(0,160),hero.id,JSON.stringify(idea.pieces),idea.reason,s.autoMake?'approved':'new',t,t);
   if(r.changes){made++;room--;}
  }
  return made;
 }

 function briefFor(idea,p){
  const g=garment(p.garment),used=new Set(p.placements.map(x=>x.zone));
  return [`${g.single} from idea "${idea.title}".`,fillInstruction(p.color),`Layout: ${p.layout}.`,'Placement plan (one design per placement):',
   ...p.placements.map(x=>`- ${x.zone} (${x.role}): ${x.name}. ${x.note}.`),...g.zones.filter(z=>!used.has(z)).map(z=>`- ${z}: leave empty on purpose.`),
   idea.kind==='outfit'?`Part of a full outfit (${JSON.parse(idea.pieces).map(q=>q.label).join(', ')}). Match scale, wear and palette across every piece.`:'',
   brain?.knowledge(p.garment)||''].filter(Boolean).join('\n').slice(0,6000);
 }
 // Approved ideas become factory jobs, one per piece, as queue room allows. Anything that doesn't fit waits for the next cycle.
 // The job carries the files from the lead design's collection (the factory's sharing rule); every design is still named in the brief.
 const attach=p=>{const rows=[...new Set(p.placements.map(x=>x.artwork))].map(id=>get('SELECT id,collection FROM factory_artwork WHERE id=?',id)).filter(Boolean),c=rows[0]?.collection||'';return {product:null,fit:'',sizes:[],collection:c,artworkIds:rows.filter(r=>r.collection===c).map(r=>r.id)};};
 async function make(){
  let queued=0;
  for(const idea of all("SELECT * FROM idea_ideas WHERE status='approved' ORDER BY updated LIMIT 50")){
   const pieces=JSON.parse(idea.pieces),jobs=JSON.parse(idea.jobs),errors=[];
   for(const [i,p] of pieces.entries()){if(jobs[i])continue;const g=garment(p.garment);
    run("UPDATE factory_employees SET enabled=1 WHERE id=? AND id NOT IN (SELECT id FROM factory_employee_settings WHERE kind='creator' AND removed=1)",g.role);
    try{const prepared=await manager.prepareJob({title:`${p.label} · ${idea.title}`.slice(0,100),brief:briefFor(idea,p),kind:idea.kind,gender:'unisex',employee:g.role,selection:attach(p)});
     db.exec('BEGIN IMMEDIATE');try{manager.insertJob(prepared);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}jobs[i]=prepared.id;queued++;}
    catch(e){if(e.status===409&&/queue is full/i.test(e.message)){run('UPDATE idea_ideas SET jobs=? WHERE id=?',JSON.stringify(jobs),idea.id);return queued;}errors.push(`${p.label}: ${e.message}`);jobs[i]=null;}}
   const done=pieces.every((_,i)=>jobs[i]);run('UPDATE idea_ideas SET jobs=?,status=?,error=?,updated=? WHERE id=?',JSON.stringify(jobs),done?'made':errors.length?'failed':'approved',errors.join(' ')||null,now(),idea.id);
  }
  return queued;
 }
 async function tick(){generate();return make();}

 function snapshot(){
  const ideas=all("SELECT * FROM idea_ideas WHERE status IN ('new','approved','failed') ORDER BY created DESC LIMIT 300").concat(all("SELECT * FROM idea_ideas WHERE status='made' ORDER BY updated DESC LIMIT 60"));
  const counts=Object.fromEntries(all('SELECT status,count(*) n FROM idea_ideas GROUP BY status').map(r=>[r.status,r.n]));
  const list=designs();
  return {settings:settings(),counts,shapes:SHAPES,
   designs:list.map(d=>({id:d.id,name:d.name,collection:d.collection,shape:d.shape,detected:d.detected,override:!!d.override,reason:d.reason,width:d.width,height:d.height,url:'/api/owner/ai-factory/artwork/'+d.id+'/file'})),
   unsorted:get("SELECT count(*) n FROM factory_artwork a LEFT JOIN idea_artwork i ON i.artwork=a.id WHERE a.kind='original' AND i.artwork IS NULL").n,
   ideas:ideas.map(i=>({id:i.id,kind:i.kind,title:i.title,hero:i.hero,pieces:JSON.parse(i.pieces),reason:i.reason,status:i.status,error:i.error,jobs:JSON.parse(i.jobs).filter(Boolean).length,created:i.created}))};
 }

 return {tick,generate,make,analyze,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/ideas'))return false;auth(req,null,true);const p=path.slice('/api/owner/ai-factory/ideas'.length);
  if(method==='GET'){if(p!=='')fail(404,'Not found.');analyze(25);send(res,200,snapshot());return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-ideas',120);const b=await body(req);
  const ids=()=>Array.isArray(b.ids)&&b.ids.length&&b.ids.length<=300&&b.ids.every(x=>typeof x==='string')?b.ids:fail(400,'Choose at least one idea.');
  if(p==='/generate'){generate({force:true});}
  else if(p==='/approve'){const list=ids();for(const id of list)run("UPDATE idea_ideas SET status='approved',error=NULL,updated=? WHERE id=? AND status IN ('new','failed')",now(),id);await make();}
  else if(p==='/dismiss'){for(const id of ids())run("UPDATE idea_ideas SET status='dismissed',updated=? WHERE id=? AND status IN ('new','failed','approved')",now(),id);}
  else if(p==='/settings'){const n=(v,lo,hi,label)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi?v:fail(400,`${label} must be between ${lo} and ${hi}.`);
   run('UPDATE idea_settings SET team=?,pool=?,auto_make=? WHERE id=1',n(b.team,1,100,'Idea workers'),n(b.pool,5,500,'Ideas to keep waiting'),b.autoMake?1:0);if(b.autoMake)run("UPDATE idea_ideas SET status='approved',updated=? WHERE status='new'",now());}
  else if(p==='/shape'){if(typeof b.artwork!=='string'||!get('SELECT 1 x FROM idea_artwork WHERE artwork=?',b.artwork))fail(404,'Design not found.');if(b.shape!==null&&!SHAPES.some(([id])=>id===b.shape))fail(400,'Choose a design shape.');
   run('UPDATE idea_artwork SET override=? WHERE artwork=?',b.shape,b.artwork);run("DELETE FROM idea_ideas WHERE status='new' AND pieces LIKE ?",'%'+b.artwork+'%');}
  else fail(404,'Unknown idea action.');
  send(res,200,snapshot());return true;
 }};
}
