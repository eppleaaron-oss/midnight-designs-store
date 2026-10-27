'use strict';
// Join by supplier identity only: an outfit neighbour is never a preview fallback.
window.MidnightMadeMedia={
 images(row,index={}){
  const saved=index.products?.[String(row.supplierId)];
  const edited=!!saved?.studioRevision&&saved.photos?.length>0;
  const urls=[...(saved?.photos||[]).map(p=>({url:new URL(p.image,'https://midnight-designs.store/').href,label:p.label||p.view||'Product view'})),...(edited?[]:row.made?.mockupStatus?.images||[]).map(p=>({url:p.url,label:p.title||'Saved mockup'}))];
  for(const url of edited?[]:[saved?.originalImage,row.made?.thumb])if(url)urls.push({url,label:'Supplier preview'});
  return [...new Map(urls.filter(p=>{try{return ['https:','http:'].includes(new URL(p.url,location.origin).protocol);}catch{return false;}}).map(p=>[p.url,p])).values()];
 },
 state(row,publishedIds){return row.supplierId&&publishedIds.has(String(row.supplierId))?'published':row.state||'waiting';},
 async load(){
  try{
   const r=await fetch('/api/owner/ai-factory/product-editor/media',{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Saved photos unavailable');const d=await r.json();
   return {photos:d.photos||{products:{}},publishedIds:new Set(d.publishedIds||[]),unavailable:d.unavailable===true};
  }catch{return {photos:{products:{}},publishedIds:new Set(),unavailable:true};}
 }
};
