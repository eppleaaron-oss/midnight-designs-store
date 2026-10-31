import {downloadSourceArtwork,sourceArtworkUrl} from './factory-source-download.mjs';
import catalogIdentity from '../catalog-identity.js';
import {placementInstruction,placementGuide,PLACEMENT_POLICY_VERSION} from './factory-placement-playbook.mjs';
import {panelKind} from './factory-basic-layout-library.mjs';
import {checkedArtwork} from './factory-artwork-permissions.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {variantAreas} from './factory-blueprints.mjs';
import {audienceMatches} from './factory-audiences.mjs';
import {garmentColorCapability,fabricColorMatches} from './factory-color.mjs';
import {garmentColors} from './factory-rendering.mjs';
import {basicSizing} from './factory-basic-sizing.mjs';
import {loadApprovedMapping} from './factory-approved-mapping.mjs';

// All idea-room products enter the same leased production queue. This module never
// creates a supplier product, places an order, or grants publishing approval.
export function factoryWorkflow({db,manager,blueprints,artwork,rendering,publishing,storageDurable=false,requireApprovedProfiles=true,fetchImpl=fetch}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_imported_artwork(url TEXT PRIMARY KEY,artwork TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_supplier_quotes(job TEXT NOT NULL,variant INTEGER NOT NULL,cents INTEGER NOT NULL,currency TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(job,variant));`);
 const get=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a),now=()=>new Date().toISOString();
 let basicWorkspace=null;const sourceReads=new Map();
 const sizing=requireApprovedProfiles?basicSizing({db,workflow:{sourceFile:(...a)=>sourceFile(...a)}}):null;
 const hold=message=>{throw Object.assign(Error(message),{status:409});};
 function sourceFile(part,set){const key=JSON.stringify([part.artwork||part.url,set.name]);if(sourceReads.has(key))return sourceReads.get(key);const work=sourceImport(part,set);sourceReads.set(key,work);work.finally(()=>{if(sourceReads.get(key)===work)sourceReads.delete(key);}).catch(()=>{});return work;}
 async function sourceImport(part,set){
  if(part.artwork){if(!get('SELECT id FROM factory_artwork WHERE id=?',part.artwork))hold('Assigned artwork is missing.');return part.artwork;}
  const cacheKey=part.url+'#factoryCollection='+encodeURIComponent(set.name);
  const cached=get('SELECT artwork FROM factory_imported_artwork WHERE url=?',cacheKey)||get('SELECT artwork FROM factory_imported_artwork WHERE url=?',part.url);
  if(cached&&get('SELECT id FROM factory_artwork WHERE id=? AND collection=?',cached.artwork,set.name.slice(0,100))){run('INSERT OR REPLACE INTO factory_imported_artwork VALUES(?,?)',cacheKey,cached.artwork);return cached.artwork;}
  const u=sourceArtworkUrl(part.url),{data,mime}=await downloadSourceArtwork(u.href,fetchImpl),extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime];
  // Supplier imports preserve their pixels. Cropping, rotation and recoloring
  // remain disabled until the owner changes the artwork's permissions.
  const existing=get("SELECT id FROM factory_artwork WHERE sha256=? AND collection=? AND kind='original' ORDER BY created LIMIT 1",createHash('sha256').update(data).digest('hex'),set.name.slice(0,100));if(existing){run('INSERT OR REPLACE INTO factory_imported_artwork VALUES(?,?)',cacheKey,existing.id);return existing.id;}
  const id=artwork.importFile({data,filename:'printful-'+createHash('sha256').update(u.href).digest('hex').slice(0,16)+'.'+extension},{name:String(part.name||set.name).slice(0,100),collection:set.name.slice(0,100),scope:'collection',target:'',product:null,placements:['front','back','left-sleeve','right-sleeve','hood'],instructions:'Preserve the imported original artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false}});
  run('INSERT OR REPLACE INTO factory_imported_artwork VALUES(?,?)',cacheKey,id);return id;
 }
 async function enqueue({idea,set,piece,brief,aiLayout=false,variantIds=null,fixedRecipe=false,outfitId=null,storeCollection=null,numericLayout=null}){
  if(!storageDurable&&!(fixedRecipe&&basicWorkspace?.ready()))hold('Persistent factory storage must be attached before starting production.');
  const existing=get('SELECT job,printful_id FROM idea_made WHERE idea=? AND catalog=?',idea.id,piece.catalog);
  if(existing?.job&&get('SELECT id FROM factory_jobs WHERE id=?',existing.job)&&!requireApprovedProfiles)return existing.job;
  if(existing?.printful_id)hold('This item already exists in Printful. Review the existing product; a duplicate will not be created.');
  const product=await manager.productDetails(piece.catalog),blueprint=await blueprints.load(piece.catalog,'default');
  if(blueprint.source!=='live')hold('Live Printful blueprint verification failed. The stored snapshot cannot start automatic production.');
  const capability=garmentColorCapability(blueprint);if(capability.mode==='hold')hold(capability.reason);const aop=capability.mode==='print',color=piece.color||'Black';
  const candidates=product.variants.filter(v=>(!variantIds||variantIds.includes(v.id))&&(aop||fabricColorMatches(v,color)));
  if(variantIds&&variantIds.some(id=>!candidates.some(v=>v.id===id)))hold('A selected exact supplier variant is no longer available.');
  if(!candidates.length)hold('Printful has no available '+color+' fabric variants for this product.');
  const bySize=new Map();for(const v of candidates){const key=v.size||v.name;if(!bySize.has(key)||aop&&fabricColorMatches(v,'White'))bySize.set(key,v);}
  const variants=[...bySize.values()];if(!variants.length)hold('Printful has no available variants for this product.');
  const audience=piece.audience||(['unisex','men','women','children'].find(a=>product.audiences.includes(a)));
  if(!audience||!audienceMatches(product,audience,{allowUnspecified:piece.allowUnspecifiedAudience===true}))hold('Choose an audience supported by this supplier product.');
  if(requireApprovedProfiles){numericLayout=await loadApprovedMapping({product:{set,product,variants,audience,role:piece.role},blueprint,sizing,input:numericLayout?.input||null});aiLayout=false;fixedRecipe=true;if(existing?.job){const previous=JSON.parse(get('SELECT plan FROM factory_render_plans WHERE job=?',existing.job)?.plan||'{}');if(JSON.stringify(previous.numericLayout?.profileApproval)!==JSON.stringify(numericLayout.profileApproval))hold('The existing queued item needs its approved profile reconciled. A duplicate will not be created.');return existing.job;}}
  const placements={},ids=[];let collection=null;
  for(const part of numericLayout?numericLayout.bindings.filter(s=>s.part).map(s=>({...set.parts[s.part],area:s.panel})):piece.placements){if(!numericLayout&&/^pocket(?:_|$)/.test(part.area)&&piece.pocketReviewed!==true)continue;if(!numericLayout&&part.part&&/^(?:pocket|belt|waistband|collar|top|bottom)(?:_|$)/.test(part.area)&&panelKind(part.part)!==panelKind(part.area))hold('Structural panels need their own artwork assignment; a front scene or sleeve cannot be substituted.');const id=await sourceFile(part,set),row=checkedArtwork(db,id);if(!row.effectivePermissions.reuse)hold('Enable Reuse for the assigned artwork.');if(collection&&row.collection!==collection)hold('Every piece must use artwork from one collection.');collection=row.collection;ids.push(id);placements[part.area]={artworkId:id,fit:'contain',scale:100,x:0,y:0,rotation:0,mirror:false,tile:false,spacing:0,protect:!JSON.parse(row.permissions).modify&&!JSON.parse(row.permissions).recolor,recolor:null,...(fixedRecipe?{withoutEnlargement:true}:{})};}
  if(!ids.length)hold('Assign at least one original artwork file.');
  if(numericLayout&&numericLayout.variants.some(v=>!variants.some(c=>c.id===v.variant)))hold('The inspected layout variants no longer match this garment.');
  const drafts=variants.map(v=>{let areas;try{areas=variantAreas(blueprint,v.id);}catch(e){hold(e.message);}if(!aop)areas=areas.filter(a=>placements[a.placement]);
   // Labels are optional. They require a separate owner-selected label file.
   areas=areas.filter(a=>!/^label/.test(a.placement)||placements[a.placement]);
   if(numericLayout){const saved=numericLayout.variants.find(d=>d.variant===v.id);if(!saved)hold('The inspected variant layout is missing.');areas=saved.areas;}
   if(!areas.length)hold('This exact variant has no supported artwork placements.');
   if(!numericLayout&&Object.keys(placements).some(p=>!variantAreas(blueprint,v.id).some(a=>a.placement===p)))hold('Artwork was assigned to an unsupported placement for '+v.name+'.');
   for(const area of areas)if(!placements[area.placement])placements[area.placement]={fillOnly:true,fit:'contain',protect:true};
   return {id:randomUUID(),variant:v.id,areas};});
  // Creator assignments remain subject to the existing employee controls.
  const prepared=await manager.prepareJob({title:(set.name+' '+piece.label).slice(0,100),brief:(placementInstruction(piece.catalog)+'\n'+brief).slice(0,6000),kind:idea.kind,gender:audience,employee:piece.role,selection:{allowUnspecifiedAudience:piece.allowUnspecifiedAudience===true,product:piece.catalog,fit:'',sizes:variants.map(v=>v.size).filter(Boolean),collection,artworkIds:[...new Set(ids)]}});
  prepared.assigned=drafts.map(d=>d.id);if(idea.kind==='outfit'){prepared.selection.outfitId=idea.id;prepared.selection.storeCollection=set.name.slice(0,100)+' outfit';}if(outfitId){prepared.selection.outfitId=outfitId;prepared.selection.storeCollection=storeCollection||set.name.slice(0,100)+' outfit';}prepared.selection.variantIds=variants.map(v=>v.id);prepared.selection.garmentColor=color;prepared.selection.colorMode=aop?'print':'fabric';
  const identity=catalogIdentity.normalize({id:set.id,sourceProductId:set.id,outfitId,catalogProductId:piece.catalog,supplierCatalogTitle:blueprint.name,name:set.name+' '+piece.label,collectionName:storeCollection||set.name,collections:[set.name]});
  const copy={title:identity.name.slice(0,150),description:(identity.collectionName||set.name)+' artwork on '+blueprint.name+'. '+(aop?'Printed background: '+color+'.':'Garment color: '+color+'.'),category:identity.category,categoryId:identity.categoryId,tags:product.audiences.length?[piece.role,audience]:[piece.role],collections:identity.collections||[set.name.slice(0,100)]};
  db.exec('BEGIN IMMEDIATE');try{
   if(get('SELECT count(*) n FROM factory_print_drafts').n+drafts.length>500)hold('Blueprint storage limit reached. Archive unused product blueprints.');
   for(const d of drafts)run('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)',d.id,copy.title.slice(0,100),piece.catalog,d.variant,blueprint.effectiveTechnique||blueprint.technique,JSON.stringify(d.areas),'live',now());
   manager.insertJob(prepared);rendering.savePlan(prepared.id,{mappingPolicyRequired:requireApprovedProfiles,placementPolicy:{version:PLACEMENT_POLICY_VERSION,guide:placementGuide(piece.catalog)},...(numericLayout?{numericLayout}:{}),background:aop?(garmentColors[color]||color):null,colorMode:aop?'print':'fabric',placements,garmentColor:color,colorCapability:capability,continueAcrossPanels:false,aiLayout,artworkEdits:fixedRecipe?{enabled:false}:rendering.artworkRules()});publishing.saveCopy(prepared.id,copy);if(numericLayout)run('INSERT INTO factory_job_layouts(job,category,layout,created) VALUES(?,?,?,?) ON CONFLICT(job) DO UPDATE SET layout=excluded.layout',prepared.id,piece.role,JSON.stringify(numericLayout),now());
   for(const v of variants){const numeric=Number(v.price);if(v.price!==null&&v.price!==undefined&&String(v.price).trim()&&Number.isFinite(numeric)&&numeric>0&&v.currency==='USD')run('INSERT INTO factory_supplier_quotes VALUES(?,?,?,?,?,?)',prepared.id,v.id,Math.round(numeric*100),'USD','Printful catalog product '+piece.catalog,now());}
   const madeId=existing?get('SELECT id FROM idea_made WHERE idea=? AND catalog=?',idea.id,piece.catalog).id:randomUUID();
   run("INSERT INTO idea_made(id,idea,set_id,set_name,catalog,category,name,status,created,updated,job) VALUES(?,?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT(idea,catalog) DO UPDATE SET job=excluded.job,status='queued',error=NULL,updated=excluded.updated",madeId,idea.id,set.id,set.name,piece.catalog,piece.role,copy.title,now(),now(),prepared.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return prepared.id;
 }
 return {sourceFile,requiresApprovedProfiles:requireApprovedProfiles,setBasicWorkspace(w){basicWorkspace=w;},enqueue,ready:()=>storageDurable};
}
