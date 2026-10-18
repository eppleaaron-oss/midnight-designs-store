import {readFileSync} from 'node:fs';

export const PLACEMENT_POLICY_VERSION='md-placement-1';
export const ARTWORK_KINDS=['hero','motif','strip','pattern','panel'];
export const PLACEMENT_RULES=[
 ['artwork','Classify before placement','Classify each source as a hero (scene or portrait), compact motif, narrow strip, repeatable pattern, or already composed panel. Unclassified artwork is conservatively treated as a hero. Never stretch a full scene into a sleeve strip or extract a symbol without permission.',1],
 ['composition','No automatic tiling of scenes or portraits','Use one hero per intended hero region. Never automatically tile a scene, portrait, cathedral illustration or composed panel. No lower-image restart. Repeat only a pattern explicitly approved by the owner for that exact artwork version; a model classification does not grant repeat permission.',1],
 ['composition','Keep the design set together','Use only the selected design set and its assigned source artwork. Coordinate palette and visual language across the outfit. Never borrow an unrelated source or substitute company branding for a missing graphic.',1],
 ['placement','Assign structural panels separately','Pockets, waistbands, collars and bag panels need their own explicit assignments. Hoodie pockets stay black by default. A pocket continuation requires a reviewed exact alignment and permitted cropping. Keep faces and text away from seams, zippers, hems and pockets. Left/right mean the wearer’s left/right.',1],
 ['placement','Stop on missing placement requirements','Load the exact live product, printing method, selected variants and template before artwork placement. Stop when required artwork, a supported placement, reviewed safe geometry or adequate source resolution is missing. Do not silently substitute another panel or declare black-only required artwork complete.',1],
 ['blueprint','Save the inspected production profile','Save product ID, printing method, layout number, selected variants, exact template, safe regions, artwork IDs and checksums, dimensions and coordinates. Basic must reload by Printful product ID and selected layout; changed templates or sizes require another inspection. Render and mockups use the same frozen production files.',1],
 ['qc','Review actual placement views','Review actual saved Printful views against the garment-specific playbook. Unseen fronts, backs, sleeves, hoods and seams remain unreviewed. Do not infer seam continuity, worn positioning, safe areas or manufacturing certification from a written recipe. Owner approval is still required.',1]
];
export const PLACEMENT_PLAYBOOK=[
 [1419,'Cotton hoodie',13,'Small thematic chest graphic, large back and coordinated genuine sleeve strips. The pocket stays black unless a separate accent or exact continuation is deliberately reviewed.'],
 [1628,'Oversized hoodie',15,'Restrained chest artwork, statement back below the lowered hood and sleeve accents.'],
 [388,'Recycled fleece hoodie',13,'Chest accent or selected centered graphic; one strong back illustration.'],
 [1418,'Cotton sweatshirt',5,'One centered composition; keep faces and wording clear of the hem.'],
 [320,'Recycled sweatshirt',5,'One continuous torso scene; no unintended repetition or horizontal restart near the bottom.'],
 [328,'Athletic T-shirt',1,'Choose small chest OR large front; complementary back and small sleeve accents.'],
 [920,'Long-sleeve shirt',1,'Chest/front graphic, statement back and genuine narrow sleeve artwork. Never stretch a full scene down a sleeve.'],
 [644,'Sports jersey',5,'Main graphic below the V-neck; small sleeve accents and separate back artwork.'],
 [276,'Tank top',5,'Compact hero below the scoop neckline and between the armholes.'],
 [1474,'Crop top',5,'Shorter, compact composition with the entire subject above the hem.'],
 [919,'Sports warmup hoodie',14,'Hero below the neck opening; supporting sleeves and a quieter hood.'],
 [659,'Button shirt',1,'Small chest artwork and complete hero on the back. Any split-front scene requires separate review.'],
 [400,'Joggers',41,'Narrow artwork along outer thigh/calf; preserve the black center and waistband.'],
 [618,'Track pants',41,'One stronger leg composition and a quieter opposite leg. Keep important details away from the crotch seam.'],
 [330,'Athletic shorts',49,'One thigh motif or short vertical illustration; optional smaller opposite-leg accent.'],
 [242,'Leggings',41,'Elongated outer-leg artwork, quieter seat/crotch and a deliberate separate waistband treatment.'],
 [420,'Neck gaiter',61,'Place the focal motif where it appears when worn over the face, rather than low on the flat file. Verify the worn mockup.'],
 [630,'Bandana',61,'Position for the chosen fold and wearing style; protect the subject from folds and ties.'],
 [963,'Utility backpack',61,'One main front hero; pocket gets an intentional separate accent or a carefully reviewed aligned continuation.'],
 [279,'Backpack',61,'Keep the skull/head complete above the pocket zipper; supporting scenery below.'],
 [350,'Fanny pack',61,'Wide horizontal composition or compact central motif, clear of the zipper and curved edges.']
].map(([product,name,recommendedLayout,direction])=>({product,name,recommendedLayout,direction,version:PLACEMENT_POLICY_VERSION}));
export const placementGuide=product=>PLACEMENT_PLAYBOOK.find(g=>g.product===Number(product))||null;
export function placementInstruction(product){const g=placementGuide(product);return 'Placement policy: classify hero/motif/strip/pattern/panel; keep the selected set together. One hero per intended region. No automatic tiling of scenes or portraits; only owner-approved patterns repeat. Structural panels need separate assignments; pockets default black. Missing required artwork or reviewed geometry stops production. Freeze exact template, artwork IDs and numeric coordinates. Unseen mockup views remain unreviewed.'+(g?'\n'+g.name+' (Printful '+g.product+'): '+g.direction:'');}
export function playbookSnapshot(){let listings=[];try{listings=JSON.parse(readFileSync(new URL('../products.json',import.meta.url),'utf8')).products||[];}catch{}
 const guides=PLACEMENT_PLAYBOOK.map(g=>({...g,listings:listings.filter(p=>Number(p.catalogProductId)===g.product).map(p=>({id:p.id,name:p.name}))}));
 return {version:PLACEMENT_POLICY_VERSION,rules:PLACEMENT_RULES.length,guides,mappedListings:guides.reduce((n,g)=>n+g.listings.length,0),note:'These directions govern new production. Existing listings are preserved. Exact coordinates still require a reviewed live garment template; unseen mockup views remain unreviewed.'};}
