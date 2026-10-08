'use strict';
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((c||0)/100),num=n=>new Intl.NumberFormat('en-US').format(n||0);
const ROLE_LABELS={headwear:'Headwear',shirts:'Shirts',hoodies:'Hoodies',jackets:'Jackets',pants:'Pants',shorts:'Shorts',accessories:'Accessories'};
const SWATCH={Black:'#0d0d0d',Charcoal:'#3a3a3a','Heather grey':'#9a9a96',White:'#f4f4f2',Cream:'#ece2c9',Navy:'#1d2a44','Forest green':'#26402d',Maroon:'#5a1c23',Red:'#a5262a',Purple:'#4b2d63'};
let snap=null,library=null,queueFilter='all',planTimer=0,busy=false,lastPlan=null;
const selected=new Set(),librarySelected=new Set(),garments=new Set(),each={},mix={},roles={},density={},perColor={},exclude=new Set(),designGarments={};
let baseColor='Black';

async function api(path,body,raw){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(70000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Factory request failed.');return d;}
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,6000);}
async function guard(button,work){if(busy)return;busy=true;if(button)button.disabled=true;try{await work();}catch(e){toast(e.message);}finally{busy=false;if(button)button.disabled=false;renderControls();}}

// ---------- configuration ----------
const dollars=id=>Math.round((Number($(id).value)||0)*100);
const intOf=(id,fallback)=>{const v=Math.round(Number($(id).value));return Number.isFinite(v)?v:fallback;};
function config(){
 const g=[...garments],pick=o=>Object.fromEntries(g.map(id=>[id,o[id]||0]));
 const dm=$('densityMode').value;
 return {name:$('runName').value.trim(),artworkIds:[...selected],garments:g,
  quantity:{mode:document.querySelector('input[name=qtyMode]:checked').value,total:intOf('qtyTotal',0),each:pick(each)},
  mix:{mode:$('mixMode').value,values:pick(mix)},
  color:{base:baseColor,mode:$('colorMode').value,perGarment:Object.fromEntries(g.filter(id=>perColor[id]?.length).map(id=>[id,perColor[id]])),exclude:[...exclude],lock:$('colorLock').checked},
  workers:{total:intOf('workerTotal',1),mode:$('workerAuto').checked?'auto':'manual',roles:Object.fromEntries([...g,'qc'].map(id=>[id,roles[id]||0]))},
  duration:{mode:$('duration').value,minutes:intOf('durationMinutes',90),count:intOf('durationCount',50)},
  output:document.querySelector('input[name=output]:checked').value,creativity:intOf('creativity',35),
  density:{mode:dm,values:Object.fromEntries(g.map(id=>[id,density[id]||garment(id).density]))},
  placement:{fill:$('placeFill').value,continueAcrossPanels:$('placePanels').checked,mirrorSleeves:$('placeMirror').checked,allowTile:$('placeTile').checked},
  qc:{automatic:$('qcAuto').checked,threshold:intOf('qcThreshold',80),maxRevisions:intOf('qcRevisions',2),requireApproval:$('qcApproval').checked},
  limits:{simultaneous:intOf('limSimultaneous',2),batch:intOf('limBatch',20),perWorker:intOf('limPerWorker',0),costPerProductCents:dollars('limCostPer'),runCents:dollars('limRun'),hourlyCents:0},
  audience:$('audience').value,style:$('styleNote').value.trim(),assignment:$('assignment').value,designGarments:Object.fromEntries([...selected].filter(id=>designGarments[id]).map(id=>[id,designGarments[id].filter(x=>garments.has(x))]))};
}
function applyConfig(c){
 if(c.artworkIds?.length){selected.clear();const known=new Set((snap?.artwork||[]).map(a=>a.id));c.artworkIds.filter(id=>known.has(id)).forEach(id=>selected.add(id));}
 garments.clear();(c.garments||[]).forEach(id=>garments.add(id));
 const radio=(name,v)=>{const r=document.querySelector(`input[name=${name}][value="${v}"]`);if(r)r.checked=true;};
 radio('qtyMode',c.quantity?.mode||'total');$('qtyTotal').value=c.quantity?.total||100;Object.assign(each,c.quantity?.each||{});
 $('mixMode').value=c.mix?.mode||'auto';Object.assign(mix,c.mix?.values||{});
 baseColor=c.color?.base||'Black';$('colorMode').value=c.color?.mode||'global';Object.assign(perColor,c.color?.perGarment||{});exclude.clear();(c.color?.exclude||[]).forEach(x=>exclude.add(x));$('colorLock').checked=c.color?.lock!==false;
 $('workerTotal').value=c.workers?.total||20;$('workerAuto').checked=c.workers?.mode!=='manual';Object.assign(roles,c.workers?.roles||{});
 $('duration').value=c.duration?.mode||'queue';$('durationMinutes').value=c.duration?.minutes||90;$('durationCount').value=c.duration?.count||50;
 radio('output',c.output||'products');$('creativity').value=c.creativity??35;
 $('densityMode').value=c.density?.mode||'ai';Object.assign(density,c.density?.values||{});
 $('placeFill').value=c.placement?.fill||'fit';$('placePanels').checked=c.placement?.continueAcrossPanels!==false;$('placeMirror').checked=c.placement?.mirrorSleeves!==false;$('placeTile').checked=!!c.placement?.allowTile;
 $('qcAuto').checked=c.qc?.automatic!==false;$('qcThreshold').value=c.qc?.threshold||80;$('qcRevisions').value=c.qc?.maxRevisions??2;$('qcApproval').checked=c.qc?.requireApproval!==false;
 const l=c.limits||{};$('limSimultaneous').value=l.simultaneous||2;$('limBatch').value=l.batch||20;$('limPerWorker').value=l.perWorker||0;$('limCostPer').value=((l.costPerProductCents||0)/100).toFixed(2);$('limRun').value=Math.round((l.runCents||0)/100);
 $('audience').value=c.audience||'unisex';$('styleNote').value=c.style||'';$('assignment').value=c.assignment||'auto';Object.assign(designGarments,c.designGarments||{});
 if(c.name)$('runName').value=c.name;
 renderSetup();
}
const garment=id=>(snap?.garments||[]).find(g=>g.id===id)||{id,label:id,role:'',zones:[],density:[1,2]};

