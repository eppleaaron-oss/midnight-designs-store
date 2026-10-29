'use strict';
// Group the supplier's available garment types into useful shopping racks.
function browseCategory(p){return MidnightCatalog.category(p);}
function browseNewest(a,b){return Number(b.id)-Number(a.id)||String(b.id).localeCompare(String(a.id));}
window.MidnightBrowse=({products,renderProducts,productPrice,activeVariant})=>{
 const $=id=>document.getElementById(id),grid=$('grid'),pageSize=12;
 const fields={q:'search',type:'category',size:'sizeFilter',color:'colorFilter',palette:'paletteFilter',collection:'collectionFilter',availability:'availabilityFilter',sort:'sort'};
 let shown=pageSize,matches=[];
 const newestIds=new Set([...products].sort(browseNewest).slice(0,12).map(p=>p.id));
 function addOption(id,value){const o=document.createElement('option');o.value=value;o.textContent=value;$(id).append(o);}
 const categories=Object.values(MidnightCatalog.categories).filter(c=>products.some(p=>browseCategory(p)===c));
 for(const c of categories)addOption('category',c);
 const sizes=['2XS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','S/M','M/L','One size'];
 const actual=[...new Set(products.flatMap(p=>p.variants.map(v=>v.size)).filter(Boolean))];
 actual.sort(MidnightCatalog.compareSizes);
 for(const size of actual)addOption('sizeFilter',size);
 for(const [id,values] of [['colorFilter',products.flatMap(p=>p.variants.map(v=>v.color))],['paletteFilter',products.flatMap(p=>p.artworkColors||[])],['collectionFilter',products.flatMap(p=>p.collections||[])]])for(const v of [...new Set(values.filter(Boolean))].sort())addOption(id,v);
 $('categoryTabs').replaceChildren();
 const outfitTab=document.createElement('a');outfitTab.href='outfits.html';outfitTab.textContent='Outfits';$('categoryTabs').append(outfitTab);
 for(const category of ['',...categories]){
  const a=document.createElement('a');a.textContent=category||'All';a.href=category?'shop.html?type='+encodeURIComponent(category):'shop.html';a.dataset.type=category;
  a.onclick=e=>{e.preventDefault();$('category').value=category;apply();};$('categoryTabs').append(a);
 }
 function restore(){
  const params=new URLSearchParams(location.search);
  for(const [key,id] of Object.entries(fields)){
   const value=params.get(key)||(id==='sort'?'newest':'');
   // Retain older bookmarked supplier category links.
   const aliases={Sweatshirts:'Crewnecks',footwear:'Shoes',facewear:'Face coverings'};
   const normalized=id==='category'?(aliases[value]||value):value;
   $(id).value=id==='search'?value:[...$(id).options].some(o=>o.value===normalized)?normalized:$(id).options[0].value;
  }
  const count=Number(params.get('shown'));shown=Number.isInteger(count)&&count>=pageSize?Math.min(count,products.length||pageSize):pageSize;
 }
 function writeUrl(){
  const url=new URL(location.href);
  for(const [key,id] of Object.entries(fields)){const value=$(id).value;if(value&&!(id==='sort'&&value==='newest'))url.searchParams.set(key,value);else url.searchParams.delete(key);}
  if(shown>pageSize)url.searchParams.set('shown',String(shown));else url.searchParams.delete('shown');
  history.replaceState(history.state,'',url);
 }
 function filtered(){
  const terms=$('search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let list=products.filter(p=>{
   const text=[p.name,p.description,p.category,browseCategory(p),...(p.collections||[]),...(p.artworkColors||[]),...p.variants.flatMap(v=>[v.name,v.size,v.color])].join(' ').toLowerCase();
   if(terms.some(t=>!text.includes(t))||($('category').value&&browseCategory(p)!==$('category').value))return false;
   if($('collectionFilter').value&&!(p.collections||[]).includes($('collectionFilter').value))return false;
   if($('paletteFilter').value&&!(p.artworkColors||[]).includes($('paletteFilter').value))return false;
   const variantFilter=!!($('sizeFilter').value||$('colorFilter').value);
   const variants=p.variants.filter(v=>(!$('sizeFilter').value||v.size===$('sizeFilter').value)&&(!$('colorFilter').value||v.color===$('colorFilter').value));
   if(variantFilter&&!variants.length)return false;
   if($('availabilityFilter').value==='available')return variants.some(activeVariant);
   if($('availabilityFilter').value==='unavailable')return variants.some(v=>!activeVariant(v))||(!variantFilter&&!p.variants.length);
   return true;
  });
  const sort=$('sort').value;
  if(sort==='newest')list.sort(browseNewest);
  if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort==='low'||sort==='high')list.sort((a,b)=>{const x=productPrice(a,true),y=productPrice(b,true);return x===null?(y===null?0:1):y===null?-1:(sort==='low'?1:-1)*(x-y);});
  return list;
 }
 function decorate(){for(const card of grid.querySelectorAll('.product-card'))if(newestIds.has(card.dataset.productId)&&!card.querySelector('.new-label')){const badge=document.createElement('span');badge.className='new-label';badge.textContent='New';card.append(badge);}}
 function progress(){
  const systems=[...new Set(products.filter(p=>browseCategory(p)==='Shoes').map(p=>p.sizeSystem).filter(Boolean))];for(const o of $('sizeFilter').options)if(o.value)o.textContent=$('category').value==='Shoes'&&systems.length===1&&/^\d+(?:\.\d+)?$/.test(o.value)?systems[0]+' '+o.value:o.value;
  const count=Math.min(shown,matches.length);$('catalogStatus').textContent=matches.length+' '+(matches.length===1?'piece':'pieces');
  $('browseProgress').textContent='Showing '+count+' of '+matches.length+' pieces';$('loadMore').hidden=count>=matches.length;
  for(const a of $('categoryTabs').querySelectorAll('a')){if(a.dataset.type===$('category').value)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  for(const a of document.querySelectorAll('[data-collection]')){if(a.dataset.collection===$('collectionFilter').value)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');}
  const active=['sizeFilter','colorFilter','paletteFilter','collectionFilter','availabilityFilter'].filter(id=>$(id).value).length;
  $('browseFilters').textContent=active?'Filters · '+active:'Filters +';
  $('clearFilters').disabled=!Object.values(fields).some(id=>$(id).value&&!(id==='sort'&&$(id).value==='newest'));
 }
 function apply(write=true,reset=true){if(reset)shown=pageSize;matches=filtered();renderProducts(grid,matches.slice(0,shown));decorate();progress();if(write)writeUrl();}
 $('loadMore').onclick=()=>{
  const old=shown;shown=Math.min(shown+pageSize,matches.length);
  const temp=document.createElement('div');temp.dataset.catalog='true';renderProducts(temp,matches.slice(old,shown));grid.append(...temp.children);decorate();progress();writeUrl();
 };
 for(const id of Object.values(fields))$(id).addEventListener(id==='search'?'input':'change',()=>apply());
 for(const a of document.querySelectorAll('[data-collection]'))a.onclick=e=>{e.preventDefault();$('collectionFilter').value=a.dataset.collection;apply();};
 $('clearFilters').onclick=()=>{for(const id of Object.values(fields))$(id).value=id==='sort'?'newest':'';apply();};
 $('browseFilters').onclick=()=>{const open=$('filterPanel').hidden;$('filterPanel').hidden=!open;$('browseFilters').setAttribute('aria-expanded',String(open));};
 window.addEventListener('popstate',()=>{restore();apply(false,false);});
 window.addEventListener('pagehide',()=>{try{sessionStorage.setItem('midnightBrowseReturn',JSON.stringify({url:location.href,y:scrollY}));}catch{}});
 restore();apply(false,false);
 if(performance.getEntriesByType('navigation')[0]?.type==='back_forward')try{const saved=JSON.parse(sessionStorage.getItem('midnightBrowseReturn')||'null');if(saved?.url===location.href)requestAnimationFrame(()=>scrollTo(0,saved.y));}catch{}
};
