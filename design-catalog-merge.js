(function(root){
'use strict';
// Only the public, owner-approved storefront catalog is an eligible source.
function mergeDesignCatalog(artworks,products){
 const groups=new Map();
 for(const p of products){
  if(!p||!p.id||!p.image||!Array.isArray(p.variants)||!p.variants.length||p.published===false||p.approved===false||['draft','rejected','failed','pending'].includes(p.status))continue;
  const collection=p.collectionName||(p.collections||[])[0]||'';
  const key=collection?'collection:'+collection.toLowerCase():'product:'+p.id;
  if(!groups.has(key))groups.set(key,{id:'catalog-'+encodeURIComponent(key),name:collection||p.name,image:p.image,thumbnail:p.image,category:'Available on clothing',kind:'reference',catalogDesign:true,productIds:[],tags:[],shopUrl:collection?'shop.html?collection='+encodeURIComponent(collection):'products/'+encodeURIComponent(p.id)+'.html'});
  const d=groups.get(key);d.productIds.push(String(p.id));d.tags.push(p.name,p.category||'');
  // Prefer the original source garment over an accessory when available.
  if(String(p.id)===String(p.sourceProductId)||(!d.hero&&['hoodies','jackets'].includes(p.categoryId))){d.image=p.image;d.thumbnail=p.image;d.hero=true;}
 }
 return [...groups.values(),...artworks];
}
if(typeof module==='object'&&module.exports)module.exports={mergeDesignCatalog};else root.mergeDesignCatalog=mergeDesignCatalog;
})(globalThis);
