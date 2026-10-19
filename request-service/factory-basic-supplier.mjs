// Restricted to a finite owner-confirmed batch and its exact frozen recipes.
export function supplierOnlyItem(db,job){
 return db.prepare(`SELECT i.* FROM factory_basic_items i
 JOIN factory_basic_batch_items a ON a.item=i.id AND a.recipe_key=i.recipe_key
 JOIN factory_basic_batches b ON b.id=a.batch
 WHERE i.job=? AND b.target='printful' AND b.status<>'cancelled'
 AND EXISTS(SELECT 1 FROM factory_basic_outfit_pieces p,json_each(b.plans) plan
 WHERE p.outfit=plan.value AND p.item=i.id AND p.outfit=json_extract(i.recipe,'$.outfitId')
 AND json_extract(p.choice,'$.product')=json_extract(i.recipe,'$.product')
 AND json_extract(p.choice,'$.setId')=json_extract(i.recipe,'$.set.id'))`).get(job)||null;
}
