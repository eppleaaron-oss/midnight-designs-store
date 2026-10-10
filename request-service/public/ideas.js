'use strict';
// Idea Room: design sets, the idea team's waiting items and outfits, bulk approval, team size and upload sorting.
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
let data=null,filter='new',madeFilter='unrated';const notes=new Map();const picked=new Set();
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
const note=t=>{$('ideaNote').textContent=t;};
const guard=(b,fn)=>async ev=>{if(b?.classList?.contains('ix-drop')||b?.classList?.contains('ix-now'))ev?.preventDefault();if(b)b.disabled=true;try{await fn(ev);}catch(e){note(e.message);}finally{if(b)b.disabled=false;}};
const PART={back:'Back',front:'Front',default:'All-over',sleeve_left:'Left sleeve',sleeve_right:'Right sleeve',leg_left:'Left leg',leg_right:'Right leg',hood:'Hood',pocket:'Pocket'};
const area=a=>a.replace(/_dtfabric$/,'').replace(/_/g,' ');
function thumbs(parts,max=6){const t=node('div','', 'ix-thumbs');for(const [k,v] of Object.entries(parts).slice(0,max)){const img=node('img');img.src=v.thumb;img.alt=PART[k]||k;img.title=(PART[k]||k)+': '+v.name;img.loading='lazy';img.referrerPolicy='no-referrer';t.append(img);}return t;}

