import {targetAreas,MAX_NATIVE_PIXELS} from './factory-placement-regions.mjs';
import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {variantAreas} from './factory-blueprints.mjs';
import {BASIC_LAYOUTS,BASIC_LAYOUT_VERSION,panelKind,exterior} from './factory-basic-layout-library.mjs';
import {checkedArtwork} from './factory-artwork-permissions.mjs';
import {isBrandArtwork} from './factory-branding.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const num=(v,label,min=0,max=100)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('Invalid '+label+'.',400);return v;};
const round=n=>Math.round(n*1000)/1000;
const areaStamp=a=>hash([a.placement,a.printfile_id,a.width,a.height,a.dpi]);
const key=(product,technique,a)=>[product,technique,a.placement,areaStamp(a),...(a.region?[a.region]:[])].join(':');
const inside=(r,b)=>r.x>=b.x-0.01&&r.y>=b.y-0.01&&r.x+r.width<=b.x+b.width+0.01&&r.y+r.height<=b.y+b.height+0.01;
const defaultPart=(slot,parts)=>Object.keys(parts).find(k=>panelKind(k)===slot.panel)||(slot.panel==='leg_left'?parts.sleeve_left&&'sleeve_left':slot.panel==='leg_right'?parts.sleeve_right&&'sleeve_right':null)||null;