// ---------- setup rendering ----------
function numberRows(box,ids,values,{label=id=>garment(id).label,min=0,max=10000,suffix=''}={}){
 box.replaceChildren(...ids.map(id=>{const wrap=node('div','', 'fx-num'),l=node('label',label(id)+suffix),i=node('input');i.type='number';i.min=min;i.max=max;i.id='n-'+box.id+'-'+id;l.htmlFor=i.id;i.value=values[id]??0;i.oninput=()=>{values[id]=Math.round(Number(i.value)||0);schedulePlan();};wrap.append(l,i);return wrap;}));
}
function renderSetup(){
 renderGarments();renderSwatches();renderDesigns();
 const g=[...garments],mode=document.querySelector('input[name=qtyMode]:checked').value;
 $('qtyTotalBox').hidden=mode!=='total';$('qtyEachBox').hidden=mode!=='each';
 if(mode==='each'){g.forEach(id=>{if(each[id]===undefined)each[id]=20;});numberRows($('qtyEachBox'),g,each);}
 const mm=$('mixMode').value;$('mixBox').hidden=mm==='auto'||!g.length;if(mm!=='auto')numberRows($('mixBox'),g,mix,{suffix:mm==='percent'?' (%)':''});
 const manual=!$('workerAuto').checked;[...$('workerRoles').querySelectorAll('input')].forEach(i=>i.disabled=!manual);numberRows($('workerRoles'),[...g,'qc'],roles,{label:id=>id==='qc'?'Quality control':garment(id).label,max:100});[...$('workerRoles').querySelectorAll('input')].forEach(i=>i.disabled=!manual);
 const cm=$('colorMode').value;$('perGarmentColors').hidden=cm==='global'||!g.length;
 $('perGarmentColors').replaceChildren(...g.map(id=>{const row=node('div','', 'fx-color-row');row.append(node('span',garment(id).label,'fx-sublabel'));const chips=node('div','', 'fx-chips');for(const c of snap?.colors||[]){if(exclude.has(c))continue;const b=chip(c,(perColor[id]||[]).includes(c),on=>{const list=new Set(perColor[id]||[]);on?list.add(c):list.delete(c);perColor[id]=[...list];schedulePlan();});chips.append(b);}row.append(chips);return row;}));
 $('excludeColors').replaceChildren(...(snap?.colors||[]).filter(c=>c!==baseColor).map(c=>chip(c,exclude.has(c),on=>{on?exclude.add(c):exclude.delete(c);renderSetup();})));
 const dm=$('densityMode').value;$('densityBox').hidden=dm==='ai'||!g.length;
 if(dm!=='ai')$('densityBox').replaceChildren(...g.map(id=>{const r=density[id]||[...garment(id).density];density[id]=r;const wrap=node('div','', 'fx-num');const l=node('label',garment(id).label+(dm==='range'?' (min–max)':''));const a=node('input'),b=node('input');[a,b].forEach((i,k)=>{i.type='number';i.min=0;i.max=12;i.value=r[k];i.id=`dn-${id}-${k}`;i.oninput=()=>{r[k]=Math.round(Number(i.value)||0);if(dm==='manual')r[1]=r[0];schedulePlan();};});l.htmlFor=a.id;wrap.append(l,a);if(dm==='range'){b.setAttribute('aria-label',garment(id).label+' maximum');wrap.append(b);}return wrap;}));
 $('assignBox').hidden=$('assignment').value!=='manual';if(!$('assignBox').hidden)renderAssign();
 $('durationCustomBox').hidden=$('duration').value!=='custom';$('durationCountBox').hidden=$('duration').value!=='count';
 const v=Number($('creativity').value);$('creativityText').textContent=v<34?'Strict: follow my uploaded designs very closely.':v<67?'Balanced: improve placement and composition while keeping the design.':'Experimental: variations, complementary graphics and alternate placements are allowed.';
 schedulePlan();
}
function chip(label,on,change){const b=node('button',label,'fx-chip');b.type='button';b.setAttribute('aria-pressed',String(on));b.onclick=()=>{const next=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(next));change(next);};return b;}
function renderGarments(){
 const box=$('garmentCards');box.replaceChildren(...(snap?.garments||[]).map(g=>{const l=node('label','', 'fx-card'),c=node('input');c.type='checkbox';c.checked=garments.has(g.id);c.onchange=()=>{c.checked?garments.add(g.id):garments.delete(g.id);renderSetup();};const zones=g.zones.length;l.append(c,node('strong',g.label),node('span',`${zones} print ${zones===1?'area':'areas'} · ${g.density[0]===g.density[1]?g.density[0]:g.density[0]+'–'+g.density[1]} designs`,'fx-sublabel'));return l;}));
 $('garmentCount').textContent=garments.size+' selected';
}
function renderSwatches(){
 $('colorSwatches').replaceChildren(...(snap?.colors||[]).filter(c=>!exclude.has(c)).map(c=>{const b=node('button','', 'fx-swatch');b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(c===baseColor));const dot=node('span','', 'fx-dot');dot.style.background=SWATCH[c]||'#777';b.append(dot,node('span',c));b.onclick=()=>{baseColor=c;renderSetup();};return b;}));
}
function renderAssign(){
 const art=new Map((snap?.artwork||[]).map(a=>[a.id,a])),g=[...garments];
 const rows=[...selected].slice(0,300).map(id=>{const row=node('div','', 'fx-assign-row');row.append(node('span',art.get(id)?.name||id));const chips=node('div','', 'fx-chips');for(const gid of g)chips.append(chip(garment(gid).label,(designGarments[id]||g).includes(gid),on=>{const list=new Set(designGarments[id]||g);on?list.add(gid):list.delete(gid);designGarments[id]=[...list];schedulePlan();}));row.append(chips);return row;});
 $('assignBox').replaceChildren(...(rows.length?rows:[node('p','Select designs and clothing first.','fx-note')]));
}

