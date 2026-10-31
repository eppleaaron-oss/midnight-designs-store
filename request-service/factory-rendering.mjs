import {assertSavedMappingApproval} from './factory-approved-mapping.mjs';
import {assertComposition} from './factory-placement-playbook.mjs';
import {artworkBounds,visibleGeometry} from './factory-artwork-bounds.mjs';
import {MAX_NATIVE_PIXELS} from './factory-placement-regions.mjs';
import {recipeIds,sourceProof} from './factory-render-proof.mjs';
import {assertBrandingPlacement} from './factory-branding.mjs';
import {checkedArtwork} from './factory-artwork-permissions.mjs';
import sharp from 'sharp';
import {createDeflate,inflateSync,crc32} from 'node:zlib';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {printFileLimits} from './factory-storage.mjs';
import {variantAreas} from './factory-blueprints.mjs';
import {garmentColorCapability,fabricColorMatches} from './factory-color.mjs';

const MAX_PIXELS=40_000_000,MAX_FILE=25*1024*1024;
const hash=data=>createHash('sha256').update(data).digest('hex');
const error=message=>{throw Object.assign(Error(message),{status:409});};
export const garmentColors={'Black':'#000000','Charcoal':'#36454f','Heather grey':'#9a9a9a','White':'#ffffff','Cream':'#fffdd0','Navy':'#000080','Forest green':'#228b22','Maroon':'#800000','Red':'#ff0000','Purple':'#800080'};
const colors=garmentColors;
const zone=s=>String(s).replace(/_dtfabric$/,'').replace(/-/g,'_').replace(/^left_sleeve$/,'sleeve_left').replace(/^right_sleeve$/,'sleeve_right').replace(/^left_leg$/,'leg_left').replace(/^right_leg$/,'leg_right');
function number(value,fallback,min,max,label){const n=value??fallback;if(!Number.isFinite(n)||n<min||n>max)error('Invalid '+label+'.');return n;}
function background(value){if(value===null)return {r:0,g:0,b:0,alpha:0};const c=colors[value]||value;if(typeof c!=='string'||!/^#[a-f0-9]{6}$/i.test(c))error('Choose a garment fill color.');return c;}

// Assemble a native PNG from small independently composited strips. No full
// native RGBA frame is retained while other queue jobs and backups use memory.
function pngChunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length,0);b.write(type,4,4,'ascii');data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,8+data.length)),8+data.length);return b;}
async function renderNativeBands(width,height,dpi,bg,overlays){
 const records=[];for(const o of overlays){if(o.resize){records.push(o);continue;}const m=await sharp(o.input).metadata();records.push({...o,width:m.width,height:m.height});}
 const stride=width*4,bandHeight=Math.max(1,Math.floor(1_000_000/width));
 async function* scanlines(){for(let y=0;y<height;y+=bandHeight){const h=Math.min(bandHeight,height-y),inputs=[];
  for(const o of records){const top=Math.max(y,o.top),bottom=Math.min(y+h,o.top+o.height);if(bottom<=top)continue;
   const input=o.resize?await sharp(o.input).resize(o.resize.width,o.resize.height,{fit:'fill'}).extract({left:o.sourceLeft,top:o.sourceTop+top-o.top,width:o.width,height:bottom-top}).png({compressionLevel:1}).toBuffer():top===o.top&&bottom===o.top+o.height?o.input:await sharp(o.input).extract({left:0,top:top-o.top,width:o.width,height:bottom-top}).png({compressionLevel:1}).toBuffer();
   inputs.push({input,left:o.left,top:top-y,...(o.blend?{blend:o.blend}:{})});
  }
  const png=await sharp({create:{width,height:h,channels:4,background:bg}}).composite(inputs).ensureAlpha().png({compressionLevel:1,adaptiveFiltering:true,palette:false}).toBuffer();
  if(png[24]!==8||png[25]!==6||png[28]!==0)error('Native strip encoder returned an unsupported PNG format.');
  const idat=[];for(let at=8;at<png.length;){const n=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')idat.push(png.subarray(at+8,at+8+n));at+=n+12;}
  const rows=inflateSync(Buffer.concat(idat),{maxOutputLength:(stride+1)*h});if(rows.length!==(stride+1)*h)error('Native print strip dimensions did not match.');
  // A strip's first filtered row assumes an all-zero previous row. Rebase
  // only that row to None so the combined PNG has exact pixels at joins.
  const filter=rows[0];if(filter>4)error('Native print strip has an invalid filter.');for(let x=0;x<stride;x++){const left=x>=4?rows[1+x-4]:0;if(filter===1||filter===4)rows[1+x]=(rows[1+x]+left)&255;else if(filter===3)rows[1+x]=(rows[1+x]+Math.floor(left/2))&255;}rows[0]=0;
  yield rows;
 }}
 async function encode(level){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const phys=Buffer.alloc(9),density=Math.round(dpi/0.0254);phys.writeUInt32BE(density,0);phys.writeUInt32BE(density,4);phys[8]=1;
  const parts=[Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('pHYs',phys)];let size=parts.reduce((n,b)=>n+b.length,0);
  await pipeline(Readable.from(scanlines(),{objectMode:false,highWaterMark:65536}),createDeflate({level}),async chunks=>{for await(const data of chunks){const part=pngChunk('IDAT',data);size+=part.length;if(size+12>MAX_FILE)throw Object.assign(Error('Rendered PNG exceeds the 25 MB print-file limit.'),{status:409,printFileLimit:true});parts.push(part);}});
  parts.push(pngChunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
 }
 try{return await encode(1);}catch(e){if(!e.printFileLimit)throw e;return encode(6);}
}

// Render real pixels. DPI is checked against source resolution, before enlarging the output canvas.
export async function renderArea(area,source,recipe={},permissions={},renderOptions={}){
 const {width,height,dpi}=area;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_NATIVE_PIXELS||!Number.isFinite(dpi)||dpi<1)error('This native print area is missing dimensions/DPI or exceeds the supported native rendering limit.');
 const bg=background(Object.hasOwn(recipe,'background')?recipe.background:'Black'),overlays=[];
 // Manual edits on the small backend favor lossless encode speed. This
 // changes PNG compression only, not resolution, colors, alpha or placement.
 const pngOptions=renderOptions.preserveLayerOrder?{compressionLevel:1}:{};
 let effectiveDpi=null;
 for(const input of Array.isArray(source)?source:source?[{data:source,recipe,permissions}]:[]){
  const {data:source,recipe,permissions}=input;
  if(permissions.reuse!==true)error('Allow Reuse for this artwork before rendering.');
  const sourceImage=sharp(source,{limitInputPixels:MAX_PIXELS,failOn:'warning'});
  const original=await sourceImage.metadata();if(!['png','jpeg','webp'].includes(original.format)||original.pages>1)error('Use a single PNG, JPEG or WebP artwork image.');
  const oriented=await sourceImage.autoOrient().png(pngOptions).toBuffer();const meta=await sharp(oriented).metadata();
  const crop=recipe.crop||{},cx=number(crop.x,0,0,99,'crop X'),cy=number(crop.y,0,0,99,'crop Y'),cw=number(crop.width,100,1,100,'crop width'),ch=number(crop.height,100,1,100,'crop height');
  const left=Math.floor(meta.width*cx/100),top=Math.floor(meta.height*cy/100),sw=Math.min(meta.width-left,Math.max(1,Math.round(meta.width*cw/100))),sh=Math.min(meta.height-top,Math.max(1,Math.round(meta.height*ch/100)));
  const fit=recipe.fit??'contain';if(!['contain','cover'].includes(fit))error('Choose contain or cover; artwork proportions are preserved.');
  const scale=number(recipe.scale,100,1,400,'artwork scale')/100,angle=number(recipe.rotation,0,-180,180,'rotation'),x=number(recipe.x,0,-100,100,'position X')/100,y=number(recipe.y,0,-100,100,'position Y')/100;
  const mirror=recipe.mirror===true,tile=recipe.tile===true,spacing=number(recipe.spacing,0,0,200,'pattern spacing')/100;
  if((left||top||sw<meta.width||sh<meta.height||fit==='cover')&&(permissions.crop!==true||recipe.protect===true))error('Cropping requires Crop permission and pixel protection switched off.');
  if((mirror||angle)&&(permissions.modify!==true||recipe.protect===true))error('Mirroring or rotation requires Modify permission and pixel protection switched off.');
  if(recipe.recolor!==undefined&&recipe.recolor!==null&&(permissions.recolor!==true||recipe.protect===true))error('Recoloring requires Recolor permission and pixel protection switched off.');
  const requestedRatio=(fit==='cover'?Math.max(width/sw,height/sh):Math.min(width/sw,height/sh))*scale;
  const ratio=recipe.withoutEnlargement===true?Math.min(1,requestedRatio):requestedRatio;
  let w=Math.max(1,Math.round(sw*ratio)),h=Math.max(1,Math.round(sh*ratio));
  const geometry=recipe.geometry;
  if(geometry){
   if(geometry.canvasWidth!==width||geometry.canvasHeight!==height||geometry.dpi!==dpi||![geometry.width,geometry.height,geometry.x,geometry.y].every(Number.isSafeInteger)||geometry.width<1||geometry.height<1)error('The saved numeric layout does not match this native canvas. Inspect the garment again.');
   w=geometry.width;h=geometry.height;
   if(Math.abs(w*sh-h*sw)>Math.max(sw,sh)*1.5)error('The numeric layout would distort the original artwork.');
   if(geometry.contentBounds){const b=geometry.contentBounds,actual=await artworkBounds(oriented);if(bg!=='#000000'||left||top||sw!==meta.width||sh!==meta.height||b.sourceWidth!==meta.width||b.sourceHeight!==meta.height||!actual||JSON.stringify(actual)!==JSON.stringify({x:b.x,y:b.y,width:b.width,height:b.height}))error('Visible-artwork measurement does not match the preserved original or black print background.');}
   const safe=geometry.safeRect,visible=visibleGeometry(geometry);if(!safe||!['x','y','width','height'].every(k=>Number.isFinite(safe[k]))||visible.x<safe.x-1||visible.y<safe.y-1||visible.x+visible.width>safe.x+safe.width+1||visible.y+visible.height>safe.y+safe.height+1)error('The saved artwork extends outside its reviewed safe region.');
  }
  // Large manual sleeve graphics often have substantial exact-black padding.
  // Render only their canvas intersection instead of encoding an oversized
  // padded overlay. libvips evaluates resize/extract as a bounded image region.
  const windowed=w*h>MAX_PIXELS&&renderOptions.preserveLayerOrder&&geometry?.contentBounds&&!angle&&!mirror&&!tile&&recipe.recolor==null;
  if(w*h>MAX_PIXELS&&!windowed)error('Scaled artwork exceeds the rendering limit.');
  const sourceDpi=Math.min(sw/w,sh/h)*dpi;effectiveDpi=Math.min(effectiveDpi??Infinity,sourceDpi);
  if(sourceDpi+1<dpi&&renderOptions.allowLowResolution!==true)error(`Source resolution is too low: ${Math.floor(effectiveDpi)} effective DPI; ${dpi} DPI is required. Use higher-resolution artwork or reduce its scale.`);
  if(windowed){
   const l=geometry.x,t=geometry.y,a=Math.max(0,l),b=Math.max(0,t),r=Math.min(width,l+w),bottom=Math.min(height,t+h),v=visibleGeometry(geometry);
   if(r<=a||bottom<=b)error('Artwork is entirely outside the print area.');
   const fits=v.x>=0&&v.y>=0&&v.x+v.width<=width&&v.y+v.height<=height;
   if(!fits&&(permissions.crop!==true||recipe.protect===true))error('This position clips artwork. Allow Crop and disable pixel protection, or keep it inside the print area.');
   // Let each final strip request its exact window directly from the original
   // resize. Holding large intermediate PNG bands and decoding them for every
   // small strip wastes memory and CPU on native pants canvases.
   if(width*height>MAX_PIXELS){overlays.push({input:oriented,left:a,top:b,width:r-a,height:bottom-b,resize:{width:w,height:h},sourceLeft:a-l,sourceTop:b-t});continue;}
   // The supplier's valid native canvas can exceed the per-overlay budget.
   // Export disjoint bands from the SAME resize, preserving sample alignment,
   // black padding, alpha and layer order without allocating a giant overlay.
   const bandHeight=Math.max(1,Math.floor(16_000_000/(r-a)));
   for(let bandTop=b;bandTop<bottom;bandTop+=bandHeight){
    const input=await sharp(oriented).resize(w,h,{fit:'fill'}).extract({left:a-l,top:bandTop-t,width:r-a,height:Math.min(bandHeight,bottom-bandTop)}).png(pngOptions).toBuffer();
    overlays.push({input,left:a,top:bandTop});
   }
   continue;
  }
  let image=sharp(oriented).extract({left,top,width:sw,height:sh}).resize(w,h,{fit:'fill'});
  if(recipe.recolor!==undefined&&recipe.recolor!==null)image=image.tint(background(recipe.recolor));
  if(mirror)image=image.flop();if(angle)image=image.rotate(angle,{background:{r:0,g:0,b:0,alpha:0}});
  const rendered=await image.png(pngOptions).toBuffer({resolveWithObject:true}),rw=rendered.info.width,rh=rendered.info.height;
  const centerX=geometry?geometry.x+w/2:width*(.5+x),centerY=geometry?geometry.y+h/2:height*(.5+y),dx=Math.max(1,Math.round(w*(1+spacing))),dy=Math.max(1,Math.round(h*(1+spacing)));
  const nx=tile?Math.ceil((width+rw+Math.abs(centerX-width/2)*2)/dx):0,ny=tile?Math.ceil((height+rh+Math.abs(centerY-height/2)*2)/dy):0;
  if((2*nx+1)*(2*ny+1)>400)error('Pattern has too many tiles. Increase artwork size or spacing.');
  for(let ix=-nx;ix<=nx;ix++)for(let iy=-ny;iy<=ny;iy++){
   const l=Math.round(centerX+ix*dx-rw/2),t=Math.round(centerY+iy*dy-rh/2),a=Math.max(0,l),b=Math.max(0,t),r=Math.min(width,l+rw),bottom=Math.min(height,t+rh);
   if(r<=a||bottom<=b)continue;
   const clipped=l<0||t<0||l+rw>width||t+rh>height;
   const visible=geometry?.contentBounds&&!angle&&!mirror&&!tile?visibleGeometry(geometry):null;
   const paddingOnly=visible&&visible.x>=0&&visible.y>=0&&visible.x+visible.width<=width&&visible.y+visible.height<=height;
   if(clipped&&!paddingOnly&&(permissions.crop!==true||recipe.protect===true))error('This position, pattern or rotation clips artwork. Allow Crop and disable pixel protection, or keep it inside the print area.');
   const input=clipped?await sharp(rendered.data).extract({left:a-l,top:b-t,width:r-a,height:bottom-b}).png(pngOptions).toBuffer():rendered.data;
   overlays.push({input,left:a,top:b,...(geometry?.contentBounds&&!renderOptions.preserveLayerOrder?{blend:'lighten'}:{})});
  }
  if(!overlays.length)error('Artwork is entirely outside the print area.');
 }
 if(renderOptions.preserveLayerOrder&&width*height>MAX_PIXELS){const data=await renderNativeBands(width,height,dpi,bg,overlays);return {data,width,height,effectiveDpi,sha256:hash(data)};}
 const output=sharp({create:{width,height,channels:4,background:bg}}).composite(overlays).withMetadata({density:dpi});let data=await output.clone().png(pngOptions).toBuffer();
 if(data.length>MAX_FILE&&renderOptions.preserveLayerOrder)data=await output.png({compressionLevel:6}).toBuffer();
 if(data.length>MAX_FILE)error('Rendered PNG exceeds the 25 MB print-file limit.');
 return {data,width,height,effectiveDpi,sha256:hash(data)};
}

export function factoryRendering({db,auth,body,send,fail,limit,origin,plans=JSON.parse(readFileSync(new URL('../printful-plans.json',import.meta.url),'utf8')),artworkEngine=null,blueprints=null,manager=null}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_render_plans(job TEXT PRIMARY KEY,plan TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_render_files(file TEXT PRIMARY KEY,signature TEXT NOT NULL,recipe TEXT NOT NULL,source_sha TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_render_quality(file TEXT PRIMARY KEY,signature TEXT NOT NULL,required_dpi INTEGER NOT NULL,effective_dpi REAL);`);
 if(!db.prepare('PRAGMA table_info(factory_render_files)').all().some(c=>c.name==='pixel_signature'))db.exec('ALTER TABLE factory_render_files ADD COLUMN pixel_signature TEXT');
 db.exec('CREATE INDEX IF NOT EXISTS factory_render_pixel_signature ON factory_render_files(pixel_signature)');
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a),now=()=>new Date().toISOString(),fileLimits=printFileLimits();let busy=false,editor=null,pipeline=null,diagnostics=null,basic=null;
 function saveRunPlan(job,c,slot,art,placementPlan){pipeline?.configureRun(job,c.qc);
  const map=new Map(art.map(a=>[a.name,a.id]));if((placementPlan||[]).some(p=>p.artwork&&!map.has(p.artwork)))error('A named artwork in the placement plan is missing.');
  const assignments=(placementPlan||[]).map(p=>({zone:zone(p.zone),artworkId:p.artwork?map.get(p.artwork):null}));
  if(!assignments.length)for(const a of art){const row=get('SELECT placements FROM factory_artwork WHERE id=?',a.id);for(const z of JSON.parse(row?.placements||'[]'))if(!assignments.some(p=>p.zone===zone(z)))assignments.push({zone:zone(z),artworkId:a.id});}
  run('INSERT OR REPLACE INTO factory_render_plans VALUES(?,?,?)',job,JSON.stringify({mappingPolicyRequired:true,garmentColor:slot.color,background:colors[slot.color],fit:['cover','fill'].includes(c.placement.fill)?'cover':'contain',mirrorSleeves:c.placement.mirrorSleeves,continueAcrossPanels:c.placement.continueAcrossPanels,strictAssignments:!!placementPlan?.length,assignments,artworkEdits:editor?.rules()}),now());
  // Each generated product owns its print-file sets; another run cannot replace these job's files.
  const profile=get('SELECT templates FROM factory_job_profiles WHERE job=?',job),ids=JSON.parse(profile?.templates||'[]');
  if(ids.length){if(get('SELECT count(*) n FROM factory_print_drafts').n+ids.length>500)error('Blueprint limit reached. Archive unused sets before starting another run.');const fresh=ids.map(id=>{const d=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!d)error('Assigned blueprint is missing.');const copy=randomUUID();run('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)',copy,d.title,d.product,d.variant,d.technique,d.areas,d.source,now());return copy;});run('UPDATE factory_job_profiles SET templates=? WHERE job=?',JSON.stringify(fresh),job);
   const products=[...new Set(fresh.map(id=>get('SELECT product FROM factory_print_drafts WHERE id=?',id).product))];
   if(products.length===1){const selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job).selection);selection.product=products[0];selection.variantIds=fresh.map(id=>get('SELECT variant FROM factory_print_drafts WHERE id=?',id).variant);run('UPDATE factory_job_audiences SET selection=? WHERE job=?',JSON.stringify(selection),job);}
  }
 }
 function inputs(draftId,plan,allowedIds,job=null){
  const d=get('SELECT * FROM factory_print_drafts WHERE id=?',draftId);if(!d)error('Save the exact supplier variant blueprint first.');
  if(!/^(default|dtg|digital|cut-sew|sublimation|direct-to-fabric)$/i.test(d.technique))error('This printing method requires a dedicated print-file renderer.');
  const areas=JSON.parse(d.areas),placements=plan.placements;
  if(!placements||typeof placements!=='object'||Array.isArray(placements)||!Object.keys(placements).length)error('Choose at least one native print area.');
  return Object.entries(placements).map(([placement,r])=>{
   const area=areas.find(a=>a.placement===placement);if(!area)error('Unsupported placement for this saved variant: '+placement+'.');
   if(!r||typeof r!=='object')error('Choose artwork or an explicit fill-only recipe for each area.');
   if(r.elements&&(!Array.isArray(r.elements)||r.elements.length<1||r.elements.length>8||r.artworkId||r.fillOnly||r.elements.some(e=>!e?.artworkId||!e.geometry||e.elements||e.tile)))error('Choose one to eight inspected artwork elements for this panel.');
   const rows=recipeIds(r).map(id=>checkedArtwork(db,id));assertComposition(db,r,rows);
   for(const a of rows){assertBrandingPlacement(db,job,placement,a);if(allowedIds&&!allowedIds.includes(a.id))error('Artwork is not assigned to this job.');if(a.product!==null&&a.product!==undefined&&a.product!==d.product)error('Artwork is restricted to a different product.');}
   if(!rows.length&&r.fillOnly!==true)error('This area needs artwork or an explicit fill-only choice.');
   const a=rows[0]||null,recipe={...r,background:Object.hasOwn(plan,'background')?plan.background:'Black'},proof=sourceProof(recipe,rows),signature=hash(JSON.stringify([d.product,d.variant,d.technique,area,recipe,proof.sha,proof.permissions]));
   const pixelSignature=hash(JSON.stringify([d.product,d.technique,area,recipe,proof.sha,proof.permissions]));return {d,area,a,rows,proof,recipe,signature,pixelSignature};
  });
 }
 async function prepare(requests){
  if(busy)throw Object.assign(Error('The print renderer is busy. Retry when the current product finishes.'),{status:429});busy=true;
  try{
   const work=requests.flatMap(r=>inputs(r.draft,r.plan,r.allowedIds,r.job)),pending=[],storedBytes=get('SELECT COALESCE(sum(length(data)),0) bytes FROM factory_print_files').bytes;let renderedBytes=0;
   for(const x of work){const cached=get('SELECT f.id,f.sha256,f.data FROM factory_render_files r JOIN factory_print_files f ON f.id=r.file WHERE r.signature=? AND f.draft=? AND f.placement=? AND f.id=(SELECT id FROM factory_print_files WHERE draft=? AND placement=? ORDER BY created DESC,rowid DESC LIMIT 1)',x.signature,x.d.id,x.area.placement,x.d.id,x.area.placement);if(cached&&get('SELECT file FROM factory_render_quality WHERE file=?',cached.id)&&hash(Buffer.from(cached.data))===cached.sha256){pending.push({...x,cached});continue;}
    const read=a=>{const data=Buffer.from(get('SELECT data FROM factory_artwork WHERE id=?',a.id).data);if(hash(data)!==a.sha256)error('The original artwork checksum changed. Restore its original version before rendering.');return data;};
    const source=x.recipe.elements?x.rows.map((a,i)=>({data:read(a),recipe:x.recipe.elements[i],permissions:a.effectivePermissions})):x.a?read(x.a):null;
    // Reuse pixels only when native area, full recipe, source proof and current
    // permissions match exactly. Variant-specific file and QC records stay separate.
    const sibling=get('SELECT f.data,f.sha256,q.effective_dpi FROM factory_render_files r JOIN factory_print_files f ON f.id=r.file JOIN factory_render_quality q ON q.file=f.id AND q.signature=r.signature WHERE r.pixel_signature=? AND f.width=? AND f.height=? AND length(f.data)>0 LIMIT 1',x.pixelSignature,x.area.width,x.area.height);
    const reused=!!sibling&&hash(Buffer.from(sibling.data))===sibling.sha256;
    const result=reused?{data:Buffer.from(sibling.data),sha256:sibling.sha256,width:x.area.width,height:x.area.height,effectiveDpi:sibling.effective_dpi}:await renderArea(x.area,source,x.recipe,x.a?x.a.effectivePermissions:{});x.reusedPixels=reused;renderedBytes+=result.data.length;if(renderedBytes>64*1024*1024)error('This rendering batch exceeds 64 MB. Prepare smaller variant sets to stay within the renderer memory budget.');if(storedBytes+renderedBytes>fileLimits.bytes)error('Print-file storage limit reached. Increase the configured quota only after confirming free persistent disk capacity.');pending.push({...x,result,placeholder:cached&&cached.data.length===0?cached.id:null,expectedSha:cached?.sha256});}
   // Recheck permissions and draft changes after asynchronous rendering before storing any of the batch.
   const checked=requests.flatMap(r=>inputs(r.draft,r.plan,r.allowedIds,r.job));if(checked.some((x,i)=>x.signature!==work[i].signature))error('Artwork permissions or blueprint changed during rendering. Retry with the updated settings.');
   const newFiles=pending.filter(x=>!x.cached),bytes=newFiles.reduce((n,x)=>n+x.result.data.length,0);
   if(get('SELECT count(*) n,COALESCE(sum(length(data)),0) bytes FROM factory_print_files').n+newFiles.filter(x=>!x.placeholder).length>fileLimits.files||get('SELECT COALESCE(sum(length(data)),0) bytes FROM factory_print_files').bytes+bytes>fileLimits.bytes)error('Print-file storage limit reached. Increase the configured quota only after confirming free persistent disk capacity.');
   db.exec('BEGIN IMMEDIATE');try{for(const x of newFiles){if(x.placeholder&&x.result.sha256!==x.expectedSha)error('Recovered print pixels do not match the saved recipe checksum. Review this tracked item.');const id=x.placeholder||randomUUID();run('INSERT INTO factory_print_files VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,sha256=excluded.sha256',id,x.d.id,x.area.placement,x.result.width,x.result.height,x.result.data,x.result.sha256,now());run('INSERT OR REPLACE INTO factory_render_files(file,signature,recipe,source_sha,created,pixel_signature) VALUES(?,?,?,?,?,?)',id,x.signature,JSON.stringify(x.recipe),x.proof.sha,now(),x.pixelSignature);run('INSERT OR REPLACE INTO factory_render_quality VALUES(?,?,?,?)',id,x.signature,x.area.dpi,Number.isFinite(x.result.effectiveDpi)?x.result.effectiveDpi:null);x.id=id;}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   return {rendered:newFiles.length,reusedPixels:newFiles.filter(x=>x.reusedPixels).length,files:pending.map(x=>({id:x.id||x.cached.id,draft:x.d.id,placement:x.area.placement,width:x.area.width,height:x.area.height,sha256:x.result?.sha256||x.cached.sha256,url:'/api/owner/ai-factory/blueprints/file/'+(x.id||x.cached.id)})),reviewRequired:true};
  }finally{busy=false;}
 }
 async function resolveJobColor(job){
  const row=get('SELECT plan FROM factory_render_plans WHERE job=?',job);if(!row)return null;
  const plan=JSON.parse(row.plan),selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job)?.selection||'null');
  if(!selection?.product||!blueprints)error('Live Printful verification is required before choosing garment color or promising all-over-print coverage.');
  const live=await blueprints.load(selection.product,'default'),capability=garmentColorCapability(live);
  if(capability.mode==='hold')error(capability.reason);
  if(plan.colorMode&&plan.colorMode!==capability.mode)error('The live supplier method no longer matches this job’s color mode. Review the product before continuing.');
  const color=selection.garmentColor||plan.garmentColor||(Object.hasOwn(colors,plan.background||'')?plan.background:Object.keys(colors).find(c=>colors[c]===plan.background));
  if(!color)error('Choose an explicit garment or print-background color.');
  const supplier=manager?await manager.productDetails(selection.product):live;
  const available=supplier.variants.filter(v=>!v.is_discontinued&&v.in_stock!==false&&!['discontinued','out_of_stock','temporary_out_of_stock'].includes(v.availability_status));
  const ids=JSON.parse(get('SELECT templates FROM factory_job_profiles WHERE job=?',job)?.templates||'[]'),updates=[];
  if(!ids.length)error('Assign exact native-area blueprints before choosing the garment color.');
  for(const id of ids){
   const d=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!d||d.product!==selection.product)error('Saved blueprints do not match the selected product.');
   const original=live.variants.find(v=>v.id===d.variant);
   let variant=available.find(v=>v.id===d.variant);
   if(capability.mode==='fabric'&&!fabricColorMatches(variant,color))variant=available.find(v=>v.size===original?.size&&fabricColorMatches(v,color));
   if(!variant)error('Printful has no available '+color+' fabric variant for the selected size; a white garment will not be substituted.');
   let areas;try{areas=variantAreas(live,variant.id);}catch(e){error(e.message);}
   const requested=plan.numericLayout?Object.keys(plan.numericLayout.variants.find(v=>v.variant===d.variant)?.placements||{}).map(zone):plan.placements?Object.entries(plan.placements).filter(([,r])=>r.artworkId).map(([placement])=>zone(placement)):plan.strictAssignments?plan.assignments.filter(p=>p.artworkId).map(p=>p.zone):[];if(requested.some(p=>!areas.some(a=>zone(a.placement)===p)))error('Artwork was assigned to an unsupported placement for this exact variant.');
   const recipeFor=a=>plan.placements?.[a.placement]||plan.assignments?.find(p=>p.zone===zone(a.placement));
   areas=areas.filter(a=>!/^label/.test(a.placement)||recipeFor(a)?.artworkId);
   if(capability.mode==='fabric')areas=areas.filter(a=>recipeFor(a)?.artworkId);
   if(!areas.length)error('This exact variant has no supported artwork placements.');
   const technique=live.effectiveTechnique||live.technique;
   if(d.variant!==variant.id||d.technique!==technique||d.areas!==JSON.stringify(areas)||d.source!=='live'){
    if(get('SELECT count(*) n FROM factory_print_files WHERE draft=?',id).n)error('Supplier geometry or garment color changed after print files were prepared. Create a replacement draft before continuing.');
    updates.push({id,variant:variant.id,technique,areas:JSON.stringify(areas)});
   }
  }
  const variantIds=ids.map(id=>updates.find(d=>d.id===id)?.variant||get('SELECT variant FROM factory_print_drafts WHERE id=?',id).variant);
  if(new Set(variantIds).size!==variantIds.length)error('The garment color would create duplicate size variants. Review the selected blueprint set.');
  const nextSelection={...selection,variantIds,garmentColor:color,colorMode:capability.mode},nextPlan={...plan,garmentColor:color,colorMode:capability.mode,colorCapability:capability,background:capability.mode==='fabric'?null:colors[color]||plan.background};
  db.exec('BEGIN IMMEDIATE');try{for(const d of updates)run("UPDATE factory_print_drafts SET variant=?,technique=?,areas=?,source='live' WHERE id=?",d.variant,d.technique,d.areas,d.id);run('UPDATE factory_job_audiences SET selection=? WHERE job=?',JSON.stringify(nextSelection),job);run('UPDATE factory_render_plans SET plan=? WHERE job=?',JSON.stringify(nextPlan),job);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return nextSelection;
 }
 async function renderJob(job){
  const admission=get('SELECT plan FROM factory_render_plans WHERE job=?',job);if(admission)assertSavedMappingApproval(db,JSON.parse(admission.plan));
  await (diagnostics?diagnostics.withStage('garment-color',()=>resolveJobColor(job)):resolveJobColor(job));
  const row=get('SELECT plan FROM factory_render_plans WHERE job=?',job);if(!row)return null;let plan=JSON.parse(row.plan);assertSavedMappingApproval(db,plan);if(plan.continueAcrossPanels)error('Cross-panel continuity needs a reviewed layout. Switch off Continue artwork across panels for independent-area rendering.');
  let selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job)?.selection||'null');
  const ids=JSON.parse(get('SELECT templates FROM factory_job_profiles WHERE job=?',job)?.templates||'[]');if(!ids.length)error('Assign a product and exact native-area blueprints before rendering.');
  if(plan.artworkEdits?.enabled){if(!editor)error('Artwork editor is unavailable.');const result=await (diagnostics?diagnostics.withStage('artwork-edited',()=>editor.prepareJob(job,plan,ids,selection)):editor.prepareJob(job,plan,ids,selection));if(result.defer)return result;plan=result.plan;selection=result.selection;}
  if(plan.aiLayout){if(!artworkEngine)error('Connect the AI artwork planner before using AI layout mode.');plan=await (diagnostics?diagnostics.withStage('artwork-analyzed',()=>artworkEngine.plan(job,plan,ids,selection)):artworkEngine.plan(job,plan,ids,selection));}
  const requests=ids.map(id=>{const draft=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!draft||draft.product!==selection?.product)error('Saved blueprints do not match the selected product.');
   if(plan.numericLayout){const saved=plan.numericLayout.variants.find(v=>v.variant===draft.variant);if(!saved||JSON.stringify(saved.areas.map(a=>[a.placement,a.printfile_id,a.width,a.height,a.dpi,a.template||null]))!==JSON.stringify(JSON.parse(draft.areas).map(a=>[a.placement,a.printfile_id,a.width,a.height,a.dpi,a.template||null])))error('The saved layout template no longer matches this variant. Inspect a new product recipe.');return {job,draft:id,plan:{background:plan.numericLayout.background,placements:saved.placements},allowedIds:selection.artworkIds};}
   if(plan.placements){const placements=Object.fromEntries(JSON.parse(draft.areas).map(a=>[a.placement,plan.placements[a.placement]||(plan.colorMode==='print'?{fillOnly:true}:null)]));return {job,draft:id,plan:{background:plan.background,placements},allowedIds:selection.artworkIds};}
   const placements={};for(const a of JSON.parse(draft.areas)){const match=plan.assignments.find(p=>p.zone===zone(a.placement))||(plan.colorMode==='print'?{artworkId:null}:null);if(!match)error('No explicit artwork or empty-placement decision for '+a.placement+'. Review the garment placement plan.');
    placements[a.placement]={artworkId:match.artworkId,fillOnly:!match.artworkId,fit:plan.fit,scale:match.scale,mirror:plan.mirrorSleeves&&zone(a.placement)==='sleeve_right'&&plan.assignments.find(p=>p.zone==='sleeve_left')?.artworkId===match.artworkId};}
   return {job,draft:id,plan:{background:plan.background,placements},allowedIds:selection.artworkIds};});
  // Save each native area independently. A full product can exceed an in-memory
  // atomic batch; matching saved recipes let interrupted jobs resume safely.
  const result={rendered:0,reusedPixels:0,files:[],reviewRequired:true},sliceStarted=Date.now();let processed=0;const total=requests.reduce((n,r)=>n+Object.keys(r.plan.placements).length,0);
  for(const request of requests)for(const [placement,recipe] of Object.entries(request.plan.placements)){
   const saved=await prepare([{...request,plan:{...request.plan,placements:{[placement]:recipe}}}]);result.rendered+=saved.rendered;result.reusedPixels+=saved.reusedPixels||0;result.files.push(...saved.files);processed++;if(basic?.workspaceReady(job)&&processed<total&&(result.rendered-result.reusedPixels>=8||result.rendered-result.reusedPixels>0&&Date.now()-sliceStarted>=30000))return {...result,defer:true,note:'Saving this item’s completed print areas before continuing the timed rendering slice.'};
  }
  return result;
 }
 return {setBasic(b){basic=b;},setDiagnostics(d){diagnostics=d;},setPipeline(p){pipeline=p;},setEditor(e){editor=e;},artworkRules:()=>editor?.rules()||{enabled:false},savePlan(job,plan){run('INSERT OR REPLACE INTO factory_render_plans VALUES(?,?,?)',job,JSON.stringify(plan),now());},saveRunPlan,resolveJobColor,renderJob,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/rendering'))return false;auth(req,null,true);
  if(method==='GET'&&path==='/api/owner/ai-factory/rendering'){send(res,200,{limits:fileLimits,usage:get('SELECT count(*) files,COALESCE(sum(length(data)),0) bytes FROM factory_print_files'),artworkPlanner:artworkEngine?.readiness()||null});return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-rendering',10);const b=await body(req);
  const draft=path.match(/^\/api\/owner\/ai-factory\/rendering\/draft\/([a-f0-9-]{36})$/);
  if(draft){send(res,200,await prepare([{draft:draft[1],plan:b}]));return true;}
  fail(404,'Rendering action not found.');
 }};
}
