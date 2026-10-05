import {createHash} from 'node:crypto';
export const DEVICES=['phone','tablet','desktop','unknown'];
export const STYLES=['Dark vintage','Gothic','Horror','Minimal','Retro','Other'];
export const COLORS=['Black','White','Cream','Red','Orange','Green','Silver','Purple','Pink','Blue','Gray','Other'];
export const PLACEMENTS=['Front','Back','Left chest','Right chest','Left sleeve','Right sleeve','Hood','Full coverage'];
const days=86400000;
export function designAnalytics({db,designCatalog,products,auth,body,send,fail,limit,origin,storefrontOrigin,clock=()=>Date.now()}){
 const designs=new Map(designCatalog.filter(d=>d.kind!=='reference').map(d=>[d.id,d])),catalog=new Map(products.map(p=>[p.id,p]));
 db.exec(`CREATE TABLE IF NOT EXISTS design_product_links(product TEXT NOT NULL,design TEXT NOT NULL,PRIMARY KEY(product,design));
 CREATE TABLE IF NOT EXISTS design_events(id TEXT NOT NULL,design TEXT NOT NULL DEFAULT '',product TEXT NOT NULL DEFAULT '',visitor TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('view','like','cart')),device TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(id,design));
 CREATE INDEX IF NOT EXISTS design_event_time ON design_events(at);
 CREATE TABLE IF NOT EXISTS request_traits(request TEXT PRIMARY KEY REFERENCES requests(id),style TEXT NOT NULL,colors TEXT NOT NULL,placements TEXT NOT NULL,product TEXT NOT NULL,design TEXT NOT NULL,source TEXT NOT NULL,at INTEGER NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(design_ratings)').all().some(c=>c.name==='device'))db.exec("ALTER TABLE design_ratings ADD COLUMN device TEXT NOT NULL DEFAULT 'unknown'");
 const all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const rank=(map,names)=>[...map].map(([id,count])=>({id,name:names.get(id)?.name||id,count})).filter(r=>r.count).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 function recordRequest(id,p,source='customer'){
  if(p===undefined)return;if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Invalid request preferences.');const style=p.style||'',colors=p.colors||[],placements=p.placements||[],product=p.productId||'',design=p.designId||'';
  if((style&&!STYLES.includes(style))||!Array.isArray(colors)||colors.length>6||colors.some(c=>!COLORS.includes(c))||!Array.isArray(placements)||placements.length>8||placements.some(c=>!PLACEMENTS.includes(c))||(product&&!catalog.has(product))||(design&&!designs.has(design)))fail(400,'Choose valid request preferences.');
  if(style||colors.length||placements.length||product||design)run('INSERT INTO request_traits VALUES(?,?,?,?,?,?,?,?)',id,style,JSON.stringify([...new Set(colors)]),JSON.stringify([...new Set(placements)]),product,design,source,clock());
 }
 function report(period,device){
  const start=period==='all'?clock()-180*days:clock()-Number(period)*days;const events=all('SELECT * FROM design_events WHERE at>=? AND (?=\'all\' OR device=?) ORDER BY at,rowid',start,device,device);
  const stage=new Map(),viewers=new Map(),carts=new Map(),pairCarts=new Map(),browsers=new Set();let unmapped=0;
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};
  for(const e of events){browsers.add(e.visitor);if(!e.design){unmapped++;continue;}const key=e.design+':'+e.visitor,s=stage.get(key)||{design:e.design,view:false,like:false,cart:false};if(e.type==='view'){s.view=true;add(viewers,e.design,e.visitor);}if(e.type==='like'&&s.view)s.like=true;if(e.type==='cart'){add(carts,e.design,e.visitor);if(s.like)s.cart=true;if(e.product)add(pairCarts,e.product+'|'+e.design,e.visitor);}stage.set(key,s);}
  const stages=[...stage.values()],funnel={viewed:stages.filter(s=>s.view).length,liked:stages.filter(s=>s.like).length,added:stages.filter(s=>s.cart).length,purchased:null};
  const perDesign=[...designs.values()].map(d=>{const values=stages.filter(s=>s.design===d.id);return {id:d.id,name:d.name,viewed:values.filter(s=>s.view).length,liked:values.filter(s=>s.like).length,added:values.filter(s=>s.cart).length,purchased:null,conversion:null};}).filter(d=>d.viewed||d.liked||d.added);
  const votes=all("SELECT design,sum(choice='like') AS likes,sum(choice='dislike') AS dislikes FROM design_votes GROUP BY design");
  const likes=rank(new Map(votes.map(r=>[r.design,r.likes])),designs),dislikes=rank(new Map(votes.map(r=>[r.design,r.dislikes])),designs);
  const ratings=all("SELECT design,device,overall,artwork,colors,style,wear,buy,complexity FROM design_ratings WHERE updated>=?",new Date(start).toISOString()).filter(r=>device==='all'||r.device===device);
  const ratingSummary=values=>({responses:values.length,...Object.fromEntries(['overall','artwork','colors','style'].map(k=>[k,values.length?values.reduce((sum,r)=>sum+r[k],0)/values.length:null]))});
  const highestRated=[...designs.values()].map(d=>({id:d.id,name:d.name,...ratingSummary(ratings.filter(r=>r.design===d.id))})).filter(r=>r.responses).sort((a,b)=>b.overall-a.overall||b.responses-a.responses||a.name.localeCompare(b.name));
  const ratingDevices=DEVICES.map(d=>({device:d,...ratingSummary(ratings.filter(r=>r.device===d))}));
  const requests=all("SELECT * FROM request_traits WHERE at>=? AND source='customer'",start),styles=new Map(),colors=new Map(),placements=new Map(),requestedPairs=new Map();const inc=(m,k)=>m.set(k,(m.get(k)||0)+1);
  for(const r of requests){if(r.style)inc(styles,r.style);for(const c of JSON.parse(r.colors))inc(colors,c);for(const p of JSON.parse(r.placements))inc(placements,p);if(r.product&&r.design)inc(requestedPairs,r.product+'|'+r.design);}
  const pairRank=m=>[...m].map(([key,v])=>{const [product,design]=key.split('|');return {productId:product,designId:design,name:(catalog.get(product)?.name||product)+' + '+(designs.get(design)?.name||design),count:v instanceof Set?v.size:v};}).sort((a,b)=>b.count-a.count);
  return {period,device,generatedAt:new Date(clock()).toISOString(),coverage:{events:new Set(events.map(e=>e.id)).size,trackedBrowsers:browsers.size,structuredRequests:requests.length,unmappedProductEvents:unmapped,ratingResponses:ratings.length,purchaseConnected:false},likes,dislikes,highestRated,mostViewed:rank(new Map([...viewers].map(([k,v])=>[k,v.size])),designs),mostAdded:rank(new Map([...carts].map(([k,v])=>[k,v.size])),designs),funnel,perDesign,ratingDevices,styles:rank(styles,new Map()),colors:rank(colors,new Map()),placements:rank(placements,new Map()),cartCombinations:pairRank(pairCarts),requestCombinations:pairRank(requestedPairs)};
 }
 const options=()=>({designs:[...designs.values()].map(d=>({id:d.id,name:d.name})),products:[...catalog.values()],styles:STYLES,colors:COLORS,placements:PLACEMENTS});
 async function handle(req,res,path,method,url){
  if(path==='/api/design-analytics-options'&&method==='GET'){send(res,200,options());return true;}
  if(path==='/api/design-events'){
   const allowed=req.headers.origin===origin||req.headers.origin===storefrontOrigin;if(!allowed)fail(403,'Origin rejected.');res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');if(method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return true;}if(method!=='POST')fail(405,'Method not allowed.');limit(req,'design-analytics',100);const b=await body(req);if(!b||! /^[a-f0-9-]{36}$/.test(b.eventId||'')||! /^[a-f0-9-]{36}$/.test(b.visitorId||'')||!['view','like','cart'].includes(b.type)||!DEVICES.includes(b.device)||b.type==='cart'&&!catalog.has(b.productId)||b.type==='like'&&!designs.has(b.designId)||b.type==='view'&&!designs.has(b.designId)&&!catalog.has(b.productId)||b.type==='cart'&&b.designId)fail(400,'Invalid analytics event.');
   if(b.productId&&!catalog.has(b.productId))fail(400,'Invalid product.');if(all('SELECT id FROM design_events WHERE id=? LIMIT 1',b.eventId).length){send(res,200,{ok:true});return true;}const linked=b.designId?[b.designId]:all('SELECT design FROM design_product_links WHERE product=?',b.productId).map(r=>r.design);if(b.designId&&!designs.has(b.designId))fail(400,'Invalid design.');const visitor=createHash('sha256').update(b.visitorId).digest('hex');for(const design of linked.length?linked:[''])run('INSERT OR IGNORE INTO design_events VALUES(?,?,?,?,?,?,?)',b.eventId,design,b.productId||'',visitor,b.type,b.device,clock());run('DELETE FROM design_events WHERE at<?',clock()-180*days);send(res,200,{ok:true});return true;
  }
  if(path==='/api/owner/design-analytics'){auth(req,null,true);if(method!=='GET')fail(405,'Method not allowed.');const period=url.searchParams.get('period')||'30',device=url.searchParams.get('device')||'all';if(!['7','30','90','all'].includes(period)||!['all',...DEVICES].includes(device))fail(400,'Choose a valid reporting period and screen size.');send(res,200,report(period,device));return true;}
  if(path==='/api/owner/design-links'){auth(req,null,true);if(method==='GET'){send(res,200,all('SELECT * FROM design_product_links'));return true;}if(method!=='POST'||req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'design-links',100);const b=await body(req);auth(req,null,true);if(!catalog.has(b?.productId)||!designs.has(b?.designId)||!['add','remove'].includes(b.action))fail(400,'Choose a valid product and artwork.');if(b.action==='add')run('INSERT OR IGNORE INTO design_product_links VALUES(?,?)',b.productId,b.designId);else run('DELETE FROM design_product_links WHERE product=? AND design=?',b.productId,b.designId);send(res,200,{ok:true});return true;}
  return false;
 }
 return {handle,recordRequest,report};
}