// ---------- designs ----------
function renderDesigns(){
 const art=snap?.artwork||[],q=$('designSearch').value.trim().toLowerCase(),col=$('designCollection').value;
 const cols=[...new Set(art.map(a=>a.collection))].sort();const current=$('designCollection').value;$('designCollection').replaceChildren(node('option','All collections'),...cols.map(c=>{const o=node('option',c);o.value=c;return o;}));$('designCollection').options[0].value='';$('designCollection').value=cols.includes(current)?current:'';
 const shown=art.filter(a=>(!col||a.collection===col)&&(!q||(a.name+' '+a.collection).toLowerCase().includes(q)));
 renderDesigns.shown=shown;
 $('designGrid').replaceChildren(...(shown.length?shown.slice(0,400).map(a=>tile(a.name,a.collection,a.url,selected.has(a.id),on=>{on?selected.add(a.id):selected.delete(a.id);$('designCount').textContent=selected.size+' selected';schedulePlan();})):[node('p',art.length?'No designs match this search.':'No designs in the factory yet. Add some from the Midnight Designs library or upload them.','fx-note')]));
 if(shown.length>400)$('designGrid').append(node('p',`Showing 400 of ${shown.length}. Search or filter to narrow the list.`,'fx-note'));
 $('designCount').textContent=selected.size+' selected';
}
function tile(name,sub,src,on,change){const l=node('label','', 'fx-tile'),c=node('input'),img=node('img');c.type='checkbox';c.checked=on;c.onchange=()=>change(c.checked);img.src=src;img.alt='';img.loading='lazy';img.decoding='async';l.append(c,img,node('span',name,'fx-tile-name'),node('span',sub,'fx-sublabel'));return l;}
async function loadLibrary(){
 if(library)return renderLibrary();$('libraryNote').textContent='Loading the Midnight Designs library…';
 try{library=(await api('runs/library')).designs;$('libraryNote').textContent=library.length?'':'The store design library could not be reached. Try again later.';}catch(e){$('libraryNote').textContent=e.message;library=null;return;}
 const cats=[...new Set(library.map(d=>d.category))].sort();$('libraryCategory').replaceChildren(node('option','All categories'),...cats.map(c=>{const o=node('option',c);o.value=c;return o;}));$('libraryCategory').options[0].value='';
 renderLibrary();
}
function renderLibrary(){
 if(!library)return;const q=$('librarySearch').value.trim().toLowerCase(),cat=$('libraryCategory').value;
 const shown=library.filter(d=>(!cat||d.category===cat)&&(!q||(d.name+' '+d.category).toLowerCase().includes(q)));renderLibrary.shown=shown;
 $('libraryGrid').replaceChildren(...shown.map(d=>tile(d.name,d.artworkId?'In factory · '+d.category:d.category,d.thumbnail,librarySelected.has(d.id),on=>{on?librarySelected.add(d.id):librarySelected.delete(d.id);$('libraryImport').textContent=librarySelected.size?`Add ${librarySelected.size} to factory`:'Add selected to factory';})));
 $('libraryImport').textContent=librarySelected.size?`Add ${librarySelected.size} to factory`:'Add selected to factory';
}
async function importLibrary(){
 const ids=[...librarySelected];if(!ids.length)return toast('Select designs from the library first.');
 const errors=[];let done=0;for(let i=0;i<ids.length;i+=25){$('libraryNote').textContent=`Adding designs to the factory… ${done} of ${ids.length}`;const r=await api('runs/import',{ids:ids.slice(i,i+25)});done+=r.imported.length;errors.push(...r.errors);}
 library=(await api('runs/library')).designs;for(const d of library)if(librarySelected.has(d.id)&&d.artworkId)selected.add(d.artworkId);librarySelected.clear();
 await refresh();$('libraryNote').textContent=`${done} designs are in the factory and selected for this run.`+(errors.length?` ${errors.length} could not be added: ${errors.slice(0,3).join('; ')}`:'');renderLibrary();
}
async function upload(files){
 const list=[...files].filter(f=>/^image\/(png|jpeg|webp)$/.test(f.type));if(!list.length)return toast('Choose PNG, JPEG or WebP images.');
 const big=list.filter(f=>f.size>5*1024*1024);const ok=list.filter(f=>f.size<=5*1024*1024),collection=$('uploadCollection').value.trim()||'New uploads';
 const before=new Set((snap?.artwork||[]).map(a=>a.id));let batch=[],bytes=0,sent=0;
 const flush=async()=>{if(!batch.length)return;const payload=await Promise.all(batch.map(f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({filename:f.name.slice(0,180),base64:String(r.result).split(',')[1]});r.onerror=()=>rej(Error('Could not read '+f.name));r.readAsDataURL(f);})));
  await api('artwork/upload',{name:batch.length===1?batch[0].name.replace(/\.[a-z]+$/i,'').slice(0,100):'Upload',collection,scope:'collection',target:'',product:null,instructions:'',placements:['front','back'],permissions:{reuse:true,recolor:true,crop:true,modify:true},files:payload});sent+=batch.length;$('uploadNote').textContent=`Uploaded ${sent} of ${ok.length}…`;batch=[];bytes=0;};
 try{for(const f of ok){if(batch.length===10||bytes+f.size>7.5*1024*1024)await flush();batch.push(f);bytes+=f.size;}await flush();}catch(e){$('uploadNote').textContent=`Uploaded ${sent} of ${ok.length}. ${e.message}`;}
 await refresh();for(const a of snap.artwork)if(!before.has(a.id))selected.add(a.id);renderDesigns();schedulePlan();
 if(sent===ok.length)$('uploadNote').textContent=`${sent} designs uploaded to "${collection}" and selected for this run.`+(big.length?` ${big.length} skipped for being over 5 MB.`:'');
}

