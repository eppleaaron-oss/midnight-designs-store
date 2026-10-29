'use strict';
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
let data=null,section='brand-dna',store=null;
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(70000)});if(r.status===401&&document.body.dataset.factoryPublic!=='true'){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
function toast(t){const e=$('toast');e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,6000);}
const guard=(b,fn)=>async(...a)=>{if(b)b.disabled=true;try{await fn(...a);}catch(e){toast(e.message);}finally{if(b)b.disabled=false;}};
const options=(sel,rows,keep)=>{const v=sel.value;sel.replaceChildren(...rows.map(([value,label])=>{const o=node('option',label);o.value=value;return o;}));if(keep&&rows.some(([value])=>value===v))sel.value=v;};

function renderPlaybook(){const p=data.placementPlaybook;if(!p)return;$('placementVersion').textContent=p.version;$('placementSummary').textContent=p.rules+' permanent rules · '+p.guides.length+' garment guides · '+p.mappedListings+' catalog listings mapped. No automatic tiling of scenes or portraits.';$('placementNote').textContent=p.note;const q=$('placementSearch').value.trim().toLowerCase();$('placementGuides').replaceChildren(...p.guides.filter(g=>(g.name+' '+g.product).toLowerCase().includes(q)).map(g=>{const card=node('details','','ix-rule');card.append(node('summary',g.name+' · Printful '+g.product+' · '+g.listings.length+' listings'),node('p',g.direction),node('p','Starting layout #'+g.recommendedLayout+'. Exact coordinates require the selected live template and reviewed safe regions.','fx-note'));if(g.listings.length)card.append(node('p',g.listings.map(l=>l.name+' ('+l.id+')').join(' · '),'fx-meta'));return card;}));}
function renderMeasuredLayouts(){const dataSet=data.measuredLayouts;if(!dataSet)return;let root=$('measuredLayouts');if(!root){root=node('section',undefined,'panel');root.id='measuredLayouts';$('placementGuides').parentElement.append(root);}root.replaceChildren(node('h2','Approved measurements & corrections'),node('p',dataSet.counts.approved+' approved · '+dataSet.counts.rejected+' rejected · '+dataSet.counts.correction+' corrections'),node('p',dataSet.note,'fx-note'));for(const r of dataSet.examples){const card=node('details',undefined,'ix-rule');card.append(node('summary',r.name+' · '+r.state+' · revision '+r.revision),node('p','Printful '+r.product+' · '+r.technique+' · '+r.audience+(r.parent?' · corrects example '+r.parent:'')),node('p',r.note));for(const v of r.example.variants){const box=node('details');box.append(node('summary','Size '+v.size+' · supplier variant '+v.variant));for(const p of Object.values(v.panels)){box.append(node('p',p.placement+' · '+p.width+' × '+p.height+' px · '+p.dpi+' DPI · background '+(p.background||'transparent')));for(const l of p.layers)box.append(node('p',l.name+': '+l.widthIn+' × '+l.heightIn+' inches; center '+l.xIn+', '+l.yIn+'; rotation '+l.rotation+'°; '+l.effectiveDpi+' effective DPI'));}card.append(box);}for(const issue of r.example.issues)card.append(node('p',issue,'fx-warn'));root.append(card);}}
function renderStatus(){
 renderMeasuredLayouts();
 $('brainVersion').textContent=data.version;
 const bad=data.components.filter(c=>!c.ok);
 $('alerts').replaceChildren(...bad.filter(c=>['provider','worker','database'].includes(c.id)).map(c=>{const d=node('div','', 'fx-recovery');const t=node('div');t.append(node('strong',`⚠ ${c.label.toUpperCase()} ${c.state.toUpperCase()}`),node('p',c.fix||c.detail));d.append(t);return d;}));
 $('components').replaceChildren(...data.components.map(c=>{const li=node('li','', 'ix-comp');li.dataset.ok=String(c.ok);li.append(node('span','', 'ix-light'),node('strong',c.label),node('span',c.state,'ix-state'),node('span',c.detail,'fx-sublabel'));return li;}));
 const k=data.counts;$('counts').replaceChildren(...[['Rules loaded',k.rules],['Locked rules',k.lockedRules],['Garment profiles',k.garmentProfiles],['Supplier blueprints',k.blueprints],['Design memories',k.memories],['Owner preferences',k.preferences],['Approved designs learned from',k.learnedFrom]].map(([a,b])=>{const d=node('div','', 'fx-stat');d.append(node('dt',a),node('dd',String(b)));return d;}));
 $('deploy').textContent=data.deployCommit?`Running deploy ${data.deployCommit}.`:'';
}
function renderRules(){
 const tabs=$('sectionTabs');tabs.replaceChildren(...data.sections.map(([id,label])=>{const b=node('button',label);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===section));b.onclick=()=>{section=id;renderRules();};return b;}));
 const list=data.rules.filter(r=>r.section===section);
 $('rules').replaceChildren(...(list.length?list.map(r=>{const card=node('article','', 'ix-rule');const head=node('div','', 'fx-row');head.append(node('strong',r.title),node('span',r.locked?'Locked':'Editable','fx-pill'));card.append(head,node('p',r.body));const act=node('div','', 'fx-actions');
  const btn=(t,fn,cls)=>{const b=node('button',t,'fx-btn '+(cls||'fx-quiet'));b.type='button';b.onclick=guard(b,fn);act.append(b);};
  btn(r.locked?'Unlock':'Lock',async()=>{await api('intelligence/rule',{id:r.id,locked:!r.locked});await load();});
  if(!r.locked){btn('Edit',async()=>{$('ruleId').value=r.id;$('ruleTitle').value=r.title;$('ruleBody').value=r.body;$('ruleLocked').checked=false;$('ruleFormTitle').textContent='Edit rule';$('ruleCancel').hidden=false;$('ruleTitle').focus();});btn('Delete',async()=>{await api('intelligence/rule',{id:r.id,delete:true});await load();});}
  card.append(act);return card;}):[node('p','No rules in this section yet. Add the first one below.','fx-note')]));
}
function resetRuleForm(){$('ruleId').value='';$('ruleForm').reset();$('ruleFormTitle').textContent='Add a rule';$('ruleCancel').hidden=true;}
function renderGarment(){
 const g=data.garments.find(x=>x.id===$('garmentSelect').value)||data.garments[0],p=g.profile||{density:[1,2],placement:{},hierarchy:'',color:'Black'};
 $('gMin').value=p.density[0];$('gMax').value=p.density[1];$('gHierarchy').value=p.hierarchy;$('gColor').value=p.color;
 $('gZones').replaceChildren(...g.zones.map(z=>{const w=node('div','', 'fx-num'),l=node('label',z.replace(/-/g,' ')),i=node('input');i.id='zone-'+z;i.maxLength=60;i.value=p.placement[z]||'';i.placeholder='Not used';l.htmlFor=i.id;w.append(l,i);return w;}));
 [...$('garmentForm').querySelectorAll('input')].forEach(i=>i.disabled=!!p.locked);$('gLock').textContent=p.locked?'Unlock profile':'Lock profile';$('gNote').textContent=p.locked?'This profile is locked. Unlock it to edit.':'';
 api('intelligence/knowledge/'+g.id).then(d=>$('knowledge').textContent=d.text).catch(()=>{});
}
function renderMemories(){
 const kind=$('memFilter').value,list=data.memories.filter(m=>!kind||m.kind===kind),label=Object.fromEntries(data.memoryKinds);
 $('memories').replaceChildren(...(list.length?list.map(m=>{const card=node('article','', 'ix-rule');const head=node('div','', 'fx-row');head.append(node('span',label[m.kind]||m.kind,'fx-pill'),node('span',new Date(m.created).toLocaleString(),'fx-sublabel'));card.append(head,node('p',m.text));const b=node('button','Delete','fx-btn fx-quiet');b.type='button';b.onclick=guard(b,async()=>{await api('intelligence/memory',{id:m.id,delete:true});await load();});card.append(b);return card;}):[node('p','No memories yet. Feedback buttons on finished products add them.','fx-note')]));
}

