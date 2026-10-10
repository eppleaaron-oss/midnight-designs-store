import {randomUUID,createHash} from 'node:crypto';import {inflateSync} from 'node:zlib';import {readFileSync} from 'node:fs';
import {fillInstruction,labelInstruction,LABEL_LOGO_PATH} from './factory-runs.mjs';

// The idea team: finds the design sets behind the store's products (jackets first) and uploaded collections,
// then keeps a pool of single-item and full-outfit ideas that put ONE set onto the real print areas of the
// Printful all-over-print catalog. The owner approves ideas in bulk; approved ideas become ordinary factory jobs.
// Nothing here is a trained model: sets come from Printful's product files, placement from the catalog's print areas.

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

// ---------- the all-over-print catalog ----------
// Every Printful all-over-print item the store can make, with its real print areas (from printful-plans.json).
const SKIP_AREA=/^(label|lining|inside|facing|details|collar|yoke|hood_inner)/;
const GROUPS=[['jacket',/jacket|windbreaker|bomber|zip hoodie/i,'jackets'],['top',/hoodie|sweatshirt/i,'hoodies'],['face',/gaiter|bandana/i,'facewear'],['bag',/backpack|fanny/i,'accessories'],
 ['bottom',/shorts|trunks/i,'shorts'],['bottom',/leggings|joggers|pants|skirt/i,'pants'],['swim',/bikini|swimsuit|boxer|bra\b/i,'underwear'],['dress',/dress/i,'shirts'],['top',/./,'shirts']];
// Most-wanted items first; kids and youth sizes last.
const PRIORITY=[390,615,801,717,619,388,1419,1628,919,328,1414,1482,257,320,1418,1590,644,792,400,618,784,604,298,330,332,1481,420,630,279,963,350];
// The tag print area the brand logo goes on: inside label first, then the outside label.
const TAGS=['label_inside','label_inside_dtfabric','label_outside','label_outside_dtfabric','label_outside_back','label_panel','label_panel_dtfabric'];
export const tagArea=areas=>TAGS.find(t=>areas.includes(t))||null;
export function loadCatalog(plans){
 const list=Object.values(plans?.products||{}).map(p=>{const [group,,role]=GROUPS.find(([,re])=>re.test(p.name));
  return {id:p.catalogProductId,name:p.name.replace(/^All-Over Print /,'').replace(/^Men's All-Over Print /,"Men's "),group,role,adult:!/kids|youth/i.test(p.name),
   areas:Object.keys(p.printfiles?.available_placements||{}).filter(a=>!SKIP_AREA.test(a)),label:tagArea(Object.keys(p.printfiles?.available_placements||{}))};}).filter(p=>p.areas.length);
 const rank=p=>{const i=PRIORITY.indexOf(p.id);return i>=0?i:p.adult?100:200;};
 return list.sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name));
}
// What a full outfit can hold, one item per category, in wearing order. Each outfit rotates through the choices
// in a category, so different ideas show different hoodies, tees and pants with the same design set.
export const OUTFIT_CATEGORIES=[['Jacket',[390,615,801,619]],['Zip hoodie',[717]],['Hoodie',[388,1419,1628,919]],['Sweatshirt',[320,1418,1590]],['T-shirt',[328,1414,1482,257,329,1415,261]],
 ['Long sleeve',[920,631]],['Jersey',[644,792,730,676]],['Tank top',[276,1475,202]],['Button shirt',[659,791]],['Joggers',[400,784,401]],['Pants',[618,604,1479]],['Shorts',[330,332,1481,298,693,1480]],
 ['Leggings',[242,189,288,559]],['Neck gaiter',[420]],['Bandana',[630]],['Backpack',[279,963]],['Fanny pack',[350]],['Crop top',[1474,200]],['Dress',[514,1476,315]],['Swim trunks',[571]]];
export let PLANS={};let CATALOG=[];try{PLANS=JSON.parse(readFileSync(new URL('../printful-plans.json',import.meta.url),'utf8'));CATALOG=loadCatalog(PLANS);}catch{}