// ---------- plan ----------
function schedulePlan(){clearTimeout(planTimer);planTimer=setTimeout(plan,350);}
async function plan(){
 const c=config(),box=$('planSummary');$('designCount').textContent=selected.size+' selected';
 if(!garments.size){box.replaceChildren();$('planNote').textContent='Choose at least one clothing type.';lastPlan=null;return;}
 try{const {plan:p}=await api('runs/plan',{config:c});lastPlan=p;
  const products=c.garments.map(id=>`${garment(id).label} ${p.unlimited&&c.quantity.mode!=='each'?'':num(p.quantities[id])}`.trim()).join(' + ');
  const workers=Object.entries(p.workers).filter(([,n])=>n>0).map(([id,n])=>`${n} ${id==='qc'?'QC':garment(id).label.toLowerCase()}`).join(', ');
  const dur=$('duration').selectedOptions[0].textContent;
  const rows=[['Designs',`${selected.size} selected`],['Products',products+(p.unlimited?' (repeats until stopped)':'')],['Total',p.unlimited?'Unlimited':num(p.total)],['Base color',c.color.mode==='global'?c.color.base:c.color.mode==='ai'?'AI chooses':'Per product'],['Workers',`${c.workers.total} (${workers})`],['Duration',dur],['QC',c.qc.automatic?'Automatic':'Manual'],['Estimated cost',p.estimatedCostCents===null?money(p.batchCostCents)+' per batch':money(p.estimatedCostCents)]];
  box.replaceChildren(...rows.flatMap(([k,v])=>[node('dt',k),node('dd',v)]));
  $('planNote').textContent=!selected.size?'Select at least one design.':!c.limits.costPerProductCents?'No AI image provider is connected, so production currently has no AI cost.':'';
 }catch(e){box.replaceChildren();$('planNote').textContent=e.message;lastPlan=null;}
}

