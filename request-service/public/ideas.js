'use strict';
// Idea Room: design sets, the idea team's waiting items and outfits, bulk approval, team size and upload sorting.
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
let data=null,filter='new';const picked=new Set();
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
const note=t=>{$('ideaNote').textContent=t;};
const guard=(b,fn)=>async()=>{if(b)b.disabled=true;try{await fn();}catch(e){note(e.message);}finally{if(b)b.disabled=false;}};
const PART={back:'Back',front:'Front',default:'All-over',sleeve_left:'Left sleeve',sleeve_right:'Right sleeve',leg_left:'Left leg',leg_right:'Right leg',hood:'Hood',pocket:'Pocket'};
const area=a=>a.replace(/_dtfabric$/,'').replace(/_/g,' ');
function thumbs(parts,max=6){const t=node('div','', 'ix-thumbs');for(const [k,v] of Object.entries(parts).slice(0,max)){const img=node('img');img.src=v.thumb;img.alt=PART[k]||k;img.title=(PART[k]||k)+': '+v.name;img.loading='lazy';img.referrerPolicy='no-referrer';t.append(img);}return t;}

function shown(){
 const open=i=>i.status==='new'||i.status==='failed';
 return data.ideas.filter(i=>filter==='new'?open(i):filter==='outfit'||filter==='product'?i.kind===filter&&open(i):i.status===filter);
}
function render(){
 const c=data.counts,s=data.settings,sets=new Map(data.sets.map(x=>[x.id,x])),jackets=data.sets.filter(x=>x.jacket).length;
 $('ideaBadge').textContent=`${c.new||0} new · ${c.approved||0} approved · ${c.made||0} made`;
 const pf=data.printful;
 $('ideaShapes').textContent=`${data.sets.length} design sets (${jackets} from jackets) across ${data.catalog} all-over-print items. `+(pf.state==='connected'?`Read ${pf.products} Printful products.`:pf.state==='not_connected'?'Printful isn\'t connected on the backend, so only uploaded sets are used.':pf.state==='error'?'Printful: '+pf.error:'Reading your Printful products…');
 if(document.activeElement?.closest?.('.ix-team')==null){$('ideaTeam').value=$('ideaTeamSlider').value=s.team;$('ideaPool').value=s.pool;$('ideaAuto').checked=s.autoMake;}
 $('ideaSets').replaceChildren(...data.sets.map(x=>{const d=node('div','', 'ix-set');d.dataset.jacket=String(x.jacket);
  const off=node('label'),cb=node('input');cb.type='checkbox';cb.checked=true;cb.onchange=guard(cb,async()=>{data=await api('ideas/set',{id:x.id,enabled:false});render();note(`${x.name} won't be used for ideas.`);});off.append(cb,document.createTextNode('Use this set'));
  d.append(node('strong',x.name),node('span',x.jacket?'Jacket set':x.source==='printful'?'From '+x.product:'Your upload: '+x.name,'fx-sublabel'),thumbs(x.parts),off);return d;}));
 for(const id of [...picked])if(!data.ideas.some(i=>i.id===id&&(i.status==='new'||i.status==='failed')))picked.delete(id);
 const list=shown();
 $('ideaGrid').replaceChildren(...(list.length?list.map(i=>{
  const open=i.status==='new'||i.status==='failed',card=node(open?'label':'article','', 'ix-idea'),set=sets.get(i.set);card.dataset.status=i.status;
  if(open){const cb=node('input');cb.type='checkbox';cb.checked=picked.has(i.id);cb.setAttribute('aria-label','Select '+i.title);cb.onchange=()=>{cb.checked?picked.add(i.id):picked.delete(i.id);bar();};card.append(cb);}
  const head=node('div','', 'fx-row');head.append(node('strong',i.title),node('span',i.kind==='outfit'?'Outfit':'Item','fx-pill'));card.append(head);
  if(set)card.append(thumbs(set.parts));
  const pieces=node('ul','', 'ix-pieces');
  for(const p of i.pieces){const li=node('li');li.append(node('b',`${p.label} · ${p.color}`),node('span',p.placements.map(x=>`${area(x.area)}: ${PART[x.part]||x.part}`).join(' · ')+(p.empty.length?` · ${p.empty.map(area).join(', ')}: base color`:'')));pieces.append(li);}
  card.append(pieces,node('p',i.reason,'fx-sublabel'));
  if(i.status==='made')card.append(node('p',`In production: ${i.jobs} job${i.jobs===1?'':'s'} queued.`,'fx-note'));
  if(i.status==='approved')card.append(node('p',`Approved. ${i.jobs} of ${i.pieces.length} pieces queued; the rest go in as the queue frees up.`,'fx-note'));
  if(i.error)card.append(node('p',i.error,'fx-warn'));
  return card;}):[node('p',filter==='made'?'Nothing made from ideas yet.':filter==='approved'?'No approved ideas waiting for queue room.':data.sets.length?'The team is drafting ideas. Press "Get more ideas now" to speed it up.':'Ideas start once there is a design set: a Printful product with its print files, or an uploaded collection with at least one full design.','fx-note')]));
 $('ideaDesigns').replaceChildren(...data.designs.filter(x=>!/^(sleeve panels|hood panels|pocket & emblems|celestial & gothic|halloween & horror|mockups & references)$/i.test(x.collection)).map(x=>{const t=node('div','', 'fx-tile'),img=node('img'),sel=node('select','', 'ix-shape');img.src=x.url;img.alt='';img.loading='lazy';sel.setAttribute('aria-label','Use of '+x.name);
  for(const [v,l] of data.shapes){const o=node('option',l);o.value=v;sel.append(o);}sel.value=x.shape;
  sel.onchange=guard(sel,async()=>{data=await api('ideas/shape',{artwork:x.id,shape:sel.value===x.detected?null:sel.value});render();note(`${x.name} updated.`);});
  t.append(img,node('span',x.name,'fx-tile-name'),node('span',x.collection,'fx-sublabel'),sel);return t;}));
 bar();
}
function bar(){$('ideaMake').textContent=picked.size?`Make selected (${picked.size})`:'Make selected';$('ideaMake').disabled=$('ideaDismiss').disabled=!picked.size;}
async function load(){data=await api('ideas');render();}