// ---------- design sets ----------
// A set is one finished design split into parts: back, front, sleeves, hood, pocket (or one all-over "default" print).
// Every piece of an idea uses parts of ONE set, so everything matches.
const PART=a=>a.replace(/_dtfabric$/,'').replace(/^(right|left)_hood$/,'hood').replace(/^top_front$/,'front').replace(/^top_back$/,'back');
export function partFor(area,parts){
 const a=PART(area),sleeve=parts.sleeve_left||parts.sleeve_right||parts.leg_left||parts.leg_right;
 const pick={front:parts.front||parts.default||parts.back,back:parts.back||parts.default||parts.front,default:parts.default||parts.back||parts.front,
  sleeve_left:parts.sleeve_left||parts.sleeve_right||parts.leg_left,sleeve_right:parts.sleeve_right||parts.sleeve_left||parts.leg_right,
  leg_left:parts.leg_left||parts.sleeve_left||parts.sleeve_right||parts.default,leg_right:parts.leg_right||parts.sleeve_right||parts.sleeve_left||parts.default,
  hood:parts.hood,pocket:parts.pocket,belt:sleeve,belt_front:sleeve,belt_back:sleeve,top:parts.pocket||sleeve,bottom:sleeve,
  bottom_front:parts.front||parts.default,bottom_back:parts.back||parts.default}[a];
 return pick||null;
}
const FILE_TYPES=/^(front|back|default|sleeve_left|sleeve_right|leg_left|leg_right|hood|right_hood|left_hood|pocket|top_front|top_back)(_dtfabric)?$/;
const JACKETS=new Set([390,615,619,717,801]);
export function setFromPrintful(detail,storeNames={}){
 const p=detail?.sync_product;if(!p||p.is_ignored)return null;const parts={};let catalog=null;
 for(const v of detail.sync_variants||[]){catalog??=v.product?.product_id||null;for(const f of v.files||[]){const t=String(f.type||'');if(!FILE_TYPES.test(t))continue;const k=PART(t),url=f.url||f.preview_url;if(!parts[k]&&typeof url==='string'&&url.startsWith('https://'))parts[k]={url,thumb:f.thumbnail_url||f.preview_url||url,name:f.filename||k};}}
 if(!parts.front&&!parts.back&&!parts.default)return null;
 const main=parts.back||parts.front||parts.default,fileName=String(main.name||'').replace(/\.[a-z0-9]+$/i,'').replace(/[-_]+/g,' ').replace(/\b(front|back|default|preview|print|file|dtfabric|\d{3,})\b/gi,'').replace(/\s+/g,' ').trim();
 const name=String(storeNames[String(p.id)]||p.name||'Untitled').replace(/\b(all-over print|recycled|unisex|men'?s|women'?s|cotton-blend|cotton|oversized|fleece|bomber|windbreaker|track|zip|hoodie|jacket|sweatshirt|t-shirt|athletic|joggers|leggings|backpack|fanny pack|neck gaiter|bandana|utility|yoga)\b/gi,'').replace(/\s+/g,' ').trim()||(fileName.length>=3&&!/^[0-9a-f]{16,}$/i.test(fileName.replace(/\s/g,''))?fileName:`Untitled ${String(p.name||'product').replace(/^(unisex|men'?s|women'?s|recycled)\s+/gi,'').toLowerCase()} design ${String(p.id).slice(-4)}`);
 const files=[...new Set((detail.sync_variants||[]).flatMap(v=>(v.files||[]).map(f=>String(f.type||''))))];
 return {id:'pf:'+p.id,printfulId:String(p.id),files,source:'printful',name,product:p.name,catalog,jacket:JACKETS.has(catalog)||/jacket|windbreaker|bomber/i.test(p.name),parts};
}