// ---------- launch and controls ----------
async function setConcurrency(n){try{const p=(await api('production')).policy;delete p.leaseSeconds;if(p.maxConcurrent!==n)await api('production/policy',{policy:{...p,maxConcurrent:n}});}catch(e){toast('Jobs at the same time not saved: '+e.message);}}
async function factory(action){try{await api('control',{action});return null;}catch(e){return e.message;}}
async function launch(){
 if(!selected.size)return toast('Select at least one design.');if(!garments.size)return toast('Choose at least one clothing type.');
 const c=config();snap=await api('runs/start',{config:c});await setConcurrency(c.limits.simultaneous);
 const blocked=await factory(snap.factory.state==='paused'?'resume':'start');await refresh();
 $('controlNote').textContent=blocked?`Run #${snap.active?.number} is saved and its products are queued. The factory can't start yet: ${blocked}`:`Run #${snap.active?.number} started.`;
 document.querySelector('.fx-summary').scrollIntoView({behavior:'smooth'});
}
async function control(action){
 const run=snap?.active;
 if(action==='start'&&!run){$('stepDesigns').scrollIntoView({behavior:'smooth'});return toast('Set up a production run below, then press Start factory.');}
 const blocked=await factory(action==='start'&&snap.factory.state==='paused'?'resume':action);
 if(run)snap=await api('runs/control',{id:run.id,action:action==='start'?'resume':action});
 await refresh();$('controlNote').textContent=blocked?`The factory didn't ${action.replace('-',' ')}: ${blocked}`:{start:'Factory started.',resume:'Factory resumed.',pause:'Factory paused. Work in progress keeps its place.',stop:'Factory stopped. Finished products are kept.','emergency-stop':'Emergency stop. Queued and running work was cancelled; finished products are kept.'}[action];
}
function renderControls(){
 if(!snap)return;const s=snap.factory.state,active=!!snap.active;
 $('ctlStart').disabled=busy||s==='running'&&active;$('ctlPause').disabled=busy||s!=='running';$('ctlResume').disabled=busy||s!=='paused';$('ctlStop').disabled=busy||s==='stopped'&&!active;$('ctlEmergency').disabled=busy||s==='stopped'&&!active;
}
let emergencyArmed=0;
function emergency(){if(Date.now()-emergencyArmed>5000){emergencyArmed=Date.now();$('ctlEmergency').textContent='Press again to confirm';setTimeout(()=>$('ctlEmergency').textContent='Emergency stop',5000);return;}emergencyArmed=0;$('ctlEmergency').textContent='Emergency stop';guard($('ctlEmergency'),()=>control('emergency-stop'));}

