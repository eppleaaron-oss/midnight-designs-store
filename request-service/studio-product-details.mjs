const categories=new Set(['hoodies','tees','long-sleeves','crewnecks','jackets','pants','shorts','leggings','bags','shoes','headwear','scarves','face-coverings','other']);
const reject=message=>{throw Object.assign(Error(message),{status:400});};
export function studioProductDetails(input,ids=null){
 if(!input||typeof input!=='object'||Array.isArray(input))reject('Enter product details.');
 const text=(v,max,name)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))reject('Invalid '+name+'.');return v.trim();};
 const name=text(input.name,180,'product name');if(!name)reject('Enter a product name.');
 const description=text(input.description,12000,'description');
 if(!categories.has(input.categoryId))reject('Choose a product category.');
 if(!Array.isArray(input.collections)||input.collections.length>12)reject('Choose up to twelve collections.');
 const collections=[...new Set(input.collections.map(v=>text(v,180,'collection')).filter(Boolean))];
 if(!input.variants||typeof input.variants!=='object'||Array.isArray(input.variants)||Object.keys(input.variants).length>100)reject('Invalid product variants.');
 const variants=Object.fromEntries(Object.entries(input.variants).map(([id,v])=>{if(!/^\d+$/.test(id)||!v||typeof v.enabled!=='boolean'||!Number.isFinite(v.price)||v.price<.01||v.price>1000||Math.abs(v.price*100-Math.round(v.price*100))>.00001)reject('Use a positive price with at most two decimals for each existing variant.');return [id,{price:v.price,enabled:v.enabled}];}));
 if(ids&&(ids.length!==Object.keys(variants).length||ids.some(id=>!variants[String(id)])))reject('Variant IDs must match this exact supplier product. Existing variants cannot be added, removed or remapped.');
 const photoList=(v,label)=>{if(!Array.isArray(v)||v.length>256||v.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_:]{1,100}$/.test(id)))reject('Invalid '+label+'.');return [...new Set(v)];};
 return {name,description,collections,categoryId:input.categoryId,variants,photoOrder:photoList(input.photoOrder||[],'photo order'),hiddenPhotos:photoList(input.hiddenPhotos||[],'hidden photos')};
}
export function orderedStudioPhotos(images,details){
 const id=i=>i.sha||i.asset,hidden=new Set(details?.hiddenPhotos||[]),rank=new Map((details?.photoOrder||[]).map((id,index)=>[id,index]));
 return images.filter(i=>!hidden.has(id(i))).map((image,index)=>({image,index})).sort((a,b)=>(rank.get(id(a.image))??1e6)-(rank.get(id(b.image))??1e6)||a.index-b.index).map(x=>x.image);
}
export function applyStudioDetails(product,details,supplier){
 if(!details)return product;
 const d=studioProductDetails(details,product.variants.map(v=>v.id));
 if(!d.description)reject('Enter a product description before publishing.');
 const variants=product.variants.map(v=>{const choice=d.variants[v.id],live=supplier.sync_variants.find(s=>String(s.id)===v.id);if(!live||Number(live.retail_price)!==choice.price)reject('Printful has not confirmed the approved variant price.');return {...v,price:choice.price,ownerAvailable:choice.enabled,availability:choice.enabled?(live.availability_status||v.availability):'unavailable'};});
 return {...product,name:d.name,description:d.description,collections:d.collections,collectionName:d.collections[0]||'',categoryId:d.categoryId,categoryOverride:d.categoryId,ownerEditedDetails:true,detailsRevision:product.studioRevision,variants};
}
