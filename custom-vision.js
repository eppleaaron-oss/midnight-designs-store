'use strict';
// Prepare a brief for the existing durable request delivery and draft engine.
(()=>{
 const $=id=>document.getElementById(id),form=$('designRequest');if(!form)return;
 let files=[],urls=[],brief='',record=null,signature='',preparing=false;
 function release(){urls.forEach(URL.revokeObjectURL);urls=[];}
 function previews(){release();$('referencePreviews').replaceChildren();for(const f of files){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),url=URL.createObjectURL(f);urls.push(url);img.src=url;img.alt='Your reference: '+f.name;caption.textContent=f.name;figure.append(img,caption);$('referencePreviews').append(figure);}$('clearReferences').hidden=!files.length;$('referenceStatus').textContent=files.length?files.length+' reference image(s) ready. Images are sent only when you submit.':'';}
 function invalidate(){if(preparing)return;brief='';$('requestReview').hidden=true;$('requestStatus').textContent='Your draft has changed. Review it before sending.';}
 function accept(selected){if($('references').disabled)return;if(selected.length>5||selected.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>5*1024*1024)){$('referenceStatus').textContent='Choose up to 5 PNG, JPG or WebP images, each no larger than 5 MB.';$('references').value='';return;}files=selected;$('references').value='';previews();invalidate();form.dispatchEvent(new Event('change',{bubbles:true}));}
 $('references').onchange=()=>accept([...$('references').files]);$('clearReferences').onclick=()=>accept([]);
 for(const type of ['dragenter','dragover'])$('visionDrop').addEventListener(type,e=>{e.preventDefault();$('visionDrop').classList.add('dragging');});
 $('visionDrop').addEventListener('dragleave',()=>$('visionDrop').classList.remove('dragging'));
 $('visionDrop').addEventListener('drop',e=>{e.preventDefault();$('visionDrop').classList.remove('dragging');accept([...e.dataTransfer.files]);});
 form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
 form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;const value=id=>$(id).value.trim();if(!value('name')||!value('idea')){$('requestStatus').textContent='Enter your name and describe your design idea.';return;}
 brief=['MIDNIGHT DESIGNS — CUSTOM DESIGN REQUEST','Please review this idea and provide a quote.','','Name: '+value('name'),'Reply email: '+value('email'),'Requested product: '+value('garment'),'','YOUR VISION',value('idea'),'','REFERENCE FILES',...(files.length?files.map(f=>f.name+' ('+(f.size/1048576).toFixed(2)+' MB)'):['None']),'','Product availability, print placements, artwork quality, and price require review. No payment or production is authorized.'].join('\n');
 const next=JSON.stringify({brief,files:files.map(f=>[f.name,f.size,f.lastModified])});if(!record||signature!==next)record={id:crypto.randomUUID(),type:'Custom design request',status:'New',title:value('garment')+' — custom artwork',name:value('name'),email:value('email'),product:value('garment'),details:brief,createdAt:new Date().toISOString()};signature=next;
 $('requestBrief').value=brief;$('sendRequest').href='mailto:midnightdesign107@gmail.com?subject='+encodeURIComponent('Midnight Designs — '+record.title)+'&body='+encodeURIComponent(brief);$('requestReview').hidden=false;$('requestStatus').textContent='Brief prepared. Nothing has been submitted.';$('sendStatus').textContent='';preparing=true;form.dispatchEvent(new Event('change',{bubbles:true}));preparing=false;$('reviewTitle').focus();$('requestReview').scrollIntoView({block:'start',behavior:'smooth'});
 };
 $('editVision').onclick=()=>{$('requestReview').hidden=true;$('idea').focus();};
 $('sendRequest').onclick=()=>{$('sendStatus').textContent='Attach your reference images and press Send in your email app. Opening an email draft does not confirm delivery.';};
 $('downloadVision').onclick=()=>{const url=URL.createObjectURL(new Blob([brief],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='midnight-design-request.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 window.midnightCustomRequest={current:()=>({record,files:[...files],brief,signature}),restore(saved){record=saved?.record||null;brief=saved?.brief||'';signature=saved?.signature||'';files=Array.isArray(saved?.files)?saved.files:[];previews();},reset(){record=null;brief='';signature='';}};
 document.querySelectorAll('.open-garment-studio').forEach(a=>a.addEventListener('click',()=>{$('garmentStudio').open=true;}));
 function reveal(){if(['#garmentStudio','#dropZone','#itemSelect','#placement','#design-review','#design-files','#printfulPlanStudio','#saved'].includes(location.hash))$('garmentStudio').open=true;}
 reveal();window.addEventListener('hashchange',reveal);window.addEventListener('pagehide',release);
})();