// ---------- live views ----------
function renderSummary(){
 const s=snap.summary,f=snap.factory,run=snap.active,plannedWorkers=run?run.config.workers.total:0;
 const label={running:'Running',paused:'Paused',stopped:'Stopped'}[f.state]||f.state;$('stateBadge').textContent=label;$('stateBadge').dataset.state=f.state;
 const activeWorkers=f.workerConnected?Math.min(s.running,run?.config.limits.simultaneous||s.running):0;
 const stats=[['Workers active',plannedWorkers?`${activeWorkers} / ${plannedWorkers}`:String(activeWorkers)],['Jobs running',s.running],['Completed today',s.completedToday],['Waiting',s.waiting],['In QC',s.inQc],['Need review',s.needReview],['Failed',s.failed]];
 $('summaryStats').replaceChildren(...stats.map(([k,v])=>{const d=node('div','', 'fx-stat'+(k==='Need review'&&v||k==='Failed'&&v?' fx-attn':''));d.append(node('dt',k),node('dd',typeof v==='number'?num(v):v));return d;}));
 const meta=[`${num(s.productsPerHour)} products/hour`,s.etaMinutes?`done in about ${s.etaMinutes<90?s.etaMinutes+' min':Math.round(s.etaMinutes/60)+' h'}`:null,`queue ${num(s.queueSize)}`,`AI spend today ${money(f.spentTodayCents)}${f.dailyBudgetCents?' of '+money(f.dailyBudgetCents):''}`,f.workerConnected?'background worker connected':'background worker not connected',f.providerConnected?null:'no AI image provider connected yet'].filter(Boolean);
 $('summaryMeta').textContent=meta.join(' · ');
 if($('limDaily').value===''&&document.activeElement!==$('limDaily'))$('limDaily').value=Math.round(f.dailyBudgetCents/100);if($('limTotal').value===''&&document.activeElement!==$('limTotal'))$('limTotal').value=Math.round(f.totalBudgetCents/100);
 const r=snap.interrupted;$('recovery').hidden=!r;if(r){$('recoveryTitle').textContent=`Production run #${r.number} was interrupted.`;$('recoveryReason').textContent=r.reason+' Its queue is saved.';}
}
function renderRun(){
 const r=snap.active;$('activeRun').hidden=!r;if(!r)return;
 const total=r.plan.unlimited?null:Object.values(r.counts).reduce((a,b)=>a+b,0),pct=total?Math.round(r.completed/total*100):0;
 $('runTitle').textContent=`Run #${r.number}: ${r.name}`;$('runStatus').textContent=r.status==='running'&&snap.factory.state!=='running'?'Waiting for factory':{running:'Running',paused:'Paused'}[r.status]||r.status;
 $('runProgress').value=pct;$('runProgress').hidden=!total;
 const parts=[total?`${num(r.completed)} of ${num(total)} products through production`:`${num(r.completed)} products through production (continuous)`,r.counts.planned?`${num(r.counts.planned)} waiting for queue space`:null,r.ends?`ends ${new Date(r.ends).toLocaleString()}`:null,r.message||null];
 $('runLine').textContent=parts.filter(Boolean).join(' · ');
 $('runErrors').hidden=!r.slotErrors.length;$('runErrors').textContent=r.slotErrors.length?'Some products could not be queued: '+r.slotErrors.map(e=>`${garment(e.garment).label} (${e.n}): ${e.error}`).join('; '):'';
}
function renderQueue(){
 const jobs=snap.jobs.filter(j=>queueFilter==='all'||queueFilter==='running'&&j.status==='running'||queueFilter==='waiting'&&['queued','retry_wait'].includes(j.status)||queueFilter==='problems'&&['failed','waiting_input'].includes(j.status));
 $('queueEmpty').hidden=!!jobs.length;
 $('queueRows').replaceChildren(...jobs.slice(0,150).map(j=>{const tr=node('tr');const p=node('progress');p.max=100;p.value=j.progress;p.setAttribute('aria-label',j.progress+'%');const pc=node('td');pc.append(p,node('span',' '+j.progress+'%','fx-sublabel'));
  tr.append(node('td',j.number?`#${j.number}-${j.id.slice(0,4)}`:j.id.slice(0,6)),node('td',[j.garment?garment(j.garment).single:ROLE_LABELS[j.employee]||j.employee,j.color].filter(Boolean).join(' · ')),node('td',j.worker?'AI-'+j.worker.slice(-4):ROLE_LABELS[j.employee]||j.employee),node('td',j.stage,'fx-stage'),pc);tr.title=j.title+(j.error?' — '+j.error:'');tr.dataset.status=j.status;return tr;}));
}
function renderReview(){
 const list=snap.jobs.filter(j=>['awaiting_review','waiting_input','failed'].includes(j.status));$('approveAll').hidden=!list.some(j=>j.status==='awaiting_review');
 $('reviewList').replaceChildren(...(list.length?list.map(reviewCard):[node('p','Nothing needs you right now.','fx-note')]));
}
function reviewCard(j){
 const card=node('article','', 'fx-review-card');card.append(node('h3',j.title),node('p',`${j.stage}${j.error?': '+j.error:''}`,j.status==='awaiting_review'?'fx-note':'fx-warn'));
 const previews=node('div','', 'fx-previews'),actions=node('div','', 'fx-actions'),btn=(t,cls,fn)=>{const b=node('button',t,'fx-btn '+(cls||''));b.type='button';b.onclick=()=>guard(b,fn);actions.append(b);return b;};
 if(j.status==='awaiting_review')btn('Approve','fx-go',async()=>{await api('publishing/approve',{job:j.id,confirm:true});toast('Approved. It moves on to the supplier and store steps.');await refresh();});
 if(j.status==='failed')btn('Retry','',async()=>{await api('retry',{id:j.id});await refresh();});
 if(j.status==='waiting_input')btn('Resume','',async()=>{await api('production/job',{id:j.id,action:'resume'});await refresh();});
 const revise=btn('Revise','',async()=>{const box=card.querySelector('textarea');if(!box){const t=node('textarea');t.rows=3;t.placeholder='What should change?';t.setAttribute('aria-label','Revision notes for '+j.title);card.insertBefore(t,actions);t.focus();revise.textContent='Send revision';return;}if(!box.value.trim())return toast('Describe what should change.');const r=await api('history',{job:j.id,action:'revise',brief:box.value.trim()});await api('history',{job:r.job,action:'queue'});toast('Revision queued.');await refresh();});
 btn('Regenerate','',async()=>{const r=await api('history',{job:j.id,action:'duplicate'});await api('history',{job:r.job,action:'queue'});toast('A fresh version is queued.');await refresh();});
 btn('Reject','fx-quiet',async()=>{await api('history',{job:j.id,action:'archive'});toast('Rejected and archived. You can restore it from production history.');await refresh();});
 const edit=node('a','Edit manually','fx-btn fx-quiet');edit.href='/ai-factory/tools#blueprintPanel';actions.append(edit);
 const show=btn('Show previews','fx-quiet',async()=>{const d=await api('publishing/export/'+j.id);previews.replaceChildren(...(d.files.length?d.files.map(f=>{const fig=node('figure'),img=node('img');img.src=f.url;img.alt=f.placement;img.loading='lazy';fig.append(img,node('figcaption',f.placement.replace(/_/g,' ')));return fig;}):[node('p','No print files saved for this product yet.','fx-note')]));show.hidden=true;});
 card.append(previews,actions);return card;
}
function renderRuns(){
 $('runList').replaceChildren(...(snap.runs.length?snap.runs.map(r=>{const row=node('div','', 'fx-run-row');row.append(node('strong',`#${r.number} ${r.name}`),node('span',`${r.status} · ${num(r.completed)} of ${num(r.slots)} products · ${new Date(r.created).toLocaleDateString()}`,'fx-sublabel'));const b=node('button','Run again','fx-btn fx-quiet');b.type='button';b.onclick=()=>guard(b,async()=>{const {config:c}=await api('runs/duplicate',{id:r.id});applyConfig({...c,name:c.name?c.name+' (again)':''});$('setupTitle').scrollIntoView({behavior:'smooth'});toast('Settings loaded from run #'+r.number+'. Review them, then start.');});row.append(b);return row;}):[node('p','No production runs yet.','fx-note')]));
 const current=$('presetSelect').value;$('presetSelect').replaceChildren(node('option','Load a preset…'),...snap.presets.map(p=>{const o=node('option',p.name);o.value=p.id;return o;}));$('presetSelect').options[0].value='';$('presetSelect').value=snap.presets.some(p=>p.id===current)?current:'';$('presetDelete').hidden=!$('presetSelect').value;
}
async function refresh(){
 snap=await api('runs');renderSummary();renderRun();renderQueue();renderReview();renderRuns();renderControls();
 if(!refresh.done){refresh.done=true;renderSetup();}
}

