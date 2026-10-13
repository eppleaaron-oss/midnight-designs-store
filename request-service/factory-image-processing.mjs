import sharp from 'sharp';

const MAX_PIXELS=16_000_000;
const hold=message=>{throw Object.assign(Error(message),{status:409});};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const rgba=(data,i)=>[data[i*4],data[i*4+1],data[i*4+2],data[i*4+3]];
function number(v,fallback,min,max,name){v=v??fallback;if(!Number.isFinite(v)||v<min||v>max)hold('Invalid '+name+'.');return v;}
async function decoded(data){
 const image=sharp(data,{limitInputPixels:MAX_PIXELS,failOn:'warning'}),meta=await image.metadata();
 if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1)hold('Use a single PNG, JPEG or WebP artwork image.');
 return image.autoOrient().ensureAlpha().raw().toBuffer({resolveWithObject:true});
}
function border(info){const result=[];for(let x=0;x<info.width;x++){result.push(x);if(info.height>1)result.push((info.height-1)*info.width+x);}for(let y=1;y<info.height-1;y++){result.push(y*info.width);if(info.width>1)result.push(y*info.width+info.width-1);}return result;}
function background(data,info,tolerance){
 const edge=border(info),buckets=new Map();let opaque=0;
 for(const i of edge){const c=rgba(data,i);if(c[3]<32)continue;opaque++;const k=c.slice(0,3).map(n=>Math.floor(n/16)).join(':');const b=buckets.get(k)||{count:0,sum:[0,0,0]};b.count++;for(let j=0;j<3;j++)b.sum[j]+=c[j];buckets.set(k,b);}
 if(!opaque)return {color:null,uniform:true,confidence:1};
 const top=[...buckets.values()].sort((a,b)=>b.count-a.count)[0],color=top.sum.map(n=>Math.round(n/top.count));
 const matching=edge.filter(i=>data[i*4+3]<32||distance(rgba(data,i),color)<=tolerance).length;
 return {color,uniform:matching/edge.length>=.85,confidence:matching/edge.length};
}
// Only edge-connected background is removed; isolated pale features are retained.
function connectedMask(data,info,color,tolerance){
 const count=info.width*info.height,seen=new Uint8Array(count),queue=new Uint32Array(count);let head=0,tail=0;
 const add=i=>{if(i<0||i>=count||seen[i])return;seen[i]=1;if(data[i*4+3]<32||color&&distance(rgba(data,i),color)<=tolerance)queue[tail++]=i;};
 for(const i of border(info))add(i);
 while(head<tail){const i=queue[head++],x=i%info.width;add(i-info.width);add(i+info.width);if(x)add(i-1);if(x<info.width-1)add(i+1);}
 const mask=new Uint8Array(count);for(let i=0;i<tail;i++)mask[queue[i]]=1;return mask;
}
export async function analyzeArtwork(data,{tolerance=35}={}){
 number(tolerance,35,0,150,'background tolerance');
 const meta=await sharp(data,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1)hold('Use a single PNG, JPEG or WebP artwork image.');
 const {data:sample,info}=await sharp(data,{limitInputPixels:MAX_PIXELS}).autoOrient().resize(256,256,{fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const bg=background(sample,info,tolerance),mask=connectedMask(sample,info,bg.color,tolerance);let transparent=0,foreground=0,minX=info.width,minY=info.height,maxX=-1,maxY=-1;
 for(let i=0;i<mask.length;i++){if(sample[i*4+3]<255)transparent++;if(!mask[i]&&sample[i*4+3]>32){foreground++;const x=i%info.width,y=Math.floor(i/info.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
 const width=[5,6,7,8].includes(meta.orientation)?meta.height:meta.width,height=[5,6,7,8].includes(meta.orientation)?meta.width:meta.height;
 return {width,height,format:meta.format,background:{color:bg.color?('#'+bg.color.map(n=>n.toString(16).padStart(2,'0')).join('')):null,flat:bg.uniform,confidence:bg.confidence,transparentFraction:transparent/mask.length},subject:foreground?{kind:'foreground estimate',bounds:{x:Math.floor(minX*width/info.width),y:Math.floor(minY*height/info.height),width:Math.ceil((maxX-minX+1)*width/info.width),height:Math.ceil((maxY-minY+1)*height/info.height)},sampleFraction:foreground/mask.length}:null,method:'Border-color analysis and edge-connected foreground estimation; this is not semantic subject recognition.',warnings:bg.uniform?[]:['Complex background: use a reviewed AI edit rather than flat-color removal.']};
}
export function validateEditPermissions(recipe,permissions){
 if(!permissions.reuse)hold('Allow Reuse for this artwork before editing.');
 if(recipe.protect===true&&(recipe.removeBackground||recipe.recolor||recipe.creative||recipe.resize))hold('Disable pixel protection before changing artwork.');
 if((recipe.removeBackground||recipe.resize)&&!permissions.modify)hold('Background removal or resizing requires Modify permission.');
 if(recipe.recolor&&!permissions.recolor)hold('Recoloring requires Recolor permission.');
 // A generative provider can change subject colors and framing despite a prompt.
 if(recipe.creative&&(!permissions.modify||!permissions.recolor||!permissions.crop))hold('Creative AI edits require Modify, Recolor and Crop permission. Protected artwork cannot be sent for creative changes.');
}
export async function deterministicEdit(data,recipe,permissions){
 validateEditPermissions(recipe,permissions);let result=Buffer.from(data);const analysis=await analyzeArtwork(data,{tolerance:recipe.tolerance??35});
 if(recipe.removeBackground){
  const {data:pixels,info}=await decoded(result),bg=background(pixels,info,number(recipe.tolerance,35,0,150,'background tolerance'));
  if(!bg.uniform)hold('Background is not a reliable flat color. Choose an AI edit or revise the background-removal instructions.');
  const mask=connectedMask(pixels,info,bg.color,recipe.tolerance??35);let subject=0;
  for(let i=0;i<mask.length;i++){if(mask[i])pixels[i*4+3]=0;else if(pixels[i*4+3]>32)subject++;}
  if(!subject)hold('No distinct subject was found. The original was preserved; review the image before removing its background.');
  result=await sharp(pixels,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 }
 let image=sharp(result,{limitInputPixels:MAX_PIXELS}).autoOrient();
 if(recipe.recolor){if(!/^#[a-f0-9]{6}$/i.test(recipe.recolor))hold('Choose a six-digit hex recolor value.');image=image.tint(recipe.recolor);}
 if(recipe.resize){const {width,height}=recipe.resize;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_PIXELS)hold('Choose resize dimensions within 16 million pixels.');image=image.resize(width,height,{fit:'inside',withoutEnlargement:true});}
 return {data:await image.png().toBuffer(),analysis};
}
