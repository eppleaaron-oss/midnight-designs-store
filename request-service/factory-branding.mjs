import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const BRANDING_VERSION='design-first-v1';
export const BRAND_LOGO_PATH='/assets/designs/art-7d5ff833db11.png';
export const BRANDING_RULE='PRIMARY RULE: Midnight Designs is design-first. Never automatically place its logo, MD, name or website on visible clothing. Branding belongs on actual supplier-supported tags/labels; no exterior fallback. Small chest graphics are thematic artwork. Blank space is intentional. Match outfits through artwork, palette and composition, not repeated company logos. Exterior branding requires a separate owner-approved exception for this product and should remain a small minority.';
export const BRANDING_CONCEPTS='BRAND IDENTITY: dark vintage/gothic art direction. PRODUCT ARTWORK: the graphics, symbols, illustrations, design-related lettering, textures and compositions customers buy. BRAND MARKING: company logo/name/MD/website, normally reserved for supported labels, packaging and the store. A raven emblem is thematic artwork, not the company logo.';
export const INTERNAL_LABELS=['label_inside','label_inside_dtfabric','inside_label','inner_label','neck_label','waistband_label','sewn_label','printed_label','label_panel','label_panel_dtfabric'];
export const isBrandLabel=area=>INTERNAL_LABELS.includes(area);
let logoSha=null;try{logoSha=createHash('sha256').update(readFileSync(new URL('..'+BRAND_LOGO_PATH,import.meta.url))).digest('hex');}catch{/* Imported-logo identity remains available when assets are hosted separately. */}
const exists=(db,table)=>!!db?.prepare("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?").get(table);

export function brandingPolicy(db,job){const row=job&&exists(db,'factory_branding_exceptions')?db.prepare('SELECT reason FROM factory_branding_exceptions WHERE job=?').get(job):null;return {version:BRANDING_VERSION,allowExterior:!!row,reason:row?.reason||null};}
export function brandingInstruction(db,job){const p=brandingPolicy(db,job);return BRANDING_RULE+'\n'+BRANDING_CONCEPTS+(p.allowExterior?'\nOWNER EXCEPTION for this product only: exterior brand marking is permitted as part of a clean design. Reason: '+p.reason+'. Never add more logos just to fill space.':'\nNo exterior-branding exception is approved. Do not invent or add company marks.');}
export function isBrandArtwork(db,art){
 if(!art)return false;const root=art.original&&exists(db,'factory_artwork')?db.prepare('SELECT id,name,filename,sha256 FROM factory_artwork WHERE id=?').get(art.original):art;
 if(logoSha&&[art.sha256,root?.sha256].includes(logoSha))return true;
 if(root?.id&&exists(db,'factory_library_imports')&&db.prepare('SELECT artwork FROM factory_library_imports WHERE design=? AND artwork=?').get('art-7d5ff833db11',root.id))return true;
 return [art.name,root?.name,art.filename,root?.filename].filter(Boolean).some(n=>/^(?:midnight[ _-]*designs?|md)[ _-]*(?:logo|wordmark|brand(?:ing)?(?:[ _-]*mark)?)(?:\b|_)/i.test(n)||/^midnight[ _-]*designs?(?:\.(?:png|jpe?g|webp))?$/i.test(n));
}
export function assertBrandingPlacement(db,job,area,art){if(isBrandArtwork(db,art)&&!isBrandLabel(area)&&!brandingPolicy(db,job).allowExterior)throw Object.assign(Error('Branding hold: the Midnight Designs logo cannot be placed on '+area+' without an explicit owner exception. Use a supported internal label or thematic artwork.'),{status:409});}

export function factoryBranding({db,auth,body,send,fail,limit,origin}){
 db.exec('CREATE TABLE IF NOT EXISTS factory_branding_exceptions(job TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL)');
 return {async handle(req,res,path,method){if(path!=='/api/owner/ai-factory/branding/exception')return false;auth(req,null,true);if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-branding',20);const b=await body(req),j=typeof b.job==='string'&&db.prepare('SELECT * FROM factory_jobs WHERE id=?').get(b.job);if(!j||j.kind==='artwork')fail(404,'Clothing product not found.');const step=db.prepare('SELECT step FROM factory_job_runtime WHERE job=?').get(j.id)?.step||0;if(!['queued','waiting_input','failed','retry_wait','awaiting_review'].includes(j.status)||step>=3)fail(409,'Change branding before print files are prepared. Revise a finished product instead.');if(typeof b.allowExterior!=='boolean'||b.confirm!==true)fail(400,'Explicitly confirm the branding choice for this product.');if(b.allowExterior){if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>300)fail(400,'Explain this exceptional visible branding design (up to 300 characters).');db.prepare('INSERT OR REPLACE INTO factory_branding_exceptions VALUES(?,?,?)').run(j.id,b.reason.trim(),new Date().toISOString());}else db.prepare('DELETE FROM factory_branding_exceptions WHERE job=?').run(j.id);send(res,200,{job:j.id,branding:brandingPolicy(db,j.id),note:'This allows an exception for one product; it does not add any logo or publish it.'});return true;}};
}
