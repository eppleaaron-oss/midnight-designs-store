import {randomUUID,createHash} from 'node:crypto';
import {variantAreas} from './factory-blueprints.mjs';
import {audienceMatches} from './factory-audiences.mjs';
import {garmentColors} from './factory-rendering.mjs';

// All idea-room products enter the same leased production queue. This module never
// creates a supplier product, places an order, or grants publishing approval.
export function factoryWorkflow({db,manager,blueprints,artwork,rendering,publishing,storageDurable=false,fetchImpl=fetch}){
 db.exec(`CREATE TABLE IF NOT EXISTS factory_imported_artwork(url TEXT PRIMARY KEY,artwork TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS factory_supplier_quotes(job TEXT NOT NULL,variant INTEGER NOT NULL,cents INTEGER NOT NULL,currency TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(job,variant));`);
 const get=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a),now=()=>new Date().toISOString();
 const hold=message=>{throw Object.assign(Error(message),{status:409});};
 async function sourceFile(part,set){
  if(part.artwork){if(!get('SELECT id FROM factory_artwork WHERE id=?',part.artwork))hold('Assigned artwork is missing.');return part.artwork;}
  const cached=get('SELECT artwork FROM factory_imported_artwork WHERE url=?',part.url);
  if(cached&&get('SELECT id FROM factory_artwork WHERE id=?',cached.artwork))return cached.artwork;
  let u;try{u=new URL(part.url);}catch{hold('Import the original artwork into the upload library first.');}
  if(u.protocol!=='https:'||!u.hostname.endsWith('.printful.com')||u.username||u.password)hold('Import the original artwork into the upload library. This external file host is not supported.');
  const r=await fetchImpl(u.href,{redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!r.ok||!['image/png','image/jpeg','image/webp'].includes(r.headers.get('content-type')?.split(';')[0]))hold('The original Printful artwork could not be downloaded. Upload its original PNG, JPEG or WebP file.');
  let bytes=0;const chunks=[];for await(const chunk of r.body){bytes+=chunk.length;if(bytes>5*1024*1024)hold('Original artwork exceeds 5 MB. Import a smaller original file.');chunks.push(chunk);}
  const data=Buffer.concat(chunks),extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[r.headers.get('content-type').split(';')[0]];
  // Supplier imports preserve their pixels. Cropping, rotation and recoloring
  // remain disabled until the owner changes the artwork's permissions.
  const id=artwork.importFile({data,filename:'printful-'+createHash('sha256').update(u.href).digest('hex').slice(0,16)+'.'+extension},{name:String(part.name||set.name).slice(0,100),collection:set.name.slice(0,100),scope:'collection',target:'',product:null,placements:['front','back','left-sleeve','right-sleeve','hood'],instructions:'Preserve the imported original artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false}});
  run('INSERT OR REPLACE INTO factory_imported_artwork VALUES(?,?)',u.href,id);return id;
 }
 async function enqueue({idea,set,piece,brief,aiLayout=false}){
  if(!storageDurable)hold('Persistent factory storage must be attached before starting production.');
  const existing=get('SELECT job,printful_id FROM idea_made WHERE idea=? AND catalog=?',idea.id,piece.catalog);
  if(existing?.job&&get('SELECT id FROM factory_jobs WHERE id=?',existing.job))return existing.job;
  if(existing?.printful_id)hold('This item already exists in Printful. Review the existing product; a duplicate will not be created.');
  const product=await manager.productDetails(piece.catalog),blueprint=await blueprints.load(piece.catalog,'default');
  if(blueprint.source!=='live')hold('Live Printful blueprint verification failed. The stored snapshot cannot start automatic production.');
  const aop=/all-over print/i.test(blueprint.name),color=piece.color||'Black';
  const candidates=product.variants.filter(v=>aop||v.color.toLowerCase()===color.toLowerCase());
  if(!candidates.length)hold('Printful has no available '+color+' fabric variants for this product.');
  const bySize=new Map();for(const v of candidates){const key=v.size||v.name;if(!bySize.has(key)||aop&&v.color.toLowerCase()==='white')bySize.set(key,v);}
  const variants=[...bySize.values()];if(!variants.length)hold('Printful has no available variants for this product.');
  const audience=piece.audience||(['unisex','men','women','children'].find(a=>product.audiences.includes(a)));
  if(!audience||!audienceMatches(product,audience))hold('Choose an audience supported by this supplier product.');
  const placements={},ids=[];let collection=null;
  for(const part of piece.placements){const id=await sourceFile(part,set),row=get('SELECT collection,permissions FROM factory_artwork WHERE id=?',id);if(!JSON.parse(row.permissions).reuse)hold('Enable Reuse for the assigned artwork.');if(collection&&row.collection!==collection)hold('Every piece must use artwork from one collection.');collection=row.collection;ids.push(id);placements[part.area]={artworkId:id,fit:'contain',scale:100,x:0,y:0,rotation:0,mirror:false,tile:false,spacing:0,protect:!JSON.parse(row.permissions).modify&&!JSON.parse(row.permissions).recolor,recolor:null};}
  if(!ids.length)hold('Assign at least one original artwork file.');
  const drafts=variants.map(v=>{let areas;try{areas=variantAreas(blueprint,v.id);}catch(e){hold(e.message);}if(!aop)areas=areas.filter(a=>placements[a.placement]);
   // Labels are optional. They require a separate owner-selected label file.
   areas=areas.filter(a=>!/^label/.test(a.placement)||placements[a.placement]);
   if(!areas.length)hold('This exact variant has no supported artwork placements.');
   if(Object.keys(placements).some(p=>!variantAreas(blueprint,v.id).some(a=>a.placement===p)))hold('Artwork was assigned to an unsupported placement for '+v.name+'.');
   for(const area of areas)if(!placements[area.placement])placements[area.placement]={fillOnly:true,fit:'contain',protect:true};
   return {id:randomUUID(),variant:v.id,areas};});
  // Creator assignments remain subject to the existing employee controls.
  const prepared=await manager.prepareJob({title:(set.name+' '+piece.label).slice(0,100),brief,kind:idea.kind,gender:audience,employee:piece.role,selection:{product:piece.catalog,fit:'',sizes:variants.map(v=>v.size).filter(Boolean),collection,artworkIds:[...new Set(ids)]}});
  prepared.assigned=drafts.map(d=>d.id);if(idea.kind==='outfit'){prepared.selection.outfitId=idea.id;prepared.selection.storeCollection=set.name.slice(0,100)+' outfit';}prepared.selection.variantIds=variants.map(v=>v.id);prepared.selection.garmentColor=color;prepared.selection.colorMode=aop?'print':'fabric';
  const copy={title:(set.name+' '+piece.label).slice(0,150),description:set.name+' artwork on '+blueprint.name+'. '+(aop?'Printed background: '+color+'.':'Garment color: '+color+'.'),category:piece.role,tags:[piece.role,audience],collections:[set.name.slice(0,100)]};
  db.exec('BEGIN IMMEDIATE');try{
   if(get('SELECT count(*) n FROM factory_print_drafts').n+drafts.length>500)hold('Blueprint storage limit reached. Archive unused product blueprints.');
   for(const d of drafts)run('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)',d.id,copy.title.slice(0,100),piece.catalog,d.variant,'default',JSON.stringify(d.areas),'live',now());
   manager.insertJob(prepared);rendering.savePlan(prepared.id,{background:aop?(garmentColors[color]||color):null,colorMode:aop?'print':'fabric',placements,continueAcrossPanels:false,aiLayout});publishing.saveCopy(prepared.id,copy);
   for(const v of variants){const numeric=Number(v.price);if(v.price!==null&&v.price!==undefined&&String(v.price).trim()&&Number.isFinite(numeric)&&numeric>0&&v.currency==='USD')run('INSERT INTO factory_supplier_quotes VALUES(?,?,?,?,?,?)',prepared.id,v.id,Math.round(numeric*100),'USD','Printful catalog product '+piece.catalog,now());}
   const madeId=existing?get('SELECT id FROM idea_made WHERE idea=? AND catalog=?',idea.id,piece.catalog).id:randomUUID();
   run("INSERT INTO idea_made(id,idea,set_id,set_name,catalog,category,name,status,created,updated,job) VALUES(?,?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT(idea,catalog) DO UPDATE SET job=excluded.job,status='queued',error=NULL,updated=excluded.updated",madeId,idea.id,set.id,set.name,piece.catalog,piece.role,copy.title,now(),now(),prepared.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return prepared.id;
 }
 return {enqueue,ready:()=>storageDurable};
}