function shown(){
 const open=i=>i.status==='new'||i.status==='failed';
 return data.ideas.filter(i=>filter==='new'?open(i):filter==='outfit'||filter==='product'?i.kind===filter&&open(i):filter==='made'?['made','published','queued','publishing'].includes(i.status):i.status===filter).sort((a,b)=>(b.kind==='outfit')-(a.kind==='outfit'));
}
function render(){
 const c=data.counts,s=data.settings,sets=new Map(data.sets.map(x=>[x.id,x])),jackets=data.sets.filter(x=>x.jacket).length;
 $('ideaBadge').textContent=`${c.new||0} new · ${c.approved||0} approved · ${c.made||0} made`;
 const pf=data.printful;
 $('ideaShapes').textContent=`${data.sets.length} design sets (${jackets} from jackets) across ${data.catalog} all-over-print items. `+(pf.state==='connected'?`Read ${pf.products} Printful products.`:pf.state==='not_connected'?'Printful isn\'t connected on the backend, so only uploaded sets are used.':pf.state==='error'?'Printful: '+pf.error:'Reading your Printful products…')+(pf.state==='connected'&&!jackets?' Your Printful store has no jackets yet, so hoodie sets lead.':'');
 if(document.activeElement?.closest?.('.ix-team')==null){$('ideaTeam').value=$('ideaTeamSlider').value=s.team;$('ideaPool').value=s.pool;$('ideaOutfit').value=s.outfitSize;$('ideaAuto').checked=s.autoMake;}
 if(document.activeElement?.closest?.('.ix-autopilot')==null){$('ideaAutopilot').checked=s.autopilot;$('ideaPerDay').value=s.perDay;}
 $('ideaSets').replaceChildren(...data.sets.map(x=>{const d=node('div','', 'ix-set');d.dataset.jacket=String(x.jacket);
  const off=node('label'),cb=node('input');cb.type='checkbox';cb.checked=true;cb.onchange=guard(cb,async()=>{data=await api('ideas/set',{id:x.id,enabled:false});render();note(`${x.name} won't be used for ideas.`);});off.append(cb,document.createTextNode('Use this set'));
  d.append(node('strong',x.name),node('span',x.jacket?'Jacket set':x.source==='printful'?'From '+x.product:'Your upload: '+x.name,'fx-sublabel'),thumbs(x.parts),off);return d;}));
 for(const id of [...picked])if(!data.ideas.some(i=>i.id===id&&(i.status==='new'||i.status==='failed')))picked.delete(id);
 const list=shown();
 $('ideaGrid').replaceChildren(...(list.length?list.map(i=>{
  const open=i.status==='new'||i.status==='failed',card=node(open?'label':'article','', 'ix-idea'),set=sets.get(i.set);card.dataset.status=i.status;
  if(open){const cb=node('input');cb.type='checkbox';cb.checked=picked.has(i.id);cb.setAttribute('aria-label','Select '+i.title);cb.onchange=()=>{cb.checked?picked.add(i.id):picked.delete(i.id);bar();};card.append(cb);}
  const head=node('div','', 'fx-row');head.append(node('strong',i.title),node('span',i.kind==='outfit'?'Outfit':'Item','fx-pill'));card.append(head);
  const ready=i.pieces.filter(p=>p.ready).length;
  if(open&&ready&&data.canPublish){const go=node('button',`Publish ${ready} ready item${ready===1?'':'s'} now`,'fx-btn fx-go ix-now');go.type='button';
   go.onclick=guard(go,async ev=>{ev?.preventDefault?.();data=await api('ideas/publish',{ids:[i.id]});picked.delete(i.id);started(1);});card.append(go);}
  if(set)card.append(thumbs(set.parts));
  const pieces=node('ul','', 'ix-pieces');
  for(const p of i.pieces){const li=node('li');li.append(node('b',`${p.category?p.category+': ':''}${p.label} · ${p.color}`),node('span',p.placements.map(x=>`${area(x.area)}: ${PART[x.part]||x.part}`).join(' · ')+(p.empty.length?` · ${p.empty.map(area).join(', ')}: base color`:'')),node('span',p.tag?`Tag: Midnight Design logo`:'Tag: logo small at the inside back neck (no tag print area)','ix-tag'));
   if(p.ready!==undefined)li.append(node('span',p.ready?'Ready to publish':'Not published: '+p.why,p.ready?'ix-ready':'ix-skip'));
   if(open&&i.pieces.length>1){const x=node('button','Remove','ix-drop');x.type='button';x.setAttribute('aria-label',`Remove ${p.label} from ${i.title}`);x.onclick=guard(x,async ev=>{ev?.preventDefault?.();data=await api('ideas/piece',{id:i.id,catalog:p.catalog});render();note(`${p.label} removed from ${i.title}.`);});li.append(x);}
   pieces.append(li);}
  card.append(pieces,node('p',i.reason,'fx-sublabel'));
  if(i.status==='published')card.append(node('p','Published to your store. Rate it in AI Made.','fx-note'));
  if(i.status==='publishing')card.append(node('p','Publishing to your store now…','fx-note'));
  if(i.status==='queued')card.append(node('p','Waiting its turn to publish.','fx-note'));
  if(i.status==='made')card.append(node('p',`In production: ${i.jobs} job${i.jobs===1?'':'s'} queued.`,'fx-note'));
  if(i.status==='approved')card.append(node('p',`Approved. ${i.jobs} of ${i.pieces.length} pieces queued; the rest go in as the queue frees up.`,'fx-note'));
  if(i.error)card.append(node('p',i.error,'fx-warn'));
  return card;}):[node('p',filter==='made'?'Nothing made from ideas yet.':filter==='approved'?'No approved ideas waiting for queue room.':data.sets.length?'The team is drafting ideas. Press "Get more ideas now" to speed it up.':'Ideas start once there is a design set: a Printful product with its print files, or an uploaded collection with at least one full design.','fx-note')]));
 $('ideaDesigns').replaceChildren(...data.designs.filter(x=>!/^(sleeve panels|hood panels|pocket & emblems|celestial & gothic|halloween & horror|mockups & references)$/i.test(x.collection)).map(x=>{const t=node('div','', 'fx-tile'),img=node('img'),sel=node('select','', 'ix-shape');img.src=x.url;img.alt='';img.loading='lazy';sel.setAttribute('aria-label','Use of '+x.name);
  for(const [v,l] of data.shapes){const o=node('option',l);o.value=v;sel.append(o);}sel.value=x.shape;
  sel.onchange=guard(sel,async()=>{data=await api('ideas/shape',{artwork:x.id,shape:sel.value===x.detected?null:sel.value});render();note(`${x.name} updated.`);});
  t.append(img,node('span',x.name,'fx-tile-name'),node('span',x.collection,'fx-sublabel'),sel);return t;}));
 bar();renderMade();
}
function bar(){$('ideaPublish').textContent=picked.size?`Publish selected to store (${picked.size})`:'Publish selected to store';$('ideaPublish').disabled=$('ideaMake').disabled=$('ideaDismiss').disabled=!picked.size;}
// AI Made: everything the team published, with star ratings that feed back into what it makes next.
function renderMade(){
 const list=data.made||[],unrated=list.filter(m=>m.status==='published'&&!m.rating).length,r=data.ratings;
 $('madeBadge').textContent=list.length?`${list.filter(m=>m.status==='published').length} published · ${unrated} to rate`+(r.count?` · average ${r.avg.toFixed(1)}★`:''):'Nothing yet';
 const busy=data.ideas.filter(i=>i.status==='queued'||i.status==='publishing').length;
 if(busy)$('madeNote').textContent=`Publishing in the background: ${busy} idea${busy===1?'':'s'} to go, ${list.filter(m=>m.status==='published').length} products done so far.`;
 else if(/^Publishing in the background/.test($('madeNote').textContent))$('madeNote').textContent='Publishing finished. Rate what came out.';
 const shown=list.filter(m=>madeFilter==='unrated'?m.status!=='failed'&&!m.rating:madeFilter==='rated'?!!m.rating:m.status==='failed');
 $('madeGrid').replaceChildren(...(shown.length?shown.map(m=>{const card=node('article','', 'mx-card');card.dataset.status=m.status;
  if(m.thumb){const img=node('img');img.src=m.thumb;img.alt=m.name;img.loading='lazy';img.referrerPolicy='no-referrer';card.append(img);}else card.append(node('div',m.status==='failed'?'Not published':m.status==='creating'?'Publishing…':'Printful is making the mockup. It shows here in a minute or two.','mx-wait'));
  card.append(node('strong',m.name),node('p',`${m.category||''} · design set ${m.set}`,'fx-sublabel'));
  if(m.prices){const v=Object.values(m.prices);card.append(node('p',`Price $${Math.min(...v).toFixed(2)}${Math.max(...v)!==Math.min(...v)?'–$'+Math.max(...v).toFixed(2):''} · ${v.length} sizes`,'fx-sublabel'));}
  if(m.error)card.append(node('p',m.error,'fx-warn'));
  if(m.status==='published'){
   const stars=node('div','', 'mx-stars');stars.setAttribute('role','group');stars.setAttribute('aria-label','Rate '+m.name);
   const note=node('input');note.type='text';note.placeholder='What to keep or change (optional)';note.maxLength=300;note.value=notes.get(m.id)??m.note??'';note.setAttribute('aria-label','Note for '+m.name);note.oninput=()=>notes.set(m.id,note.value);
   for(let n=1;n<=5;n++){const b=node('button',n<=(m.rating||0)?'★':'☆');b.type='button';b.setAttribute('aria-label',n+' star'+(n>1?'s':''));b.setAttribute('aria-pressed',String(n<=(m.rating||0)));
    b.onclick=guard(b,async()=>{data=await api('ideas/rate',{id:m.id,rating:n,note:note.value});notes.delete(m.id);render();$('madeNote').textContent=`${m.name}: ${n} star${n>1?'s':''}. ${n>=4?'The team will make more like this.':n<=2?'The team will avoid this.':'Saved.'}`;});stars.append(b);}
   card.append(stars,note);}
  const acts=node('div','', 'mx-actions');
  if(m.printfulId){const del=node('button','Delete from store','fx-btn fx-quiet');del.type='button';del.onclick=guard(del,async()=>{if(!confirm(`Delete "${m.name}" from Printful and your store?`))return;data=await api('ideas/delete',{id:m.id,confirm:true});render();$('madeNote').textContent=`${m.name} deleted. It leaves the store at the next catalog sync.`;});acts.append(del);}
  card.append(acts);return card;}):[node('p',madeFilter==='unrated'?(list.length?'Everything is rated.':'Nothing published yet. Tick outfits in the Idea Room and press Publish, or turn on Autopilot.'):madeFilter==='rated'?'No ratings yet.':'No problems.','fx-note')]));
}
async function load(){data=await api('ideas');render();}

