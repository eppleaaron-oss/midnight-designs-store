'use strict';
// Only label a photo as a back view when the supplier's metadata identifies it.
function catalogPhotoPair(p,entry,variantId){
 const first=p.variants.find(v=>String(v.id)===variantId)||p.variants[0];
 const valid=entry&&(!p.studioRevision||entry.studioRevision===p.studioRevision)&&(!entry.originalImage||entry.originalImage===p.image);
 const candidates=valid?(entry.photos||[]).filter(photo=>photo.category==='product'&&(!photo.storeVariantIds?.length||photo.storeVariantIds.includes(first?.id))).sort((a,b)=>(a.style==='Flat'?0:1)-(b.style==='Flat'?0:1)):[];
 const front=candidates.find(photo=>/^front(?:_|$)/i.test(photo.view))||candidates.find(photo=>/front/i.test(photo.view));
 const back=candidates.find(photo=>/back/i.test(photo.view)&&photo.image!==front?.image);
 const preferred=valid?(entry.photos||[]).find(photo=>photo.image===p.image&&(!photo.storeVariantIds?.length||photo.storeVariantIds.includes(first?.id))):null;
 const primary=preferred||front||candidates[0];
 if(primary)return {first:primary.image,firstLabel:/front/i.test(primary.view)?(primary.category==='fit'?'On-person · Front':'Front view'):'First photo',second:back?.image||null,secondLabel:'Back view',alt:primary.view};
 const more=[...new Set([p.image,...(p.images||[])])].filter(Boolean);
 return {first:more[0],firstLabel:'First photo',second:more[1]||null,secondLabel:'Next photo',alt:''};
}
(async()=>{
 if(!document.getElementById('grid')&&!document.querySelector('.hero-art'))return;
 let entries={},products=[];
 try{const [photos,catalog]=await Promise.all(['product-photos.json','products.json'].map(async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw Error();return r.json();}));entries=photos.products||{};products=catalog.products||[];}catch{return;}
 function update(){
  for(const link of document.querySelectorAll('.product-image,.hero-product')){
   if(link.dataset.photoReady)continue;
   const id=new URL(link.href,location.href).searchParams.get('id'),p=products.find(p=>p.id===id),img=link.querySelector('img');
   if(!p||!img)continue;
   const pair=catalogPhotoPair(p,entries[id],new URL(link.href,location.href).searchParams.get('variant'));
   link.dataset.photoReady='true';
   if(pair.first&&img.getAttribute('src')!==pair.first)img.src=pair.first;
   img.alt=(p.imageAlt||p.name)+(pair.alt?' · '+pair.alt.replaceAll('_',' ')+' view':'');
   if(document.body.dataset.browse!=='rack'||!pair.second)continue;
   const second=img.cloneNode(false);second.src=pair.second;second.className='product-second-view';second.alt=p.name+' · '+pair.secondLabel;second.loading='lazy';second.removeAttribute('fetchpriority');
   second.onerror=()=>{second.remove();link.classList.remove('has-second-view','show-second-view');button.remove();};
   link.classList.add('has-second-view');link.append(second);
   const card=link.closest('.product-card'),button=document.createElement('button');
   button.type='button';button.className='photo-toggle';button.textContent=pair.secondLabel+' ↔';button.setAttribute('aria-label',pair.secondLabel+' of '+p.name);button.setAttribute('aria-pressed','false');
   button.onclick=()=>{const open=link.classList.toggle('show-second-view');button.setAttribute('aria-pressed',String(open));button.textContent=(open?pair.firstLabel:pair.secondLabel)+' ↔';button.setAttribute('aria-label',(open?pair.firstLabel:pair.secondLabel)+' of '+p.name);};const wrap=document.createElement('div');wrap.className='product-photo-wrap';card.insertBefore(wrap,link);wrap.append(link,button);
  }
 }
 update();new MutationObserver(update).observe(document.body,{childList:true,subtree:true});
})();
