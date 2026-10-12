import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

const MAX_PIXELS=40_000_000,MAX_FILE=25*1024*1024;
const hash=data=>createHash('sha256').update(data).digest('hex');
const error=message=>{throw Object.assign(Error(message),{status:409});};
const colors={'Black':'#000000','Charcoal':'#36454f','Heather grey':'#9a9a9a','White':'#ffffff','Cream':'#fffdd0','Navy':'#000080','Forest green':'#228b22','Maroon':'#800000','Red':'#ff0000','Purple':'#800080'};
const zone=s=>String(s).replace(/_dtfabric$/,'').replace(/-/g,'_').replace(/^left_sleeve$/,'sleeve_left').replace(/^right_sleeve$/,'sleeve_right').replace(/^left_leg$/,'leg_left').replace(/^right_leg$/,'leg_right');
function number(value,fallback,min,max,label){const n=value??fallback;if(!Number.isFinite(n)||n<min||n>max)error('Invalid '+label+'.');return n;}
function background(value){if(value===null)return {r:0,g:0,b:0,alpha:0};const c=colors[value]||value;if(typeof c!=='string'||!/^#[a-f0-9]{6}$/i.test(c))error('Choose a garment fill color.');return c;}

// Render real pixels. DPI is checked against source resolution, before enlarging the output canvas.
export async function renderArea(area,source,recipe={},permissions={}){
 const {width,height,dpi}=area;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_PIXELS||!Number.isFinite(dpi)||dpi<1)error('This native print area is missing dimensions/DPI or exceeds the 40-million-pixel rendering limit.');
 const bg=background(Object.hasOwn(recipe,'background')?recipe.background:'Black'),overlays=[];
 let effectiveDpi=null;
 if(source){
  if(permissions.reuse!==true)error('Allow Reuse for this artwork before rendering.');
  const sourceImage=sharp(source,{limitInputPixels:MAX_PIXELS,failOn:'warning'});
  const original=await sourceImage.metadata();if(!['png','jpeg','webp'].includes(original.format)||original.pages>1)error('Use a single PNG, JPEG or WebP artwork image.');
  const oriented=await sourceImage.autoOrient().png().toBuffer();const meta=await sharp(oriented).metadata();
  const crop=recipe.crop||{},cx=number(crop.x,0,0,99,'crop X'),cy=number(crop.y,0,0,99,'crop Y'),cw=number(crop.width,100,1,100,'crop width'),ch=number(crop.height,100,1,100,'crop height');
  const left=Math.floor(meta.width*cx/100),top=Math.floor(meta.height*cy/100),sw=Math.min(meta.width-left,Math.max(1,Math.round(meta.width*cw/100))),sh=Math.min(meta.height-top,Math.max(1,Math.round(meta.height*ch/100)));
  const fit=recipe.fit??'contain';if(!['contain','cover'].includes(fit))error('Choose contain or cover; artwork proportions are preserved.');
  const scale=number(recipe.scale,100,1,400,'artwork scale')/100,angle=number(recipe.rotation,0,-180,180,'rotation'),x=number(recipe.x,0,-100,100,'position X')/100,y=number(recipe.y,0,-100,100,'position Y')/100;
  const mirror=recipe.mirror===true,tile=recipe.tile===true,spacing=number(recipe.spacing,0,0,200,'pattern spacing')/100;
  if((left||top||sw<meta.width||sh<meta.height||fit==='cover')&&(permissions.crop!==true||recipe.protect===true))error('Cropping requires Crop permission and pixel protection switched off.');
  if((mirror||angle)&&(permissions.modify!==true||recipe.protect===true))error('Mirroring or rotation requires Modify permission and pixel protection switched off.');
  const ratio=(fit==='cover'?Math.max(width/sw,height/sh):Math.min(width/sw,height/sh))*scale,w=Math.max(1,Math.round(sw*ratio)),h=Math.max(1,Math.round(sh*ratio));
  if(w*h>MAX_PIXELS)error('Scaled artwork exceeds the rendering limit.');
  effectiveDpi=Math.min(sw/w,sh/h)*dpi;
  if(effectiveDpi+1<dpi)error(`Source resolution is too low: ${Math.floor(effectiveDpi)} effective DPI; ${dpi} DPI is required. Use higher-resolution artwork or reduce its scale.`);
  let image=sharp(oriented).extract({left,top,width:sw,height:sh}).resize(w,h,{fit:'fill'});
  if(mirror)image=image.flop();if(angle)image=image.rotate(angle,{background:{r:0,g:0,b:0,alpha:0}});
  const rendered=await image.png().toBuffer({resolveWithObject:true}),rw=rendered.info.width,rh=rendered.info.height;
  const centerX=width*(.5+x),centerY=height*(.5+y),dx=Math.max(1,Math.round(w*(1+spacing))),dy=Math.max(1,Math.round(h*(1+spacing)));
  const nx=tile?Math.ceil((width+rw+Math.abs(centerX-width/2)*2)/dx):0,ny=tile?Math.ceil((height+rh+Math.abs(centerY-height/2)*2)/dy):0;
  if((2*nx+1)*(2*ny+1)>400)error('Pattern has too many tiles. Increase artwork size or spacing.');
  for(let ix=-nx;ix<=nx;ix++)for(let iy=-ny;iy<=ny;iy++){
   const l=Math.round(centerX+ix*dx-rw/2),t=Math.round(centerY+iy*dy-rh/2),a=Math.max(0,l),b=Math.max(0,t),r=Math.min(width,l+rw),bottom=Math.min(height,t+rh);
   if(r<=a||bottom<=b)continue;
   const clipped=l<0||t<0||l+rw>width||t+rh>height;
   if(clipped&&(permissions.crop!==true||recipe.protect===true))error('This position, pattern or rotation clips artwork. Allow Crop and disable pixel protection, or keep it inside the print area.');
   const input=clipped?await sharp(rendered.data).extract({left:a-l,top:b-t,width:r-a,height:bottom-b}).png().toBuffer():rendered.data;
   overlays.push({input,left:a,top:b});
  }
  if(!overlays.length)error('Artwork is entirely outside the print area.');
 }
 const data=await sharp({create:{width,height,channels:4,background:bg}}).composite(overlays).withMetadata({density:dpi}).png().toBuffer();
 if(data.length>MAX_FILE)error('Rendered PNG exceeds the 25 MB print-file limit.');
 return {data,width,height,effectiveDpi,sha256:hash(data)};
}

export function factoryRendering({db,auth,body,send,fail,limit,origin,plans=JSON.parse(readFileSync(new URL('../printful-plans.json',import.meta.url),'utf8'))}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_render_plans(job TEXT PRIMARY KEY,plan TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_render_files(file TEXT PRIMARY KEY,signature TEXT NOT NULL,recipe TEXT NOT NULL,source_sha TEXT,created TEXT NOT NULL);`);
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a),now=()=>new Date().toISOString();let busy=false;
 function saveRunPlan(job,c,slot,art,placementPlan){
  const map=new Map(art.map(a=>[a.name,a.id]));if((placementPlan||[]).some(p=>p.artwork&&!map.has(p.artwork)))error('A named artwork in the placement plan is missing.');
  const assignments=(placementPlan||[]).map(p=>({zone:zone(p.zone),artworkId:p.artwork?map.get(p.artwork):null}));
  if(!assignments.length)for(const a of art){const row=get('SELECT placements FROM factory_artwork WHERE id=?',a.id);for(const z of JSON.parse(row?.placements||'[]'))if(!assignments.some(p=>p.zone===zone(z)))assignments.push({zone:zone(z),artworkId:a.id});}
  run('INSERT OR REPLACE INTO factory_render_plans VALUES(?,?,?)',job,JSON.stringify({background:colors[slot.color],fit:['cover','fill'].includes(c.placement.fill)?'cover':'contain',mirrorSleeves:c.placement.mirrorSleeves,continueAcrossPanels:c.placement.continueAcrossPanels,assignments}),now());
  // Each generated product owns its print-file sets; another run cannot replace these job's files.
  const profile=get('SELECT templates FROM factory_job_profiles WHERE job=?',job),ids=JSON.parse(profile?.templates||'[]');
  if(ids.length){if(get('SELECT count(*) n FROM factory_print_drafts').n+ids.length>500)error('Blueprint limit reached. Archive unused sets before starting another run.');const fresh=ids.map(id=>{const d=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!d)error('Assigned blueprint is missing.');const copy=randomUUID();run('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)',copy,d.title,d.product,d.variant,d.technique,d.areas,d.source,now());return copy;});run('UPDATE factory_job_profiles SET templates=? WHERE job=?',JSON.stringify(fresh),job);
   const products=[...new Set(fresh.map(id=>get('SELECT product FROM factory_print_drafts WHERE id=?',id).product))];
   if(products.length===1){const selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job).selection);selection.product=products[0];selection.variantIds=fresh.map(id=>get('SELECT variant FROM factory_print_drafts WHERE id=?',id).variant);run('UPDATE factory_job_audiences SET selection=? WHERE job=?',JSON.stringify(selection),job);}
  }
 }
 function inputs(draftId,plan,allowedIds){
  const d=get('SELECT * FROM factory_print_drafts WHERE id=?',draftId);if(!d)error('Save the exact supplier variant blueprint first.');
  if(!/^(default|digital|cut-sew|sublimation)$/i.test(d.technique))error('Backend garment fill is available for sublimation and all-over-print blueprints.');
  const areas=JSON.parse(d.areas),placements=plan.placements;
  if(!placements||typeof placements!=='object'||Array.isArray(placements)||!Object.keys(placements).length)error('Choose at least one native print area.');
  return Object.entries(placements).map(([placement,r])=>{
   const area=areas.find(a=>a.placement===placement);if(!area)error('Unsupported placement for this saved variant: '+placement+'.');
   if(!r||typeof r!=='object')error('Choose artwork or an explicit fill-only recipe for each area.');
   const a=r.artworkId?get('SELECT id,product,permissions,sha256 FROM factory_artwork WHERE id=?',r.artworkId):null;
   if(r.artworkId&&!a)error('Assigned artwork is missing.');if(a&&allowedIds&&!allowedIds.includes(a.id))error('Artwork is not assigned to this job.');
   if(!a&&r.fillOnly!==true)error('This area needs artwork or an explicit fill-only choice.');
   if(a?.product!==null&&a?.product!==undefined&&a.product!==d.product)error('Artwork is restricted to a different product.');
   const recipe={...r,background:Object.hasOwn(plan,'background')?plan.background:'Black'},signature=hash(JSON.stringify([d.product,d.variant,d.technique,area,recipe,a?.sha256||null,a?.permissions||null]));
   return {d,area,a,recipe,signature};
  });
 }
 async function prepare(requests){
  if(busy)throw Object.assign(Error('The print renderer is busy. Retry when the current product finishes.'),{status:429});busy=true;
  try{
   const work=requests.flatMap(r=>inputs(r.draft,r.plan,r.allowedIds)),pending=[],storedBytes=get('SELECT COALESCE(sum(length(data)),0) bytes FROM factory_print_files').bytes;let renderedBytes=0;
   for(const x of work){const cached=get('SELECT f.id,f.sha256,f.data FROM factory_render_files r JOIN factory_print_files f ON f.id=r.file WHERE r.signature=? AND f.draft=? AND f.placement=? AND f.id=(SELECT id FROM factory_print_files WHERE draft=? AND placement=? ORDER BY created DESC,rowid DESC LIMIT 1)',x.signature,x.d.id,x.area.placement,x.d.id,x.area.placement);if(cached&&hash(Buffer.from(cached.data))===cached.sha256){pending.push({...x,cached});continue;}
    const source=x.a?Buffer.from(get('SELECT data FROM factory_artwork WHERE id=?',x.a.id).data):null;if(source&&hash(source)!==x.a.sha256)error('The original artwork checksum changed. Restore its original version before rendering.');const result=await renderArea(x.area,source,x.recipe,x.a?JSON.parse(x.a.permissions):{});renderedBytes+=result.data.length;if(renderedBytes>64*1024*1024)error('This rendering batch exceeds 64 MB. Prepare smaller variant sets to stay within the renderer memory budget.');if(storedBytes+renderedBytes>200*1024*1024)error('Print-file storage limit reached. Back up and archive files before rendering more.');pending.push({...x,result});}
   // Recheck permissions and draft changes after asynchronous rendering before storing any of the batch.
   const checked=requests.flatMap(r=>inputs(r.draft,r.plan,r.allowedIds));if(checked.some((x,i)=>x.signature!==work[i].signature))error('Artwork permissions or blueprint changed during rendering. Retry with the updated settings.');
   const newFiles=pending.filter(x=>!x.cached),bytes=newFiles.reduce((n,x)=>n+x.result.data.length,0);
   if(get('SELECT count(*) n,COALESCE(sum(length(data)),0) bytes FROM factory_print_files').n+newFiles.length>256||get('SELECT COALESCE(sum(length(data)),0) bytes FROM factory_print_files').bytes+bytes>200*1024*1024)error('Print-file storage limit reached. Back up and archive files before rendering more.');
   db.exec('BEGIN IMMEDIATE');try{for(const x of newFiles){const id=randomUUID();run('INSERT INTO factory_print_files VALUES(?,?,?,?,?,?,?,?)',id,x.d.id,x.area.placement,x.result.width,x.result.height,x.result.data,x.result.sha256,now());run('INSERT INTO factory_render_files VALUES(?,?,?,?,?)',id,x.signature,JSON.stringify(x.recipe),x.a?.sha256||null,now());x.id=id;}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   return {rendered:newFiles.length,files:pending.map(x=>({id:x.id||x.cached.id,draft:x.d.id,placement:x.area.placement,width:x.area.width,height:x.area.height,sha256:x.result?.sha256||x.cached.sha256,url:'/api/owner/ai-factory/blueprints/file/'+(x.id||x.cached.id)})),reviewRequired:true};
  }finally{busy=false;}
 }
 async function renderJob(job){
  const row=get('SELECT plan FROM factory_render_plans WHERE job=?',job);if(!row)return null;const plan=JSON.parse(row.plan);if(plan.continueAcrossPanels)error('Cross-panel continuity needs a reviewed layout. Switch off Continue artwork across panels for independent-area rendering.');
  const selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job)?.selection||'null');
  const ids=JSON.parse(get('SELECT templates FROM factory_job_profiles WHERE job=?',job)?.templates||'[]');if(!ids.length)error('Assign a product and exact native-area blueprints before rendering.');
  const requests=ids.map(id=>{const draft=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!draft||draft.product!==selection?.product)error('Saved blueprints do not match the selected product.');if(!/all-over print/i.test(plans.products?.[draft.product]?.name||''))error('Automatic garment fill requires a verified all-over-print product. For other garments, select the actual fabric color and review its print-area files.');
   const placements={};for(const a of JSON.parse(draft.areas)){const match=plan.assignments.find(p=>p.zone===zone(a.placement));if(!match)error('No explicit artwork or empty-placement decision for '+a.placement+'. Review the garment placement plan.');
    placements[a.placement]={artworkId:match.artworkId,fillOnly:!match.artworkId,fit:plan.fit,mirror:plan.mirrorSleeves&&zone(a.placement)==='sleeve_right'&&plan.assignments.find(p=>p.zone==='sleeve_left')?.artworkId===match.artworkId};}
   return {draft:id,plan:{background:plan.background,placements},allowedIds:selection.artworkIds};});
  return prepare(requests);
 }
 return {saveRunPlan,renderJob,async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/rendering'))return false;auth(req,null,true);
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-rendering',10);const b=await body(req);
  const draft=path.match(/^\/api\/owner\/ai-factory\/rendering\/draft\/([a-f0-9-]{36})$/);
  if(draft){send(res,200,await prepare([{draft:draft[1],plan:b}]));return true;}
  fail(404,'Rendering action not found.');
 }};
}
