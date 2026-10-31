(function(root){
'use strict';
const privateKinds=new Set(['reference','mockup','product-mockup','print-panel','template-guide']);
function isOriginalArtwork(a){
 if(!a?.id||a.kind!=='artwork'||privateKinds.has(a.assetType)||a.visibility==='private'||a.approved===false)return false;
 return typeof a.image==='string'&&/^assets\/(designs|originals)\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(a.image);
}
function mergeDesignCatalog(artworks,products=[]){
 const families=new Map(),seen=new Map();
 for(const a of artworks){
  if(!isOriginalArtwork(a))continue;
  // Only an explicit family key groups distinct originals. Similar names or
  // colors are not evidence that two designs belong to the same hoodie.
  const key=String(a.familyId||a.designFamilyId||a.id),identity=(a.familyId||a.designFamilyId?key+':':'')+(a.sourceSha256||a.image);
  if(seen.has(identity)){const existing=seen.get(identity);existing.aliasIds=[...new Set([...(existing.aliasIds||[]),a.id])];continue;}
  const member={...a,sourceRole:a.sourceRole||'artwork'};seen.set(identity,member);
  if(!families.has(key))families.set(key,{...a,familyId:key,name:a.familyName||a.name,kind:'artwork',members:[],productIds:[],shopUrl:null});
  families.get(key).members.push(member);
 }
 for(const d of families.values()){
  const hero=d.members.find(a=>a.sourceRole==='front')||d.members[0];
  d.id=hero.id;d.image=hero.image;d.thumbnail=/^assets\/(designs|originals)\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(hero.thumbnail||'')?hero.thumbnail:hero.image;
  const artworkIds=new Set(d.members.flatMap(a=>[a.id,...(a.aliasIds||[])]));
  const matched=products.filter(p=>p?.id&&p.published!==false&&p.approved!==false&&!['draft','rejected','failed','pending','needs_corrections','hold'].includes(p.status)&&Array.isArray(p.variants)&&p.variants.length&&(
   [p.designFamilyId,p.artworkFamilyId,p.collectionId].some(id=>id!==undefined&&String(id)===d.familyId)||
   [...(p.designIds||[]),...(p.artworkIds||[])].some(id=>artworkIds.has(String(id)))||
   d.members.some(a=>a.sourceProductId!==undefined&&String(a.sourceProductId)===String(p.sourceProductId||p.id))));
  d.productIds=[...new Set(matched.map(p=>String(p.id)))];
  if(d.productIds.length){const collections=[...new Set(matched.map(p=>p.collectionName||(p.collections||[])[0]).filter(Boolean))];d.shopUrl=collections.length===1?'shop.html?collection='+encodeURIComponent(collections[0]):'shop.html?products='+encodeURIComponent(d.productIds.join(','));}
 }
 return [...families.values()];
}
if(typeof module==='object'&&module.exports)module.exports={mergeDesignCatalog,isOriginalArtwork};else {root.mergeDesignCatalog=mergeDesignCatalog;root.isOriginalArtwork=isOriginalArtwork;}
})(globalThis);