export function factoryIdeas({db,auth,body,send,fail,limit,origin,manager,brain=null,catalog=CATALOG,storefrontOrigin='https://midnight-designs.store',fetchImpl=fetch,env=process.env,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS idea_artwork(artwork TEXT PRIMARY KEY,width INTEGER,height INTEGER,shape TEXT NOT NULL,reason TEXT NOT NULL,override TEXT,analyzed TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idea_sets(id TEXT PRIMARY KEY,source TEXT NOT NULL,name TEXT NOT NULL,product TEXT,catalog INTEGER,jacket INTEGER NOT NULL,parts TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idea_set_ideas(id TEXT PRIMARY KEY,signature TEXT NOT NULL UNIQUE,set_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,pieces TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,jobs TEXT NOT NULL DEFAULT '[]',error TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idea_settings(id INTEGER PRIMARY KEY CHECK(id=1),team INTEGER NOT NULL,pool INTEGER NOT NULL,auto_make INTEGER NOT NULL);
 INSERT OR IGNORE INTO idea_settings(id,team,pool,auto_make) VALUES(1,20,40,0);
 DROP TABLE IF EXISTS idea_ideas;`);
 if(!db.prepare('PRAGMA table_info(idea_settings)').all().some(c=>c.name==='outfit_size')){db.exec('ALTER TABLE idea_settings ADD COLUMN outfit_size INTEGER NOT NULL DEFAULT 14');db.exec("DELETE FROM idea_set_ideas WHERE status='new'");}
 db.exec(`CREATE TABLE IF NOT EXISTS idea_made(id TEXT PRIMARY KEY,idea TEXT NOT NULL,set_id TEXT NOT NULL,set_name TEXT NOT NULL,catalog INTEGER NOT NULL,category TEXT,name TEXT NOT NULL,printful_id TEXT,status TEXT NOT NULL,error TEXT,prices TEXT,thumb TEXT,rating INTEGER,note TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,updated TEXT NOT NULL,UNIQUE(idea,catalog))`);
 if(!db.prepare('PRAGMA table_info(idea_settings)').all().some(c=>c.name==='autopilot')){db.exec('ALTER TABLE idea_settings ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 1');db.exec('ALTER TABLE idea_settings ADD COLUMN per_day INTEGER NOT NULL DEFAULT 2');db.exec("DELETE FROM idea_set_ideas WHERE status='new'");}
 db.exec("UPDATE idea_set_ideas SET status='new' WHERE status='publishing'");
 const all=(q,...a)=>db.prepare(q).all(...a),get=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a),now=()=>new Date(clock()).toISOString();
 const settings=()=>{const s=get('SELECT * FROM idea_settings WHERE id=1');return {team:s.team,pool:s.pool,autoMake:!!s.auto_make,outfitSize:s.outfit_size,autopilot:!!s.autopilot,perDay:s.per_day};};
 const item=id=>catalog.find(c=>c.id===id);

 // Shape sorting for uploaded designs, used to split an uploaded collection into parts.
 function analyze(max=25){
  const rows=all("SELECT a.id,a.name,a.data FROM factory_artwork a LEFT JOIN idea_artwork i ON i.artwork=a.id WHERE a.kind='original' AND i.artwork IS NULL LIMIT ?",max);
  for(const r of rows){let info=null;try{info=imageInfo(Buffer.from(r.data));}catch{}const c=classify(info,r.name);run('INSERT OR REPLACE INTO idea_artwork VALUES(?,?,?,?,?,NULL,?)',r.id,info?.width||null,info?.height||null,c.shape,c.reason,now());}
  return rows.length;
 }
 const designs=()=>all("SELECT a.id,a.name,a.collection,a.created,i.width,i.height,coalesce(i.override,i.shape) shape,i.shape detected,i.override,i.reason FROM factory_artwork a JOIN idea_artwork i ON i.artwork=a.id WHERE a.kind='original' ORDER BY a.created");
 // Store library categories group designs by type, not by set, so they are never treated as one set.
 const LIBRARY=/^(sleeve panels|hood panels|pocket & emblems|celestial & gothic|halloween & horror|mockups & references)$/i;
 function uploadSets(){
  const by=new Map();for(const d of designs()){if(LIBRARY.test(d.collection))continue;(by.get(d.collection)||by.set(d.collection,[]).get(d.collection)).push(d);}
  const t=now(),seen=new Set();
  for(const [collection,list] of by){
   const full=list.filter(d=>d.shape==='full'),strips=list.filter(d=>d.shape==='strip'),marks=list.filter(d=>d.shape==='emblem');if(!full.length)continue;
   const url=d=>({url:'/api/owner/ai-factory/artwork/'+d.id+'/file',thumb:'/api/owner/ai-factory/artwork/'+d.id+'/file',name:d.name,artwork:d.id});
   const hood=list.find(d=>/\bhood\b/i.test(d.name)),parts={back:url(full[0])};if(full[1]&&full[1]!==hood)parts.front=url(full[1]);
   if(strips[0]){parts.sleeve_left=url(strips[0]);parts.sleeve_right=url(strips[1]||strips[0]);}if(hood)parts.hood=url(hood);if(marks[0])parts.pocket=url(marks[0]);
   const id='up:'+createHash('sha256').update(collection).digest('hex').slice(0,16);seen.add(id);
   run('INSERT INTO idea_sets(id,source,name,product,catalog,jacket,parts,updated) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,parts=excluded.parts,updated=excluded.updated',id,'upload',collection,null,null,0,JSON.stringify(parts),t);
  }
  for(const s of all("SELECT id FROM idea_sets WHERE source='upload'"))if(!seen.has(s.id))run('DELETE FROM idea_sets WHERE id=?',s.id);
 }
 // Read every product in the Printful store and keep the design set behind it. Jackets lead.
 let pfProducts=null;
 let printful={state:env.PRINTFUL_TOKEN?'waiting':'not_connected',error:null,checked:0};
 async function refreshPrintful(){
  if(!env.PRINTFUL_TOKEN){printful={state:'not_connected',error:null,checked:clock()};return;}
  const headers={Authorization:'Bearer '+env.PRINTFUL_TOKEN,...(env.PRINTFUL_STORE_ID?{'X-PF-Store-Id':env.PRINTFUL_STORE_ID}:{})};
  const pf=async path=>{const r=await fetchImpl('https://api.printful.com/'+path,{headers,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Printful answered '+r.status+'.');return (await r.json()).result;};
  let storeNames={};try{const r=await fetchImpl(storefrontOrigin+'/products.json',{signal:AbortSignal.timeout(10000)});if(r.ok){const d=await r.json();for(const x of d.products||[])if(x&&x.id&&x.name)storeNames[String(x.id)]=String(x.name);}}catch{}
  try{const list=[];for(let offset=0;offset<1000;offset+=100){const page=await pf(`store/products?limit=100&offset=${offset}`);list.push(...page);if(page.length<100)break;}
   const t=now(),seen=new Set(),found=[];
   for(const p of list){const detail=await pf('store/products/'+p.id);
    found.push({id:String(p.id),name:String(detail?.sync_product?.name||p.name||''),ignored:!!detail?.sync_product?.is_ignored,catalog:(detail?.sync_variants||[]).find(v=>v.product?.product_id)?.product?.product_id||null,
     variants:(detail?.sync_variants||[]).length,files:[...new Set((detail?.sync_variants||[]).flatMap(v=>(v.files||[]).map(f=>String(f.type||''))))]});
    const s=setFromPrintful(detail,storeNames);if(!s)continue;seen.add(s.id);
    run('INSERT INTO idea_sets(id,source,name,product,catalog,jacket,parts,updated) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,product=excluded.product,catalog=excluded.catalog,jacket=excluded.jacket,parts=excluded.parts,updated=excluded.updated',s.id,s.source,s.name,s.product,s.catalog,s.jacket?1:0,JSON.stringify(s.parts),t);}
   for(const s of all("SELECT id FROM idea_sets WHERE source='printful'"))if(!seen.has(s.id))run('DELETE FROM idea_sets WHERE id=?',s.id);
   printful={state:'connected',error:null,checked:clock(),products:list.length};pfProducts=found;}
  catch(e){printful={state:'error',error:e.message||'Printful could not be reached.',checked:clock()};}
 }
 const sets=()=>all('SELECT * FROM idea_sets WHERE enabled=1 ORDER BY jacket DESC,source,name').map(s=>({...s,jacket:!!s.jacket,parts:JSON.parse(s.parts)}));

 // One piece: a catalog item with every print area filled from the same set, or the base color where the set has nothing for it.
 function piece(set,c,color){
  const placements=[],empty=[];for(const area of c.areas){const p=partFor(area,set.parts);p?placements.push({area,part:Object.keys(set.parts).find(k=>set.parts[k]===p),name:p.name,url:p.url,thumb:p.thumb,artwork:p.artwork||null}):empty.push(area);}
  if(!placements.length)return null;
  // Ready to publish as-is: every print area gets its own part of the set, so nothing prints blank, and a pocket
  // only uses the set's pocket file on the same product it was cut for, so the pocket lines up with the front.
  const pocketOff=set.source==='printful'&&set.catalog!==c.id&&placements.some(x=>PART(x.area)==='pocket');
  const why=set.source==='printful'&&set.catalog===c.id?'Already in your store: this set came from this item.':set.source!=='printful'?'Uploaded sets go through the AI workers.':empty.length?`${empty.map(a=>a.replace(/_dtfabric$/,'').replace(/_/g,' ')).join(', ')} would print blank.`:pocketOff?'The pocket must be cut from the front so it lines up, and this set\'s pocket was cut for a different item.':'';
  return {catalog:c.id,label:c.name,group:c.group,role:c.role,color,placements,empty,tag:c.label||null,ready:!why,why};
 }
 // A full outfit carries one set onto as many items as the owner allows, one per category, jacket first.
 // Owner ratings steer the team: low-rated sets and item types (average 2 or less over 2+ ratings) are dropped,
 // high-rated sets get ideas first.
 function score(kind,key){const r=get(`SELECT avg(rating) a,count(rating) n FROM idea_made WHERE rating IS NOT NULL AND ${kind==='set'?'set_id':'category'}=?`,key);return {avg:r?.a||0,n:r?.n||0,low:(r?.n||0)>=2&&r.a<=2};}
 function outfit(set,n,size){
  const pieces=[];
  for(const [name,ids] of OUTFIT_CATEGORIES){if(pieces.length>=size)break;
   if(score('category',name).low)continue;
   // The set's own product leads a jacket outfit; other categories skip the exact item the set came from.
   const choices=ids.filter(id=>id!==set.catalog);if(!choices.length&&!(name==='Jacket'&&set.jacket))continue;
   const id=name==='Jacket'&&set.jacket&&set.catalog?set.catalog:choices[n%choices.length];
   const c=item(id),p=c&&piece(set,c,set.source==='printful'?'White':'Black');if(p)pieces.push({...p,category:name});}
  if(pieces.length<3)return null;
  return {kind:'outfit',title:`${set.name} full outfit (${pieces.length} items)`,pieces,reason:`Every piece is cut from the ${set.name} set${set.product?` (${set.product})`:''}: front, back, sleeves, hood and pocket go to the matching print area on each item, so the whole outfit reads as one design. Remove any item you don't want before making it.`};
 }
 function compose(set,n){
  if(n%3===0)return outfit(set,n/3,settings().outfitSize);
  const c=catalog[(n-1-Math.floor(n/3))%catalog.length];if(!c||c.id===set.catalog)return null;const p=piece(set,c,set.source==='printful'?'White':'Black');
  return p&&{kind:'product',title:`${set.name} ${c.name}`,pieces:[p],reason:`The ${set.name} set mapped onto the ${c.name}'s real print areas.`};
 }
 const signature=(set,idea)=>createHash('sha256').update(JSON.stringify([set.id,idea.pieces.map(p=>[p.catalog,p.color,p.placements.map(x=>[x.area,x.url])])])).digest('hex');

 // One working cycle: each idea worker drafts one idea, jacket sets first, until enough are waiting.
 function generate({force=false}={}){
  analyze();uploadSets();const s=settings(),list=sets();if(!list.length)return 0;
  let room=Math.min(s.team,force?s.team:s.pool-get("SELECT count(*) n FROM idea_set_ideas WHERE status='new'").n),made=0;
  const counts=new Map(all('SELECT set_id,count(*) n FROM idea_set_ideas GROUP BY set_id').map(r=>[r.set_id,r.n]));
  for(let tries=0;room>0&&tries<s.team*8;tries++){
   const rated=new Map(list.map(x=>[x.id,score('set',x.id)])),usable=list.filter(x=>!rated.get(x.id).low);if(!usable.length)break;
   const order=[...usable].sort((a,b)=>(counts.get(a.id)||0)-(counts.get(b.id)||0)-((rated.get(a.id).avg-rated.get(b.id).avg)*2)||b.jacket-a.jacket),set=order[0],n=counts.get(set.id)||0;counts.set(set.id,n+1);
   const idea=compose(set,n);if(!idea)continue;const t=now();
   const r=run('INSERT OR IGNORE INTO idea_set_ideas(id,signature,set_id,kind,title,pieces,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),signature(set,idea),set.id,idea.kind,idea.title.slice(0,160),JSON.stringify(idea.pieces),idea.reason,s.autoMake?'approved':'new',t,t);
   if(r.changes){made++;room--;}
  }
  return made;
 }

 function briefFor(idea,p,set){
  const head=[`${p.label} (Printful catalog product ${p.catalog}) from idea "${idea.title}".`,fillInstruction(p.color),
   `Design set: ${set.name}${set.product?`, taken from the store product "${set.product}"`:''}. Use only this set's files. Do not add or mix in any other design.`,
   'Print areas (one design per print area):',...p.placements.map(x=>`- ${x.area}: ${x.part} part of the set (${x.name}) ${x.url.startsWith('/')?'factory file '+(x.artwork||''):x.url}`),
   ...p.empty.map(a=>`- ${a}: no part of this set fits here, so fill it with the base color only.`),
   labelInstruction(storefrontOrigin,p.tag),
   'Scale each part to the print area the way it sits on the original product; continue artwork across seams where the original does.',
   p.placements.some(x=>/pocket/.test(x.area))?'The pocket must line up with the front: it is the front image cut exactly where the pocket sits, so the design runs unbroken across it.':'',
   idea.kind==='outfit'?`Part of the ${set.name} outfit (${JSON.parse(idea.pieces).map(q=>q.label).join(', ')}). Every piece must look like the same design.`:''].filter(Boolean).join('\n');
  return [head,brain?.knowledge(null,5990-head.length)].filter(Boolean).join('\n').slice(0,6000);
 }
 const attach=p=>{const ids=[...new Set(p.placements.map(x=>x.artwork).filter(Boolean))],rows=ids.map(id=>get('SELECT id,collection FROM factory_artwork WHERE id=?',id)).filter(Boolean),c=rows[0]?.collection||'';return {product:null,fit:'',sizes:[],collection:c,artworkIds:rows.filter(r=>r.collection===c).map(r=>r.id)};};
 // Approved ideas become factory jobs, one per piece, as queue room allows. Anything that doesn't fit waits for the next cycle.
 async function make(){
  let queued=0;
  for(const idea of all("SELECT * FROM idea_set_ideas WHERE status='approved' ORDER BY updated LIMIT 50")){
   const set=get('SELECT * FROM idea_sets WHERE id=?',idea.set_id),pieces=JSON.parse(idea.pieces),jobs=JSON.parse(idea.jobs),errors=[];
   if(!set){run("UPDATE idea_set_ideas SET status='failed',error=?,updated=? WHERE id=?",'Its design set is no longer available.',now(),idea.id);continue;}
   for(const [i,p] of pieces.entries()){if(jobs[i])continue;
    run("UPDATE factory_employees SET enabled=1 WHERE id=? AND id NOT IN (SELECT id FROM factory_employee_settings WHERE kind='creator' AND removed=1)",p.role);
    try{const prepared=await manager.prepareJob({title:`${p.label} · ${set.name}`.slice(0,100),brief:briefFor(idea,p,set),kind:idea.kind,gender:'unisex',employee:p.role,selection:attach(p)});
     db.exec('BEGIN IMMEDIATE');try{manager.insertJob(prepared);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}jobs[i]=prepared.id;queued++;}
    catch(e){if(e.status===409&&/queue is full/i.test(e.message)){run('UPDATE idea_set_ideas SET jobs=? WHERE id=?',JSON.stringify(jobs),idea.id);return queued;}errors.push(`${p.label}: ${e.message}`);jobs[i]=null;}}
   const done=pieces.every((_,i)=>jobs[i]);run('UPDATE idea_set_ideas SET jobs=?,status=?,error=?,updated=? WHERE id=?',JSON.stringify(jobs),done?'made':errors.length?'failed':'approved',errors.join(' ')||null,now(),idea.id);
  }
  return queued;
 }
 // ---------- publishing straight to the store ----------
 // A Printful set's parts are finished print files already hosted by Printful, so ready pieces can be created as
 // Printful store products directly; the catalog sync then lists them on midnight-designs.store.
 const pfHeaders=()=>({Authorization:'Bearer '+env.PRINTFUL_TOKEN,...(env.PRINTFUL_STORE_ID?{'X-PF-Store-Id':env.PRINTFUL_STORE_ID}:{}),'Content-Type':'application/json'});
 async function pfCall(path,options={}){const r=await fetchImpl('https://api.printful.com/'+path,{...options,headers:pfHeaders(),signal:AbortSignal.timeout(30000)});const d=await r.json().catch(()=>({}));if(r.status===404)return null;if(!r.ok)throw Error(`Printful: ${d?.error?.message||d?.result||'HTTP '+r.status}`.slice(0,300));return d.result;}
 const variantCache=new Map();
 async function catalogVariants(id){if(!variantCache.has(id)){const r=await pfCall('products/'+id);variantCache.set(id,(r?.variants||[]).filter(v=>v.in_stock!==false));}return variantCache.get(id);}
 let storePrices=null;
 async function priceFor(catalogId,size,cost){
  if(!storePrices){storePrices=new Map();try{const r=await fetchImpl(storefrontOrigin+'/products.json',{signal:AbortSignal.timeout(10000)});if(r.ok)for(const p of (await r.json()).products||[])for(const v of p.variants||[])storePrices.set(p.catalogProductId+'|'+v.size,Math.max(storePrices.get(p.catalogProductId+'|'+v.size)||0,Number(v.price)||0));}catch{}}
  const same=storePrices.get(catalogId+'|'+size);return same>0?same:Math.max(Math.ceil(cost*1.8)-0.01,Math.ceil(cost)+9.99);
 }
 async function publishPiece(idea,set,p){
  const key=idea.id+':'+p.catalog,row=get('SELECT * FROM idea_made WHERE idea=? AND catalog=?',idea.id,p.catalog);if(row?.printful_id)return row;
  const external=('md-ai-'+createHash('sha256').update(key).digest('hex')).slice(0,32),name=`${set.name} ${p.label}`.replace(/\s+/g,' ').slice(0,120),t=now();
  if(!row)run("INSERT INTO idea_made(id,idea,set_id,set_name,catalog,category,name,status,created,updated) VALUES(?,?,?,?,?,?,?,'creating',?,?)",randomUUID(),idea.id,set.id,set.name,p.catalog,p.category||p.group,name,t,t);
  try{
   let made=await pfCall('store/products/@'+external);
   if(!made?.sync_product){
    const variants=await catalogVariants(p.catalog),bySize=new Map();for(const v of variants){const k=v.size||v.name;if(!bySize.has(k)||/white/i.test(v.color||''))bySize.set(k,v);}
    if(!bySize.size)throw Error('Printful has no in-stock sizes for this item.');
    const logo=storefrontOrigin+LABEL_LOGO_PATH,files=[...p.placements.map(x=>({type:x.area,url:x.url})),...(p.tag?[{type:p.tag,url:logo}]:[])],prices={};
    const sync_variants=[];for(const [size,v] of bySize){const price=await priceFor(p.catalog,size,Number(v.price)||30);prices[size]=price;sync_variants.push({variant_id:v.id,retail_price:price.toFixed(2),files});}
    const r=await pfCall('store/products',{method:'POST',body:JSON.stringify({sync_product:{external_id:external,name},sync_variants:sync_variants.slice(0,20)})});
    made={sync_product:{id:r?.id,thumbnail_url:r?.thumbnail_url||null}};run('UPDATE idea_made SET prices=? WHERE idea=? AND catalog=?',JSON.stringify(prices),idea.id,p.catalog);}
   if(!made.sync_product.id)throw Error('Printful did not return the new product.');
   run("UPDATE idea_made SET printful_id=?,thumb=coalesce(?,thumb),status='published',error=NULL,updated=? WHERE idea=? AND catalog=?",String(made.sync_product.id),made.sync_product.thumbnail_url||null,now(),idea.id,p.catalog);
  }catch(e){run("UPDATE idea_made SET status='failed',error=?,updated=? WHERE idea=? AND catalog=?",String(e.message).slice(0,300),now(),idea.id,p.catalog);}
  return get('SELECT * FROM idea_made WHERE idea=? AND catalog=?',idea.id,p.catalog);
 }
 let publishing=false,syncAsked=0;
 async function publishIdeas(ids){
  if(!env.PRINTFUL_TOKEN)fail(409,'Printful is not connected on the backend, so nothing can be published.');
  if(publishing)return 0;publishing=true;let count=0;
  try{for(const id of ids){const idea=get('SELECT * FROM idea_set_ideas WHERE id=?',id),set=idea&&get('SELECT * FROM idea_sets WHERE id=?',idea.set_id);if(!idea||!set)continue;
    const pieces=JSON.parse(idea.pieces),ready=pieces.filter(p=>p.ready),setRow={...set,parts:JSON.parse(set.parts)};
    if(!ready.length){run("UPDATE idea_set_ideas SET status='failed',error=?,updated=? WHERE id=?",'None of its items can be published as-is: '+[...new Set(pieces.map(p=>p.why))].join(' '),now(),id);continue;}
    run("UPDATE idea_set_ideas SET status='publishing',updated=? WHERE id=?",now(),id);
    const results=[];for(const p of ready)results.push(await publishPiece(idea,setRow,p));
    const ok=results.filter(r=>r?.status==='published').length,bad=results.filter(r=>r?.status==='failed');count+=ok;
    const skipped=pieces.length-ready.length;
    run('UPDATE idea_set_ideas SET status=?,error=?,updated=? WHERE id=?',ok?'published':'failed',[bad.length?`${bad.length} failed: ${bad[0].error}`:'',skipped?`${skipped} item${skipped===1?'':'s'} skipped because they would print blank or misaligned.`:''].filter(Boolean).join(' ')||null,now(),id);}
   if(count&&env.CATALOG_GITHUB_TOKEN&&clock()-syncAsked>10*60000){syncAsked=clock();
    await fetchImpl('https://api.github.com/repos/eppleaaron-oss/midnight-designs-store/actions/workflows/sync-printful.yml/dispatches',{method:'POST',headers:{Authorization:'Bearer '+env.CATALOG_GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(20000)}).catch(()=>{});}
  }finally{publishing=false;}
  return count;
 }
 // Autopilot: publishes the best waiting outfits from Printful sets, up to the owner's daily number.
 async function autopilot(){
  const s=settings();if(!s.autopilot||!env.PRINTFUL_TOKEN||publishing)return 0;
  const today=get("SELECT count(DISTINCT idea) n FROM idea_made WHERE created>=?",new Date(clock()-86400000).toISOString()).n;if(today>=s.perDay)return 0;
  const next=all("SELECT i.* FROM idea_set_ideas i JOIN idea_sets s ON s.id=i.set_id WHERE i.status='new' AND i.kind='outfit' AND s.source='printful' AND s.enabled=1 ORDER BY i.created").find(i=>JSON.parse(i.pieces).filter(p=>p.ready).length>=3);
  return next?publishIdeas([next.id]):0;
 }
 async function refreshThumbs(){if(!env.PRINTFUL_TOKEN)return;for(const r of all("SELECT * FROM idea_made WHERE status='published' AND thumb IS NULL AND updated<? LIMIT 5",new Date(clock()-60000).toISOString())){try{const d=await pfCall('store/products/'+r.printful_id);if(!d){run("UPDATE idea_made SET status='deleted',updated=? WHERE id=?",now(),r.id);continue;}const u=d.sync_product?.thumbnail_url||(d.sync_variants||[]).flatMap(v=>v.files||[]).find(f=>f.type==='preview')?.preview_url;run('UPDATE idea_made SET thumb=?,updated=? WHERE id=?',u||null,now(),r.id);}catch{}}}
 function rate(id,rating,note){
  const r=get('SELECT * FROM idea_made WHERE id=?',id);if(!r)fail(404,'Product not found.');
  run('UPDATE idea_made SET rating=?,note=?,updated=? WHERE id=?',rating,note,now(),id);
  if(rating&&(rating>=4||rating<=2)&&get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name='brain_memories'")){
   run("DELETE FROM brain_memories WHERE job=?",'made:'+id);
   run('INSERT INTO brain_memories VALUES(?,?,?,?,?,?)',randomUUID(),rating>=4?'preference':'failure',`Owner rated "${r.name}" ${rating}/5${note?': '+note:''}. ${rating>=4?'Do more like this.':'Avoid repeating this.'}`.slice(0,500),'made:'+id,null,now());}
 }
 async function deleteMade(id){const r=get('SELECT * FROM idea_made WHERE id=?',id);if(!r)fail(404,'Product not found.');
  if(r.printful_id){const res=await fetchImpl('https://api.printful.com/store/products/'+r.printful_id,{method:'DELETE',headers:pfHeaders(),signal:AbortSignal.timeout(30000)});if(!res.ok&&res.status!==404)fail(502,'Printful did not delete it (HTTP '+res.status+').');}
  run("UPDATE idea_made SET status='deleted',updated=? WHERE id=?",now(),id);}
 function madeList(){return all("SELECT * FROM idea_made WHERE status!='deleted' ORDER BY created DESC LIMIT 200").map(r=>({id:r.id,name:r.name,set:r.set_name,category:r.category,status:r.status,error:r.error,printfulId:r.printful_id,prices:r.prices?JSON.parse(r.prices):null,thumb:r.thumb,rating:r.rating,note:r.note,created:r.created}));}

 async function tick(){if(clock()-printful.checked>30*60000)await refreshPrintful();generate();await autopilot().catch(e=>console.error('Autopilot failed:',e.message));await refreshThumbs();return make();}

 function snapshot(){
  const ideas=all("SELECT * FROM idea_set_ideas WHERE status IN ('new','approved','failed','publishing') ORDER BY created DESC LIMIT 300").concat(all("SELECT * FROM idea_set_ideas WHERE status IN ('made','published') ORDER BY updated DESC LIMIT 60"));
  const counts=Object.fromEntries(all('SELECT status,count(*) n FROM idea_set_ideas GROUP BY status').map(r=>[r.status,r.n]));
  return {settings:settings(),counts,categories:OUTFIT_CATEGORIES.map(([n])=>n),shapes:SHAPES,printful:{state:printful.state,error:printful.error,products:printful.products||0},catalog:catalog.length,
   sets:sets().map(s=>({id:s.id,source:s.source,name:s.name,product:s.product,jacket:s.jacket,parts:Object.fromEntries(Object.entries(s.parts).map(([k,v])=>[k,{thumb:v.thumb,name:v.name}]))})),
   designs:designs().map(d=>({id:d.id,name:d.name,collection:d.collection,shape:d.shape,detected:d.detected,override:!!d.override,reason:d.reason,url:'/api/owner/ai-factory/artwork/'+d.id+'/file'})),
   made:madeList(),ratings:{count:get('SELECT count(rating) n FROM idea_made WHERE rating IS NOT NULL').n,avg:get('SELECT avg(rating) a FROM idea_made WHERE rating IS NOT NULL').a},canPublish:!!env.PRINTFUL_TOKEN,
   ideas:ideas.map(i=>({id:i.id,set:i.set_id,kind:i.kind,title:i.title,pieces:JSON.parse(i.pieces).map(p=>({...p,placements:p.placements.map(({url,...x})=>x)})),reason:i.reason,status:i.status,error:i.error,jobs:JSON.parse(i.jobs).filter(Boolean).length,created:i.created}))};
 }

 return {tick,generate,make,analyze,refreshPrintful,publishIdeas,autopilot,printfulProducts:()=>pfProducts,printfulState:()=>printful,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/ideas'))return false;auth(req,null,true);const p=path.slice('/api/owner/ai-factory/ideas'.length);
  if(method==='GET'){if(p!=='')fail(404,'Not found.');if(!printful.checked)await refreshPrintful();analyze(25);uploadSets();if(!get("SELECT 1 x FROM idea_set_ideas WHERE status='new'"))generate();send(res,200,snapshot());return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-ideas',120);const b=await body(req);
  const ids=()=>Array.isArray(b.ids)&&b.ids.length&&b.ids.length<=300&&b.ids.every(x=>typeof x==='string')?b.ids:fail(400,'Choose at least one idea.');
  if(p==='/generate'){generate({force:true});}
  else if(p==='/printful'){limit(req,'factory-ideas-printful',6);await refreshPrintful();generate({force:true});}
  else if(p==='/publish'){limit(req,'factory-ideas-publish',20);const list=ids();for(const id of list)if(!get("SELECT 1 x FROM idea_set_ideas WHERE id=? AND status IN ('new','failed')",id))fail(409,'Only waiting ideas can be published.');await publishIdeas(list);}
  else if(p==='/rate'){if(typeof b.id!=='string')fail(400,'Choose a product.');const r=b.rating===null?null:Number.isInteger(b.rating)&&b.rating>=1&&b.rating<=5?b.rating:fail(400,'Rate from 1 to 5 stars.');rate(b.id,r,typeof b.note==='string'?b.note.slice(0,300):'');}
  else if(p==='/delete'){if(typeof b.id!=='string')fail(400,'Choose a product.');if(b.confirm!==true)fail(400,'Confirm the delete.');await deleteMade(b.id);}
  else if(p==='/approve'){for(const id of ids())run("UPDATE idea_set_ideas SET status='approved',error=NULL,updated=? WHERE id=? AND status IN ('new','failed')",now(),id);await make();}
  else if(p==='/dismiss'){for(const id of ids())run("UPDATE idea_set_ideas SET status='dismissed',updated=? WHERE id=? AND status IN ('new','failed','approved')",now(),id);}
  else if(p==='/set'){if(typeof b.id!=='string'||!get('SELECT 1 x FROM idea_sets WHERE id=?',b.id))fail(404,'Design set not found.');run('UPDATE idea_sets SET enabled=? WHERE id=?',b.enabled?1:0,b.id);if(!b.enabled)run("DELETE FROM idea_set_ideas WHERE set_id=? AND status='new'",b.id);}
  else if(p==='/settings'){const n=(v,lo,hi,label)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi?v:fail(400,`${label} must be between ${lo} and ${hi}.`);
   const size=b.outfitSize===undefined?settings().outfitSize:n(b.outfitSize,3,OUTFIT_CATEGORIES.length,'Items per outfit'),grew=size!==settings().outfitSize;
   run('UPDATE idea_settings SET team=?,pool=?,auto_make=?,outfit_size=?,autopilot=?,per_day=? WHERE id=1',n(b.team,1,100,'Idea workers'),n(b.pool,5,500,'Ideas to keep waiting'),b.autoMake?1:0,size,b.autopilot===undefined?settings().autopilot?1:0:b.autopilot?1:0,b.perDay===undefined?settings().perDay:n(b.perDay,1,50,'Outfits per day'));
   if(grew){run("DELETE FROM idea_set_ideas WHERE status='new' AND kind='outfit'");generate();}if(b.autoMake)run("UPDATE idea_set_ideas SET status='approved',updated=? WHERE status='new'",now());}
  else if(p==='/piece'){const idea=typeof b.id==='string'&&get("SELECT * FROM idea_set_ideas WHERE id=? AND status IN ('new','failed')",b.id);if(!idea)fail(404,'Idea not found.');
   const pieces=JSON.parse(idea.pieces),left=pieces.filter(x=>x.catalog!==b.catalog);if(left.length===pieces.length)fail(404,'That item is not in this idea.');if(!left.length)fail(400,'An idea needs at least one item. Dismiss it instead.');
   run("UPDATE idea_set_ideas SET pieces=?,title=?,updated=? WHERE id=?",JSON.stringify(left),idea.kind==='outfit'?idea.title.replace(/\(\d+ items\)$/,`(${left.length} items)`):idea.title,now(),idea.id);}
  else if(p==='/shape'){if(typeof b.artwork!=='string'||!get('SELECT 1 x FROM idea_artwork WHERE artwork=?',b.artwork))fail(404,'Design not found.');if(b.shape!==null&&!SHAPES.some(([id])=>id===b.shape))fail(400,'Choose a design shape.');
   run('UPDATE idea_artwork SET override=? WHERE artwork=?',b.shape,b.artwork);uploadSets();run("DELETE FROM idea_set_ideas WHERE status='new' AND pieces LIKE ?",'%'+b.artwork+'%');}
  else fail(404,'Unknown idea action.');
  send(res,200,snapshot());return true;
 }};
}