// ---------- wiring ----------
function tabs(group,onSelect){const list=[...group.querySelectorAll('[role=tab]')];list.forEach(t=>t.onclick=()=>{list.forEach(x=>{x.setAttribute('aria-selected',String(x===t));const pane=x.getAttribute('aria-controls');if(pane)$(pane).hidden=x!==t;});onSelect?.(t);});}
tabs(document.querySelector('#stepDesigns .fx-tabs'),t=>{if(t.id==='tabLibrary')loadLibrary();});
tabs(document.querySelector('#queueTitle').parentElement.querySelector('.fx-tabs'),t=>{queueFilter=t.dataset.filter;renderQueue();});
$('designSearch').oninput=renderDesigns;$('designCollection').onchange=renderDesigns;
$('selectVisible').onclick=()=>{(renderDesigns.shown||[]).forEach(a=>selected.add(a.id));renderDesigns();schedulePlan();};
$('clearDesigns').onclick=()=>{selected.clear();renderDesigns();schedulePlan();};
$('librarySearch').oninput=renderLibrary;$('libraryCategory').onchange=renderLibrary;
$('libraryVisible').onclick=()=>{(renderLibrary.shown||[]).forEach(d=>librarySelected.add(d.id));renderLibrary();};
$('libraryImport').onclick=()=>guard($('libraryImport'),importLibrary);
$('uploadFiles').onchange=e=>guard(null,()=>upload(e.target.files));
const drop=$('dropZone');['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('fx-over');}));['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('fx-over');}));drop.addEventListener('drop',e=>guard(null,()=>upload(e.dataTransfer.files)));drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('uploadFiles').click();}});
document.querySelectorAll('input[name=qtyMode],input[name=output]').forEach(r=>r.onchange=renderSetup);
['mixMode','colorMode','densityMode','assignment','duration','workerAuto','creativity'].forEach(id=>$(id).addEventListener('input',renderSetup));
['qtyTotal','workerTotal','durationMinutes','durationCount','placeFill','placePanels','placeMirror','placeTile','styleNote','qcAuto','qcThreshold','qcRevisions','qcApproval','limSimultaneous','limBatch','limPerWorker','limCostPer','limRun','audience','colorLock','runName'].forEach(id=>$(id).addEventListener('input',schedulePlan));
$('launch').onclick=()=>guard($('launch'),launch);
$('ctlStart').onclick=()=>guard($('ctlStart'),()=>control('start'));$('ctlPause').onclick=()=>guard($('ctlPause'),()=>control('pause'));$('ctlResume').onclick=()=>guard($('ctlResume'),()=>control('resume'));$('ctlStop').onclick=()=>guard($('ctlStop'),()=>control('stop'));$('ctlEmergency').onclick=emergency;
$('recoveryResume').onclick=()=>guard($('recoveryResume'),()=>control(snap.factory.state==='paused'?'resume':'start'));
$('approveAll').onclick=()=>guard($('approveAll'),async()=>{const list=snap.jobs.filter(j=>j.status==='awaiting_review');let ok=0,errors=[];for(const j of list){try{await api('publishing/approve',{job:j.id,confirm:true});ok++;}catch(e){errors.push(j.title+': '+e.message);}}await refresh();toast(`Approved ${ok} of ${list.length}.`+(errors.length?' '+errors[0]:''));});
$('saveBudget').onclick=()=>guard($('saveBudget'),async()=>{await api('budget',{dailyBudget:dollars('limDaily'),totalBudget:dollars('limTotal')});await refresh();toast('Factory spending limits saved.');});
$('presetSave').onclick=()=>guard($('presetSave'),async()=>{const name=$('runName').value.trim();if(!name)return toast('Type a run name first; the preset uses it.');const c=config();snap=await api('runs/preset',{name,config:c,keepDesigns:$('presetDesigns').checked});await refresh();toast(`Preset "${name}" saved.`);});
$('presetSelect').onchange=()=>{const p=snap.presets.find(x=>x.id===$('presetSelect').value);$('presetDelete').hidden=!p;if(p){applyConfig({...p.config,name:p.name});toast(`Preset "${p.name}" loaded. Select designs, then start.`);}};
$('presetDelete').onclick=()=>guard($('presetDelete'),async()=>{snap=await api('runs/preset-delete',{id:$('presetSelect').value});$('presetSelect').value='';await refresh();});
$('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});location.replace('/login?next=ai-factory');};
refresh().catch(e=>toast(e.message));
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(()=>{});},5000);
})();
