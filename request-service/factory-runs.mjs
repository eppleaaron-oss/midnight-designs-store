import {randomUUID} from 'node:crypto';

// Garment types offered by the factory page. Each maps to an existing creator role so runs reuse the same
// workers, blueprints and job pipeline as the rest of the factory. Zones and density are planning guidance for the brief.
export const GARMENTS=[
 {id:'tshirt',single:'T-shirt',label:'T-shirts',role:'shirts',zones:['front','back','left-sleeve','right-sleeve'],density:[1,3]},
 {id:'longsleeve',single:'Long sleeve',label:'Long sleeves',role:'shirts',zones:['front','back','left-sleeve','right-sleeve'],density:[2,4]},
 {id:'sweatshirt',single:'Sweatshirt',label:'Sweatshirts',role:'hoodies',zones:['front','back','left-sleeve','right-sleeve'],density:[2,4]},
 {id:'hoodie',single:'Hoodie',label:'Hoodies',role:'hoodies',zones:['front','back','left-sleeve','right-sleeve','hood'],density:[3,5]},
 {id:'ziphoodie',single:'Zip hoodie',label:'Zip hoodies',role:'hoodies',zones:['front-left','front-right','back','left-sleeve','right-sleeve','hood'],density:[4,6]},
 {id:'jacket',single:'Jacket',label:'Jackets',role:'jackets',zones:['front-left','front-right','back','left-sleeve','right-sleeve','hood'],density:[4,6]},
 {id:'pants',single:'Pants',label:'Pants',role:'pants',zones:['left-leg','right-leg'],density:[1,2]},
 {id:'joggers',single:'Joggers',label:'Joggers',role:'pants',zones:['left-leg','right-leg'],density:[1,2]},
 {id:'shorts',single:'Shorts',label:'Shorts',role:'shorts',zones:['left-leg','right-leg'],density:[1,2]},
 {id:'hat',single:'Hat',label:'Hats',role:'headwear',zones:['front'],density:[1,1]},
 {id:'accessory',single:'Accessory',label:'Accessories',role:'accessories',zones:['front','back'],density:[1,2]},
 {id:'facemask',single:'Face mask',label:'Face masks',role:'facewear',zones:['front'],density:[1,1]},
 {id:'shoes',single:'Shoes',label:'Shoes',role:'footwear',zones:['left-side','right-side','tongue'],density:[1,3]}
];
export const COLORS=['Black','Charcoal','Heather grey','White','Cream','Navy','Forest green','Maroon','Red','Purple'];
export const DURATIONS={'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'8h':480};
const DURATION_MODES=[...Object.keys(DURATIONS),'custom','count','queue','unlimited'];
const garment=id=>GARMENTS.find(g=>g.id===id);
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const clean=(s,max)=>typeof s==='string'&&s.length<=max?s.trim():null;

// Validates a run configuration from the page and returns a normalized copy. Throws Error with an owner-facing message.
export function normalizeConfig(c){
 const bad=m=>{throw Error(m);};
 if(!c||typeof c!=='object')bad('Choose designs, clothing and quantities first.');
 const name=clean(c.name??'',80)??bad('Use a run name under 80 characters.');
 const artworkIds=Array.isArray(c.artworkIds)&&c.artworkIds.length<=300&&c.artworkIds.every(x=>typeof x==='string'&&x.length<=64)?[...new Set(c.artworkIds)]:bad('Select up to 300 designs.');
 const garments=Array.isArray(c.garments)&&c.garments.every(garment)?[...new Set(c.garments)]:bad('Choose valid clothing types.');
 const q=c.quantity||{},mode=['total','each','unlimited'].includes(q.mode)?q.mode:bad('Choose how many products to make.');
 const each={};for(const g of garments){const v=q.each?.[g]??0;if(!int(v,0,10000))bad('Use whole-number quantities up to 10,000.');each[g]=v;}
 const total=mode==='total'?(int(q.total,1,10000)?q.total:bad('Make between 1 and 10,000 products.')):0;
 const mix=c.mix||{},mixMode=['auto','count','percent'].includes(mix.mode)?mix.mode:'auto',mixValues={};
 for(const g of garments){const v=mix.values?.[g]??0;if(!int(v,0,10000))bad('Use whole numbers for the production mix.');mixValues[g]=v;}
 if(mode==='total'&&mixMode==='percent'&&garments.reduce((n,g)=>n+mixValues[g],0)!==100)bad('Production mix percentages must add up to 100.');
 const col=c.color||{},base=COLORS.includes(col.base)?col.base:'Black',colorMode=['global','per-product','ai'].includes(col.mode)?col.mode:'global';
 const exclude=Array.isArray(col.exclude)?col.exclude.filter(x=>COLORS.includes(x)):[];
 if(exclude.includes(base))bad('The base color cannot also be excluded.');
 const perGarment={};for(const g of garments){const list=col.perGarment?.[g];if(list===undefined)continue;if(!Array.isArray(list)||!list.length||list.some(x=>!COLORS.includes(x)))bad('Choose valid colors for each product.');perGarment[g]=[...new Set(list)].filter(x=>!exclude.includes(x));}
 const w=c.workers||{},workerTotal=int(w.total,1,100)?w.total:bad('Use 1 to 100 AI workers.'),workerMode=w.mode==='manual'?'manual':'auto',roles={};
 if(workerMode==='manual'){for(const g of [...garments,'qc']){const v=w.roles?.[g]??0;if(!int(v,0,100))bad('Use whole numbers for worker roles.');roles[g]=v;}if(Object.values(roles).reduce((a,b)=>a+b,0)!==workerTotal)bad('Worker roles must add up to the total number of workers.');}
 const d=c.duration||{},durationMode=DURATION_MODES.includes(d.mode)?d.mode:'unlimited';
 const minutes=durationMode==='custom'?(int(d.minutes,5,10080)?d.minutes:bad('Use a custom duration between 5 minutes and 7 days.')):DURATIONS[durationMode]||0;
 const untilCount=durationMode==='count'?(int(d.count,1,10000)?d.count:bad('Stop after 1 to 10,000 products.')):0;
 const output=['products','outfits','mix'].includes(c.output)?c.output:'products';
 const creativity=int(c.creativity,0,100)?c.creativity:35;
 const dn=c.density||{},densityMode=['ai','range','manual'].includes(dn.mode)?dn.mode:'ai',density={};
 for(const g of garments){const r=dn.values?.[g];if(densityMode==='ai'||r===undefined){density[g]=garment(g).density;continue;}if(!Array.isArray(r)||r.length!==2||!int(r[0],0,12)||!int(r[1],r[0],12))bad('Use design counts between 0 and 12 per product.');density[g]=densityMode==='manual'?[r[0],r[0]]:r;}
 const p=c.placement||{},placement={continueAcrossPanels:p.continueAcrossPanels!==false,mirrorSleeves:p.mirrorSleeves!==false,allowTile:p.allowTile===true,fill:['fit','fill','cover','contain'].includes(p.fill)?p.fill:'fit'};
 const qc=c.qc||{},qcSettings={automatic:qc.automatic!==false,threshold:int(qc.threshold,50,100)?qc.threshold:80,maxRevisions:int(qc.maxRevisions,0,5)?qc.maxRevisions:2,requireApproval:qc.requireApproval!==false};
 const l=c.limits||{},limits={simultaneous:int(l.simultaneous,1,4)?l.simultaneous:2,batch:int(l.batch,1,100)?l.batch:20,perWorker:int(l.perWorker,0,10000)?l.perWorker:0,costPerProductCents:int(l.costPerProductCents,0,100000)?l.costPerProductCents:0,runCents:int(l.runCents,0,10000000)?l.runCents:0,hourlyCents:int(l.hourlyCents,0,10000000)?l.hourlyCents:0};
 const audience=['unisex','men','women','children'].includes(c.audience)?c.audience:'unisex';
 const style=clean(c.style??'',500)??bad('Keep the style note under 500 characters.');
 const assignment=c.assignment==='manual'?'manual':'auto',designGarments={};
 if(assignment==='manual')for(const id of artworkIds){const list=c.designGarments?.[id];if(list===undefined)continue;if(!Array.isArray(list)||list.some(g=>!garments.includes(g)))bad('Assign designs only to selected clothing.');designGarments[id]=[...new Set(list)];}
 return {name,artworkIds,garments,quantity:{mode,total,each},mix:{mode:mixMode,values:mixValues},color:{base,mode:colorMode,perGarment,exclude,lock:col.lock!==false},workers:{total:workerTotal,mode:workerMode,roles},duration:{mode:durationMode,minutes,count:untilCount},output,creativity,density:{mode:densityMode,values:density},placement,qc:qcSettings,limits,audience,style,assignment,designGarments};
}

// Splits n into integer parts proportional to weights (largest remainder), so the parts always add up to n.
export function split(n,weights){const sum=weights.reduce((a,b)=>a+b,0)||1,raw=weights.map(w=>n*w/sum),out=raw.map(Math.floor);let left=n-out.reduce((a,b)=>a+b,0);raw.map((r,i)=>[r-Math.floor(r),i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{if(left>0){out[i]++;left--;}});return out;}

// Turns a normalized configuration into concrete per-garment quantities, worker allocation and colors.
export function planRun(c){
 const g=c.garments;let quantities={};
 if(c.quantity.mode==='each')for(const id of g)quantities[id]=c.quantity.each[id];
 else{const n=c.quantity.mode==='total'?c.quantity.total:c.limits.batch;const weights=c.mix.mode==='auto'?g.map(id=>garment(id).role==='jackets'?2:1):g.map(id=>c.mix.values[id]);const parts=split(n,weights.some(w=>w>0)?weights:g.map(()=>1));g.forEach((id,i)=>quantities[id]=parts[i]);}
 const total=Object.values(quantities).reduce((a,b)=>a+b,0);
 let workers;if(c.workers.mode==='manual')workers={...c.workers.roles};else{const qc=c.qc.automatic&&c.workers.total>1?Math.max(1,Math.round(c.workers.total*0.1)):0,rest=c.workers.total-qc,parts=split(rest,g.map(id=>quantities[id]||0).some(Boolean)?g.map(id=>quantities[id]):g.map(()=>1));workers={qc};g.forEach((id,i)=>workers[id]=parts[i]);}
 const colors={};for(const id of g){const list=c.color.mode==='per-product'&&c.color.perGarment[id]?.length?c.color.perGarment[id]:c.color.mode==='ai'?(c.color.perGarment[id]||COLORS).filter(x=>!c.color.exclude.includes(x)):[c.color.base];colors[id]=list;}
 const unlimited=c.quantity.mode==='unlimited'||c.duration.mode==='unlimited';
 return {quantities,total,unlimited,workers,colors,estimatedCostCents:unlimited?null:total*c.limits.costPerProductCents,batchCostCents:c.limits.batch*c.limits.costPerProductCents};
}

// Builds the ordered product slots for one pass of a run. Each slot becomes one factory job when queue space allows.
export function buildSlots(c,plan,artwork,cycle=0){
 const slots=[],designsFor=g=>c.assignment==='manual'?c.artworkIds.filter(id=>(c.designGarments[id]||c.garments).includes(g)):c.artworkIds;
 const outfitCount=c.output==='products'?0:c.output==='outfits'?Math.max(...c.garments.map(g=>plan.quantities[g]),0):Math.floor(Math.min(...c.garments.map(g=>plan.quantities[g]))/2);
 for(let o=0;o<outfitCount;o++){const design=c.artworkIds.length?c.artworkIds[(o+cycle)%c.artworkIds.length]:null,number=cycle*1000+o+1;for(const g of c.garments)slots.push({garment:g,design,outfit:'Midnight Outfit #'+String(number).padStart(3,'0'),color:plan.colors[g][o%plan.colors[g].length]});}
 for(const g of c.garments){const list=designsFor(g),n=c.output==='outfits'?0:plan.quantities[g]-(c.output==='mix'?outfitCount:0);for(let i=0;i<n;i++)slots.push({garment:g,design:list.length?list[(i+cycle)%list.length]:null,outfit:null,color:plan.colors[g][i%plan.colors[g].length]});}
 return slots.filter(s=>!s.design||artwork.has(s.design));
}

// The blank garment is white. Any other main color only exists if the fill option is switched on for every print area.
export function fillInstruction(color){
 return /^white$/i.test(color)?'Base garment color: White. Use the plain white garment with the fill option OFF.':`Base garment color: ${color}. FILL OPTION REQUIRED: switch on the fill option in ${color} for every print area, edge to edge, before placing any artwork. The blank garment is white, so without the fill the product comes out white. Never fake the color with a pasted solid-color image.`;
}
export function brief(c,slot,art){
 const g=garment(slot.garment),[lo,hi]=c.density.values[slot.garment],creative=c.creativity<34?'Strict: follow the uploaded design closely; only adapt scale and placement.':c.creativity<67?'Balanced: improve placement and composition while preserving the design.':'Experimental: variations, complementary graphics, alternate placements and matching sleeve graphics are allowed.';
 return [
  `${g.single} for production run "${c.name||'Untitled run'}".`,
  fillInstruction(slot.color)+(c.color.lock?' Color is locked.':''),
  art?`Primary artwork: ${art.name} (${art.collection}).`:'No artwork selected; wait for owner input.',
  `Design elements: ${lo===hi?lo:lo+'–'+hi} across ${g.zones.join(', ')}. Use the garment's real supplier blueprint, print areas, safe zones, bleed and seams.`,
  `Placement: ${c.placement.fill}; ${c.placement.continueAcrossPanels?'continue artwork across panels where it reads well':'keep each panel self-contained'}; ${c.placement.mirrorSleeves?'mirror sleeve graphics':'sleeves may differ'}; ${c.placement.allowTile?'tiling allowed':'no tiling'}. Never cut off faces or text at seams or distort artwork. Empty placements must be deliberate, never accidental.`,
  slot.outfit?`Part of ${slot.outfit}: coordinate theme, colors, typography and placement with the other pieces.`:'',
  `Creativity: ${creative}`,
  c.style?`Style: ${c.style}`:'',
  `Quality control: ${c.qc.automatic?`automatic, minimum score ${c.qc.threshold}, up to ${c.qc.maxRevisions} automatic revisions`:'manual'}; ${c.qc.requireApproval?'owner approval required before publishing':'owner review only for exceptions'}.`
 ].filter(Boolean).join('\n');
}

export function factoryRuns({db,auth,body,send,fail,limit,origin,manager,artwork,brain=null,storefrontOrigin,fetchImpl=fetch,clock=Date.now}){
 const all=(q,...a)=>db.prepare(q).all(...a),get=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a),now=()=>new Date(clock()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS factory_runs(id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,name TEXT NOT NULL,config TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,cycle INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',started INTEGER,ends INTEGER,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_run_slots(run TEXT NOT NULL,seq INTEGER NOT NULL,cycle INTEGER NOT NULL,garment TEXT NOT NULL,design TEXT,outfit TEXT,color TEXT NOT NULL,job TEXT,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(run,seq));
 CREATE INDEX IF NOT EXISTS factory_run_slots_job ON factory_run_slots(job);
 CREATE TABLE IF NOT EXISTS factory_presets(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,config TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_library_imports(design TEXT PRIMARY KEY,artwork TEXT NOT NULL,created TEXT NOT NULL);`);
 const ACTIVE=['running','waiting'],state=()=>get('SELECT state FROM factory_settings WHERE id=1')?.state||'stopped';
 const artworkMap=()=>new Map(all("SELECT id,name,collection FROM factory_artwork WHERE kind='original'").map(a=>[a.id,a]));
 let library={time:0,designs:null};
 async function storefrontDesigns(){if(library.designs&&clock()-library.time<600000)return library.designs;try{const r=await fetchImpl(storefrontOrigin+'/designs.json',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const list=await r.json();library={time:clock(),designs:list.filter(d=>d&&typeof d.id==='string'&&d.kind!=='reference'&&typeof d.image==='string').map(d=>({id:d.id,name:String(d.name||d.id).slice(0,100),category:String(d.category||'Midnight Designs').slice(0,100),image:storefrontOrigin+'/'+d.image.replace(/^\/+/,''),thumbnail:storefrontOrigin+'/'+String(d.thumbnail||d.image).replace(/^\/+/,'')}))};}catch{if(!library.designs)return [];}return library.designs;}

 // Moves queued slots into the factory job queue while there is room, respecting the run's batch size.
 async function feed(r){
  const c=JSON.parse(r.config),plan=JSON.parse(r.plan),t=clock();
  if(r.ends&&t>=r.ends){finish(r,'completed','Production time finished. Jobs already queued will continue.');return;}
  if(c.duration.mode==='count'&&completed(r.id)>=c.duration.count){finish(r,'completed','Product target reached.');return;}
  let pending=all('SELECT * FROM factory_run_slots WHERE run=? AND job IS NULL AND error=? ORDER BY seq',r.id,'');
  if(!pending.length&&plan.unlimited&&c.duration.mode!=='queue'&&!all("SELECT 1 FROM factory_run_slots s JOIN factory_jobs j ON j.id=s.job WHERE s.run=? AND j.status IN ('queued','running','retry_wait') LIMIT 1",r.id).length){addCycle(r,c,plan,r.cycle+1);pending=all('SELECT * FROM factory_run_slots WHERE run=? AND job IS NULL AND error=? ORDER BY seq',r.id,'');}
  if(!pending.length){if(!plan.unlimited&&!all("SELECT 1 FROM factory_run_slots s JOIN factory_jobs j ON j.id=s.job WHERE s.run=? AND j.status IN ('queued','running','retry_wait') LIMIT 1",r.id).length)finish(r,'completed','Every product in this run has been through production.');return;}
  const inFlight=get("SELECT count(*) n FROM factory_run_slots s JOIN factory_jobs j ON j.id=s.job WHERE s.run=? AND j.status IN ('queued','running','retry_wait')",r.id).n;
  const room=Math.min(100-get("SELECT count(*) n FROM factory_jobs WHERE status='queued'").n,c.limits.batch-inFlight);
  const art=artworkMap();
  // The slot's own design leads; the run's other designs (rotated per slot) are offered for secondary and accent placements.
  const support=(c,s,a)=>{const rest=c.artworkIds.filter(id=>id!==a?.id&&art.has(id)),k=rest.length?s.seq%rest.length:0;return [...(a?[a]:[]),...[...rest.slice(k),...rest.slice(0,k)].map(id=>art.get(id))];};
  for(const s of pending.slice(0,Math.max(0,room))){
   const g=garment(s.garment),a=s.design?art.get(s.design):null,label=g.single;
   const title=(s.outfit?s.outfit+' · ':'')+label+(a?' · '+a.name:'');
   try{const prepared=await manager.prepareJob({title:title.slice(0,100),brief:[brief(c,s,a),brain?.production(s.garment,support(c,s,a)),brain?.knowledge(s.garment)].filter(Boolean).join('\n\n').slice(0,6000),kind:s.outfit?'outfit':'product',gender:c.audience,employee:g.role,selection:{product:null,fit:'',sizes:[],collection:a?a.collection:'',artworkIds:support(c,s,a).map(x=>x.id).slice(0,12)}});
    db.exec('BEGIN IMMEDIATE');try{manager.insertJob(prepared);run('UPDATE factory_run_slots SET job=? WHERE run=? AND seq=?',prepared.id,r.id,s.seq);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
   catch(e){if(e.status===409&&/queue is full/i.test(e.message))break;run('UPDATE factory_run_slots SET error=? WHERE run=? AND seq=?',String(e.message).slice(0,300),r.id,s.seq);}
  }
 }
 function addCycle(r,c,plan,cycle){const slots=buildSlots(c,plan,artworkMap(),cycle),start=(get('SELECT max(seq) n FROM factory_run_slots WHERE run=?',r.id).n??-1)+1;slots.forEach((s,i)=>run('INSERT INTO factory_run_slots(run,seq,cycle,garment,design,outfit,color) VALUES(?,?,?,?,?,?,?)',r.id,start+i,cycle,s.garment,s.design,s.outfit,s.color));run('UPDATE factory_runs SET cycle=?,updated=? WHERE id=?',cycle,now(),r.id);r.cycle=cycle;}
 function finish(r,status,message){run('UPDATE factory_runs SET status=?,message=?,updated=? WHERE id=?',status,message,now(),r.id);}
 const completed=id=>get('SELECT count(*) n FROM factory_run_slots s JOIN factory_job_runtime t ON t.job=s.job WHERE s.run=? AND t.step>=4',id).n;
 async function tick(){for(const r of all("SELECT * FROM factory_runs WHERE status IN ('running','waiting')"))await feed(r);}

 function runView(r){if(!r)return null;const c=JSON.parse(r.config),plan=JSON.parse(r.plan);const counts=Object.fromEntries(all("SELECT COALESCE(j.status,CASE WHEN s.error<>'' THEN 'not_queued' ELSE 'planned' END) status,count(*) n FROM factory_run_slots s LEFT JOIN factory_jobs j ON j.id=s.job WHERE s.run=? GROUP BY 1",r.id).map(x=>[x.status,x.n]));
  return {id:r.id,number:r.number,name:r.name,status:r.status,message:r.message,config:c,plan,cycle:r.cycle,started:r.started,ends:r.ends,created:r.created,updated:r.updated,counts,completed:completed(r.id),slotErrors:all("SELECT garment,error,count(*) n FROM factory_run_slots WHERE run=? AND error<>'' GROUP BY garment,error LIMIT 10",r.id)};}

 function stage(j){if(j.status==='queued')return j.step>0?'Assigned':'Queued';if(j.status==='awaiting_review')return 'Owner review';if(j.status==='draft_saved')return 'Approved (draft)';if(j.status==='completed')return 'Ready for publishing';if(['failed','waiting_input','retry_wait'].includes(j.status))return j.status==='retry_wait'?'Revision':'Needs attention';if(j.status==='running')return ['Designing','Blueprint fit','Blueprint fit','AI QC','Supplier product','Mockup','Publishing'][j.step]||'Designing';return j.status;}

 function snapshot(){
  const settings=get('SELECT * FROM factory_settings WHERE id=1')||{state:'stopped',daily_budget:0,total_budget:0},today=new Date(clock()).toISOString().slice(0,10),hour=clock()-3600000;
  const counts=Object.fromEntries(all('SELECT status,count(*) n FROM factory_jobs GROUP BY status').map(x=>[x.status,x.n]));
  const jobs=all(`SELECT j.id,j.title,j.employee,j.status,j.error,j.updated,COALESCE(t.step,0) step,t.worker,s.run,s.garment,s.color,s.outfit,r.number FROM factory_jobs j LEFT JOIN factory_job_runtime t ON t.job=j.id LEFT JOIN factory_run_slots s ON s.job=j.id LEFT JOIN factory_runs r ON r.id=s.run WHERE j.status NOT IN ('archived','cancelled') ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'awaiting_review' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,j.updated DESC LIMIT 200`).map(j=>({...j,stage:stage(j),progress:j.status==='completed'?100:Math.round(Math.min(j.step,7)/7*100)}));
  const completedToday=get('SELECT count(*) n FROM factory_job_checkpoints WHERE step=? AND created>=?','review',Date.parse(today+'T00:00:00Z')).n,lastHour=get('SELECT count(*) n FROM factory_job_checkpoints WHERE step=? AND created>=?','review',hour).n;
  const heartbeat=get('SELECT max(seen) seen FROM factory_worker_heartbeats')?.seen||0,workerConnected=clock()-heartbeat<45000;
  const spent=get('SELECT COALESCE(sum(amount),0) n FROM factory_usage')?.n||0,spentToday=get('SELECT COALESCE(sum(amount),0) n FROM factory_usage WHERE created>=?',today)?.n||0;
  const active=get("SELECT * FROM factory_runs WHERE status IN ('running','waiting','paused') ORDER BY number DESC LIMIT 1");
  const remaining=active?get("SELECT count(*) n FROM factory_run_slots s LEFT JOIN factory_jobs j ON j.id=s.job WHERE s.run=? AND (s.job IS NULL AND s.error='' OR j.status IN ('queued','running','retry_wait'))",active.id).n:0;
  // A run is interrupted when it still has work but production stopped underneath it after it had begun processing.
  const processed=active&&get('SELECT 1 x FROM factory_run_slots s JOIN factory_job_checkpoints k ON k.job=s.job WHERE s.run=? LIMIT 1',active.id);
  const interrupted=active&&active.status==='running'&&remaining&&(settings.state==='running'?!workerConnected&&processed:processed)?{number:active.number,id:active.id,reason:settings.state==='running'?'The background worker stopped responding.':'The factory stopped before this run finished.'}:null;
  return {factory:{state:settings.state,workerConnected,dailyBudgetCents:settings.daily_budget,totalBudgetCents:settings.total_budget,spentCents:spent,spentTodayCents:spentToday,providerConnected:false},
   summary:{running:counts.running||0,waiting:(counts.queued||0)+(counts.retry_wait||0),inQc:jobs.filter(j=>j.status==='running'&&j.step===3).length,needReview:(counts.awaiting_review||0)+(counts.waiting_input||0),failed:counts.failed||0,completedToday,productsPerHour:lastHour,queueSize:counts.queued||0,etaMinutes:lastHour&&remaining?Math.ceil(remaining/lastHour*60):null},
   active:runView(active),interrupted,runs:all('SELECT * FROM factory_runs ORDER BY number DESC LIMIT 20').map(r=>({id:r.id,number:r.number,name:r.name,status:r.status,message:r.message,created:r.created,completed:completed(r.id),slots:get('SELECT count(*) n FROM factory_run_slots WHERE run=?',r.id).n})),
   presets:all('SELECT id,name,config,updated FROM factory_presets ORDER BY name').map(p=>({...p,config:JSON.parse(p.config)})),
   jobs,garments:GARMENTS,colors:COLORS,
   artwork:all("SELECT a.id,a.name,a.collection,a.created,i.design FROM factory_artwork a LEFT JOIN factory_library_imports i ON i.artwork=a.id WHERE a.kind='original' ORDER BY a.created DESC").map(a=>({...a,url:'/api/owner/ai-factory/artwork/'+a.id+'/file'}))};
 }

 async function importDesigns(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>25||ids.some(x=>typeof x!=='string'))fail(400,'Import 1 to 25 designs at a time.');
  const list=await storefrontDesigns(),done=[],errors=[];
  for(const id of new Set(ids)){if(get('SELECT 1 FROM factory_library_imports WHERE design=?',id)){done.push(id);continue;}const d=list.find(x=>x.id===id);if(!d){errors.push(id+': not in the design library');continue;}
   try{const r=await fetchImpl(d.image,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('download failed ('+r.status+')');const data=Buffer.from(await r.arrayBuffer());
    const artworkId=artwork.importFile({data,filename:d.image.split('/').pop().slice(0,180)},{name:d.name,collection:d.category,scope:'collection',target:'',product:null,placements:['front','back'],instructions:'Imported from the Midnight Designs design library ('+d.id+').',permissions:{reuse:true,recolor:true,crop:true,modify:true}});
    run('INSERT INTO factory_library_imports VALUES(?,?,?)',id,artworkId,now());done.push(id);}catch(e){errors.push(d.name+': '+(e.message||'import failed'));}}
  return {imported:done,errors};
 }

 return {tick,snapshot,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/runs'))return false;auth(req,null,true);
  if(method==='GET'&&path==='/api/owner/ai-factory/runs'){await tick();send(res,200,snapshot());return true;}
  if(method==='GET'&&path==='/api/owner/ai-factory/runs/library'){const imported=new Map(all('SELECT design,artwork FROM factory_library_imports').map(x=>[x.design,x.artwork]));send(res,200,{designs:(await storefrontDesigns()).map(d=>({...d,artworkId:imported.get(d.id)||null}))});return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-runs',60);const b=await body(req);
  const config=()=>{try{return normalizeConfig(b.config);}catch(e){fail(400,e.message);}};
  if(path==='/api/owner/ai-factory/runs/plan'){const c=config();send(res,200,{config:c,plan:planRun(c)});return true;}
  if(path==='/api/owner/ai-factory/runs/import'){send(res,200,await importDesigns(b.ids));return true;}
  if(path==='/api/owner/ai-factory/runs/preset'){const c=config(),name=clean(b.name??'',60);if(!name)fail(400,'Name the preset (up to 60 characters).');const existing=get('SELECT id FROM factory_presets WHERE name=?',name);run('INSERT INTO factory_presets VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config,updated=excluded.updated',existing?.id||randomUUID(),name,JSON.stringify(b.keepDesigns===true?c:{...c,artworkIds:[],designGarments:{}}),now());send(res,200,snapshot());return true;}
  if(path==='/api/owner/ai-factory/runs/preset-delete'){run('DELETE FROM factory_presets WHERE id=?',String(b.id||''));send(res,200,snapshot());return true;}
  if(path==='/api/owner/ai-factory/runs/start'){
   const c=config();if(!c.garments.length)fail(400,'Choose at least one clothing type.');if(!c.artworkIds.length)fail(400,'Select at least one design.');
   const art=artworkMap();if(c.artworkIds.some(id=>!art.has(id)))fail(400,'Some selected designs are no longer in the factory library.');
   const plan=planRun(c);if(!plan.unlimited&&!plan.total)fail(400,'Set a production quantity above zero.');
   if(c.limits.runCents&&plan.estimatedCostCents!==null&&plan.estimatedCostCents>c.limits.runCents)fail(409,'The estimated cost is above this run\'s spending limit.');
   if(get("SELECT 1 FROM factory_runs WHERE status IN ('running','waiting','paused')"))fail(409,'Finish or stop the current production run first.');
   for(const role of new Set(c.garments.map(g=>garment(g).role)))run("UPDATE factory_employees SET enabled=1 WHERE id=? AND id NOT IN (SELECT id FROM factory_employee_settings WHERE kind='creator' AND removed=1)",role);
   const id=randomUUID(),number=(get('SELECT max(number) n FROM factory_runs').n||0)+1,t=clock();
   run('INSERT INTO factory_runs(id,number,name,config,plan,status,started,ends,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',id,number,c.name||'Production run #'+number,JSON.stringify(c),JSON.stringify(plan),'running',t,c.duration.minutes?t+c.duration.minutes*60000:null,now(),now());
   const r=get('SELECT * FROM factory_runs WHERE id=?',id);addCycle(r,c,plan,0);await feed(r);send(res,200,snapshot());return true;}
  if(path==='/api/owner/ai-factory/runs/control'){
   const r=get('SELECT * FROM factory_runs WHERE id=?',String(b.id||''));if(!r)fail(404,'Production run not found.');
   const action=b.action;if(!['pause','resume','stop','emergency-stop'].includes(action))fail(400,'Unknown run action.');
   if(action==='pause'&&ACTIVE.includes(r.status))run("UPDATE factory_runs SET status='paused',updated=? WHERE id=?",now(),r.id);
   else if(action==='resume'&&['paused','running','waiting'].includes(r.status)){run("UPDATE factory_runs SET status='running',message='',updated=? WHERE id=?",now(),r.id);await feed(get('SELECT * FROM factory_runs WHERE id=?',r.id));}
   else if(action==='stop'||action==='emergency-stop')finish(r,'stopped',action==='stop'?'Stopped by the owner. Products already in production keep their progress.':'Emergency stop. Queued and running work was cancelled.');
   send(res,200,snapshot());return true;}
  if(path==='/api/owner/ai-factory/runs/duplicate'){const r=get('SELECT * FROM factory_runs WHERE id=?',String(b.id||''));if(!r)fail(404,'Production run not found.');send(res,200,{config:JSON.parse(r.config)});return true;}
  fail(404,'Unknown production run action.');
 }};
}
