// Publication receipts identify an explicitly approved immutable release, not a supplier existence check.
export function ownerApproved(product){
 const a=product?.publicationApproval;
 return a?.state==='approved'&&a.revision===(product.studioRevision||product.factoryExternalId)&&typeof a.revision==='string'&&a.revision.length>0;
}
export function importApproved(product,previous){
 if(product?.publicationApproval)return ownerApproved(product);
 // Preserve pre-policy releases already on the public store. This cannot approve a new revision or ID.
 return !!previous&&String(previous.id)===String(product?.id)&&previous.factoryExternalId===product.factoryExternalId&&previous.studioRevision===product.studioRevision;
}
