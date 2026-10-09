import {createHash} from 'node:crypto';
import {tagArea,PLANS} from './factory-ideas.mjs';

// Store check: goes through every live product on the storefront (and its Printful product when Printful is connected)
// and lists what needs fixing. These are fixed checks against the store's own data, not guesses by a model.
const GENERIC=/\b(all-over print|recycled|unisex|men'?s|women'?s|cotton-blend|cotton|oversized|fleece|bomber|windbreaker|track|zip|hoodie|jacket|sweatshirt|t-shirt|athletic|joggers|leggings|backpack|fanny pack|neck gaiter|bandana|utility|yoga|crew neck|shorts|pants|tank top)\b/gi;
const AREA=a=>a.replace(/_dtfabric$/,'').replace(/_/g,' ');
const SKIP=/^(label|lining|inside|facing|details|collar|yoke|hood_inner|preview|mockup)/;
const money=n=>'$'+Number(n).toFixed(2);
const SEVERITY={high:0,medium:1,low:2};

export function storeAudit({products=[],copy={},printful=null,plans={}}){
 const issues=[],add=(product,severity,title,detail,fix)=>issues.push({id:createHash('sha256').update(product.id+'|'+title).digest('hex').slice(0,16),product:product.id,productName:product.name,url:product.url||null,image:product.image||null,severity,title,detail,fix});
 const byCatalog=new Map();for(const p of products)(byCatalog.get(p.catalogProductId)||byCatalog.set(p.catalogProductId,[]).get(p.catalogProductId)).push(p);
 const names=new Map();for(const p of products){const k=String(p.name||'').toLowerCase();names.set(k,(names.get(k)||0)+1);}
 const pf=printful?new Map(printful.map(x=>[x.id,x])):null;
 for(const p of products){
  const variants=Array.isArray(p.variants)?p.variants:[],images=Array.isArray(p.images)?p.images:[],siblings=byCatalog.get(p.catalogProductId)||[];
  if(!String(p.name||'').replace(GENERIC,'').replace(/[^a-z]/gi,''))add(p,'high','No design name',`"${p.name}" only names the blank garment, so shoppers can't tell what the design is or search for it.`,'Give it a design name like the others, for example "Crimson Throne Recycled Fleece Hoodie".');
  if((names.get(String(p.name||'').toLowerCase())||0)>1)add(p,'medium','Duplicate name',`Another product is also called "${p.name}".`,'Rename one of them so each design has its own name.');
  if(images.length<=1)add(p,'high','Only one photo',`Shoppers see a single image of this product.`,'Generate mockups in Printful (front, back, sleeves, model shots) and run the photo sync.');
  else if(images.length<5)add(p,'medium','Few photos',`Only ${images.length} photos. Your best products have 13 to 15.`,'Add back, sleeve and lifestyle mockups in Printful, then run the photo sync.');
  const text=copy[String(p.id)]?.description;
  if(!text||String(text).trim().length<80)add(p,'medium','No product description','The product page has no written description of the design, fabric and fit.','Add a description in the catalog copy (design story, materials, fit, care).');
  if(!p.category)add(p,'low','No category','The product is not in a shop category, so filters skip it.','Set its category.');
  const most=Math.max(...siblings.map(s=>(s.variants||[]).length));
  if(siblings.length>1&&variants.length<most&&variants.length<=3)add(p,'high','Missing sizes',`Only ${variants.map(v=>v.size).filter(Boolean).join(', ')||variants.length+' variant'} offered. The same item sells ${most} sizes on your other products.`,'Turn on the missing sizes in Printful so nobody leaves because their size is gone.');
  const off=variants.filter(v=>v.availability&&v.availability!=='active');
  if(off.length)add(p,'medium','Sizes out of stock',`${off.map(v=>v.size||v.name).join(', ')} ${off.length===1?'is':'are'} not available.`,'Check Printful stock or hide those sizes.');
  const bySize=new Map();for(const s of siblings)if(s!==p)for(const v of s.variants||[])if(v.size)bySize.set(v.size,[...(bySize.get(v.size)||[]),{price:v.price,name:s.name}]);
  const odd=variants.map(v=>{const o=(bySize.get(v.size)||[]).find(x=>Math.abs(x.price-v.price)>0.5);return o&&{v,o};}).filter(Boolean);
  if(odd.length){const {v,o}=odd[0];add(p,'low','Price differs from the same item',`${v.size} is ${money(v.price)} here but ${money(o.price)} on ${o.name}.`,'Use one price per size for the same garment unless the difference is on purpose.');}
  if(pf){const x=pf.get(String(p.id));
   if(!x)add(p,'high','Not found in Printful','This store product has no matching Printful product, so orders for it cannot be fulfilled.','Re-sync the product from Printful or remove it from the store.');
   else{
    if(x.ignored)add(p,'high','Ignored in Printful','Printful marks this product as ignored, so its orders are not sent to production.','Un-ignore it in the Printful store.');
    const plan=Object.values(plans.products||{}).find(q=>q.catalogProductId===(x.catalog||p.catalogProductId)),areas=Object.keys(plan?.printfiles?.available_placements||{});
    const files=new Set(x.files),has=a=>files.has(a)||files.has(a.replace(/_dtfabric$/,''))||files.has(a+'_dtfabric');
    const main=areas.filter(a=>!SKIP.test(a)),empty=main.filter(a=>!has(a));
    if(main.length&&empty.length&&!files.has('default'))add(p,empty.some(a=>/^(front|back)/.test(a))?'high':'medium','Print areas left blank',`${empty.map(AREA).join(', ')} ${empty.length===1?'has':'have'} no artwork, so ${empty.length===1?'it prints':'they print'} plain.`,'Add the matching part of the design (sleeves get the sleeve strip, the hood gets the hood panel), or confirm the blank is on purpose.');
    const tag=tagArea(areas);
    if(tag&&!has(tag))add(p,'medium','No logo on the tag',`This item has a tag print area (${AREA(tag)}) but no Midnight Design logo on it.`,'Put the Midnight Design logo on the tag. New factory products do this automatically.');
   }}
 }
 if(pf)for(const x of printful)if(!x.ignored&&!products.some(p=>String(p.id)===x.id))issues.push({id:createHash('sha256').update('pf|'+x.id).digest('hex').slice(0,16),product:x.id,productName:x.name,url:null,image:null,severity:'medium',title:'In Printful but not on the store',detail:`"${x.name}" exists in Printful but isn't listed on midnight-designs.store.`,fix:'Run the catalog sync, or ignore it in Printful if it was a test.'});
 return issues.sort((a,b)=>SEVERITY[a.severity]-SEVERITY[b.severity]||a.productName.localeCompare(b.productName));
}