document.querySelectorAll('#ideaTabs [role=tab]').forEach(t=>t.onclick=()=>{document.querySelectorAll('#ideaTabs [role=tab]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));filter=t.dataset.filter;render();});
$('ideaAll').onclick=()=>{for(const i of shown())if(i.status==='new'||i.status==='failed')picked.add(i.id);render();};
// Publishing runs on the server in the background; the page jumps to AI Made and refreshes every few seconds as products arrive.
function started(n){render();note(`${n} idea${n===1?'':'s'} sent to your store. Watch them arrive in AI Made.`);$('madeNote').textContent=`Publishing ${n} idea${n===1?'':'s'} in the background. Products appear below one by one, and you can leave this page open or come back later.`;document.getElementById('aiMade')?.scrollIntoView({behavior:'smooth',block:'start'});}
// Used by Start Factory: publishes the ticked ideas, or every waiting outfit that has ready items when none are ticked.
window.mdIdeas={async start(){if(!data)await load();if(!data.canPublish)throw Error('Printful is not connected on the backend, so nothing can be published.');
 const ids=picked.size?[...picked]:data.ideas.filter(i=>i.status==='new'&&i.kind==='outfit'&&i.pieces.some(p=>p.ready)).map(i=>i.id);if(!ids.length)return 0;
 data=await api('ideas/publish',{ids});picked.clear();started(ids.length);return ids.length;}};
$('ideaPublish').onclick=guard($('ideaPublish'),async()=>{const n=picked.size;data=await api('ideas/publish',{ids:[...picked]});picked.clear();started(n);});
document.querySelectorAll('#madeTabs [role=tab]').forEach(t=>t.onclick=()=>{document.querySelectorAll('#madeTabs [role=tab]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));madeFilter=t.dataset.filter;renderMade();});
$('ideaMake').onclick=guard($('ideaMake'),async()=>{const n=picked.size;data=await api('ideas/approve',{ids:[...picked]});picked.clear();render();note(`${n} idea${n===1?'':'s'} sent to production. Jobs appear in the live queue below.`);});
$('ideaDismiss').onclick=guard($('ideaDismiss'),async()=>{const n=picked.size;data=await api('ideas/dismiss',{ids:[...picked]});picked.clear();render();note(`${n} dismissed. The team will draft new ones.`);});
$('ideaMore').onclick=guard($('ideaMore'),async()=>{const before=data.counts.new||0;data=await api('ideas/generate',{});render();note(`${Math.max(0,(data.counts.new||0)-before)} new ideas drafted.`);});
$('ideaPrintful').onclick=guard($('ideaPrintful'),async()=>{note('Reading your Printful products…');data=await api('ideas/printful',{});render();note(data.printful.state==='connected'?`Found ${data.sets.filter(x=>x.source==='printful').length} design sets in ${data.printful.products} Printful products.`:$('ideaShapes').textContent);});
const saveSettings=guard(null,async()=>{data=await api('ideas/settings',{team:Number($('ideaTeam').value),pool:Number($('ideaPool').value),outfitSize:Number($('ideaOutfit').value),autopilot:$('ideaAutopilot').checked,perDay:Number($('ideaPerDay').value),autoMake:$('ideaAuto').checked});render();note($('ideaAutopilot').checked?`Autopilot is on: up to ${$('ideaPerDay').value} outfits a day go to your store.`:$('ideaAuto').checked?'The team now sends ideas straight to production.':'Settings saved.');});
$('ideaTeamSlider').oninput=()=>{$('ideaTeam').value=$('ideaTeamSlider').value;};$('ideaTeamSlider').onchange=saveSettings;
$('ideaTeam').onchange=()=>{$('ideaTeamSlider').value=$('ideaTeam').value;saveSettings();};$('ideaPool').onchange=saveSettings;$('ideaOutfit').onchange=saveSettings;$('ideaAutopilot').onchange=saveSettings;$('ideaPerDay').onchange=saveSettings;$('ideaAuto').onchange=saveSettings;
let last=0;setInterval(()=>{const busy=data?.ideas?.some(i=>i.status==='queued'||i.status==='publishing');if(document.hidden||Date.now()-last<(busy?5000:20000)||document.activeElement?.closest?.('#madeGrid,.ix-team,.ix-autopilot'))return;last=Date.now();load().catch(()=>{});},2500);
load().catch(e=>note(e.message));
})();
