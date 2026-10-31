'use strict';
// Join by supplier identity only: an outfit neighbour is never a preview fallback.
window.MidnightMadeMedia={
 placement(label){const name=String(label||'').toLowerCase().replaceAll(' ','_');return name.match(/^(front|back|sleeve_left|sleeve_right|left_sleeve|right_sleeve|hood|pocket|default)(?:_(?:dtfabric|dtg|embroidery|sublimation))?(?=$|[·_])/)?name.match(/^(front|back|sleeve_left|sleeve_right|left_sleeve|right_sleeve|hood|pocket|default)/)[0]:null;},
 reviewState(row){
  const u=row.update,j=u?.job,hasDraft=!!u?.draftRevision;
  if(hasDraft&&(!j||j.revision!==u.draftRevision))return 'draft';
  if(j){if(j.state==='failed'||j.state==='cancelled')return 'needs_corrections';if(j.storeUpdated&&j.state==='completed')return row.state==='published'?'published':'approved';if(j.ownerApproved)return 'approved';if(j.state==='completed')return 'ready_for_review';return 'draft';}
  if(row.state==='published')return 'published';
  if(row.made?.error||/failed|blocked|error|rejected/.test(row.state))return 'needs_corrections';
  if(row.supplierId&&['supplier_created','awaiting_review','ready_for_review'].includes(row.state))return 'ready_for_review';
  return 'draft';
 },
 images(row,index={}){
  const saved=index.products?.[String(row.supplierId)];
  const edited=!!saved?.studioRevision&&saved.photos?.length>0;
  const urls=[...(saved?.photos||[]).map(p=>({url:new URL(p.image,'https://midnight-designs.store/').href,label:p.label||p.view||'Product view'})),...(edited?[]:row.made?.mockupStatus?.images||[]).map(p=>({url:p.url,label:p.title||'Saved mockup'}))];
  for(const url of edited?[]:[saved?.originalImage,row.made?.thumb])if(url)urls.push({url,label:'Supplier preview'});
  return [...new Map(urls.filter(p=>{try{return ['https:','http:'].includes(new URL(p.url,location.origin).protocol);}catch{return false;}}).map(p=>[p.url,p])).values()];
 },
 updateStatus(update){if(!update)return '';const j=update.job;if(!j||j.revision!==update.draftRevision)return 'Draft saved — not applied to Printful';if(j.state==='completed')return j.storeUpdated?'':j.printfulUpdated?'Printful updated — not published to store':'Private preview ready — awaiting your approval';if(j.state==='cancelled')return 'Private preview rejected or cancelled — not published';if(j.state==='failed')return 'Update failed — '+(j.error||'Open the editor for details');return 'Update in progress — '+j.state.replaceAll('_',' ')+(j.error?' · '+j.error:'');},
 photoNote(row,index={}){return row.update?.job?.id&&index.products?.[String(row.supplierId)]?.studioRevision===row.update.job.id?'These photos show the completed Printful mockups for this update.':'These photos are from the last finished update; they do not confirm this draft.';},
 state(row,publishedIds,verified=true){if(row.supplierId&&!verified)return 'publication_unverified';if(row.supplierId&&publishedIds.has(String(row.supplierId)))return 'published';return ['published','publication_unverified'].includes(row.state)?'supplier_created':row.state||'waiting';},
 async load(refresh=false){
  try{
   const r=await fetch('/api/owner/ai-factory/product-editor/media'+(refresh?'?refresh=1':''),{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Saved photos unavailable');const d=await r.json();
   return {photos:d.photos||{products:{}},publishedIds:new Set(d.publishedIds||[]),publicationVerified:d.publicationVerified===true,unavailable:d.unavailable===true};
  }catch{return {photos:{products:{}},publishedIds:new Set(),publicationVerified:false,unavailable:true};}
 }
};
