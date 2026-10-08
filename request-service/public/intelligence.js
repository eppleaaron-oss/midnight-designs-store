'use strict';
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
let data=null,section='brand-dna';
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(70000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
function toast(t){const e=$('toast');e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,6000);}
const guard=(b,fn)=>async(...a)=>{if(b)b.disabled=true;try{await fn(...a);}catch(e){toast(e.message);}finally{if(b)b.disabled=false;}};
const options=(sel,rows,keep)=>{const v=sel.value;sel.replaceChildren(...rows.map(([value,label])=>{const o=node('option',label);o.value=value;return o;}));if(keep&&rows.some(([value])=>value===v))sel.value=v;};

function renderStatus(){
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
async function inspect(id){
 if(!id){$('jobDetail').hidden=true;$('pipeline').replaceChildren();return;}
 const d=await api('intelligence/job/'+id);
 $('pipeline').replaceChildren(...d.stages.map(s=>{const li=node('li',s.name,'ix-stage');li.dataset.state=s.state;li.title=s.state;return li;}));
 $('jobMeta').textContent=[d.job.title,d.job.status,d.run?`Run #${d.run.number} · ${d.run.color}`:null,d.job.error||null].filter(Boolean).join(' · ');
 $('jobLog').replaceChildren(...(d.log.length?d.log.map(e=>{const li=node('li');li.append(node('time',new Date(e.at).toLocaleTimeString()),node('span',' '+e.text));return li;}):[node('li','No recorded actions yet. The worker writes a step here each time it finishes one.')]));
 $('jobBrief').textContent=d.brief;$('jobDetail').hidden=false;
}
async function load(){
 data=await api('intelligence');renderStatus();renderRules();renderMemories();
 if(!$('garmentSelect').options.length){options($('garmentSelect'),data.garments.map(g=>[g.id,g.label]));$('garmentSelect').value='jacket';options($('testGarment'),data.garments.map(g=>[g.id,g.label]));$('testGarment').value='ziphoodie';
  options($('memFilter'),[['','All memories'],...data.memoryKinds]);options($('memKind'),data.memoryKinds);}
 renderGarment();
 options($('jobSelect'),[['','Choose a job…'],...data.jobs.map(j=>[j.id,`${j.title} · ${j.status}`])],true);
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
$('memForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{await api('intelligence/memory',{kind:$('memKind').value,text:$('memText').value});$('memText').value='';await load();})();};
$('testForm').onsubmit=e=>{e.preventDefault();guard(null,async()=>{const d=await api('intelligence/test',{prompt:$('testPrompt').value||'Test design',garment:$('testGarment').value,artworkIds:[...$('testArt').selectedOptions].map(o=>o.value)});
 $('testPlan').replaceChildren(...[['Garment',d.garment],['Artwork',d.artwork.join(', ')||'None selected'],['Blueprint',d.blueprint||'None saved'],['',d.blueprintNote],['Color plan',d.colorPlan],['Reasoning',d.reasoning.join(' ')],['Expected score',d.expectedScore??d.scoreNote]].flatMap(([a,b])=>[node('dt',a),node('dd',b)]));
 $('testZones').replaceChildren(...d.placement.map(z=>{const tr=node('tr');tr.append(node('td',z.zone),node('td',z.role),node('td',z.artwork));return tr;}));
 $('testKnowledge').textContent=d.knowledge;$('testOut').hidden=false;$('testRun').disabled=!d.canRun;$('testRun').title=d.canRun?'':'Needs a connected AI provider';})();};
$('testRun').onclick=()=>toast('Test generation runs once the AI provider is connected.');
$('jobSelect').onchange=()=>guard(null,()=>inspect($('jobSelect').value))();
$('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});location.replace('/login?next=ai-factory');};
const deep=()=>{const m=/^#job-([\w-]{1,64})$/.exec(location.hash);if(!m)return;$('jobSelect').value=m[1];inspect(m[1]).then(()=>$('jobTitle').scrollIntoView()).catch(e=>toast(e.message));};
addEventListener('hashchange',deep);
load().then(deep).catch(e=>toast(e.message));
})();
