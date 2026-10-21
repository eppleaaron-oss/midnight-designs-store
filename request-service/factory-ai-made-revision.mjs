export function replacementPayload(detail,p,fileLink){
 const replacement=p.selection.replaceProduct;
 if(String(detail?.sync_product?.id)!==replacement.supplierId||detail.sync_product.external_id!==replacement.external)throw Error('The original Printful product changed. Review this revision again.');
 const variants=detail.sync_variants||[];
 if(variants.length!==p.files.length||variants.some(v=>!v.id||!p.files.some(d=>d.variant===v.variant_id)||v.product?.product_id!==p.selection.product))throw Error('Keep every original variant and the same garment when updating a product.');
 return {sync_product:{name:p.copy.title,external_id:'midnight-factory-'+p.j.id},sync_variants:variants.map(v=>{
  const d=p.files.find(d=>d.variant===v.variant_id),price=p.assessment.variants.find(x=>x.variant===d.variant);
  if(!price)throw Error('The revised variant price is missing.');
  return {id:v.id,variant_id:v.variant_id,retail_price:(price.priceCents/100).toFixed(2),files:d.areas.map(a=>({type:a.placement,url:fileLink(a.file)}))};
 })};
}
