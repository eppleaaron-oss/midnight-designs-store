export function compatiblePrintArea(a,b){return !!a&&!!b&&a.width===b.width&&a.height===b.height&&a.dpi===b.dpi;}
export function productUpdateTarget(product,publishedIds=new Set()){
 return product.state==='published'||publishedIds.has(String(product.supplierId))?'store':'mockups';
}
export function canPublishSavedUpdate(job,revision,dirty){
 return !dirty&&job?.state==='completed'&&job.target==='mockups'&&job.printfulUpdated&&job.images?.length>0&&job.revision===revision;
}
export function draftSaveStatus(status,revision,{currentRevision=revision,busy=false,dirty=false}={}){
 if(currentRevision!==revision||busy||dirty)return 'obsolete';
 if(status.revision!==revision)return 'changed';
 if(status.recovery?.confirmedRevision>=revision)return 'confirmed';
 return status.recovery?.error?'failed':'pending';
}
export function editorBlockReason(busy,job,hasLayer,hasSource=true){
 if(busy)return 'An editor action is in progress. Wait for it to finish.';
 if(hasLayer&&!hasSource)return 'Saved artwork is unavailable. Replace it from the library or remove this layer; its saved layout is retained.';
 if(!hasLayer)return 'Select Edit artwork, choose an original image, or upload artwork to enable layer controls.';
 return job&&!['completed','cancelled','failed'].includes(job.state)?'A previous update is still running'+(job.error?': '+job.error:'.')+' You can edit and Save app draft now. Finish waits for that tracked update to settle.':'';
}

export async function finishSavedDraft({source,revision,document,target,confirmPublication,dirty,api,onSaved=()=>{}}){
 try{
  // Finish saves the validated draft and production job together. Saving first
  // starts an unnecessary full backup before the job can be recorded.
  const result=await api('finish',{source,revision,document,target,confirmPublication});onSaved(result);return result;
 }catch(e){
  // A known validation failure must still preserve the owner's panel edits.
  // A lost response is uncertain: retain local edits and do not invent a new
  // save revision over a Finish that may already have been accepted.
  if(dirty&&e.status>=400&&e.status<500){try{const saved=await api('save',{source,revision,document});onSaved(saved);e.message='Draft revision '+saved.revision+' stored in the app. Update did not complete: '+e.message;}catch(saveError){e.message+=' Your unsaved edits remain in this editor. Draft save: '+saveError.message;}}
  else if(dirty)e.message+=' Update response is unconfirmed. Your edits remain in this editor; reopen the product to check its tracked update before submitting again.';
  throw e;
 }
}

export function addDesignLayers(panel,designs,area,{replace=false}={}){
 const next=structuredClone(panel),kept=replace?[]:next.layers;
 if(!designs.length||kept.length+designs.length>8)throw Error('Use up to eight designs per panel. Remove a design or choose another placement.');
 if(designs.some(a=>!a.asset||!(a.width>0)||!(a.height>0)))throw Error('Wait for the original artwork to load.');
 const columns=designs.length>1?Math.ceil(Math.sqrt(designs.length)):1,rows=Math.ceil(designs.length/columns);
 next.layers=[...kept,...designs.map((a,i)=>({asset:a.asset,x:(i%columns+.5)/columns,y:(Math.floor(i/columns)+.5)/rows,width:Math.max(.001,Math.min(.65/columns,.65/rows*area.height/area.width*a.width/a.height,a.width/area.width)),rotation:0,mirror:false,allowModify:false}))];
 return next;
}
