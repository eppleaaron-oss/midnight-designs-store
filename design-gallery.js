'use strict';
function artworkThemes(d){
 const text=[d.name,d.description,d.category,...(d.tags||[])].filter(Boolean).join(' ').toLowerCase();
 return [
  ['Words & Meaning',/words|meaning|typograph|lettering|phrase|motto|time takes|still waters|we grow|wild life|within|soul|quote/],
  ['Roses & Thorns',/rose|thorn|floral/],['Skulls & Reapers',/skull|reaper|skeleton|death|grim/],
  ['Cathedrals',/cathedral|chapel|church|gothic arch/],['Moonlight',/moon|lunar|crescent|celestial|night sky|eclipse/],
  ['Retro Horror',/horror|vhs|slasher|movie|theater|cinema|terror|halloween|haunted|pumpkin/]
 ].filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
}
(async()=>{
 const $=id=>document.getElementById(id);if(!$('designGrid'))return;
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 let designs;try{const r=await fetch('designs.json',{cache:'no-cache'});if(!r.ok)throw Error();designs=await r.json();if(!Array.isArray(designs))throw Error();}catch{$('designGrid').append(node('p','error','The artwork could not load. Please refresh and try again.'));return;}
 const rawArtwork=designs;designs=window.mergeDesignCatalog(rawArtwork,[]);let catalogUnavailable=false;
 try{const r=await fetch('products.json',{cache:'no-cache'});if(!r.ok)throw Error();const catalog=await r.json();if(!Array.isArray(catalog.products))throw Error();designs=window.mergeDesignCatalog(rawArtwork,catalog.products);}catch{catalogUnavailable=true;}
 let theme='',limit=12,active=null;const batch=12;
 const params=new URLSearchParams(location.search);$('designSearch').value=params.get('q')||'';
 const themes=['','Words & Meaning','Roses & Thorns','Skulls & Reapers','Cathedrals','Moonlight','Retro Horror'];
 theme=themes.includes(params.get('theme'))?params.get('theme'):'';
 if(params.get('sort')==='liked')$('designSort').value='liked';
 for(const value of themes){const button=node('button','',value||'All artwork');button.type='button';button.dataset.theme=value;button.onclick=()=>{theme=value;limit=batch;render();};$('designThemes').append(button);}
 function liked(){try{return JSON.parse(localStorage.getItem('midnightDesignVotes')||'{}')||{};}catch{return {};}}
 function open(d){
  active=d;const familyUrl=new URL(location.href);familyUrl.searchParams.set('family',d.familyId);familyUrl.searchParams.set('design',d.id);history.replaceState(history.state,'',familyUrl);$('designLarge').src=d.image;$('designLarge').alt=d.name;$('designTitle').textContent=d.name;
  $('chooseDesign').href='request-design.html?design='+encodeURIComponent(d.id)+'&family='+encodeURIComponent(d.familyId);$('chooseDesign').textContent='USE THIS DESIGN FOR A CUSTOM REQUEST';$('wearSelection').hidden=false;
  $('shopDesign').hidden=!d.shopUrl;if(d.shopUrl)$('shopDesign').href=d.shopUrl;
  const members=d.members||[d];$('designFamilyArtwork').replaceChildren(...members.map(member=>{const b=node('button','family-artwork');b.type='button';b.setAttribute('aria-label','View '+member.sourceRole+' artwork — '+member.name);b.setAttribute('aria-pressed',String(member.id===d.id));const img=node('img');img.src=member.thumbnail||member.image;img.alt='';b.append(img,node('span','',member.sourceRole==='artwork'?member.name:member.sourceRole.replace(/_/g,' ')));b.onclick=()=>open({...d,...member,name:d.name,members});return b;}));
  $('designKind').textContent='Original artwork · '+(d.members?.length||1)+' source image(s)'+(d.productIds.length?' · '+d.productIds.length+' matching published piece(s)':' · Matching products have not been linked.');
  window.midnightDesignVotes?.dialog(d);window.midnightDesignRatings?.open(d);$('designDialog').dataset.designId=d.id;$('designDialog').dataset.familyId=d.familyId;if(!$('designDialog').open)$('designDialog').showModal();
  if(d.kind!=='reference')document.dispatchEvent(new CustomEvent('midnight:design-view',{detail:{designId:d.id}}));
 }
 function render(){
  const tokens=$('designSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean),votes=liked();
  let list=designs.map((d,index)=>({d,index})).filter(({d})=>(!theme||artworkThemes(d).includes(theme))&&tokens.every(t=>[d.name,d.description,d.category,...(d.tags||[]),...artworkThemes(d)].join(' ').toLowerCase().includes(t)));
  list.sort((a,b)=>{if($('designSort').value==='liked'){const diff=Number(votes[b.d.id]==='like')-Number(votes[a.d.id]==='like');if(diff)return diff;}const x=Date.parse(a.d.createdAt||''),y=Date.parse(b.d.createdAt||'');if(Number.isFinite(x)&&Number.isFinite(y)&&x!==y)return y-x;const linked=d=>Math.max(0,...d.productIds.map(Number).filter(Number.isFinite));return linked(b.d)-linked(a.d)||a.index-b.index;});
  window.midnightDesignVotes?.resetCardListeners();$('designGrid').replaceChildren();
  for(const {d} of list.slice(0,limit)){
   const card=node('article','artwork-card'),preview=node('button','art-card');preview.type='button';preview.setAttribute('aria-label','View design — '+d.name);
   const img=node('img');img.src=d.thumbnail||d.image;img.alt=d.name;img.loading='lazy';preview.append(img);preview.onclick=()=>open(d);
   card.append(preview,node('h3','',d.name));
   const view=node('button','btn outline artwork-view','VIEW ARTWORK');view.type='button';view.onclick=()=>open(d);card.append(view);
   if(d.shopUrl){const shop=node('a','btn outline artwork-shop','SHOP MATCHING PIECES');shop.href=d.shopUrl;card.append(shop);}else{const unavailable=node('button','btn outline artwork-unlinked','NO LINKED PIECES YET');unavailable.type='button';unavailable.disabled=true;unavailable.title='Matching published products have not been linked to this artwork.';card.append(unavailable);}
   const votes=window.midnightDesignVotes?.controls(d);if(votes){card.append(votes);const rate=node('button','artwork-rate','Rate artwork');rate.type='button';rate.onclick=()=>{open(d);$('ratingSection').scrollIntoView({block:'start'});};card.append(rate);}
   $('designGrid').append(card);
  }
  if(!list.length)$('designGrid').append(node('p','notice','No artwork matches this search. Try another theme or phrase.'));
  $('designCount').textContent='Showing '+Math.min(limit,list.length)+' of '+list.length+' designs'+(catalogUnavailable?' · Product designs could not refresh. Reload to retry.':'');$('moreDesigns').hidden=limit>=list.length;$('designSortNote').hidden=$('designSort').value!=='liked';
  for(const b of $('designThemes').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.theme===theme));
  const url=new URL(location.href);for(const [key,value] of [['theme',theme],['q',$('designSearch').value.trim()],['sort',$('designSort').value==='liked'?'liked':'']])if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);history.replaceState(history.state,'',url);
 }
 $('designSearch').oninput=()=>{limit=batch;render();};$('designSort').onchange=()=>{limit=batch;render();};$('moreDesigns').onclick=()=>{limit+=batch;render();};$('closeDesign').onclick=()=>{$('designDialog').close();const url=new URL(location.href);url.searchParams.delete('family');url.searchParams.delete('design');history.replaceState(history.state,'',url);};
 // Refresh the liked ordering after a customer changes a preference.
 $('designSort').addEventListener('focus',()=>{if($('designSort').value==='liked')render();});
 render();const requested=params.get('family')||params.get('design');if(requested){const selected=designs.find(d=>d.familyId===requested||d.id===requested||d.members.some(a=>a.id===requested||(a.aliasIds||[]).includes(requested)));if(selected){const member=selected.members.find(a=>a.id===params.get('design')||(a.aliasIds||[]).includes(params.get('design')));open(member?{...selected,...member,name:selected.name,members:selected.members}:selected);}}
})();