function table(db){db.exec('CREATE TABLE IF NOT EXISTS factory_artwork_composition(artwork TEXT PRIMARY KEY,sha256 TEXT NOT NULL,kind TEXT NOT NULL,repeat_approved INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL)');}
const hold=message=>{throw Object.assign(Error(message),{status:409});};
export function artworkComposition(db,a){table(db);const r=db.prepare('SELECT * FROM factory_artwork_composition WHERE artwork=? AND sha256=?').get(a.id,a.sha256);return {kind:r?.kind||'hero',repeatApproved:!!r?.repeat_approved,source:r?'owner':'conservative default',sha256:a.sha256};}
export function saveArtworkComposition(db,a,{kind,repeatApproved=false}){if(!ARTWORK_KINDS.includes(kind)||typeof repeatApproved!=='boolean')hold('Choose a valid artwork role and repeat permission.');if(repeatApproved&&kind!=='pattern')hold('Scenes, portraits and composed panels cannot repeat. Only an explicitly approved pattern may repeat.');table(db);db.prepare('INSERT INTO factory_artwork_composition VALUES(?,?,?,?,?) ON CONFLICT(artwork) DO UPDATE SET sha256=excluded.sha256,kind=excluded.kind,repeat_approved=excluded.repeat_approved,updated=excluded.updated').run(a.id,a.sha256,kind,Number(repeatApproved),new Date().toISOString());return artworkComposition(db,a);}
export function assertComposition(db,recipe,rows){const elements=recipe.elements||[recipe],heroes=new Set();for(let i=0;i<rows.length;i++){const e=elements[i],a=rows[i],c=artworkComposition(db,a);if(e.tile&&(c.kind!=='pattern'||!c.repeatApproved))hold('Placement hold: no automatic tiling of scenes or portraits. Classify this exact source as a pattern and explicitly approve its repeats.');if(e.tile&&!a.effectivePermissions.crop)hold('Pattern bleed requires explicit Crop permission.');if(['hero','panel'].includes(c.kind)){const region=JSON.stringify(e.geometry?.safeRect||'panel');if(heroes.has(region))hold('Placement hold: only one hero per intended region. Use separate reviewed regions or supporting motif artwork.');heroes.add(region);}}}
