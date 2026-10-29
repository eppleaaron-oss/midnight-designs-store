export function compatiblePrintArea(a,b){return !!a&&!!b&&a.width===b.width&&a.height===b.height&&a.dpi===b.dpi;}
export function productUpdateTarget(product,publishedIds=new Set()){
 return 'mockups';
}
export function canPublishSavedUpdate(job,revision,dirty){
 return !dirty&&job?.revision===revision&&(job.state==='completed'&&job.target==='mockups'&&job.images?.length>0||job.state==='failed'&&job.target==='store'&&!job.ownerApproved&&/Explicit owner approval/.test(job.error||''));
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

// Shared by the browser preview and native print renderer. Changes only the
// edge-connected flat background, never an enclosed dark detail or original.
export function removeArtworkBackground(pixels,width,height,tolerance=35){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40_000_000||pixels.length!==width*height*4)throw Error('Use artwork within 40 million pixels.');
 if(!Number.isFinite(tolerance)||tolerance<0||tolerance>150)throw Error('Choose background strength between 0 and 150.');
 const edge=[];for(let x=0;x<width;x++){edge.push(x);if(height>1)edge.push((height-1)*width+x);}for(let y=1;y<height-1;y++){edge.push(y*width);if(width>1)edge.push(y*width+width-1);}
 const buckets=new Map();for(const i of edge){const n=i*4;if(pixels[n+3]<32)continue;const k=(pixels[n]>>4)*256+(pixels[n+1]>>4)*16+(pixels[n+2]>>4),b=buckets.get(k)||{count:0,sum:[0,0,0]};b.count++;for(let j=0;j<3;j++)b.sum[j]+=pixels[n+j];buckets.set(k,b);}
 const top=[...buckets.values()].sort((a,b)=>b.count-a.count)[0],color=top?top.sum.map(n=>Math.round(n/top.count)):null,t2=tolerance*tolerance;
 const matches=i=>{const n=i*4;return pixels[n+3]<32||color&&((pixels[n]-color[0])**2+(pixels[n+1]-color[1])**2+(pixels[n+2]-color[2])**2<=t2);};
 if(edge.filter(matches).length/edge.length<.85)throw Error('This background has several colors or scenery. Solid-background removal cannot safely isolate it. Your original is unchanged.');
 // Scanline flood fill uses one byte per pixel and a span stack rather than a
 // full-size integer queue, keeping large artwork within the free backend.
 const seen=new Uint8Array(width*height),stack=[];let removed=0;
 const seed=i=>{if(!seen[i]&&matches(i)){seen[i]=1;stack.push(i);}};
 for(const i of edge)seed(i);
 while(stack.length){const i=stack.pop();if(seen[i]===2)continue;const y=Math.floor(i/width),row=y*width;let left=i%width,right=left;
  while(left>0&&seen[row+left-1]!==2&&matches(row+left-1))left--;
  while(right+1<width&&seen[row+right+1]!==2&&matches(row+right+1))right++;
  let up=false,down=false;for(let x=left;x<=right;x++){const at=row+x;seen[at]=2;if(pixels[at*4+3])removed++;pixels[at*4+3]=0;const above=y>0&&seen[at-width]!==2&&matches(at-width),below=y+1<height&&seen[at+width]!==2&&matches(at+width);if(above&&!up)seed(at-width);if(below&&!down)seed(at+width);up=above;down=below;}
 }
 let subject=false,minX=width,minY=height,maxX=-1,maxY=-1;for(let i=0;i<width*height;i++){const at=i*4;if(pixels[at+3]>32)subject=true;if(pixels[at+3]&&(pixels[at]||pixels[at+1]||pixels[at+2])){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
 if(!subject)throw Error('No distinct artwork remains at this strength. Lower it; your original is unchanged.');
 if(!removed)throw Error('No connected solid background was found. This image may already be transparent.');
 return {pixels,color,removed,contentBounds:maxX>=minX?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null};
}

// Hit testing follows the same rotation, mirroring and print proportions as drawing.
// Test uppermost layers first; transparent/black padding is excluded when measured.
export function designAtPoint(layers,area,assetFor,point){
 if(!point?.inside||!area?.width||!area?.height)return -1;
 for(let i=layers.length-1;i>=0;i--){
  const l=layers[i],s=assetFor(l);if(!s?.width||!s?.height)continue;
  const w=l.width*area.width,h=w*s.height/s.width;if(!(w>0&&h>0))continue;
  const dx=(point.x-l.x)*area.width,dy=(point.y-l.y)*area.height,r=(l.rotation||0)*Math.PI/180;
  let u=(dx*Math.cos(r)+dy*Math.sin(r))/w;const v=(-dx*Math.sin(r)+dy*Math.cos(r))/h;
  if(l.mirror)u=-u;const x=(u+.5)*s.width,y=(v+.5)*s.height,b=s.contentBounds||{x:0,y:0,width:s.width,height:s.height};
  if(x>=b.x&&x<=b.x+b.width&&y>=b.y&&y<=b.y+b.height)return i;
 }
 return -1;
}
export function deleteDesignLayer(panel,index){
 if(!Number.isInteger(index)||index<0||index>=panel.layers.length)throw Error('Select a design to delete.');
 const next=structuredClone(panel);next.layers.splice(index,1);return next;
}
