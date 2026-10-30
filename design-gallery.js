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
 let catalogUnavailable=false;
 try{const r=await fetch('products.json',{cache:'no-cache'});if(!r.ok)throw Error();const catalog=await r.json();if(!Array.isArray(catalog.products))throw Error();designs=window.mergeDesignCatalog(designs,catalog.products);}catch{catalogUnavailable=true;}
 let theme='',limit=12,active=null;const batch=12;
 const params=new URLSearchParams(location.search);$('designSearch').value=params.get('q')||'';
 const themes=['','Words & Meaning','Roses & Thorns','Skulls & Reapers','Cathedrals','Moonlight','Retro Horror'];
 theme=themes.includes(params.get('theme'))?params.get('theme'):'';
 if(params.get('sort')==='liked')$('designSort').value='liked';
 for(const value of themes){const button=node('button','',value||'All');button.type='button';button.dataset.theme=value;button.onclick=()=>{theme=value;limit=batch;render();};$('designThemes').append(button);}
 function liked(){try{return JSON.parse(localStorage.getItem('midnightDesignVotes')||'{}')||{};}catch{return {};}}
 function open(d){
  active=d;$('designLarge').src=d.image;$('designLarge').alt=d.name;$('designTitle').textContent=d.name;
  $('chooseDesign').href=d.catalogDesign?d.shopUrl:'custom.html?design='+encodeURIComponent(d.id);$('chooseDesign').textContent=d.catalogDesign?'SHOP THIS DESIGN':'CHOOSE THIS DESIGN';$('wearSelection').hidden=d.kind==='reference'&&!d.catalogDesign;
  $('designKind').textContent=d.catalogDesign?'Approved product preview · '+d.productIds.length+' matching piece(s). This is a garment mockup, not a standalone artwork file.':d.kind==='reference'?'Finished mockup / inspiration reference. Choose a standalone artwork design to create your piece.':d.category;
  window.midnightDesignVotes?.dialog(d);window.midnightDesignRatings?.open(d);$('designDialog').dataset.designId=d.kind==='reference'?'':d.id;$('designDialog').showModal();
  if(d.kind!=='reference')document.dispatchEvent(new CustomEvent('midnight:design-view',{detail:{designId:d.id}}));
 }
 function render(){
  const tokens=$('designSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean),votes=liked();
  let list=designs.map((d,index)=>({d,index})).filter(({d})=>(!theme||artworkThemes(d).includes(theme))&&tokens.every(t=>[d.name,d.description,d.category,...(d.tags||[]),...artworkThemes(d)].join(' ').toLowerCase().includes(t)));
  list.sort((a,b)=>{if($('designSort').value==='liked'){const diff=Number(votes[b.d.id]==='like')-Number(votes[a.d.id]==='like');if(diff)return diff;}const x=Date.parse(a.d.createdAt||''),y=Date.parse(b.d.createdAt||'');return Number.isFinite(x)&&Number.isFinite(y)?y-x:a.index-b.index;});
  window.midnightDesignVotes?.resetCardListeners();$('designGrid').replaceChildren();
  for(const {d} of list.slice(0,limit)){
   const card=node('article','artwork-card'),preview=node('button','art-card');preview.type='button';preview.setAttribute('aria-label','View design — '+d.name);
   const img=node('img');img.src=d.thumbnail||d.image;img.alt=d.name;img.loading='lazy';preview.append(img);preview.onclick=()=>open(d);
   card.append(preview,node('h3','',d.name));
   if(d.kind!=='reference'){const choose=node('a','btn outline','CHOOSE THIS DESIGN');choose.href='custom.html?design='+encodeURIComponent(d.id);card.append(choose);}
   else if(d.catalogDesign){const shop=node('a','btn outline','SHOP THIS DESIGN');shop.href=d.shopUrl;card.append(shop,node('p','notice','Product preview · '+d.productIds.length+' matching piece(s)'));}else card.append(node('p','notice','Inspiration reference'));
   const view=node('button','artwork-view','VIEW DESIGN');view.type='button';view.onclick=()=>open(d);card.append(view);
   const votes=window.midnightDesignVotes?.controls(d);if(votes){card.append(votes);const rate=node('button','artwork-rate','Rate artwork');rate.type='button';rate.onclick=()=>{open(d);$('ratingSection').scrollIntoView({block:'start'});};card.append(rate);}
   $('designGrid').append(card);
  }
  if(!list.length)$('designGrid').append(node('p','notice','No artwork matches this search. Try another theme or phrase.'));
  $('designCount').textContent='Showing '+Math.min(limit,list.length)+' of '+list.length+' designs'+(catalogUnavailable?' · Product designs could not refresh. Reload to retry.':'');$('moreDesigns').hidden=limit>=list.length;$('designSortNote').hidden=$('designSort').value!=='liked';
  for(const b of $('designThemes').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.theme===theme));
  const url=new URL(location.href);for(const [key,value] of [['theme',theme],['q',$('designSearch').value.trim()],['sort',$('designSort').value==='liked'?'liked':'']])if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);history.replaceState(history.state,'',url);
 }
 $('designSearch').oninput=()=>{limit=batch;render();};$('designSort').onchange=()=>{limit=batch;render();};$('moreDesigns').onclick=()=>{limit+=batch;render();};$('closeDesign').onclick=()=>$('designDialog').close();
 // Refresh the liked ordering after a customer changes a preference.
 $('designSort').addEventListener('focus',()=>{if($('designSort').value==='liked')render();});
 render();
})();
