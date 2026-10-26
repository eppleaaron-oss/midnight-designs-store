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
 let saved=false;
 try{
  if(dirty){const result=await api('save',{source,revision,document});revision=result.revision;document=result.document;saved=true;onSaved(result);}
  return await api('finish',{source,revision,document,target,confirmPublication});
 }catch(e){if(saved)e.message='Draft revision '+revision+' stored in the app. Update did not complete: '+e.message;throw e;}
}
