export function compatiblePrintArea(a,b){return !!a&&!!b&&a.width===b.width&&a.height===b.height&&a.dpi===b.dpi;}
export function draftSaveStatus(status,revision){
 if(status.revision!==revision)return 'changed';
 if(status.recovery?.confirmedRevision>=revision)return 'confirmed';
 return status.recovery?.error?'failed':'pending';
}
export function editorBlockReason(busy,job,hasLayer,hasSource=true){
 if(busy)return 'An editor action is in progress. Wait for it to finish.';
 if(job&&!['completed','cancelled','failed'].includes(job.state))return 'This product update is running. Editing unlocks when it finishes or reports an error.';
 if(hasLayer&&!hasSource)return 'Saved artwork is unavailable. Replace it from the library or remove this layer; its saved layout is retained.';
 return hasLayer?'':'Select Edit artwork, choose an original image, or upload artwork to enable layer controls.';
}
