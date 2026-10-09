import {randomUUID,createHash} from 'node:crypto';
import {GARMENTS,fillInstruction,LABEL_LOGO_PATH} from './factory-runs.mjs';

// The Midnight Brain: owner-editable knowledge that every production brief is built from, plus factory diagnostics.
// Nothing here pretends a model was trained; rules, profiles and memories are plain records that get written into briefs.
export const BRAIN_SECTIONS=[['brand-dna','Brand DNA'],['fashion','Fashion knowledge'],['garment','Garment intelligence'],['artwork','Artwork intelligence'],['color','Color intelligence'],['placement','Placement intelligence'],['composition','Composition intelligence'],['supplier','Supplier knowledge'],['blueprint','Blueprint knowledge'],['qc','QC intelligence'],['pricing','Pricing intelligence'],['publishing','Publishing intelligence']];
export const MEMORY_KINDS=[['permanent','Permanent rules'],['preference','Owner preferences'],['success','Successful designs'],['failure','Failed designs'],['supplier','Supplier knowledge'],['learning','Production learnings']];
export const FEEDBACK=[['good','Good','success'],['excellent','Excellent','success'],['bad','Bad','failure'],['never','Never do this again','failure'],['style','Save this style','preference'],['placement','Save this placement','preference'],['color','Save this color combination','preference'],['reference','Save as reference','success']];
const BRAIN_VERSION='MD-Brain 1.1';

const FILL_RULE='The blank garment is white. White products use no fill. Every other main color (black, charcoal, navy, red and so on) must use the fill option on every print area, edge to edge, before artwork goes on. Never fake a color with a pasted solid-color image.';
// Rules added after the first Brain release. Seeded once per database, so an owner who deletes an unlocked one doesn't get it back.
const RULES_V2=[
 ['placement','One design per placement','Each print placement holds exactly one design. Never stack, overlap or collage two designs in the same placement. The same design is only repeated on purpose, such as matching mirrored sleeves.',1],
 ['placement','When to place a design','Place a design only when the placement is in the garment profile, the print area is big enough for the design to read clearly, and it supports the hero. Leave a placement empty when the design would be shrunk until unreadable, cut by a seam, zipper or pocket, compete with the hero, repeat with no purpose, or go past the most design elements for the garment. An empty placement is better than filler.',1],
 ['artwork','Use references','Study the reference products and designs from the Midnight Designs store before designing. Match their quality, darkness, placement scale and finish. Never copy a reference onto the new product unless it is the selected design.',0]
];
// Industry knowledge added with the idea team: how big brands place graphics, and how design shapes map to placements.
const RULES_V3=[
 ['fashion','Industry placement playbook','Common layouts from major streetwear and sportswear brands: left-chest logo about 3.5 to 4 inches wide; full-front graphic 10 to 12 inches wide; oversized back print up to 14 by 16 inches; sleeve run down the outer sleeve seam; small sleeve hit near the cuff or shoulder; leg run down the outer leg seam; small hip mark high on the thigh; hat front mark about 2 to 2.5 inches tall; nape print under the collar. A strong back with a small chest mark is the most common premium layout.',0],
 ['artwork','Design shapes','Strips (long, thin designs) go on sleeves, legs and shoe side panels. Full designs lead on fronts, backs, hats, masks and accessories. Emblems (small logos and marks) go on chests, hat fronts, hoods and sleeve hits. Never stretch a full design down a sleeve or squash a strip onto a chest.',1],
 ['composition','Full outfits','An outfit is headwear, face wear, a top, bottoms and shoes built around one hero design. Every piece uses the hero or a design from the same collection, shares the palette and keeps a similar wear and texture so the pieces read as one set.',0]
];
const DEFAULT_RULES=[
 ['brand-dna','Primary style','Dark vintage streetwear.',1],
 ['brand-dna','Default garment color','Black.',1],
 ['brand-dna','Prefer','Large statement back graphics; smaller supporting front graphics; coordinated sleeves; distressed artwork; dark palettes with bone/cream accents; premium streetwear composition.',0],
 ['brand-dna','Avoid','Random or unrelated graphics; unrelated sleeve artwork; excessive empty placement; cheap clip-art appearance; artwork outside print boundaries; unnecessary colors; designs that don\'t coordinate.',1],
 ['placement','Hierarchy','Only one hero graphic per product. Supporting and accent graphics must be visibly smaller than the hero.',0],
 ['placement','Seams','Never let faces or text cross a seam, zipper or pocket edge.',1],
 ['color','Garment fill',FILL_RULE,1],
 ['blueprint','Load before design','Before designing, load product, variant, print areas, dimensions, safe areas and restrictions from the supplier blueprint. Never guess print boundaries.',1],
 ['qc','Technical checks','Check resolution, DPI, exact print-file dimensions, safe zone, bleed, transparency, print boundaries, variant and files separately from the aesthetic review.',1],
 ['qc','Score thresholds','90–100 approve; 80–89 improve automatically; below 80 redesign.',0]
];
// Per-garment profiles: density, hierarchy and where each role goes. Keys match GARMENTS ids.
const DEFAULT_PROFILES={
 jacket:{density:[4,6],hierarchy:'1 hero, 1–2 secondary, 2–3 accents, optional branding',placement:{back:'Hero',front:'Secondary / minimal','left-sleeve':'Accent','right-sleeve':'Accent',hood:'Supporting'},color:'Black'},
 ziphoodie:{density:[4,6],hierarchy:'1 hero, 1–2 secondary, 2 accents',placement:{back:'Hero','front-left':'Secondary','front-right':'Accent','left-sleeve':'Accent','right-sleeve':'Accent',hood:'Supporting'},color:'Black'},
 hoodie:{density:[3,5],hierarchy:'1 hero, 1 secondary, 1–2 accents',placement:{back:'Hero',front:'Secondary','left-sleeve':'Accent','right-sleeve':'Accent',hood:'Supporting'},color:'Black'},
 sweatshirt:{density:[2,4],hierarchy:'1 hero, 1 secondary, accents optional',placement:{back:'Hero',front:'Secondary','left-sleeve':'Accent','right-sleeve':'Accent'},color:'Black'},
 tshirt:{density:[1,3],hierarchy:'1 hero, optional small front and sleeve accent',placement:{back:'Hero',front:'Secondary / chest mark','left-sleeve':'Accent'},color:'Black'},
 longsleeve:{density:[2,4],hierarchy:'1 hero, 1 secondary, sleeve accents',placement:{back:'Hero',front:'Secondary','left-sleeve':'Accent','right-sleeve':'Accent'},color:'Black'},
 pants:{density:[1,2],hierarchy:'1–2 vertical leg graphics',placement:{'left-leg':'Secondary','right-leg':'Accent'},color:'Black'},
 joggers:{density:[1,2],hierarchy:'1–2 vertical leg graphics',placement:{'left-leg':'Secondary','right-leg':'Accent'},color:'Black'},
 shorts:{density:[1,2],hierarchy:'1 small leg graphic, optional accent',placement:{'left-leg':'Secondary','right-leg':'Accent'},color:'Black'},
 hat:{density:[1,1],hierarchy:'1 front mark',placement:{front:'Brand / secondary'},color:'Black'},
 accessory:{density:[1,2],hierarchy:'1 main graphic, optional back accent',placement:{front:'Hero',back:'Accent'},color:'Black'},
 facemask:{density:[1,1],hierarchy:'1 print across the mask face',placement:{front:'Hero'},color:'Black'},
 shoes:{density:[1,3],hierarchy:'Strip runs on the side panels, optional tongue mark',placement:{'left-side':'Secondary','right-side':'Accent',tongue:'Brand / secondary'},color:'Black'}
};

