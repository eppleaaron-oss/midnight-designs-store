import catalogIdentity from '../catalog-identity.js';
// Display metadata only; immutable recipes, job IDs and supplier receipts survive.
export function nameFactoryProduct(p){
 const product=catalogIdentity.normalize({...p,catalogProductId:p.choice?.product||p.catalogProductId,sourceProductId:p.choice?.setId||p.sourceProductId,outfitId:p.outfit||p.outfitId,collectionName:p.collection||p.collectionName});
 return {...product,collection:product.collectionName||p.collection};
}

export const compareFactorySizes=catalogIdentity.compareSizes;
