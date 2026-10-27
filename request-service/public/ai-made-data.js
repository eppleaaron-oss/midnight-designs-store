'use strict';
// Join by supplier identity only: an outfit neighbour is never a preview fallback.
window.MidnightMadeMedia={
 placement(label){const name=String(label||'').toLowerCase().replaceAll(' ','_');return name.match(/^(front|back|sleeve_left|sleeve_right|left_sleeve|right_sleeve|hood|pocket|default)(?:_(?:dtfabric|dtg|embroidery|sublimation))?(?=$|[·_])/)?name.match(/^(front|back|sleeve_left|sleeve_right|left_sleeve|right_sleeve|hood|pocket|default)/)[0]:null;},
 images(row,index={}){
  const saved=index.products?.[String(row.supplierId)];
  const edited=!!saved?.studioRevision&&saved.photos?.length>0;
  const urls=[...(saved?.photos||[]).map(p=>({url:new URL(p.image,'https://midnight-designs.store/').href,label:p.label||p.view||'Product view'})),...(edited?[]:row.made?.mockupStatus?.images||[]).map(p=>({url:p.url,label:p.title||'Saved mockup'}))];
  for(const url of edited?[]:[saved?.originalImage,row.made?.thumb])if(url)urls.push({url,label:'Supplier preview'});
  return [...new Map(urls.filter(p=>{try{return ['https:','http:'].includes(new URL(p.url,location.origin).protocol);}catch{return false;}}).map(p=>[p.url,p])).values()];
 },
 updateStatus(update){if(!update)return '';const j=update.job;if(!j||j.revision!==update.draftRevision)return 'Draft saved — not applied to Printful';if(j.state==='completed')return j.storeUpdated?'':'Printful updated — not published to store';if(j.state==='failed')return 'Update failed — '+(j.error||'Open the editor for details');return 'Update in progress — '+j.state.replaceAll('_',' ')+(j.error?' · '+j.error:'');},
 photoNote(row,index={}){return row.update?.job?.id&&index.products?.[String(row.supplierId)]?.studioRevision===row.update.job.id?'These photos show the completed Printful mockups for this update.':'These photos are from the last finished update; they do not confirm this draft.';},
 state(row,publishedIds){return row.supplierId&&publishedIds.has(String(row.supplierId))?'published':row.state||'waiting';},
 async load(){
  try{
   const r=await fetch('/api/owner/ai-factory/product-editor/media',{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Saved photos unavailable');const d=await r.json();
   return {photos:d.photos||{products:{}},publishedIds:new Set(d.publishedIds||[]),unavailable:d.unavailable===true};
  }catch{return {photos:{products:{}},publishedIds:new Set(),unavailable:true};}
 }
};