export function factoryIntelligence({db,auth,body,send,fail,limit,origin,passwordHash,storageDurable=false,storefrontOrigin='https://midnight-designs.store',fetchImpl=fetch,env=process.env,clock=Date.now}){
 const all=(q,...a)=>db.prepare(q).all(...a),get=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a),now=()=>new Date(clock()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS brain_rules(id TEXT PRIMARY KEY,section TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS brain_garments(garment TEXT PRIMARY KEY,profile TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS brain_memories(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,job TEXT,garment TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS brain_seeded(id INTEGER PRIMARY KEY CHECK(id=1),created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS brain_migrations(name TEXT PRIMARY KEY,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS brain_references(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,image TEXT NOT NULL,garment TEXT,note TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);`);
 if(!get('SELECT 1 x FROM brain_seeded')){const t=now();for(const [section,title,text,locked] of DEFAULT_RULES)run('INSERT INTO brain_rules VALUES(?,?,?,?,?,?,?)',randomUUID(),section,title,text,locked,t,t);for(const [g,p] of Object.entries(DEFAULT_PROFILES))run('INSERT OR IGNORE INTO brain_garments VALUES(?,?,0,?)',g,JSON.stringify(p),t);run('INSERT INTO brain_seeded VALUES(1,?)',t);}
 if(!get("SELECT 1 x FROM brain_migrations WHERE name='rules-v2'")){const t=now();for(const [section,title,text,locked] of RULES_V2)if(!get('SELECT 1 x FROM brain_rules WHERE title=?',title))run('INSERT INTO brain_rules VALUES(?,?,?,?,?,?,?)',randomUUID(),section,title,text,locked,t,t);
  run("UPDATE brain_rules SET body=?,updated=? WHERE title='Garment fill' AND body LIKE 'The base color is the fabric itself.%'",FILL_RULE,t);run("INSERT INTO brain_migrations VALUES('rules-v2',?)",t);}
 if(!get("SELECT 1 x FROM brain_migrations WHERE name='rules-v3'")){const t=now();for(const [section,title,text,locked] of RULES_V3)if(!get('SELECT 1 x FROM brain_rules WHERE title=?',title))run('INSERT INTO brain_rules VALUES(?,?,?,?,?,?,?)',randomUUID(),section,title,text,locked,t,t);
  for(const [g,p] of Object.entries(DEFAULT_PROFILES))run('INSERT OR IGNORE INTO brain_garments VALUES(?,?,0,?)',g,JSON.stringify(p),t);run("INSERT INTO brain_migrations VALUES('rules-v3',?)",t);}
 // rules-v4: the owner's permanent logo-on-the-tag rule, plus one jacket design carried across a whole outfit.
 if(!get("SELECT 1 x FROM brain_migrations WHERE name='rules-v4'")){const t=now();
  for(const [section,title,text,locked] of [['brand-dna','Logo on the tag',`Every product carries the Midnight Design logo (${storefrontOrigin+LABEL_LOGO_PATH}) on its tag: the inside label print area, else the outside label, else small at the inside back neck. Never skip it.`,1],
   ['composition','One design, many items','Carry one design set onto as many items as fit, each part in its matching print area. Never swap in a different design.',1]])
   if(!get('SELECT 1 x FROM brain_rules WHERE title=?',title))run('INSERT INTO brain_rules VALUES(?,?,?,?,?,?,?)',randomUUID(),section,title,text,locked,t,t);
  run("INSERT INTO brain_migrations VALUES('rules-v4',?)",t);}
 const has=table=>!!get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?",table);
 const count=(table,where='')=>has(table)?get(`SELECT count(*) n FROM ${table} ${where}`).n:0;
 const garmentLabel=id=>GARMENTS.find(g=>g.id===id)?.label||id;
 const profile=id=>{const row=get('SELECT * FROM brain_garments WHERE garment=?',id);return row?{...JSON.parse(row.profile),locked:!!row.locked}:null;};

 // The exact knowledge text a worker receives for one garment. Shown on the AI Intelligence page so nothing is hidden in a prompt.
 function knowledge(garment){
  const rules=all("SELECT section,title,body,locked FROM brain_rules ORDER BY CASE section WHEN 'brand-dna' THEN 0 ELSE 1 END,locked DESC,created");
  const p=garment?profile(garment):null,prefs=all("SELECT text FROM brain_memories WHERE kind IN ('permanent','preference') AND (garment IS NULL OR garment=?) ORDER BY created DESC LIMIT 15",garment||'');
  const avoid=all("SELECT text FROM brain_memories WHERE kind='failure' AND (garment IS NULL OR garment=?) ORDER BY created DESC LIMIT 8",garment||'');
  const lines=['Midnight Brain ('+BRAIN_VERSION+'):',...rules.map(r=>`- ${r.locked?'[LOCKED] ':''}${r.title}: ${r.body}`)];
  if(p)lines.push(`${garmentLabel(garment)} profile${p.locked?' [LOCKED]':''}: ${p.density[0]}–${p.density[1]} design elements; ${p.hierarchy}; default color ${p.color}.`,'Placement: '+Object.entries(p.placement).map(([zone,role])=>`${zone} → ${role}`).join('; ')+'.');
  const refs=all('SELECT kind,name,image,garment,note FROM brain_references WHERE garment IS NULL OR garment=? ORDER BY garment IS NULL,created DESC LIMIT 8',garment||'');
  if(refs.length)lines.push('Reference examples from the Midnight Designs store (match this level):',...refs.map(r=>`- ${r.name} (${r.kind==='product'?'store product':r.kind==='design'?'store design':'mockup'})${r.note?': '+r.note:''} ${r.image}`));
  if(prefs.length)lines.push('Owner preferences:',...prefs.map(m=>'- '+m.text));
  if(avoid.length)lines.push('Avoid (owner rejected):',...avoid.map(m=>'- '+m.text));
  lines.push('Locked rules cannot be overridden by worker instructions.');
  return lines.join('\n');
 }


 // One design per placement. The hero goes to the hero placement; other designs fill secondary and accent placements in order;
 // anything past the garment's limit, or with no separate design left, stays empty with the reason written down.
 const RANK=role=>/hero/i.test(role)?0:/secondary|chest/i.test(role)?1:/support/i.test(role)?2:/brand/i.test(role)?3:4;
 function placementPlan(garmentId,art){
  const g=GARMENTS.find(x=>x.id===garmentId),p=profile(garmentId)||DEFAULT_PROFILES[garmentId]||{density:g.density,placement:{}};
  const zones=Object.entries(p.placement).sort((a,b)=>RANK(a[1])-RANK(b[1])),pool=art.slice(1),rows=[];let used=0,next=0;
  for(const [zone,role] of zones){
   let pick=null,reason='';
   if(!art.length)reason='No design selected.';
   else if(used>=p.density[1])reason=`Leave empty: ${g.label} already has its most design elements (${p.density[1]}).`;
   else if(RANK(role)===0||(!pool.length&&used===0))pick=art[0];
   else if(next<pool.length)pick=pool[next++];
   else reason='Leave empty: no separate design left, and one design per placement means no filler repeats.';
   if(pick)used++;rows.push({zone,role,artwork:pick?pick.name:null,reason:pick?'':reason});
  }
  for(const z of g.zones)if(!p.placement[z])rows.push({zone:z,role:'Not used',artwork:null,reason:`Leave empty: the ${g.label.toLowerCase()} profile doesn't use this placement.`});
  return rows;
 }
 // The job-specific placement plan. The color fill line comes from the run brief itself.
 function production(garmentId,art){
  if(!GARMENTS.some(g=>g.id===garmentId))return '';
  return ['Placement plan (one design per placement):',...placementPlan(garmentId,art).map(r=>`- ${r.zone} (${r.role}): ${r.artwork||r.reason}`)].join('\n');
 }

 // Store catalog for the Reference library, cached for 10 minutes.
 let store={time:0,data:null};
 const GUESS=[[/zip/i,'ziphoodie'],[/hoodie/i,'hoodie'],[/sweatshirt|crewneck/i,'sweatshirt'],[/jacket|windbreaker|bomber/i,'jacket'],[/long sleeve|long-sleeve/i,'longsleeve'],[/t-shirt|tee\b|tshirt/i,'tshirt'],[/jogger/i,'joggers'],[/short/i,'shorts'],[/pant|legging/i,'pants'],[/hat|cap|beanie/i,'hat']];
 const guess=name=>GUESS.find(([re])=>re.test(name))?.[1]||null;
 async function storeCatalog(){
  if(store.data&&clock()-store.time<600000)return store.data;
  const abs=u=>/^https:\/\//.test(u)?u:storefrontOrigin+'/'+String(u).replace(/^\/+/,'');
  const load=async f=>{const r=await fetchImpl(storefrontOrigin+'/'+f,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(f+' answered '+r.status);return r.json();};
  try{const [p,d]=await Promise.all([load('products.json'),load('designs.json')]);
   const items=[...(Array.isArray(p.products)?p.products:[]).filter(x=>x&&typeof x.image==='string').map(x=>({id:'product:'+x.id,kind:'product',name:String(x.name).slice(0,120),category:String(x.category||''),image:abs(x.image),thumbnail:abs(x.image),garment:guess(x.name)})),
    ...(Array.isArray(d)?d:[]).filter(x=>x&&typeof x.id==='string'&&typeof x.image==='string').map(x=>({id:'design:'+x.id,kind:x.kind==='reference'?'mockup':'design',name:String(x.name).slice(0,120),category:String(x.category||''),image:abs(x.image),thumbnail:abs(x.thumbnail||x.image),garment:guess(x.name)}))];
   store={time:clock(),data:items};return items;}
  catch(e){fail(502,'The store catalog could not be reached: '+(e.message||'network error'));}
 }

 function heartbeat(){return has('factory_worker_heartbeats')?get('SELECT max(seen) seen FROM factory_worker_heartbeats')?.seen||0:0;}
 const provider=()=>({name:env.AI_IMAGE_PROVIDER||(env.OPENAI_API_KEY?'openai':''),key:env.AI_IMAGE_API_KEY||env.OPENAI_API_KEY||''});
 function status(){
  const p=provider(),hb=heartbeat(),workerOnline=!!env.FACTORY_WORKER_TOKEN&&clock()-hb<45000;
  const failed=count('factory_jobs',"WHERE status='failed'"),queued=count('factory_jobs',"WHERE status='queued'");
  const fp=createHash('sha256').update(passwordHash||'').digest('hex');
  const components=[
   {id:'brain',label:'Brain',ok:true,state:'Online',detail:`${count('brain_rules')} rules and ${count('brain_garments')} garment profiles loaded.`},
   {id:'provider',label:'AI provider',ok:!!p.key,state:p.key?'Configured':'Offline',detail:p.key?`${p.name} key is set on the backend. Run the full diagnostic to verify it.`:'No AI image provider key is set on the backend, so no artwork can be generated or edited.',fix:p.key?null:'Choose a provider and add its API key to the backend environment on Render (AI_IMAGE_PROVIDER and AI_IMAGE_API_KEY).'},
   {id:'worker',label:'Production worker',ok:workerOnline,state:workerOnline?'Online':'Offline',detail:workerOnline?'Heartbeat received in the last 45 seconds.':env.FACTORY_WORKER_TOKEN?'Worker token is set, but no heartbeat has arrived.':'No background worker is set up.',fix:workerOnline?null:'Create the Render background worker from render.factory.yaml with the shared FACTORY_WORKER_TOKEN.'},
   {id:'database',label:'Database',ok:storageDurable,state:storageDurable?'Persistent':'Temporary',detail:storageDurable?'Factory data is on a persistent disk.':'Factory data is on temporary instance storage. A restart or redeploy erases artwork, queue, Brain edits and history.',fix:storageDurable?null:'Attach a persistent disk at /var/data and set DATA_PATH and FACTORY_DISK_MOUNT (see docs/factory-production.md).'},
   {id:'printful',label:'Printful',ok:!!env.PRINTFUL_TOKEN,state:env.PRINTFUL_TOKEN?'Configured':'Not connected',detail:env.PRINTFUL_TOKEN?'Printful token is set.':'No PRINTFUL_TOKEN on the backend, so blueprints and products can\'t load from Printful.',fix:env.PRINTFUL_TOKEN?null:'Add PRINTFUL_TOKEN (and PRINTFUL_STORE_ID for publishing) to the backend environment.'},
   {id:'storage',label:'Artwork storage',ok:storageDurable,state:storageDurable?'Persistent':'Temporary',detail:`${count('factory_artwork')} artwork files stored${storageDurable?'':' on temporary storage'}.`,fix:storageDurable?null:'Same fix as Database: attach the persistent disk.'},
   {id:'queue',label:'Factory queue',ok:failed===0,state:failed?`${failed} failed`:'Healthy',detail:`${queued} queued, ${count('factory_jobs',"WHERE status='running'")} running, ${failed} failed.`,fix:failed?'Open Review & Publish to retry or revise failed jobs.':null},
   {id:'publishing',label:'Publishing',ok:!!(env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID),state:env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID?'Configured':'Not connected',detail:env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID?'Store publishing credentials are set.':'Store publishing needs CATALOG_GITHUB_TOKEN and PRINTFUL_STORE_ID on the backend.',fix:env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID?null:'Add CATALOG_GITHUB_TOKEN and PRINTFUL_STORE_ID to the backend environment.'},
   {id:'login',label:'Owner login',ok:/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash||''),state:'Configured',detail:`Password code fingerprint ${fp.slice(0,4)}…${fp.slice(-4)}.`}
  ];
  const counts={rules:count('brain_rules'),lockedRules:count('brain_rules','WHERE locked=1'),garmentProfiles:count('brain_garments'),blueprints:count('factory_print_drafts'),memories:count('brain_memories'),preferences:count('brain_memories',"WHERE kind='preference'"),learnedFrom:count('brain_memories',"WHERE kind='success'"),references:count('brain_references')};
  return {version:BRAIN_VERSION,components,counts,deployCommit:(env.RENDER_GIT_COMMIT||'').slice(0,7)||null};
 }

 // Each check returns pass, fail or not_configured with the exact component and a fix, so a failure is never just a vague banner.
 async function diagnose(){
  const results=[],add=(id,label,state,detail,fix=null)=>results.push({id,label,state,detail,fix});
  const p=provider(),timeout=()=>AbortSignal.timeout(10000);
  if(!p.key){for(const [id,label] of [['provider','AI provider'],['auth','API authentication'],['generation','Generation endpoint'],['vision','Vision capability'],['editing','Image editing']])add(id,label,'not_configured','No AI image provider key on the backend.','Choose a provider, then add AI_IMAGE_PROVIDER and AI_IMAGE_API_KEY on Render.');}
  else if(p.name==='openai'){add('provider','AI provider','pass','OpenAI key is set.');try{const r=await fetchImpl('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+p.key},signal:timeout()});if(!r.ok){add('auth','API authentication','fail',`OpenAI answered ${r.status}.`,'Check that the API key is valid and has billing enabled.');}else{const models=((await r.json()).data||[]).map(m=>m.id);add('auth','API authentication','pass','The key was accepted.');const image=models.find(m=>/^(gpt-image|dall-e)/.test(m));add('generation','Generation endpoint',image?'pass':'fail',image?`Image model available: ${image}.`:'No image model is available to this key.',image?null:'Enable image models on the OpenAI account.');const vision=models.find(m=>/^gpt-(4o|4\.1|5)/.test(m));add('vision','Vision capability',vision?'pass':'fail',vision?`Vision model available: ${vision}.`:'No vision model is available to this key.');add('editing','Image editing',models.some(m=>/^gpt-image/.test(m))?'pass':'fail',models.some(m=>/^gpt-image/.test(m))?'Image edits are supported by the available image model.':'Image editing needs a gpt-image model.');}}catch(e){add('auth','API authentication','fail','Could not reach OpenAI: '+(e.message||'network error'),'Check the backend has internet access.');}}
  else add('provider','AI provider','fail',`Provider "${p.name}" is not supported yet.`,'Use AI_IMAGE_PROVIDER=openai or ask Claude to add this provider.');
  const hb=heartbeat();add('worker','Worker communication',!env.FACTORY_WORKER_TOKEN?'not_configured':clock()-hb<45000?'pass':'fail',!env.FACTORY_WORKER_TOKEN?'No worker token is set.':hb?`Last heartbeat ${Math.round((clock()-hb)/1000)} seconds ago.`:'The worker has never checked in.',clock()-hb<45000?null:'Create or restart the Render background worker.');
  try{get('SELECT count(*) n FROM factory_jobs');add('queue','Queue communication','pass','The job queue can be read and written.');}catch(e){add('queue','Queue communication','fail',e.message);}
  add('storage','Storage',storageDurable?'pass':'fail',storageDurable?'Database is on a persistent disk.':'Database is on temporary storage and will be erased on restart.','Attach a persistent disk (see docs/factory-production.md).');
  if(!env.PRINTFUL_TOKEN)add('printful','Printful','not_configured','No PRINTFUL_TOKEN on the backend.','Add PRINTFUL_TOKEN on Render.');
  else{try{const r=await fetchImpl('https://api.printful.com/products?limit=1',{headers:{Authorization:'Bearer '+env.PRINTFUL_TOKEN},signal:timeout()});add('printful','Printful',r.ok?'pass':'fail',r.ok?'Printful accepted the token.':`Printful answered ${r.status}.`,r.ok?null:'Create a new Printful token with catalog and product access.');}catch(e){add('printful','Printful','fail','Could not reach Printful: '+(e.message||'network error'));}}
  add('publishing','Publishing',env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID?'pass':'not_configured',env.CATALOG_GITHUB_TOKEN&&env.PRINTFUL_STORE_ID?'Publishing credentials are set.':'Missing CATALOG_GITHUB_TOKEN or PRINTFUL_STORE_ID.');
  const first=results.find(r=>r.state!=='pass');
  return {ranAt:now(),results,summary:first?`First problem: ${first.label}. ${first.detail}`:'Every factory component passed.'};
 }

 // Sandbox plan for "Test Midnight Brain": shows what a worker would receive, without queueing or publishing anything.
 function testPlan(b){
  const garment=GARMENTS.find(g=>g.id===b.garment);if(!garment)fail(400,'Choose a garment to test.');
  const prompt=typeof b.prompt==='string'&&b.prompt.trim().length<=2000?b.prompt.trim():fail(400,'Describe the test design in under 2,000 characters.');
  const ids=Array.isArray(b.artworkIds)?b.artworkIds.slice(0,12).filter(x=>typeof x==='string'):[];
  const art=ids.map(id=>get("SELECT id,name,collection FROM factory_artwork WHERE id=?",id)).filter(Boolean);
  const p=profile(garment.id)||{density:garment.density,placement:{},hierarchy:'',color:'Black'};
  const drafts=has('factory_print_drafts')?all('SELECT id,title FROM factory_print_drafts'):[];
  const word=garment.single.toLowerCase().split(' ').pop(),blueprint=drafts.find(d=>d.title.toLowerCase().includes(word))||null;
  const plan=placementPlan(garment.id,art);
  const color=/\b(black|charcoal|white|cream|navy|red|maroon|purple|grey|gray|green)\b/i.exec(prompt)?.[1]||p.color;
  return {garment:garment.label,prompt,artwork:art.map(a=>a.name),blueprint:blueprint?blueprint.title:null,blueprintNote:blueprint?'Uses this saved supplier blueprint for exact print areas.':'No saved blueprint matches this garment. Add one in the blueprint library before production.',placement:plan,colorPlan:fillInstruction(color[0].toUpperCase()+color.slice(1).toLowerCase()),reasoning:[`${garment.label} profile asks for ${p.density[0]}–${p.density[1]} design elements (${p.hierarchy||'no hierarchy set'}).`,art.length?`${art[0].name} becomes the hero because it is the first selected artwork.`:'Select artwork to see hero and accent choices.',`${count('brain_rules','WHERE locked=1')} locked rules apply.`],expectedScore:null,scoreNote:'A Midnight Score needs the Critic AI, which needs a connected AI provider.',knowledge:[fillInstruction(color[0].toUpperCase()+color.slice(1).toLowerCase()),production(garment.id,art),knowledge(garment.id)].join('\n\n'),canRun:!!provider().key};
 }

 // The full life of one job, assembled from records the factory already keeps.
 function jobLife(id){
  const job=get('SELECT * FROM factory_jobs WHERE id=?',id);if(!job)fail(404,'Job not found.');
  const runtime=has('factory_job_runtime')?get('SELECT * FROM factory_job_runtime WHERE job=?',id):null;
  const checkpoints=has('factory_job_checkpoints')?all('SELECT step,result,created FROM factory_job_checkpoints WHERE job=? ORDER BY created',id):[];
  const events=has('factory_history_events')?all('SELECT action,actor,created FROM factory_history_events WHERE entity_id=? ORDER BY seq',id):[];
  const slot=has('factory_run_slots')?get('SELECT s.*,r.number,r.name FROM factory_run_slots s JOIN factory_runs r ON r.id=s.run WHERE s.job=?',id):null;
  const memories=all('SELECT kind,text,created FROM brain_memories WHERE job=? ORDER BY created',id);
  const log=[...events.map(e=>{let actor='';try{actor=JSON.parse(e.actor).name||'';}catch{}return {at:e.created,text:`${e.action}${actor?' — '+actor:''}`};}),...checkpoints.map(c=>({at:new Date(c.created).toISOString(),text:`Finished ${c.step} step.`})),...memories.map(m=>({at:m.created,text:`Owner feedback (${m.kind}): ${m.text}`}))].sort((a,b)=>a.at.localeCompare(b.at));
  const step=runtime?.step||0,done=s=>checkpoints.some(c=>c.step===s);
  const stages=[['Brief',true],['Brain',true],['Designer',done('validate')],['Critic',false],['Revision',false],['Technical QC',done('files')],['Mockup',done('mockups')],['Owner review',['completed'].includes(job.status)||step>4],['Printful',done('supplier-product')],['Store',done('store-publication')]].map(([name,ok])=>({name,state:ok?'done':name==='Critic'||name==='Revision'?'needs AI provider':'waiting'}));
  return {job:{id:job.id,title:job.title,status:job.status,error:job.error,created:job.created,updated:job.updated},run:slot?{number:slot.number,name:slot.name,garment:slot.garment,color:slot.color}:null,brief:job.brief,stages,log};
 }

 return {knowledge,production,placementPlan,status,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/intelligence'))return false;auth(req,null,true);const p=path.slice('/api/owner/ai-factory/intelligence'.length);
  if(method==='GET'){
   if(p===''){send(res,200,{...status(),sections:BRAIN_SECTIONS,memoryKinds:MEMORY_KINDS,feedback:FEEDBACK.map(([id,label])=>({id,label})),garments:GARMENTS.map(g=>({id:g.id,label:g.label,zones:g.zones,profile:profile(g.id)})),references:all('SELECT * FROM brain_references ORDER BY created DESC'),rules:all('SELECT * FROM brain_rules ORDER BY section,locked DESC,created'),memories:all('SELECT * FROM brain_memories ORDER BY created DESC LIMIT 300'),jobs:has('factory_jobs')?all('SELECT id,title,status,updated FROM factory_jobs ORDER BY updated DESC LIMIT 50'):[]});return true;}
   if(p==='/store'){const pinned=new Set(all('SELECT id FROM brain_references').map(r=>r.id));send(res,200,{items:(await storeCatalog()).map(x=>({...x,pinned:pinned.has(x.id)}))});return true;}
   if(p.startsWith('/knowledge/')){const g=decodeURIComponent(p.slice(11));send(res,200,{garment:g,text:knowledge(GARMENTS.some(x=>x.id===g)?g:null)});return true;}
   const job=p.match(/^\/job\/([\w-]{1,64})$/);if(job){send(res,200,jobLife(job[1]));return true;}
   fail(404,'Not found.');
  }
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-intelligence',60);const b=await body(req);
  const text=(v,max,label)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():fail(400,`Write the ${label} (up to ${max} characters).`);
  if(p==='/diagnose'){limit(req,'factory-diagnose',6);send(res,200,await diagnose());return true;}
  if(p==='/test'){send(res,200,testPlan(b));return true;}
  if(p==='/rule'){
   if(b.delete){const r=get('SELECT locked FROM brain_rules WHERE id=?',String(b.id||''));if(!r)fail(404,'Rule not found.');if(r.locked)fail(409,'Unlock this rule before deleting it.');run('DELETE FROM brain_rules WHERE id=?',b.id);}
   else if(b.id&&b.locked!==undefined&&b.title===undefined){if(!get('SELECT 1 x FROM brain_rules WHERE id=?',String(b.id)))fail(404,'Rule not found.');run('UPDATE brain_rules SET locked=?,updated=? WHERE id=?',b.locked?1:0,now(),b.id);}
   else{if(!BRAIN_SECTIONS.some(([id])=>id===b.section))fail(400,'Choose a Brain section.');const title=text(b.title,100,'rule name'),bodyText=text(b.body,2000,'rule');if(b.id){const r=get('SELECT locked FROM brain_rules WHERE id=?',String(b.id));if(!r)fail(404,'Rule not found.');if(r.locked&&b.locked!==false)fail(409,'This rule is locked. Unlock it to edit.');run('UPDATE brain_rules SET section=?,title=?,body=?,locked=?,updated=? WHERE id=?',b.section,title,bodyText,b.locked?1:0,now(),b.id);}else run('INSERT INTO brain_rules VALUES(?,?,?,?,?,?,?)',randomUUID(),b.section,title,bodyText,b.locked?1:0,now(),now());}
  }else if(p==='/garment'){
   if(!GARMENTS.some(g=>g.id===b.garment))fail(400,'Choose a garment.');const cur=profile(b.garment);
   if(b.locked!==undefined&&b.profile===undefined)run('INSERT INTO brain_garments VALUES(?,?,?,?) ON CONFLICT(garment) DO UPDATE SET locked=excluded.locked,updated=excluded.updated',b.garment,JSON.stringify(cur||DEFAULT_PROFILES[b.garment]),b.locked?1:0,now());
   else{if(cur?.locked)fail(409,'This garment profile is locked. Unlock it to edit.');const q=b.profile||{},d=q.density;if(!Array.isArray(d)||d.length!==2||!d.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=12)||d[0]>d[1])fail(400,'Use a design range between 0 and 12.');const zones=GARMENTS.find(g=>g.id===b.garment).zones,placement={};for(const z of zones){const v=q.placement?.[z];if(v!==undefined&&(typeof v!=='string'||v.length>60))fail(400,'Keep each placement role under 60 characters.');if(v)placement[z]=v.trim();}
    run('INSERT INTO brain_garments VALUES(?,?,0,?) ON CONFLICT(garment) DO UPDATE SET profile=excluded.profile,updated=excluded.updated',b.garment,JSON.stringify({density:d,hierarchy:text(q.hierarchy,300,'hierarchy'),placement,color:text(q.color,40,'default color')}),now());}
  }else if(p==='/reference'){
   if(Array.isArray(b.add)){const items=new Map((await storeCatalog()).map(x=>[x.id,x]));const ids=b.add.filter(x=>typeof x==='string').slice(0,200);if(!ids.length)fail(400,'Choose at least one reference.');
    const t=now();for(const id of ids){const x=items.get(id);if(!x)fail(404,'That item is no longer in the store catalog.');run('INSERT OR IGNORE INTO brain_references VALUES(?,?,?,?,?,?,?)',x.id,x.kind,x.name,x.image,x.garment,'',t);}}
   else{const r=get('SELECT id FROM brain_references WHERE id=?',String(b.id||''));if(!r)fail(404,'Reference not found.');
    if(b.delete)run('DELETE FROM brain_references WHERE id=?',r.id);
    else{if(b.garment!==null&&b.garment!==undefined&&!GARMENTS.some(g=>g.id===b.garment))fail(400,'Choose a garment.');const note=typeof b.note==='string'?b.note.trim():'';if(note.length>300)fail(400,'Keep the note under 300 characters.');run('UPDATE brain_references SET garment=?,note=? WHERE id=?',b.garment||null,note,r.id);}}
  }else if(p==='/memory'){
   if(b.delete){run('DELETE FROM brain_memories WHERE id=?',String(b.id||''));}
   else{if(!MEMORY_KINDS.some(([id])=>id===b.kind))fail(400,'Choose a memory type.');run('INSERT INTO brain_memories VALUES(?,?,?,?,?,?)',randomUUID(),b.kind,text(b.text,1000,'memory'),null,GARMENTS.some(g=>g.id===b.garment)?b.garment:null,now());}
  }else if(p==='/feedback'){
   const f=FEEDBACK.find(([id])=>id===b.kind);if(!f)fail(400,'Choose a feedback type.');const job=has('factory_jobs')?get('SELECT id,title FROM factory_jobs WHERE id=?',String(b.job||'')):null;if(!job)fail(404,'Job not found.');
   const slot=has('factory_run_slots')?get('SELECT garment,color FROM factory_run_slots WHERE job=?',job.id):null,note=typeof b.note==='string'?b.note.trim().slice(0,500):'';
   run('INSERT INTO brain_memories VALUES(?,?,?,?,?,?)',randomUUID(),f[2],`${f[1]}: ${job.title}${slot?` (${slot.color})`:''}${note?' — '+note:''}`,job.id,slot?.garment||null,now());
  }else fail(404,'Unknown Brain action.');
  send(res,200,{ok:true});return true;
 }};
}