const KIND={product:'Store product',design:'Store design',mockup:'Mockup'};
function renderStore(){
 if(!store)return;const kind=$('refKind').value,q=$('refSearch').value.trim().toLowerCase(),pinned=new Set(data.references.map(r=>r.id));
 const shown=store.filter(x=>(!kind||x.kind===kind)&&(!q||(x.name+' '+x.category).toLowerCase().includes(q)));
 $('storeGrid').replaceChildren(...shown.map(x=>{const l=node('label','', 'fx-tile'),c=node('input'),img=node('img');c.type='checkbox';c.checked=pinned.has(x.id);img.src=x.thumbnail;img.alt='';img.loading='lazy';
  c.onchange=guard(c,async()=>{await api('intelligence/reference',c.checked?{add:[x.id]}:{id:x.id,delete:true});await load();});
  l.append(c,img,node('span',x.name,'fx-tile-name'),node('span',KIND[x.kind]+(x.garment?' · '+(data.garments.find(g=>g.id===x.garment)?.label||''):''),'fx-sublabel'));return l;}));
 $('storeNote').textContent=shown.length?`${shown.length} shown. ${pinned.size} pinned.`:'Nothing on the store matches.';
}
function renderRefs(){
 $('refCount').textContent=String(data.references.length);
 $('refList').replaceChildren(...(data.references.length?data.references.map(r=>{const card=node('article','', 'ix-rule ix-ref'),img=node('img');img.src=r.image;img.alt='';img.loading='lazy';
  const body=node('div'),head=node('div','', 'fx-row');head.append(node('strong',r.name),node('span',KIND[r.kind]||r.kind,'fx-pill'));
  const g=node('select'),n=node('input');g.setAttribute('aria-label','Use for garment');n.setAttribute('aria-label','What to learn from it');n.maxLength=300;n.placeholder='What should the AI learn from this? (optional)';n.value=r.note||'';
  g.append(...[['','All garments'],...data.garments.map(x=>[x.id,x.label])].map(([v,t])=>{const o=node('option',t);o.value=v;return o;}));g.value=r.garment||'';
  const act=node('div','', 'fx-actions'),save=node('button','Save','fx-btn fx-quiet'),del=node('button','Remove','fx-btn fx-quiet');save.type=del.type='button';
  save.onclick=guard(save,async()=>{await api('intelligence/reference',{id:r.id,garment:g.value||null,note:n.value});await load();toast('Reference saved.');});
  del.onclick=guard(del,async()=>{await api('intelligence/reference',{id:r.id,delete:true});await load();});
  act.append(save,del);body.append(head,g,n,act);card.append(img,body);return card;}):[node('p','No references pinned yet. Tick store products or designs above.','fx-note')]));
}
async function loadStore(){if(store)return renderStore();$('storeNote').textContent='Loading your store…';try{store=(await api('intelligence/store')).items;renderStore();}catch(e){$('storeNote').textContent=e.message;}}
let products=[],nextProduct=null,selectedJob='',selectedStage='',stageReport=null,inspectSequence=0,stageSequence=0;
function updateLink(){const u=new URL(location.href);if(selectedJob)u.searchParams.set('job',selectedJob);else u.searchParams.delete('job');if(selectedStage)u.searchParams.set('stage',selectedStage);else u.searchParams.delete('stage');history.replaceState(null,'',u);}
function hideJob(){selectedJob='';selectedStage='';stageReport=null;++inspectSequence;++stageSequence;$('jobDetail').hidden=true;$('stageDetail').hidden=true;$('pipeline').replaceChildren();$('acceptanceDetail').hidden=true;}
async function loadProducts(append=false){
 const params=new URLSearchParams({q:$('jobSearch').value.trim(),status:$('jobStatus').value});if(append&&nextProduct)params.set('before',nextProduct);
 const d=await api('intelligence/production?'+params);products=append?[...products,...d.jobs]:d.jobs;nextProduct=d.next;
 options($('jobSelect'),[['','Choose a product…'],...products.map(j=>[j.id,`${j.title} · ${j.status}`])],true);$('moreJobs').hidden=!nextProduct;$('productionCount').textContent=`${products.length} of ${d.total} products shown.`;
 if(!append&&selectedJob&&!products.some(j=>j.id===selectedJob)){hideJob();updateLink();}
}
async function showStage(id,{focus=true}={}){
 if(!selectedJob)return;const job=selectedJob,sequence=++stageSequence,d=await api('intelligence/job/'+job+'/stage/'+id);if(job!==selectedJob||sequence!==stageSequence)return;
 selectedStage=id;stageReport=d;updateLink();$('stageTitle').textContent=d.stage.name+' · '+d.stage.label;$('stageSummary').textContent=d.stage.summary;$('responseNote').textContent=d.responseNote;
 $('stageEvidence').textContent=JSON.stringify({evidence:d.stage.evidence,runtime:d.runtime,worker:d.worker},null,2);
 $('apiResponses').replaceChildren(...d.events.map(e=>{const card=node('article','', 'ix-response');card.append(node('h4',`${e.kind==='api'?'API response':e.kind} · ${e.state} · ${new Date(e.created).toLocaleString()}`),node('p',e.message),node('pre',JSON.stringify(e.details,null,2),'ix-pre'));return card;}));
 for(const b of $('pipeline').querySelectorAll('button'))b.setAttribute('aria-expanded',String(b.dataset.stage===id));$('stageDetail').hidden=false;if(focus)$('stageTitle').focus();
}
async function inspect(id,{link=true}={}){
 if(!id){hideJob();updateLink();return;}const sequence=++inspectSequence,d=await api('intelligence/job/'+id);if(sequence!==inspectSequence)return;
 const changed=selectedJob!==id,focusStage=document.activeElement?.dataset.stage;selectedJob=id;if(changed){selectedStage='';stageReport=null;++stageSequence;$('stageDetail').hidden=true;$('acceptanceDetail').hidden=true;}
 if(![...$('jobSelect').options].some(o=>o.value===id)){$('jobSelect').append(new Option(d.job.title+' · '+d.job.status,id));}$('jobSelect').value=id;
 $('pipeline').replaceChildren(...d.stages.map(s=>{const tr=node('tr');tr.dataset.state=s.state;const td=node('td'),b=node('button',s.name);b.type='button';b.dataset.stage=s.id;b.setAttribute('aria-controls','stageDetail');b.setAttribute('aria-expanded',String(s.id===selectedStage));b.onclick=guard(b,()=>showStage(s.id));td.append(b);tr.append(td,node('td',s.label||s.state,'ix-result'),node('td',s.summary||''));return tr;}));
 if(focusStage)$('pipeline').querySelector(`[data-stage="${focusStage}"]`)?.focus();
 $('jobMeta').textContent=[d.job.title,d.job.status,d.run?`Run #${d.run.number} · ${d.run.color}`:null,d.job.error||null].filter(Boolean).join(' · ');$('productionNotes').textContent=(d.diagnosticNotes||[]).join(' ');
 $('jobLog').replaceChildren(...(d.log.length?d.log.map(e=>{const li=node('li');li.append(node('time',new Date(e.at).toLocaleTimeString()),node('span',' '+e.text));return li;}):[node('li','No recorded actions yet.')]));
 $('jobBrief').textContent=d.brief;$('jobDetail').hidden=false;if(link)updateLink();if(selectedStage)await showStage(selectedStage,{focus:false});
}
$('placementSearch').oninput=renderPlaybook;
async function load(){
 data=await api('intelligence');renderStatus();renderPlaybook();renderRules();renderMemories();renderRefs();renderStore();
 if(!$('garmentSelect').options.length){options($('garmentSelect'),data.garments.map(g=>[g.id,g.label]));$('garmentSelect').value='jacket';options($('testGarment'),data.garments.map(g=>[g.id,g.label]));$('testGarment').value='ziphoodie';
  options($('memFilter'),[['','All memories'],...data.memoryKinds]);options($('memKind'),data.memoryKinds);}
 renderGarment();
 await loadProducts();
 try{const art=(await api('runs')).artwork;options($('testArt'),art.map(a=>[a.id,a.name]),false);}catch{}
}
$('diagnose').onclick=guard($('diagnose'),async()=>{$('diagSummary').textContent='Running every check…';const d=await api('intelligence/diagnose',{});$('diagSummary').textContent=d.summary;$('diagTable').hidden=false;
 $('diagRows').replaceChildren(...d.results.map(r=>{const tr=node('tr');tr.dataset.state=r.state;tr.append(node('td',r.label),node('td',{pass:'Passed',fail:'Failed',not_configured:'Not set up'}[r.state],'ix-result'),node('td',r.detail),node('td',r.fix||''));return tr;}));});
