const key=value=>String(value||'').trim().toLowerCase();
const allOverName=value=>/\ball[\s\-\u2010-\u2015]+over[\s\-\u2010-\u2015]+(?:print|synthetic|cotton)\b/i.test(String(value||''));

// Resolve the actual supplier method before requesting its native print files.
// A product title and a sublimation method on their own do not prove AOP.
export function supplierTechnique(product,details,requested='default'){
 if(requested!=='default')return requested;
 const methods=details?.techniques||[],type=key(details?.type||product?.type);
 if(type==='direct-to-fabric'&&methods.some(t=>t.key==='direct-to-fabric'))return 'direct-to-fabric';
 if(type==='cut-sew'||allOverName(product?.title)&&methods.some(t=>t.key==='cut-sew'))return 'cut-sew';
 if(methods.some(t=>t.key==='dtg'))return 'dtg';
 return methods.find(t=>t.is_default)?.key||'default';
}

export function garmentColorCapability(blueprint){
 if(blueprint?.source!=='live')return {mode:'hold',reason:'Live Printful color and coverage verification is required; a stored snapshot cannot prove garment coverage.'};
 const type=key(blueprint.catalogType),technique=key(blueprint.effectiveTechnique||blueprint.technique);
 // These supplier products print their canvas quarters and tongues. They are
 // not fabric-color garments, and their rubber, soles and laces are not panels.
 if([513,525].includes(Number(blueprint.catalogProductId))&&type==='shoes'&&technique==='sublimation'){
  const required=['shoe_quarters_left','shoe_quarters_right','shoe_tongue_left','shoe_tongue_right'],files=new Map((blueprint.printfiles?.printfiles||[]).map(f=>[f.printfile_id,f])),maps=blueprint.printfiles?.variant_printfiles||[];
  const verified=blueprint.variants?.length&&blueprint.variants.every(v=>{const m=maps.find(m=>m.variant_id===v.id);return m&&required.every(p=>{const f=files.get(m.placements?.[p]);return f&&['width','height','dpi'].every(k=>Number.isFinite(f[k])&&f[k]>0);});});
  return verified?{mode:'print',technique,scope:'canvas-panels',coverage:'Only the supplier-mapped canvas quarters and tongues. Soles, rubber, laces and hardware are not printed or recolored.'}:{mode:'hold',reason:'Verify every selected canvas shoe variant’s native quarter and tongue print files before production.'};
 }
 const aopMethod=technique==='direct-to-fabric'&&type==='direct-to-fabric'&&allOverName(blueprint.name)||technique==='cut-sew'||type==='cut-sew'&&['default','digital','sublimation'].includes(technique)||allOverName(blueprint.name)&&technique==='sublimation';
 if(aopMethod)return {mode:'print',technique,coverage:'Only the exact variant’s supplier print panels; hardware, seams and unprintable surfaces are not recolored.'};
 if(type==='cut-sew'||allOverName(blueprint.name))return {mode:'hold',reason:'Printful has not verified an all-over-print method for this product. Full garment coverage cannot be promised.'};
 return {mode:'fabric',technique,coverage:'Select the actual supplier fabric color; artwork affects only the assigned print areas.'};
}

export function fabricColorMatches(variant,color){return key(variant?.color)===key(color);}