export function factoryAudit({db,auth,body,send,fail,limit,origin,storefrontOrigin='https://midnight-designs.store',ideas,plans=PLANS,fetchImpl=fetch,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS audit_dismissed(id TEXT PRIMARY KEY,created TEXT NOT NULL)');
 let cache=null;
 async function load(force=false){
  if(cache&&!force&&clock()-cache.time<600000)return cache;
  const get=async f=>{const r=await fetchImpl(storefrontOrigin+'/'+f+'?t='+clock(),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`The store's ${f} answered ${r.status}.`);return r.json();};
  const [p,c]=await Promise.all([get('products.json'),get('catalog-copy.json').catch(()=>({products:{}}))]);
  if(force||!ideas?.printfulProducts())await ideas?.refreshPrintful?.().catch(()=>{});
  const state=ideas?.printfulState?.()||{state:'not_connected'};
  cache={time:clock(),products:Array.isArray(p.products)?p.products:[],copy:c.products||{},printful:ideas?.printfulProducts?.()||null,printfulState:state.state,printfulError:state.error||null,synced:p.lastSyncedAt||p.updatedAt||null};
  return cache;
 }
 async function snapshot(force){
  let data;try{data=await load(force);}catch(e){fail(502,'The store could not be read: '+(e.message||'network error'));}
  const hidden=new Set(db.prepare('SELECT id FROM audit_dismissed').all().map(r=>r.id)),all=storeAudit({...data,plans});
  const issues=all.filter(i=>!hidden.has(i.id));
  return {checked:new Date(data.time).toISOString(),synced:data.synced,products:data.products.length,printful:{state:data.printfulState,error:data.printfulError,products:data.printful?.length||0},
   counts:{high:issues.filter(i=>i.severity==='high').length,medium:issues.filter(i=>i.severity==='medium').length,low:issues.filter(i=>i.severity==='low').length,dismissed:all.length-issues.length},
   clean:data.products.filter(p=>!issues.some(i=>i.product===String(p.id))).length,issues};
 }
 return {async handle(req,res,path,method){
  if(!path.startsWith('/api/owner/ai-factory/audit'))return false;auth(req,null,true);const p=path.slice('/api/owner/ai-factory/audit'.length);
  if(method==='GET'&&p===''){send(res,200,await snapshot(false));return true;}
  if(method!=='POST')fail(405,'Use POST.');if(req.headers.origin!==origin)fail(403,'Origin rejected.');limit(req,'factory-audit',60);const b=await body(req);
  if(p==='/run'){limit(req,'factory-audit-run',10);send(res,200,await snapshot(true));return true;}
  if(p==='/dismiss'){if(typeof b.id!=='string'||!/^[0-9a-f]{16}$/.test(b.id))fail(400,'Choose an issue.');db.prepare('INSERT OR IGNORE INTO audit_dismissed VALUES(?,?)').run(b.id,new Date(clock()).toISOString());send(res,200,await snapshot(false));return true;}
  if(p==='/restore'){db.prepare('DELETE FROM audit_dismissed').run();send(res,200,await snapshot(false));return true;}
  fail(404,'Unknown store check action.');
 }};
}