document.querySelectorAll('#ideaTabs [role=tab]').forEach(t=>t.onclick=()=>{document.querySelectorAll('#ideaTabs [role=tab]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));filter=t.dataset.filter;render();});
$('ideaAll').onclick=()=>{for(const i of shown())if(i.status==='new'||i.status==='failed')picked.add(i.id);render();};
$('ideaMake').onclick=guard($('ideaMake'),async()=>{const n=picked.size;data=await api('ideas/approve',{ids:[...picked]});picked.clear();render();note(`${n} idea${n===1?'':'s'} sent to production. Jobs appear in the live queue below.`);});
$('ideaDismiss').onclick=guard($('ideaDismiss'),async()=>{const n=picked.size;data=await api('ideas/dismiss',{ids:[...picked]});picked.clear();render();note(`${n} dismissed. The team will draft new ones.`);});
$('ideaMore').onclick=guard($('ideaMore'),async()=>{const before=data.counts.new||0;data=await api('ideas/generate',{});render();note(`${Math.max(0,(data.counts.new||0)-before)} new ideas drafted.`);});
$('ideaPrintful').onclick=guard($('ideaPrintful'),async()=>{note('Reading your Printful products…');data=await api('ideas/printful',{});render();note(data.printful.state==='connected'?`Found ${data.sets.filter(x=>x.source==='printful').length} design sets in ${data.printful.products} Printful products.`:$('ideaShapes').textContent);});
const saveSettings=guard(null,async()=>{data=await api('ideas/settings',{team:Number($('ideaTeam').value),pool:Number($('ideaPool').value),autoMake:$('ideaAuto').checked});render();note($('ideaAuto').checked?'The team now sends ideas straight to production.':'Settings saved.');});
$('ideaTeamSlider').oninput=()=>{$('ideaTeam').value=$('ideaTeamSlider').value;};$('ideaTeamSlider').onchange=saveSettings;
$('ideaTeam').onchange=()=>{$('ideaTeamSlider').value=$('ideaTeam').value;saveSettings();};$('ideaPool').onchange=saveSettings;$('ideaAuto').onchange=saveSettings;
setInterval(()=>{if(!document.hidden)load().catch(()=>{});},20000);
load().catch(e=>note(e.message));
})();
