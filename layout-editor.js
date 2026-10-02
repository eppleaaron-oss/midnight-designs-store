'use strict';
const fields=['announcement','headline','intro','featuredCount','showStory','showTicker','showCatalog','showDesigns','showCustom','showAi'],el=id=>document.getElementById(id);let published;
function values(){const d={version:1};for(const id of fields)d[id]=el(id).type==='checkbox'?el(id).checked:id==='featuredCount'?Number(el(id).value):el(id).value;return d;}
function fill(d){for(const id of fields)if(d[id]!=null)el(id).type==='checkbox'?el(id).checked=d[id]:el(id).value=d[id];}
function preview(){const d=values();el('layoutPreview').contentWindow.postMessage({type:'midnight-layout-preview',layout:d},location.origin);try{localStorage.setItem('midnight-layout-draft',JSON.stringify(d))}catch{}el('layoutStatus').textContent='Preview updated. Live store unchanged.';el('layoutPayload').value='';el('copyLayout').disabled=true;}
el('layoutPreview').onload=()=>{if(published)preview();};el('previewLayout').onclick=preview;
el('cleanLayout').onclick=()=>{fill({...values(),featuredCount:6,showStory:true,showTicker:false,showCatalog:false,showDesigns:true,showCustom:true,showAi:false});preview();};
el('desktopLayout').onclick=()=>el('layoutPreview').style.width='100%';el('mobileLayout').onclick=()=>el('layoutPreview').style.width='390px';
for(const id of fields)el(id).oninput=()=>{el('layoutPayload').value='';el('copyLayout').disabled=true;};
el('prepareLayout').onclick=()=>{el('layoutPayload').value=JSON.stringify(values());el('copyLayout').disabled=false;el('layoutPublishStatus').textContent='Settings ready. Publish through the protected control.';};
el('copyLayout').onclick=async()=>{try{await navigator.clipboard.writeText(el('layoutPayload').value);el('layoutPublishStatus').textContent='Copied. Paste into Layout settings in the protected workflow.';}catch{el('layoutPayload').select();el('layoutPublishStatus').textContent='Select and copy the settings below.';}};
fetch('store-layout.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{published=d;try{const saved=JSON.parse(localStorage.getItem('midnight-layout-draft')||'null');fill(saved||d);}catch{fill(d)}preview();}).catch(()=>{el('layoutStatus').textContent='Layout settings could not load. Reload to try again.';});
