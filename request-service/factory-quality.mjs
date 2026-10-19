import {assertComposition} from './factory-placement-playbook.mjs';
import {MAX_NATIVE_PIXELS} from './factory-placement-regions.mjs';
import {recipeIds,sourceProof} from './factory-render-proof.mjs';
import {brandingPolicy,assertBrandingPlacement} from './factory-branding.mjs';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {checkedArtwork} from './factory-artwork-permissions.mjs';
import {pngDimensions} from './factory-blueprints.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const hold=message=>{throw Object.assign(Error(message),{status:409});};

// Source DPI is measured before resizing. A large exported PNG alone is not
// evidence that its artwork was sharp enough to print.
export function factoryQuality({db}){
 db.exec('CREATE TABLE IF NOT EXISTS factory_quality_reports(job TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,report TEXT NOT NULL,created TEXT NOT NULL)');
 const get=(q,...a)=>db.prepare(q).get(...a);
 function inputs(job){
  const frozen=JSON.parse(get('SELECT plan FROM factory_render_plans WHERE job=?',job)?.plan||'null')?.numericLayout;
  const selection=JSON.parse(get('SELECT selection FROM factory_job_audiences WHERE job=?',job)?.selection||'null');
  const ids=JSON.parse(get('SELECT templates FROM factory_job_profiles WHERE job=?',job)?.templates||'[]');
  if(!selection?.product||!ids.length)hold('Quality hold: exact supplier blueprints are missing.');
  const art=(selection.artworkIds||[]).map(id=>{const a=checkedArtwork(db,id);if(!a.effectivePermissions.reuse||hash(Buffer.from(a.data))!==a.sha256)hold('Quality hold: artwork reuse permission or original checksum changed.');return {id:a.id,sha256:a.sha256,permissions:a.effectivePermissions,instructions:a.instructions};});
  const drafts=ids.map(id=>{const d=get('SELECT * FROM factory_print_drafts WHERE id=?',id);if(!d||d.source!=='live'||d.product!==selection.product)hold('Quality hold: live garment-specific blueprints are required.');const areas=JSON.parse(d.areas);if(!areas.length)hold('Quality hold: the blueprint has no print areas.');return {id,product:d.product,variant:d.variant,technique:d.technique,areas:areas.map(area=>{
   const f=get('SELECT * FROM factory_print_files WHERE draft=? AND placement=? ORDER BY created DESC,rowid DESC LIMIT 1',id,area.placement);
   if(!f||f.width!==area.width||f.height!==area.height||hash(Buffer.from(f.data))!==f.sha256)hold('Quality hold: missing, changed or incorrectly sized '+area.placement+' file.');
   const dims=pngDimensions(Buffer.from(f.data));if(dims.width!==area.width||dims.height!==area.height)hold('Quality hold: PNG pixels do not match the blueprint.');
   const r=get('SELECT * FROM factory_render_files WHERE file=?',f.id),p=get('SELECT * FROM factory_render_quality WHERE file=?',f.id);
   if(!r||!p)hold('Quality hold: this print file has no measured source-resolution proof. Render it again from its original artwork.');
   const recipe=JSON.parse(r.recipe),rows=recipeIds(recipe).map(id=>checkedArtwork(db,id)),proof=sourceProof(recipe,rows),a=rows[0]||null;assertComposition(db,recipe,rows);
   if(frozen){const expected=frozen.variants.find(v=>v.variant===d.variant)?.placements[area.placement];if(!expected||JSON.stringify({...expected,background:frozen.background})!==JSON.stringify(recipe))hold('Quality hold: the rendered file differs from the frozen inspected layout.');}
   for(const a of rows){assertBrandingPlacement(db,job,area.placement,a);if(!selection.artworkIds.includes(a.id))hold('Quality hold: print artwork is not assigned to this product.');if(!a.effectivePermissions.reuse||hash(Buffer.from(a.data))!==a.sha256)hold('Quality hold: rendered artwork or its permission changed.');}
   if(r.source_sha!==proof.sha)hold('Quality hold: rendered source checksum changed.');
   const signature=hash(JSON.stringify([d.product,d.variant,d.technique,area,recipe,proof.sha,proof.permissions]));
   if(signature!==r.signature||p.signature!==r.signature||p.required_dpi!==area.dpi||a&&(!Number.isFinite(p.effective_dpi)||p.effective_dpi+1<area.dpi))hold('Quality hold: renderer proof no longer matches the source, permissions, recipe or required DPI.');
   if(!a&&recipe.fillOnly!==true)hold('Quality hold: a print area has neither artwork nor an explicit fill.');
   return {...area,file:f.id,sha256:f.sha256,recipe,requiredDpi:p.required_dpi,effectiveDpi:p.effective_dpi,signature:r.signature};
  })};});
  if(new Set(drafts.map(d=>d.variant)).size!==drafts.length)hold('Quality hold: duplicate supplier variants.');
  const value={branding:brandingPolicy(db,job),selection,art,drafts};return {...value,fingerprint:hash(JSON.stringify(value))};
 }
 async function check(job){const value=inputs(job),decoded=new Set();for(const d of value.drafts)for(const a of d.areas){
   // inputs() verifies every file's bytes, dimensions, variant, recipe and DPI
   // proof. Identical verified PNG content needs one complete decode per check.
   const key=[a.sha256,a.width,a.height,a.requiredDpi].join(':');if(decoded.has(key))continue;
   const f=get('SELECT data FROM factory_print_files WHERE id=?',a.file),image=sharp(Buffer.from(f.data),{limitInputPixels:MAX_NATIVE_PIXELS,failOn:'warning'}),meta=await image.metadata();if(meta.format!=='png'||meta.pages>1||Math.abs((meta.density||0)-a.requiredDpi)>1)hold('Quality hold: PNG format or print-density metadata is invalid.');await image.stats();decoded.add(key);}
  if(inputs(job).fingerprint!==value.fingerprint)hold('Quality inputs changed while decoding the files.');
  const report={passed:true,fingerprint:value.fingerprint,decodedFiles:decoded.size,variants:value.drafts.map(d=>d.variant),files:value.drafts.flatMap(d=>d.areas.map(a=>({variant:d.variant,placement:a.placement,file:a.file,sha256:a.sha256,width:a.width,height:a.height,requiredDpi:a.requiredDpi,effectiveDpi:a.effectiveDpi,fillOnly:a.recipe.fillOnly===true}))),checks:['native dimensions','full PNG decode','file and source checksums','measured source DPI','supported areas','current artwork permissions','complete variant files','label-first branding permissions'],note:'Technical file checks do not certify physical seams, print color or supplier manufacturing.'};
  db.prepare('INSERT OR REPLACE INTO factory_quality_reports VALUES(?,?,?,?)').run(job,value.fingerprint,JSON.stringify(report),new Date().toISOString());return report;
 }
 function assert(job){const value=inputs(job),saved=get('SELECT * FROM factory_quality_reports WHERE job=?',job);if(!saved||saved.fingerprint!==value.fingerprint||!JSON.parse(saved.report).passed)hold('Quality hold: run technical quality control on the current print files.');return JSON.parse(saved.report);}
 return {check,assert,inputs};
}
