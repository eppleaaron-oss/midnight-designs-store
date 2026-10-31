const hold=message=>{throw Object.assign(Error(message),{status:409});};

export function assertSavedMappingApproval(db,plan){
 if(plan.mappingPolicyRequired===false||!plan.mappingPolicyRequired&&!plan.placementPolicy&&!plan.aiLayout&&!Array.isArray(plan.assignments))return;
 const approval=plan.numericLayout?.profileApproval;
 if(!approval||!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='factory_placement_examples'").get())hold('This queued AI product has no approved measured mapping. Review its exact product profile before rendering.');
 const row=db.prepare('SELECT * FROM factory_placement_examples WHERE id=?').get(approval.exampleId);
 const latest=row&&db.prepare('SELECT id,state FROM factory_placement_examples WHERE supplier=? ORDER BY created DESC,id DESC LIMIT 1').get(row.supplier);
 if(!row||row.state!=='approved'||row.revision!==approval.revision||latest?.id!==row.id)hold('The queued product’s measured profile was superseded, corrected or rejected. Review it before AI reuse.');
}

// Source roles (front/back/sleeves) are independent of physical print panels.
// Their relationship comes only from the owner's exact measured profile.
export async function loadApprovedMapping({product,blueprint,sizing,input=null}){
 const options=sizing.options(product,blueprint);
 const candidates=options.layouts.filter(l=>l.exampleId&&l.compatible);
 const requested=input?candidates.find(l=>l.number===input.number):null;
 const selected=input?requested:candidates.length===1?candidates[0]:null;
 if(!selected)hold(input?'This exact product, technique and selected sizes have no compatible approved placement profile.':'Choose one compatible owner-approved product profile. Missing or ambiguous profiles cannot use improvised placement.');
 if(selected.pattern)hold('Repeated artwork requires a separate approved mapping.');
 const request=input||{version:options.version,number:selected.number,scaleMode:'fixed'};
 if(request.scaleMode&&request.scaleMode!=='fixed'||Object.keys(request.overrides||{}).length)hold('AI reuse cannot override approved measurements. Save and approve a new product-specific profile.');
 for(const slot of selected.slots){
  if(!slot.part||!product.set.parts[slot.part])hold('The approved '+slot.id+' source artwork role is missing. No front/back or sleeve substitution is allowed.');
  if(Object.hasOwn(request.assignments||{},slot.id)&&request.assignments[slot.id]!==slot.part)hold('The source artwork role differs from the approved physical-panel mapping.');
 }
 const resolved=await sizing.resolve(product,blueprint,request);
 if(resolved.requiresAcceptance||resolved.reductions?.length)hold('The new artwork does not fit the approved profile unchanged. Review and approve its revised placement.');
 if(resolved.exampleId!==selected.exampleId)hold('The approved placement profile changed during inspection.');
 return {...resolved,profileApproval:{exampleId:selected.exampleId,revision:selected.revision,...(selected.approvedAt?{approvedAt:selected.approvedAt}:{}),...(selected.supplierProductId?{supplierProductId:selected.supplierProductId}:{})},sourceRoleMapping:selected.slots.map(s=>({slot:s.id,sourceArtworkRole:s.part,physicalPanel:s.placement}))};
}
