'use strict';
// Join by supplier identity only: an outfit neighbour is never a preview fallback.
window.MidnightMadeMedia={
 images(row,index={}){
  const saved=index.products?.[String(row.supplierId)];
  const urls=[...(saved?.photos||[]).map(p=>({url:new URL(p.image,'https://midnight-designs.store/').href,label:p.label||p.view||'Product view'})),...(row.made?.mockupStatus?.images||[]).map(p=>({url:p.url,label:p.title||'Saved mockup'}))];
  for(const url of [saved?.originalImage,row.made?.thumb])if(url)urls.push({url,label:'Supplier preview'});
  return [...new Map(urls.filter(p=>{try{return ['https:','http:'].includes(new URL(p.url,location.origin).protocol);}catch{return false;}}).map(p=>[p.url,p])).values()];
 },
 state(row,publishedIds){return row.supplierId&&publishedIds.has(String(row.supplierId))?'published':row.state||'waiting';},
 async load(){
  const read=async file=>{const r=await fetch('https://midnight-designs.store/'+file,{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Store images are temporarily unavailable.');return r.json();};
  const [photos,store]=await Promise.allSettled([read('product-photos.json'),read('products.json')]);
  return {photos:photos.status==='fulfilled'?photos.value:{products:{}},publishedIds:new Set(store.status==='fulfilled'?(store.value.products||[]).map(p=>String(p.id)):[]),unavailable:photos.status==='rejected'};
 }
};
