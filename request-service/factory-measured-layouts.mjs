import {createHash} from 'node:crypto';
import {variantAreas} from './factory-blueprints.mjs';
import {legRegions} from './factory-placement-regions.mjs';
import {panelKind,exterior,BASIC_LAYOUT_VERSION} from './factory-basic-layout-library.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const measuredAreaStamp=a=>digest([a.placement,a.printfile_id,a.width,a.height,a.dpi,a.template||null]);
const round=x=>Math.round(x*10000)/10000;
export function measurementLibrary(db){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_placement_examples(id INTEGER PRIMARY KEY AUTOINCREMENT,supplier TEXT NOT NULL,source TEXT NOT NULL,revision INTEGER NOT NULL,product INTEGER NOT NULL,technique TEXT NOT NULL,audience TEXT NOT NULL,state TEXT NOT NULL,name TEXT NOT NULL,note TEXT NOT NULL,example TEXT NOT NULL,parent INTEGER,created INTEGER NOT NULL,UNIQUE(source,revision,state));`);
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a);
 const view=r=>({...r,example:JSON.parse(r.example)});
 return {
 async record({source,supplier,revision,product,blueprint,document,decision,name,note='',audience='unisex',readArtwork,clock=Date.now,parts={},job=null}){
  if(!['approved','rejected','correction'].includes(decision)||!Number.isSafeInteger(revision)||revision<1||typeof note!=='string'||note.length>1200)throw Error('Choose approved, rejected or correction feedback for a saved revision.');
  const prior=get('SELECT * FROM factory_placement_examples WHERE source=? AND revision=? AND state=?',source,revision,decision);if(prior){const latest=get('SELECT id,created FROM factory_placement_examples WHERE supplier=? ORDER BY created DESC,id DESC LIMIT 1',String(supplier)),example=JSON.parse(prior.example);if(job)example.job=job;if(latest.id!==prior.id||example.job!==JSON.parse(prior.example).job||prior.note!==note){db.prepare('UPDATE factory_placement_examples SET example=?,note=?,created=? WHERE id=?').run(JSON.stringify(example),note,Math.max(clock(),latest.created+1),prior.id);return view(get('SELECT * FROM factory_placement_examples WHERE id=?',prior.id));}return view(prior);}
  const meta=new Map(),variants=[],issues=[];const technique=blueprint.effectiveTechnique||blueprint.technique||'default';
  for(const v of document.supplier?.sync_variants||[]){const panels={};for(const a of exterior(variantAreas(blueprint,v.variant_id))){const panel=document.variants?.[String(v.id)]?.[a.placement];
   if(!panel){issues.push('Size '+v.size+': '+a.placement+' has no saved editable composition.');continue;}
   const layers=[];for(const [index,l] of panel.layers.entries()){
    if(!meta.has(l.asset))meta.set(l.asset,await readArtwork(l.asset,panel.background));const m=meta.get(l.asset);if(!(m.width>0&&m.height>0))throw Error('Artwork dimensions are unavailable.');
    const w=l.width*a.width,h=w*m.height/m.width,b=panel.background==='#000000'&&!l.rotation&&!l.mirror?m.bounds:null;
    const bounds=b||{x:0,y:0,width:m.width,height:m.height};
    layers.push({asset:l.asset,part:(Object.entries(parts).filter(([,id])=>id===l.asset).find(([part])=>panelKind(part)===panelKind(a.placement))|| (Object.values(parts).filter(id=>id===l.asset).length===1?Object.entries(parts).find(([,id])=>id===l.asset):null))?.[0]||null,name:m.name||l.asset,sourceWidth:m.width,sourceHeight:m.height,sourceBounds:bounds,widthIn:round(w/a.dpi),heightIn:round(h/a.dpi),xIn:round(l.x*a.width/a.dpi),yIn:round(l.y*a.height/a.dpi),visibleWidthIn:round(bounds.width/m.width*w/a.dpi),visibleHeightIn:round(bounds.height/m.height*h/a.dpi),visibleXIn:round((l.x*a.width-w/2+(bounds.x+bounds.width/2)/m.width*w)/a.dpi),visibleYIn:round((l.y*a.height-h/2+(bounds.y+bounds.height/2)/m.height*h)/a.dpi),rotation:l.rotation||0,mirror:!!l.mirror,cropAllowed:!!l.allowModify,backgroundRemoval:l.backgroundRemoval||null,effectiveDpi:round(m.width/w*a.dpi),layer:index});
    if(l.rotation||l.mirror||l.allowModify||l.backgroundRemoval)issues.push(a.placement+': a transformed or cropped layer needs its own reviewed automatic mapping.');
   }
   if(panel.background!=='#000000')issues.push(a.placement+': Basic currently requires a black all-over-print background.');
   panels[a.placement]={placement:a.placement,stamp:measuredAreaStamp(a),width:a.width,height:a.height,dpi:a.dpi,printfileId:a.printfile_id,template:a.template||null,background:panel.background,layers};
  }variants.push({variant:v.variant_id,size:v.size,panels});}
  if(!variants.length)throw Error('Save an exact supplier variant and template before learning measurements.');
  const parent=get('SELECT id FROM factory_placement_examples WHERE supplier=? AND revision<? ORDER BY revision DESC,id DESC LIMIT 1',String(supplier),revision)?.id||null;
  const example={version:1,job,productType:product.type||product.name||name,technique,variants,issues:[...new Set(issues)],units:'inches',orientation:'wearer',noAutomaticTransforms:true};
  const r=db.prepare('INSERT INTO factory_placement_examples(supplier,source,revision,product,technique,audience,state,name,note,example,parent,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *').get(String(supplier),source,revision,Number(product.id),technique,audience,decision,String(name||'Owner placement example').slice(0,160),note,JSON.stringify(example),parent,Math.max(clock(),(get('SELECT MAX(created) n FROM factory_placement_examples').n||0)+1));return view(r);
 },
 list(){return all('SELECT * FROM factory_placement_examples ORDER BY created DESC,id DESC').map(view);},
 snapshot(){const rows=this.list();return {counts:Object.fromEntries(['approved','rejected','correction'].map(s=>[s,rows.filter(r=>r.state===s).length])),examples:rows.slice(0,120).map(r=>({...r,panels:r.example.variants.reduce((n,v)=>n+Object.keys(v.panels).length,0)})),note:'Numeric owner feedback is stored with exact product, printing method, supplier variant, template and artwork. Rejected/correction records are never automatic placement rules. Safe regions still require the exact garment guideline review.'};},
 layouts(p,bp){const latest=new Map();for(const r of this.list())if(!latest.has(r.supplier))latest.set(r.supplier,r);return [...latest.values()].filter(r=>r.state==='approved'&&r.product===p.product.id&&r.audience===p.audience).map(r=>{
  const reasons=[...r.example.issues],technique=bp.effectiveTechnique||bp.technique||'default';if(r.technique!==technique)reasons.push('Printing method changed.');
  for(const v of p.variants){const prior=r.example.variants.find(x=>x.variant===v.id);if(!prior){reasons.push('Size '+v.size+' has no approved example.');continue;}for(const a of exterior(variantAreas(bp,v.id))){const panel=prior.panels[a.placement];if(!panel||panel.stamp!==measuredAreaStamp(a))reasons.push('Size '+v.size+': '+a.placement+' template changed or was not reviewed.');}}
  const first=r.example.variants.find(v=>v.variant===p.variants[0]?.id)||r.example.variants[0],slots=[];
  for(const panel of Object.values(first.panels))for(const [index,l] of panel.layers.entries()){const slotId=panel.placement+'_'+index;slots.push({id:slotId,panel:panelKind(panel.placement),placement:panel.placement,anchor:'owner_manual',optional:false,widthIn:l.visibleWidthIn,heightIn:l.visibleHeightIn,part:l.part,measurements:Object.fromEntries(r.example.variants.map(v=>{const layer=v.panels[panel.placement]?.layers[index];return [v.variant,layer?{widthIn:layer.visibleWidthIn,heightIn:layer.visibleHeightIn,xIn:layer.visibleXIn,yIn:layer.visibleYIn}:null];}))});}
  for(const v of p.variants){const recorded=r.example.variants.find(x=>x.variant===v.id);if(recorded)for(const [placement,panel]of Object.entries(first.panels))if(recorded.panels[placement]?.layers.length!==panel.layers.length)reasons.push('Sizes have different layer counts; review each size before transferring.');}
  if(!slots.length)reasons.push('This example contains no artwork layers.');
  for(const v of p.variants)for(const s of slots)if(!s.measurements[v.id])reasons.push('A selected size has no matching layer.');
  return {number:1000+r.id,exampleId:r.id,version:BASIC_LAYOUT_VERSION,name:r.name+' · approved measurements',category:p.role,pattern:false,slots,compatible:!reasons.length,reasons:[...new Set(reasons)],needsReviewedMap:true,examplePreview:r.example.variants,feedback:r.note,revision:r.revision};
 });}
 };
}

export function reviewedLayerRegion(db,product,technique,area,rect){
 const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='factory_basic_geometry'").get();
 const profiles=exists?db.prepare('SELECT profile FROM factory_basic_geometry WHERE product=? AND technique=? AND placement=? AND stamp=?').all(product,technique,area.placement,measuredAreaStamp(area)).map(r=>JSON.parse(r.profile)):[];
 profiles.push(...legRegions(product,area));
 return profiles.find(p=>p.reviewed&&rect.x>=p.safeRect.x-.5&&rect.y>=p.safeRect.y-.5&&rect.x+rect.width<=p.safeRect.x+p.safeRect.width+.5&&rect.y+rect.height<=p.safeRect.y+p.safeRect.height+.5)||null;
}
