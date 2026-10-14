'use strict';
(()=>{
 const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 let data=null,busy=false;
 async function api(body){const r=await fetch('/api/owner/ai-factory/layouts',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Master sign-in required.');}const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load layouts.');return d;}
 function render(){
  if(!data)return;const category=$('layoutCategory').value,q=$('layoutSearch').value.trim().toLowerCase(),labels=Object.fromEntries(data.categories.map(c=>[c.id,c.label])),shown=data.layouts.filter(l=>(!category||l.category===category)&&(!q||(l.number+' '+l.name+' '+l.recipe+' '+labels[l.category]).toLowerCase().includes(q)));
  $('layoutCount').textContent=shown.length+' of '+data.layouts.length+' layouts';$('layoutHelp').textContent=data.note;
  $('layoutChoices').replaceChildren(...data.categories.map(c=>{const row=node('div',undefined,'fl-choice'),l=data.layouts.find(l=>l.number===data.choices[c.id]);row.append(node('strong',c.label),node('span',l?'#'+l.number+' '+l.name:'AI chooses a compatible layout','fx-note'));if(l){const b=node('button','Let AI choose for '+c.label,'fx-btn fx-quiet');b.type='button';b.disabled=busy;b.onclick=()=>save(c.id,null);row.append(b);}return row;}));
  const open=new Set([...$('layoutGrid').querySelectorAll('details[open]')].map(e=>Number(e.dataset.layout)));
  $('layoutGrid').replaceChildren(...shown.map(l=>{const chosen=data.choices[l.category]===l.number,card=node('details',undefined,'fl-card');card.dataset.layout=l.number;card.dataset.selected=chosen;card.open=open.has(l.number);const summary=node('summary');summary.append(node('span',labels[l.category],'fl-category'),node('strong','#'+l.number+' '+l.name),node('span',chosen?'Selected · view instructions':'View placement instructions','fx-note'));const recipe=node('p',l.recipe,'fl-recipe'),b=node('button',chosen?'Selected for '+labels[l.category]:'Use for '+labels[l.category],'fx-btn '+(chosen?'fx-go':'fx-quiet'));b.type='button';b.disabled=busy||chosen;b.setAttribute('aria-pressed',String(chosen));b.onclick=()=>save(l.category,l.number);card.append(summary,recipe,b);return card;}));
  $('layoutEmpty').hidden=shown.length>0;
 }
 async function save(category,number){if(busy)return;busy=true;render();try{data=await api({category,number});const c=data.categories.find(c=>c.id===category),l=data.layouts.find(l=>l.number===number);$('layoutNote').textContent=l?'Saved #'+l.number+' '+l.name+' for new AI-assisted '+c.label.toLowerCase()+'. Enable AI-assisted layout or full AI production when starting those products.':'New AI-assisted '+c.label.toLowerCase()+' can choose a compatible layout again.';}catch(e){$('layoutNote').textContent=e.message;}finally{busy=false;render();if(number)$('layoutGrid').querySelector('[data-layout="'+number+'"] summary')?.focus();}}
 $('layoutCategory').onchange=render;$('layoutSearch').oninput=render;
 $('layoutRefresh').onclick=load;
 async function load(){if(busy)return;busy=true;try{data=await api();const old=$('layoutCategory').value;$('layoutCategory').replaceChildren(node('option','All clothing categories'),...data.categories.map(c=>{const o=node('option',c.label+' ('+c.count+')');o.value=c.id;return o;}));$('layoutCategory').options[0].value='';$('layoutCategory').value=old;}catch(e){$('layoutNote').textContent=e.message;}finally{busy=false;render();}}
 load();
})();
