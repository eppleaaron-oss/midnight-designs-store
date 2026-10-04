'use strict';
(()=>{
const $=id=>document.getElementById(id),form=$('designRequest');let files=[],urls=[],brief='',subject='',requestRecord=null;
function clear(){urls.forEach(URL.revokeObjectURL);urls=[];files=[];$('references').value='';$('referencePreviews').replaceChildren();$('clearReferences').hidden=true;}
function invalidate(){$('requestReview').hidden=true;brief='';$('requestStatus').textContent='';}
form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
$('references').addEventListener('change',()=>{
 const selected=[...$('references').files];clear();
 if(selected.length>5||selected.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>5*1024*1024)){$('referenceStatus').textContent='Choose up to 5 PNG, JPG or WebP files, each no larger than 5 MB.';return;}
 files=selected;$('referenceStatus').textContent=files.length?files.length+' reference images ready to attach in your email app.':'';
 for(const file of files){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');const url=URL.createObjectURL(file);urls.push(url);img.src=url;img.alt='Your reference: '+file.name;caption.textContent=file.name;figure.append(img,caption);$('referencePreviews').append(figure);}
 $('clearReferences').hidden=!files.length;
});
$('clearReferences').onclick=()=>{clear();invalidate();$('referenceStatus').textContent='References removed.';};
fetch('products.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{for(const p of data.products){const option=document.createElement('option');option.value=p.name+' (ID: '+p.id+')';option.textContent=p.name;$('catalogProduct').append(option);}}).catch(()=>{$('catalogProduct').options[0].textContent='Catalog unavailable — describe your item above';});
form.onsubmit=e=>{
 e.preventDefault();if(!form.reportValidity())return;
 const placements=[...form.querySelectorAll('input[name=placement]:checked')].map(i=>i.value);
 if(!placements.length){$('requestStatus').textContent='Choose at least one design placement.';form.querySelector('input[name=placement]').focus();return;}
 if(!$('idea').value.trim()||!$('name').value.trim()||!$('colors').value.trim()){$('requestStatus').textContent='Enter your name, artwork colors and a design description.';return;}
 const value=id=>$(id).value.trim()||'Not specified';
 subject='Midnight Designs custom design request — '+value('garment');
 brief=['CUSTOM DESIGN REQUEST','Please review this idea and provide a quote.','',...[
 ['Name','name'],['Reply email','email'],['Garment / product','garment'],['Existing product','catalogProduct'],['Product / material preferences','productDetails'],['Size / fit','size'],['Quantity','quantity'],['Destination','destination'],['Style','style'],['Artwork colors','colors'],['Clothing color','garmentColor'],['Exact text','designText']].map(([label,id])=>label+': '+value(id)),'Requested placements: '+placements.join(', '),'Placement notes: '+value('placementNotes'),'Total budget (USD): '+value('budget'),'Preferred delivery deadline: '+value('deadline'),'','DESIGN IDEA',value('idea'),'','OTHER NOTES',value('notes'),'','REFERENCE FILES',...(files.length?files.map(f=>f.name+' ('+(f.size/1024/1024).toFixed(2)+' MB)'):['None']),'','Please attach the reference files listed above before sending.','This is a request for review, not an accepted order.'].join('\n');
 requestRecord={id:crypto.randomUUID(),type:'Custom design request',status:'New',title:value('garment')+' — '+value('style'),name:value('name'),email:value('email'),product:value('garment'),budget:'USD '+value('budget'),deadline:$('deadline').value,details:brief,files:files.map(f=>f.name).join('\n'),notes:'',related:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};$('requestBrief').value=brief;$('sendRequest').href='mailto:midnightdesign107@gmail.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(brief);$('requestReview').hidden=false;$('requestStatus').textContent='Brief prepared. Nothing has been sent.';$('sendStatus').textContent='';
 const briefFile=new File([brief],'midnight-design-request.txt',{type:'text/plain'});
 $('shareRequest').hidden=!(navigator.canShare&&navigator.canShare({files:[briefFile,...files]}));
 $('reviewTitle').focus();$('requestReview').scrollIntoView({block:'start',behavior:'smooth'});
};
$('sendRequest').onclick=()=>{$('sendStatus').textContent='Review the email, attach your reference images and press Send in your email app. This page cannot confirm delivery.';};
const requestDownload=document.createElement('button');requestDownload.type='button';requestDownload.className='btn outline';requestDownload.id='downloadRequestFile';requestDownload.textContent='Download request file';$('downloadBrief').after(requestDownload);requestDownload.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,kind:'midnight-design-request',request:requestRecord},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='midnight-design-request.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('sendStatus').textContent='Request file downloaded. Attach it with your references and press Send in your email app. Nothing has been submitted here.';};$('downloadBrief').onclick=()=>{const url=URL.createObjectURL(new Blob([brief],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='midnight-design-request.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('shareRequest').onclick=async()=>{try{await navigator.share({title:subject,text:'Send this custom-design brief and references to midnightdesign107@gmail.com.',files:[new File([brief],'midnight-design-request.txt',{type:'text/plain'}),...files]});$('sendStatus').textContent='Shared with your selected app. Send to Midnight Designs there; delivery is not confirmed here.';}catch(e){$('sendStatus').textContent=e.name==='AbortError'?'Sharing canceled. Your brief is still here.':'Sharing unavailable. Use email and attach your reference files manually.';}};
$('editRequest').onclick=()=>{$('requestReview').hidden=true;$('garment').focus();form.scrollIntoView({block:'start'});};
window.addEventListener('pagehide',()=>urls.forEach(URL.revokeObjectURL));
})();