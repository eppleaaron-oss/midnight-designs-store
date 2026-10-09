'use strict';
// Idea Room: the idea team's waiting products and outfits, bulk approval, team size and design sorting.
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
let data=null,filter='new';const picked=new Set();
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
const note=t=>{$('ideaNote').textContent=t;};
const guard=(b,fn)=>async()=>{if(b)b.disabled=true;try{await fn();}catch(e){note(e.message);}finally{if(b)b.disabled=false;}};

function shown(){
 return data.ideas.filter(i=>filter==='new'?i.status==='new'||i.status==='failed':filter==='outfit'||filter==='product'?i.kind===filter&&(i.status==='new'||i.status==='failed'):i.status===filter);
}
function render(){
 const c=data.counts,s=data.settings,d=data.designs,count=k=>d.filter(x=>x.shape===k).length;
 $('ideaBadge').textContent=`${c.new||0} new · ${c.approved||0} approved · ${c.made||0} made`;
 $('ideaShapes').textContent=d.length?`${d.length} designs sorted: ${count('full')} full, ${count('strip')} strips, ${count('emblem')} emblems.`+(data.unsorted?` ${data.unsorted} still being sorted.`:''):'No designs in the factory yet. Upload some below, or bring in every design from your store.';
 if(document.activeElement?.closest?.('.ix-team')==null){$('ideaTeam').value=$('ideaTeamSlider').value=s.team;$('ideaPool').value=s.pool;$('ideaAuto').checked=s.autoMake;}
 const art=new Map(d.map(x=>[x.id,x])),list=shown();
 for(const id of [...picked])if(!data.ideas.some(i=>i.id===id&&(i.status==='new'||i.status==='failed')))picked.delete(id);
 $('ideaGrid').replaceChildren(...(list.length?list.map(i=>{
  const open=i.status==='new'||i.status==='failed',card=node(open?'label':'article','', 'ix-idea');card.dataset.status=i.status;
  if(open){const cb=node('input');cb.type='checkbox';cb.checked=picked.has(i.id);cb.setAttribute('aria-label','Select '+i.title);cb.onchange=()=>{cb.checked?picked.add(i.id):picked.delete(i.id);bar();};card.append(cb);}
  const head=node('div','', 'fx-row');head.append(node('strong',i.title),node('span',i.kind==='outfit'?'Outfit':'Item','fx-pill'));
  const ids=[...new Set(i.pieces.flatMap(p=>p.placements.map(x=>x.artwork)))],thumbs=node('div','', 'ix-thumbs');
  for(const id of ids.slice(0,6)){const a=art.get(id);if(!a)continue;const img=node('img');img.src=a.url;img.alt=a.name;img.title=a.name;img.loading='lazy';thumbs.append(img);}
  const pieces=node('ul','', 'ix-pieces');
  for(const p of i.pieces){const li=node('li');li.append(node('b',`${p.label} · ${p.color}`),document.createTextNode(' — '+p.layout),node('span',p.placements.map(x=>`${x.zone.replace(/-/g,' ')}: ${x.name}`).join(' · ')));pieces.append(li);}
  card.append(head,thumbs,pieces,node('p',i.reason,'fx-sublabel'));
  if(i.status==='made')card.append(node('p',`In production: ${i.jobs} job${i.jobs===1?'':'s'} queued.`,'fx-note'));
  if(i.status==='approved')card.append(node('p',`Approved. ${i.jobs} of ${i.pieces.length} pieces queued; the rest go in as the queue frees up.`,'fx-note'));
  if(i.error)card.append(node('p',i.error,'fx-warn'));
  return card;}):[node('p',filter==='made'?'Nothing made from ideas yet.':filter==='approved'?'No approved ideas waiting for queue room.':d.some(x=>x.shape==='full')?'The team is drafting ideas. Press "Get more ideas now" to speed it up.':'Ideas start once there is at least one full design in the factory.','fx-note')]));
 $('ideaDesigns').replaceChildren(...d.map(x=>{const t=node('div','', 'fx-tile'),img=node('img'),sel=node('select','', 'ix-shape');img.src=x.url;img.alt='';img.loading='lazy';sel.setAttribute('aria-label','Shape of '+x.name);
  for(const [v,l] of data.shapes){const o=node('option',l+(v===x.detected&&x.override?' (detected)':''));o.value=v;sel.append(o);}sel.value=x.shape;
  sel.onchange=guard(sel,async()=>{data=await api('ideas/shape',{artwork:x.id,shape:sel.value===x.detected?null:sel.value});render();note(`${x.name} is now sorted as ${sel.selectedOptions[0].textContent.toLowerCase()}.`);});
  t.append(img,node('span',x.name,'fx-tile-name'),node('span',x.reason,'fx-sublabel'),sel);return t;}));
 bar();
}
function bar(){$('ideaMake').textContent=picked.size?`Make selected (${picked.size})`:'Make selected';$('ideaMake').disabled=$('ideaDismiss').disabled=!picked.size;}
async function load(){data=await api('ideas');render();}

document.querySelectorAll('#ideaTabs [role=tab]').forEach(t=>t.onclick=()=>{document.querySelectorAll('#ideaTabs [role=tab]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));filter=t.dataset.filter;render();});
$('ideaAll').onclick=()=>{for(const i of shown())if(i.status==='new'||i.status==='failed')picked.add(i.id);render();};
$('ideaMake').onclick=guard($('ideaMake'),async()=>{const n=picked.size;data=await api('ideas/approve',{ids:[...picked]});picked.clear();render();note(`${n} idea${n===1?'':'s'} sent to production. Jobs appear in the live queue below.`);});
$('ideaDismiss').onclick=guard($('ideaDismiss'),async()=>{const n=picked.size;data=await api('ideas/dismiss',{ids:[...picked]});picked.clear();render();note(`${n} dismissed. The team will draft new ones.`);});
$('ideaMore').onclick=guard($('ideaMore'),async()=>{const before=data.counts.new||0;data=await api('ideas/generate',{});render();note(`${Math.max(0,(data.counts.new||0)-before)} new ideas drafted.`);});
const saveSettings=guard(null,async()=>{data=await api('ideas/settings',{team:Number($('ideaTeam').value),pool:Number($('ideaPool').value),autoMake:$('ideaAuto').checked});render();note($('ideaAuto').checked?'The team now sends ideas straight to production.':'Settings saved.');});
$('ideaTeamSlider').oninput=()=>{$('ideaTeam').value=$('ideaTeamSlider').value;};$('ideaTeamSlider').onchange=saveSettings;
$('ideaTeam').onchange=()=>{$('ideaTeamSlider').value=$('ideaTeam').value;saveSettings();};$('ideaPool').onchange=saveSettings;$('ideaAuto').onchange=saveSettings;
$('ideaStore').onclick=guard($('ideaStore'),async()=>{note('Bringing in your store designs…');const lib=(await api('runs/library')).designs.filter(d=>!d.artworkId).map(d=>d.id);let done=0;
 for(let i=0;i<lib.length;i+=25){const r=await api('runs/import',{ids:lib.slice(i,i+25)});done+=r.imported.length;note(`Bringing in your store designs… ${done} of ${lib.length}`);}
 await load();note(lib.length?`${done} store designs added. The team is sorting them and drafting ideas.`:'Every store design is already in the factory.');});
setInterval(()=>{if(!document.hidden)load().catch(()=>{});},20000);
load().catch(e=>note(e.message));
})();