// Reviewed anatomical anchors are separate from supplier mockup-image coordinates.
// A Printful API rectangle does not supply a chest/thigh safe zone by itself.
export function basicSizing({db,workflow,clock=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS factory_basic_geometry(key TEXT PRIMARY KEY,product INTEGER NOT NULL,technique TEXT NOT NULL,placement TEXT NOT NULL,stamp TEXT NOT NULL,profile TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_basic_inspections(id TEXT PRIMARY KEY,signature TEXT NOT NULL,created INTEGER NOT NULL);`);
 const get=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const profile=(product,technique,a)=>{const r=get('SELECT profile FROM factory_basic_geometry WHERE key=?',key(product,technique,a));return r?JSON.parse(r.profile):a.builtinProfile||null;};
 function options(p,bp){
  const technique=bp.effectiveTechnique||bp.technique,areas=new Map();
  for(const v of p.variants)for(const a of targetAreas(p.product.id,p.role,exterior(variantAreas(bp,v.id)))){const k=key(p.product.id,technique,a);if(!areas.has(k))areas.set(k,{...a,key:k,variantIds:[],profile:profile(p.product.id,technique,a),widthIn:round(a.width/a.dpi),heightIn:round(a.height/a.dpi)});areas.get(k).variantIds.push(v.id);}
  const layouts=BASIC_LAYOUTS.filter(l=>l.category===p.role||[64,66].includes(l.number)).map(l=>{
   const reasons=l.reason?[l.reason]:[];
   for(const v of p.variants)for(const s of l.slots){if(s.panel==='*')continue;if(!s.optional&&!targetAreas(p.product.id,p.role,exterior(variantAreas(bp,v.id))).some(a=>(a.region||panelKind(a.placement))===s.panel))reasons.push('Size '+v.size+' has no supported '+s.panel+' panel.');}
   return {...l,compatible:!reasons.length,reasons:[...new Set(reasons)],needsReviewedMap:true};
  });
  return {version:BASIC_LAYOUT_VERSION,layouts,areas:[...areas.values()],allLayouts:BASIC_LAYOUTS.map(l=>({number:l.number,category:l.category,name:l.name,supported:l.supported,reason:l.reason})),note:'Inches refer to the artwork inside the full native canvas. Safe regions and anatomical anchors need a product-specific review; mockup template rectangles are not safe-zone masks.'};
 }
 function saveProfile(p,bp,b){
  if(b.reviewed!==true||b.orientation!=='wearer'||typeof b.reference!=='string'||!b.reference.trim()||b.reference.length>600)fail('Review the garment template, use wearer orientation, and describe the supplier guideline used.',400);
  const option=options(p,bp).areas.find(a=>a.key===b.areaKey);if(!option)fail('This print area is not in the selected live variants.');
  if(typeof b.anchor!=='string'||!/^[-a-z_]{1,40}$/.test(b.anchor))fail('Choose a named anatomical anchor.',400);
  const r=b.safeRect;if(!r||typeof r!=='object')fail('Define the safe region from this garment’s print guideline.',400);
  const dpi=option.dpi,safeRect={x:num(r.x,'safe left')*dpi,y:num(r.y,'safe top')*dpi,width:num(r.width,'safe width',0.01)*dpi,height:num(r.height,'safe height',0.01)*dpi};
  const bounds=option.builtinProfile?.safeRect||{x:0,y:0,width:option.width,height:option.height};if(!inside(safeRect,bounds))fail('The reviewed safe region extends outside the native print canvas.');
  const point={x:num(b.xIn,'anchor horizontal position')*dpi,y:num(b.yIn,'anchor vertical position')*dpi};
  if(!inside({...point,width:0,height:0},safeRect))fail('The anatomical anchor must be inside the reviewed safe region.');
  const old=profile(p.product.id,bp.effectiveTechnique||bp.technique,option),anchors={...(old?.anchors||{}),[b.anchor]:point};
  if(Object.values(anchors).some(a=>!inside({...a,width:0,height:0},safeRect)))fail('Changing this safe region would exclude a saved anchor. Review its positions first.');
  const value={safeRect,anchors,orientation:'wearer',reference:b.reference.trim(),reviewed:true,reviewedAt:new Date(clock()).toISOString(),stamp:areaStamp(option)};
  run('INSERT INTO factory_basic_geometry VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET profile=excluded.profile,updated=excluded.updated',option.key,p.product.id,bp.effectiveTechnique||bp.technique,option.placement,areaStamp(option),JSON.stringify(value),value.reviewedAt);
  return value;
 }
 async function artwork(part,set){
  if(/mockup|product[-_ ]photo/i.test(part.name||''))fail('A product mockup cannot be used as printable source artwork. Assign the original design.');
  const id=await workflow.sourceFile(part,set),row=checkedArtwork(db,id);if(isBrandArtwork(db,row))fail('Choose thematic artwork from this set; exterior company branding is not a chest graphic.');
  if(!row.effectivePermissions.reuse)fail('Reuse permission is required for this artwork.');
  const data=Buffer.from(row.data),meta=await sharp(data,{limitInputPixels:40_000_000}).autoOrient().metadata();
  const oriented=meta.autoOrient||meta,width=oriented.width,height=oriented.height;if(!width||!height)fail('The source artwork has no readable dimensions.');
  // A conservative edge check flags margins; it never crops or extracts a motif.
  const sample=await sharp(data).autoOrient().resize(96,96,{fit:'inside',withoutEnlargement:true}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let minX=sample.info.width,minY=sample.info.height,maxX=-1,maxY=-1;
  for(let y=0;y<sample.info.height;y++)for(let x=0;x<sample.info.width;x++){const i=(y*sample.info.width+x)*4;if(sample.data[i+3]>24&&Math.max(...sample.data.subarray(i,i+3))>22){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
  const visible=maxX>=minX?(maxX-minX+1)*(maxY-minY+1)/(sample.info.width*sample.info.height):0;
  return {id,sha256:row.sha256,width,height,permissions:row.effectivePermissions,marginWarning:visible<0.65?'The source has substantial dark/transparent margins. The inch measurement is the full image bounds; inspect the visible graphic. Cropping/extracting a symbol requires separate permission.':null};
 }
 async function resolve(p,bp,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==BASIC_LAYOUT_VERSION)fail('Choose a current Basic layout version.',400);
  const layout=BASIC_LAYOUTS.find(l=>l.number===input.number&&(l.category===p.role||[64,66].includes(l.number)));if(!layout)fail('Choose a layout for this garment category.',400);
  const option=options(p,bp).layouts.find(l=>l.number===layout.number);if(!option.compatible)fail(option.reasons.join(' '));
  const assignments=input.assignments||{},overrides=input.overrides||{};
  if(Object.keys(assignments).some(k=>!layout.slots.some(s=>s.id===k))||Object.keys(overrides).some(k=>!layout.slots.some(s=>s.id===k)))fail('A layout contains an unsupported assignment or override.',400);
  if(input.scaleMode!==undefined&&!['fixed','proportional'].includes(input.scaleMode))fail('Choose fixed inches or proportional scaling.',400);
  if(p.audience==='children')fail('Adult presets cannot be applied to children. A separate reviewed children’s sizing profile is required.');
  const sources=new Map(),bindings=[],warnings=[],variants=[],reductions=[];
  for(const s of layout.slots){const chosen=Object.hasOwn(assignments,s.id)?assignments[s.id]:s.panel==='*'?(p.set.parts.front?'front':p.set.parts.default?'default':null):defaultPart(s,p.set.parts);
   if(chosen===null||chosen===''){if(!s.optional)fail('Layout '+layout.name+' requires '+s.id+' artwork. Assign a source from the selected set; an unassigned required panel cannot become blank black.');bindings.push({...s,part:null});continue;}
   if(typeof chosen!=='string'||!p.set.parts[chosen])fail('The '+s.id+' assignment is not in the selected design set.',400);
   if(!sources.has(chosen))sources.set(chosen,await artwork(p.set.parts[chosen],p.set));bindings.push({...s,part:chosen});
  }
  const technique=bp.effectiveTechnique||bp.technique,firstAreas=exterior(variantAreas(bp,p.variants[0].id));
  for(const v of p.variants){const native=exterior(variantAreas(bp,v.id)),placements={},measurements=[];
   for(const area of native){if(area.width*area.height>MAX_NATIVE_PIXELS)fail('The required '+area.placement+' native canvas exceeds the supported native rendering limit.');const targets=targetAreas(p.product.id,p.role,[area]),selected=bindings.flatMap(s=>{const target=targets.find(a=>s.panel==='*'?!a.region:(a.region||panelKind(a.placement))===s.panel);return s.part&&target?[{s,target}]:[];});
    if(!selected.length){placements[area.placement]={fillOnly:true,fit:'contain',protect:true};measurements.push({placement:area.placement,blank:true,width:area.width,height:area.height,dpi:area.dpi});continue;}
    const elements=[];for(const {s,target}of selected){
    const src=sources.get(s.part),map=profile(p.product.id,technique,target);if(!map?.reviewed||!map.anchors[s.anchor])fail('Review the '+(target.region||area.placement)+' safe region and '+s.anchor+' anchor for size '+v.size+' before using '+layout.name+'.');
    const override=overrides[s.id]||{};if(Object.keys(override).some(k=>!['widthIn','heightIn','xIn','yIn','spacingIn'].includes(k)))fail('Only size, position and pattern spacing overrides are supported.',400);
    const base=firstAreas.find(a=>a.placement===area.placement),factor=input.scaleMode==='proportional'&&base?Math.min(area.width/area.dpi/(base.width/base.dpi),area.height/area.dpi/(base.height/base.dpi)):1;
    const targetW=num(override.widthIn??s.widthIn,'artwork width',0.1,40)*factor*area.dpi,targetH=override.heightIn===undefined&&s.heightIn===null?Infinity:num(override.heightIn??s.heightIn,'artwork height',0.1,60)*factor*area.dpi;
    const requested=Math.min(targetW/src.width,targetH/src.height),anchor=map.anchors[s.anchor];
    const cx=override.xIn===undefined?anchor.x:num(override.xIn,'horizontal position')*area.dpi,cy=override.yIn===undefined?anchor.y:num(override.yIn,'vertical position')*area.dpi;
    if(!inside({x:cx,y:cy,width:0,height:0},map.safeRect))fail('The '+s.id+' position is outside the reviewed safe region.');
    const safeW=2*Math.min(cx-map.safeRect.x,map.safeRect.x+map.safeRect.width-cx),safeH=2*Math.min(cy-map.safeRect.y,map.safeRect.y+map.safeRect.height-cy);
    const ratio=Math.min(requested,1,safeW/src.width,safeH/src.height);if(ratio<=0)fail('The '+s.id+' anchor leaves no safe artwork space.');
    const width=Math.max(1,Math.floor(src.width*ratio)),height=Math.max(1,Math.floor(src.height*ratio)),x=Math.round(cx-width/2),y=Math.round(cy-height/2),effectiveDpi=Math.min(src.width/width,src.height/height)*area.dpi;
    if(effectiveDpi+0.01<area.dpi)fail('The source artwork cannot meet this garment’s resolution requirement.');
    if(ratio<requested-0.001)reductions.push({variant:v.id,placement:area.placement,requestedWidthIn:round(src.width*requested/area.dpi),requestedHeightIn:round(src.height*requested/area.dpi),actualWidthIn:round(width/area.dpi),actualHeightIn:round(height/area.dpi),reason:requested>1?'Source pixels or the reviewed safe area limit the requested size.':'The reviewed safe area limits the requested size.'});
    if(src.marginWarning)warnings.push(s.id+': '+src.marginWarning);
    const geometry={x,y,width,height,canvasWidth:area.width,canvasHeight:area.height,dpi:area.dpi,safeRect:map.safeRect,profileStamp:hash(map)};
    const recipe={artworkId:src.id,fit:'contain',geometry,protect:true,mirror:false,rotation:0,tile:false};
    if(layout.pattern){if(!src.permissions.crop)fail('Repeating patterns extend through the panel bleed and need explicit Crop permission for the selected motif.');recipe.tile=true;recipe.protect=false;const spacing=num(override.spacingIn??0,'pattern spacing',0,10)*area.dpi;if(spacing>width*2)fail('Pattern spacing must be at most twice the motif width.');recipe.spacing=100*spacing/width;const nx=Math.ceil((area.width+width+Math.abs(cx-area.width/2)*2)/(width+spacing)),ny=Math.ceil((area.height+height+Math.abs(cy-area.height/2)*2)/(height+spacing));if((2*nx+1)*(2*ny+1)>400)fail('This pattern would have too many tiles. Increase the motif size or choose fewer repeats.');}
    elements.push(recipe);
    measurements.push({region:target.region||null,slot:s.id,part:s.part,artwork:src.id,name:p.set.parts[s.part].name,previewUrl:'/api/owner/ai-factory/artwork/'+src.id+'/file',placement:area.placement,anchor:s.anchor,widthIn:round(width/area.dpi),heightIn:round(height/area.dpi),centerXIn:round(cx/area.dpi),centerYIn:round(cy/area.dpi),effectiveDpi:round(effectiveDpi),canvas:{width:area.width,height:area.height,dpi:area.dpi},geometry,pattern:layout.pattern,spacingIn:override.spacingIn||0,profileReference:map.reference});
    }placements[area.placement]=elements.length===1?elements[0]:{elements};
   }
   variants.push({variant:v.id,size:v.size,areas:native,placements,measurements});
  }
  const frozen={number:layout.number,name:layout.name,version:BASIC_LAYOUT_VERSION,input,scaleMode:input.scaleMode||'fixed',background:'#000000',bindings,variants,sources:Object.fromEntries([...sources].map(([part,s])=>[part,{id:s.id,sha256:s.sha256,width:s.width,height:s.height,permissions:s.permissions}])),reductions,warnings:[...new Set(warnings)],requiresAcceptance:reductions.length>0&&input.acceptReduction!==true};
  frozen.signature=hash(frozen);return frozen;
 }
 function receipt(signature){const id=randomUUID();run('INSERT INTO factory_basic_inspections VALUES(?,?,?)',id,signature,clock());run('DELETE FROM factory_basic_inspections WHERE id IN (SELECT id FROM factory_basic_inspections ORDER BY created DESC LIMIT -1 OFFSET 200)');return id;}
 function verifyReceipt(token,signature,{queued=false}={}){const saved=typeof token==='string'&&get('SELECT * FROM factory_basic_inspections WHERE id=?',token);if(!saved||saved.signature!==signature||!queued&&clock()-saved.created>86400000)fail('The layout, artwork, sizes or garment map changed. Inspect this exact recipe again before creating it.');}
 return {options,saveProfile,resolve,receipt,verifyReceipt};
}