$('ruleForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{await api('intelligence/rule',{id:$('ruleId').value||undefined,section,title:$('ruleTitle').value,body:$('ruleBody').value,locked:$('ruleLocked').checked});resetRuleForm();await load();toast('Rule saved.');})();};
$('ruleCancel').onclick=resetRuleForm;
$('garmentSelect').onchange=renderGarment;
$('garmentForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{const g=data.garments.find(x=>x.id===$('garmentSelect').value);const placement={};g.zones.forEach(z=>{const v=$('zone-'+z).value.trim();if(v)placement[z]=v;});await api('intelligence/garment',{garment:g.id,profile:{density:[Number($('gMin').value),Number($('gMax').value)],hierarchy:$('gHierarchy').value,color:$('gColor').value,placement}});await load();toast(g.label+' profile saved.');})();};
$('gLock').onclick=guard($('gLock'),async()=>{const g=data.garments.find(x=>x.id===$('garmentSelect').value);await api('intelligence/garment',{garment:g.id,locked:!g.profile?.locked});await load();});
$('memFilter').onchange=renderMemories;
$('refKind').onchange=renderStore;$('refSearch').oninput=renderStore;
$('refPinProducts').onclick=guard($('refPinProducts'),async()=>{await loadStore();const ids=(store||[]).filter(x=>x.kind==='product').map(x=>x.id);if(!ids.length)return toast('No store products found.');await api('intelligence/reference',{add:ids});await load();toast(ids.length+' store products pinned as references.');});
$('memForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{await api('intelligence/memory',{kind:$('memKind').value,text:$('memText').value});$('memText').value='';await load();})();};
$('testForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{const d=await api('intelligence/test',{prompt:$('testPrompt').value||'Test design',garment:$('testGarment').value,artworkIds:[...$('testArt').selectedOptions].map(o=>o.value)});
 $('testPlan').replaceChildren(...[['Garment',d.garment],['Artwork',d.artwork.join(', ')||'None selected'],['Blueprint',d.blueprint||'None saved'],['',d.blueprintNote],['Color plan',d.colorPlan],['Reasoning',d.reasoning.join(' ')],['Expected score',d.expectedScore??d.scoreNote]].flatMap(([a,b])=>[node('dt',a),node('dd',b)]));
 $('testZones').replaceChildren(...d.placement.map(z=>{const tr=node('tr');tr.append(node('td',z.zone),node('td',z.role),node('td',z.artwork||z.reason));tr.dataset.empty=String(!z.artwork);return tr;}));
 $('testKnowledge').textContent=d.knowledge;$('testOut').hidden=false;$('testRun').disabled=!d.canRun;$('testRun').title=d.canRun?'':'Needs a connected AI provider';})();};
$('testRun').onclick=()=>toast('Test generation runs once the AI provider is connected.');
$('jobSelect').onchange=()=>guard(null,()=>inspect($('jobSelect').value))();
$('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});location.replace('/login?next=ai-factory');};
$('productionFilter').onsubmit=e=>{e.preventDefault();guard(null,()=>loadProducts())();};
$('moreJobs').onclick=guard($('moreJobs'),()=>loadProducts(true));
$('refreshJob').onclick=guard($('refreshJob'),async()=>{if(selectedJob)await inspect(selectedJob);else await loadProducts();});
$('closeStage').onclick=()=>{const id=selectedStage;selectedStage='';stageReport=null;++stageSequence;$('stageDetail').hidden=true;updateLink();const b=$('pipeline').querySelector(`[data-stage="${id}"]`);b?.setAttribute('aria-expanded','false');b?.focus();};
$('exportStage').onclick=()=>{if(!stageReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(stageReport,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=`production-${selectedJob}-${selectedStage}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('acceptanceReport').onclick=guard($('acceptanceReport'),async()=>{if(!selectedJob)return;const job=selectedJob,d=await api('intelligence/job/'+job+'/acceptance');if(job!==selectedJob)return;$('acceptanceSummary').textContent=d.status==='passed'?'Required live test passed.':'Required live test has not passed. Automatic publishing remains disabled.';$('acceptanceChecks').replaceChildren(...d.checks.map(c=>node('li',(c.passed?'Complete: ':'Missing: ')+c.label)));$('acceptanceEvidence').textContent=JSON.stringify({files:d.files,mockupTaskIds:d.mockupTaskIds,supplierId:d.supplierId,storefrontId:d.storefrontId,models:d.models,note:d.note},null,2);$('acceptanceDetail').hidden=false;});
async function deep(){const p=new URL(location.href).searchParams,m=/^#job-([\w-]{1,64})$/.exec(location.hash),id=p.get('job')||m?.[1],stage=p.get('stage');if(!id||!/^[-a-f0-9]{36}$/.test(id))return;await inspect(id,{link:false});if(stage&&/^[-a-z]+$/.test(stage))await showStage(stage);$('jobTitle').scrollIntoView();}
addEventListener('hashchange',()=>deep().catch(e=>toast(e.message)));
let refreshing=false;setInterval(async()=>{if(!selectedJob||document.hidden||refreshing)return;refreshing=true;try{await inspect(selectedJob);}catch(e){toast(e.message);}finally{refreshing=false;}},15000);
load().then(()=>{loadStore();return deep();}).catch(e=>toast(e.message));
})();
