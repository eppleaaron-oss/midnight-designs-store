'use strict';
// Store Check: lists what needs fixing on the live store's products, biggest problems first.
(()=>{
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path,body){const r=await fetch('/api/owner/ai-factory/'+path,{method:body!==undefined?'POST':'GET',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});if(r.status===401){location.replace('/login?next=ai-factory');throw Error('Owner sign-in required.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d;}
const note=t=>{$('checkNote').textContent=t;};
const guard=(b,fn)=>async()=>{b.disabled=true;try{await fn();}catch(e){note(e.message);}finally{b.disabled=false;}};
const store='https://midnight-designs.store/';
function render(d){
 const c=d.counts,total=c.high+c.medium+c.low;
 $('checkBadge').textContent=total?`${total} to fix`:'All clear';
 $('checkMeta').textContent=`${d.products} products checked, ${d.clean} with nothing to fix. ${c.high} urgent, ${c.medium} worth fixing, ${c.low} minor`+(c.dismissed?`, ${c.dismissed} hidden`:'')+'. '+(d.printful.state==='connected'?`Printful print files checked for ${d.printful.products} products.`:d.printful.state==='error'?'Printful could not be read, so print areas and tags were not checked: '+d.printful.error:'Printful is not connected, so print areas and tags were not checked.');
 $('checkRestore').hidden=!c.dismissed;
 $('checkList').replaceChildren(...(d.issues.length?d.issues.map(i=>{const row=node('article','', 'sc-item');row.dataset.severity=i.severity;
  if(i.image){const img=node('img');img.src=/^https:/.test(i.image)?i.image:store+i.image.replace(/^\/+/,'');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';row.append(img);}else row.append(node('div','', 'sc-blank'));
  const head=node('p','', 'sc-head');const title=node('strong',i.title);head.append(title,node('span',i.severity==='high'?'Urgent':i.severity==='medium'?'Fix soon':'Minor','sc-sev'));
  const name=node('p','', 'fx-sublabel sc-name');if(i.url){const a=node('a',i.productName);a.href=/^https:/.test(i.url)?i.url:store+i.url.replace(/^\/+/,'');a.target='_blank';a.rel='noopener';name.append(a);}else name.textContent=i.productName;
  const hide=node('button','Hide','fx-btn fx-quiet');hide.type='button';hide.setAttribute('aria-label',`Hide "${i.title}" for ${i.productName}`);hide.onclick=guard(hide,async()=>{render(await api('audit/dismiss',{id:i.id}));note('Hidden. It stays hidden until you press Show hidden issues.');});
  row.append(head,hide,name,node('p',i.detail,'sc-detail'),node('p','Fix: '+i.fix,'sc-fix'));return row;}):[node('p','Nothing to fix. Every product passed.','fx-note')]));
}
$('checkRun').onclick=guard($('checkRun'),async()=>{note('Checking every product…');render(await api('audit/run',{}));note('Store checked.');});
$('checkRestore').onclick=guard($('checkRestore'),async()=>{render(await api('audit/restore',{}));note('Hidden issues are back.');});
api('audit').then(render).catch(e=>{$('checkBadge').textContent='Not checked';note(e.message);});
})();
