import {visibleGeometry} from './factory-artwork-bounds.mjs';
import {factoryQuality} from './factory-quality.mjs';
import {legRegions} from './factory-placement-regions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createService} from './server.mjs';
import {SIZING_RULES} from './factory-sizing-rules.mjs';
import {BASIC_LAYOUT_VERSION,BASIC_LAYOUTS} from './factory-basic-layout-library.mjs';

async function fixture(t,{pants=false,shoes=false}={}){
 const origin='http://localhost:3000',salt='aa'.repeat(16),token='sizing-test-worker-'.repeat(3),product={id:shoes?513:pants?1479:328,title:shoes?"Men's High Top Canvas Shoes":pants?'All-Over Print Unisex Cotton Wide-Leg Pants':'All-Over Print Unisex T-Shirt',type:shoes?'SHOES':pants?'DIRECT-TO-FABRIC':'CUT-SEW',type_name:shoes?'Shoes':pants?'Pants':'T-Shirt',currency:'USD'};
 const variants=[{id:3281,size:'M',color:'White',price:'20.00',in_stock:true},{id:3282,size:'L',color:'White',price:'21.00',in_stock:true}];
 const response=result=>new Response(JSON.stringify({result}),{headers:{'Content-Type':'application/json'}});
 const fetchImpl=async url=>{url=String(url);if(url.endsWith('/products'))return response([product]);if(url.endsWith('/products/'+product.id))return response({product,variants});if(url.includes('/v2/'))return new Response(JSON.stringify({data:{type:shoes?'SHOES':pants?'DIRECT-TO-FABRIC':'CUT-SEW',techniques:[{key:shoes?'sublimation':pants?'direct-to-fabric':'cut-sew',is_default:true}]}}));if(shoes&&url.includes('/printfiles/'))return response({available_placements:{shoe_quarters_left:'Left shoe quarters',shoe_quarters_right:'Right shoe quarters',shoe_tongue_left:'Left shoe tongue',shoe_tongue_right:'Right shoe tongue',label_inside:'Branding'},printfiles:[{printfile_id:260,width:2250,height:2250,dpi:150},{printfile_id:263,width:1050,height:600,dpi:150}],variant_printfiles:variants.map(v=>({variant_id:v.id,placements:{shoe_quarters_left:260,shoe_quarters_right:260,shoe_tongue_left:260,shoe_tongue_right:260,label_inside:263}}))});if(url.includes('/printfiles/'))return response({available_placements:{front:'Front',back:'Back'},printfiles:pants?[{printfile_id:1563,width:2040,height:1500,dpi:30}]:[{printfile_id:1,width:1800,height:2400,dpi:150},{printfile_id:2,width:2100,height:2700,dpi:150}],variant_printfiles:variants.map((v,i)=>({variant_id:v.id,placements:{front:pants?1563:i+1,back:pants?1563:i+1}})),option_groups:["Men's"]});if(url.includes('/templates/'))return response(pants?{templates:[{template_id:1100803,image_url:'https://files.cdn.printful.com/o/upload/api-template/c9/c954949c18e77172acd369ba80c139f0?v=1772003399',template_width:3000,template_height:3000,print_area_left:0,print_area_top:395,print_area_width:3000,print_area_height:2208}],variant_mapping:variants.map(v=>({variant_id:v.id,templates:[{placement:'front',template_id:1100803}]}))}:{templates:[],variant_mapping:[]});throw Error('Unexpected sizing fixture request: '+url);};
 const service=createService({dbPath:':memory:',origin,secure:false,factoryLoginRequired:false,passwordHash:salt+':'+scryptSync('sizing-fixture',salt,64).toString('hex'),factorySettings:{token:'supplier-test',fetchImpl},blueprintSettings:{token:'supplier-test',fetchImpl,plans:{products:{}}},productionSettings:{storageDurable:true,workerToken:token},workflowSettings:{storageDurable:true,fetchImpl},publishingSettings:{token:'supplier-test',githubToken:'store-test',storageDurable:true,fetchImpl},ideaSettings:{env:{},catalog:[]}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.server.close(r)));const url='http://127.0.0.1:'+service.server.address().port,db=service.db;
 async function call(path,b,machine=false){const r=await fetch(url+path,{method:b?'POST':'GET',headers:{Origin:origin,...(b?{'Content-Type':'application/json'}:{}),...(machine?{Authorization:'Bearer '+token}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json()};}
 const api=(path,b)=>call('/api/owner/ai-factory/'+path,b),basic=(path,b)=>api('basic'+path,b),machine=(path,b={})=>call('/internal/factory/'+path,{worker:'sizing-worker',...b},true);
 await api('budget',{dailyBudget:100,totalBudget:100});await machine('heartbeat');
 const png=await sharp({create:{width:900,height:1200,channels:4,background:'#cc3333'}}).png().toBuffer();
 const uploaded=await api('artwork/upload',{name:'Sizing graphic',collection:'Sizing collection',scope:'collection',target:'',product:null,placements:['front','back'],instructions:'Preserve artwork.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'art.png',base64:png.toString('base64')}]});assert.equal(uploaded.status,200);const art=uploaded.data.artworks[0].id;
 const part={artwork:art,name:'Sizing graphic',url:'/api/owner/ai-factory/artwork/'+art+'/file'},set='sizing:collection';db.prepare('INSERT INTO idea_sets(id,source,name,parts,jacket,updated) VALUES(?,?,?,?,?,?)').run(set,'printful','Sizing collection',JSON.stringify({front:part,back:part}),0,new Date().toISOString());
 const choice={setId:set,product:product.id,sizes:['M'],audience:shoes?'men':'unisex'};
 async function profile({anchor='center_front',placement='front',xIn=6,yIn=7,sizes=['M']}={}){const p=await basic('/inspect',{...choice,sizes,geometryOnly:true});assert.equal(p.status,200,JSON.stringify(p.data));const area=p.data.layoutOptions.areas.find(a=>a.placement===placement);const saved=await basic('/layouts/profile',{...choice,sizes,areaKey:area.key,safeRect:{x:0.5,y:0.5,width:area.widthIn-1,height:area.heightIn-1},anchor,xIn,yIn,reviewed:true,orientation:'wearer',reference:'Fixture: exact garment print guideline and seam review'});assert.equal(saved.status,200,JSON.stringify(saved.data));return saved.data;}
 const layout=(number,overrides={},assignments={})=>({number,version:BASIC_LAYOUT_VERSION,assignments,overrides,scaleMode:'fixed'});
 async function step(){const c=await machine('claim');assert.ok(c.data.job,JSON.stringify(c.data));const r=await machine('step',{job:c.data.job,lease:c.data.lease});assert.equal(r.status,200,JSON.stringify(r.data));return r;}
 return {service,db,url,call,api,basic,machine,choice,profile,layout,step,art,set};
}

test('sizing rules are separate locked Brain records and the 66 layouts explicitly identify unsupported compositions',async t=>{
 const f=await fixture(t),brain=(await f.api('intelligence')).data;
 assert.equal(SIZING_RULES.length,13);for(const [,title,body]of SIZING_RULES){const rules=brain.rules.filter(r=>r.title===title);assert.equal(rules.length,1,title);assert.equal(rules[0].locked,1);assert.equal(rules[0].body,body);}
 assert.equal(BASIC_LAYOUTS.filter(l=>l.number<=66).length,66);assert.equal(BASIC_LAYOUTS.find(l=>l.number===67).category,'footwear');assert.equal(BASIC_LAYOUTS.find(l=>l.number===7).supported,false);assert.match(BASIC_LAYOUTS.find(l=>l.number===7).reason,/multi-element/);
 const knowledge=(await f.api('intelligence/knowledge/tshirt')).data.text;assert.match(knowledge,/garment size, print canvas, and artwork size/);assert.match(knowledge,/Effective horizontal resolution/);assert.match(knowledge,/3.5/);
});

test('a canvas shoe pair preserves separate quarter artwork and exports four native panels without repeating a scene',async t=>{
 const f=await fixture(t,{shoes:true}),base=await f.basic('/inspect',{...f.choice,geometryOnly:true});
 assert.equal(base.status,200,JSON.stringify(base.data));const option=base.data.layoutOptions.layouts.find(l=>l.number===67);assert.equal(option.compatible,true);assert.equal(option.pattern,false);
 const request={...f.choice,layout:f.layout(67)};const missing=await f.basic('/inspect',request);assert.equal(missing.status,409);assert.match(missing.data.error,/Review the shoe_quarters_left safe region/);
 await f.profile({placement:'shoe_quarters_left',anchor:'outer_canvas',xIn:7.5,yIn:7.5});await f.profile({placement:'shoe_quarters_right',anchor:'outer_canvas',xIn:7.5,yIn:7.5});
 const p=await f.basic('/inspect',request);assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.numericLayout.requiresAcceptance,false);assert.deepEqual(p.data.numericLayout.bindings.map(b=>b.part),['front','back',null,null]);
 for(const placement of ['shoe_quarters_left','shoe_quarters_right'])assert.equal(p.data.numericLayout.variants[0].placements[placement].tile,false);
 const created=await f.basic('/create',{...request,inspectionToken:p.data.inspectionToken,requestKey:randomUUID()});assert.equal(created.status,200,JSON.stringify(created.data));for(let i=0;i<3;i++)await f.step();
 const files=f.db.prepare('SELECT placement,width,height,data FROM factory_print_files').all();assert.deepEqual(files.map(f=>f.placement).sort(),['shoe_quarters_left','shoe_quarters_right','shoe_tongue_left','shoe_tongue_right']);assert.ok(files.every(f=>f.width===2250&&f.height===2250));
 for(const file of files.filter(f=>f.placement.includes('tongue'))){const stats=await sharp(Buffer.from(file.data)).stats();assert.ok(stats.channels.slice(0,3).every(c=>c.max===0),'unassigned optional tongue panels are deliberately black');}
 assert.equal(files.some(f=>f.placement.includes('label')),false,'branding is not invented');assert.equal((await f.basic('')).data.active.listing?.store_id||null,null,'rendering does not publish a listing');
});

test('a 3.5-inch chest stays 525 pixels wide on the full native canvas, and reviewed geometry stays frozen after global changes',async t=>{
 const f=await fixture(t);await f.profile({anchor:'left_chest',xIn:8.5,yIn:3.5});await f.profile({placement:'back',anchor:'center_back'});
 const request={...f.choice,layout:f.layout(1,{back:{widthIn:4,heightIn:6}})};
 const inspected=await f.basic('/inspect',request);assert.equal(inspected.status,200,JSON.stringify(inspected.data));const p=inspected.data,front=p.numericLayout.variants[0].measurements.find(m=>m.placement==='front');
 assert.equal(front.widthIn,3.5);assert.equal(front.geometry.width,525);assert.equal(front.canvas.width,1800);assert.equal(front.canvas.height,2400);assert.ok(front.effectiveDpi>=150);
 const created=await f.basic('/create',{...request,inspectionToken:p.inspectionToken,requestKey:randomUUID()});assert.equal(created.status,200,JSON.stringify(created.data));const item=created.data;
 await f.profile({anchor:'left_chest',xIn:5,yIn:4});await f.api('layouts',{category:'shirts',number:9});
 for(let i=0;i<3;i++)assert.equal((await f.step()).data.status,'queued');
 const draft=JSON.parse(f.db.prepare('SELECT templates FROM factory_job_profiles WHERE job=?').get(item.job).templates)[0],file=f.db.prepare("SELECT * FROM factory_print_files WHERE draft=? AND placement='front'").get(draft),recipe=JSON.parse(f.db.prepare('SELECT recipe FROM factory_render_files WHERE file=?').get(file.id).recipe);
 assert.deepEqual(recipe.geometry,front.geometry);assert.equal(recipe.geometry.width,525);assert.equal(file.width,1800);assert.equal(file.height,2400);
 const raw=await sharp(Buffer.from(file.data)).ensureAlpha().raw().toBuffer(),at=(x,y)=>[...raw.subarray((y*file.width+x)*4,(y*file.width+x)*4+4)];
 assert.deepEqual(at(10,10),[0,0,0,255]);assert.deepEqual(at(front.geometry.x+20,front.geometry.y+20),[204,51,51,255]);
 const frozen=JSON.parse(f.db.prepare('SELECT layout FROM factory_job_layouts WHERE job=?').get(item.job).layout);assert.equal(frozen.number,1);assert.equal(frozen.variants[0].placements.front.geometry.width,525);
 const report=JSON.parse(f.db.prepare('SELECT report FROM factory_quality_reports WHERE job=?').get(item.job).report);assert.equal(report.passed,true);
});

test('missing required front artwork stops; a back-only layout deliberately renders a solid black front',async t=>{
 const f=await fixture(t);const parts=JSON.parse(f.db.prepare('SELECT parts FROM idea_sets WHERE id=?').get(f.set).parts);delete parts.front;f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify(parts),f.set);
 const missing=await f.basic('/inspect',{...f.choice,layout:f.layout(5)});assert.equal(missing.status,409);assert.match(missing.data.error,/requires front artwork/);
 await f.profile({placement:'back',anchor:'center_back'});const request={...f.choice,layout:f.layout(9,{back:{widthIn:4,heightIn:6}})},p=await f.basic('/inspect',request);assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.numericLayout.variants[0].placements.front.fillOnly,true);
 const created=await f.basic('/create',{...request,inspectionToken:p.data.inspectionToken,requestKey:randomUUID()});assert.equal(created.status,200,JSON.stringify(created.data));for(let i=0;i<3;i++)await f.step();
 const file=f.db.prepare("SELECT data FROM factory_print_files WHERE placement='front'").get(),stats=await sharp(Buffer.from(file.data)).stats();assert.ok(stats.channels.slice(0,3).every(c=>c.max===0));
});

test('layout receipts reject changed sizes, positions, profiles and missing acceptance; each variant keeps fixed physical inches',async t=>{
 const f=await fixture(t);await f.profile();await f.profile({sizes:['L'],xIn:7,yIn:8});
 const request={...f.choice,layout:f.layout(5)},checked=await f.basic('/inspect',request);assert.equal(checked.status,200);assert.equal(checked.data.numericLayout.requiresAcceptance,true,'7-inch preset exceeds the 900-pixel source width');
 const attempt=await f.basic('/create',{...request,inspectionToken:checked.data.inspectionToken,requestKey:randomUUID()});assert.equal(attempt.status,409);assert.match(attempt.data.error,/accept the proposed size/i);
 const small={...request,layout:f.layout(5,{front:{widthIn:3.5,heightIn:5}})},p=(await f.basic('/inspect',small)).data;
 for(const edited of [{...small,sizes:['L']},{...small,layout:f.layout(5,{front:{widthIn:4,heightIn:5}})}]){const r=await f.basic('/create',{...edited,inspectionToken:p.inspectionToken,requestKey:randomUUID()});assert.equal(r.status,409);assert.match(r.data.error,/Inspect this exact recipe again/);}
 const all=await f.basic('/inspect',{...small,sizes:['M','L']});assert.equal(all.status,200,JSON.stringify(all.data));assert.deepEqual(all.data.numericLayout.variants.map(v=>v.measurements.find(m=>m.placement==='front').geometry.width),[525,525]);assert.deepEqual(all.data.numericLayout.variants.map(v=>v.areas[0].width),[1800,2100]);
 await f.profile({xIn:5});const stale=await f.basic('/create',{...small,inspectionToken:p.inspectionToken,requestKey:randomUUID()});assert.equal(stale.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});

test('accepted sizing reductions stay explicit, distinct layouts have distinct recipes, and rejected layout records survive cleanup',async t=>{
 const f=await fixture(t);await f.profile();
 const layout={...f.layout(5),acceptReduction:true},p=await f.basic('/inspect',{...f.choice,layout});assert.equal(p.status,200);assert.equal(p.data.numericLayout.requiresAcceptance,false);assert.ok(p.data.numericLayout.reductions.length);assert.equal(p.data.numericLayout.variants[0].measurements[0].widthIn,6);
 const first=await f.basic('/create',{...f.choice,layout,inspectionToken:p.data.inspectionToken,requestKey:randomUUID()});assert.equal(first.status,200,JSON.stringify(first.data));
 assert.equal((await f.basic('/disapprove',{id:first.data.id,confirm:true})).status,200);const history=(await f.basic('')).data.recent[0];assert.equal(history.recipe.layout.number,5);assert.equal(history.cleanup.verified,true);
 const secondLayout={...layout,number:10},secondInspection=await f.basic('/inspect',{...f.choice,layout:secondLayout});assert.equal(secondInspection.status,200);
 const second=await f.basic('/create',{...f.choice,layout:secondLayout,inspectionToken:secondInspection.data.inspectionToken,requestKey:randomUUID()});assert.equal(second.status,200,JSON.stringify(second.data));assert.notEqual(first.data.recipe_key,second.data.recipe_key);
 assert.equal((await f.basic('/layouts/profile',{...f.choice,reviewed:false})).status,400);
 assert.ok(f.db.prepare('SELECT length(data) n FROM factory_artwork WHERE id=?').get(f.art).n>0);
});


test('combined pants canvas exports two independent leg graphics with an empty crotch gap and source proofs for both',async t=>{
 const f=await fixture(t,{pants:true}),url='/api/owner/ai-factory/artwork/';
 const blue=await sharp({create:{width:600,height:1800,channels:4,background:'#2233cc'}}).png().toBuffer(),up=await f.api('artwork/upload',{name:'Right leg blue',collection:'Sizing collection',scope:'collection',target:'',product:null,placements:['front'],instructions:'Preserve.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'blue.png',base64:blue.toString('base64')}]});assert.equal(up.status,200);const right=up.data.artworks[0].id;
 f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify({sleeve_left:{artwork:f.art,name:'Left red',url:url+f.art+'/file'},sleeve_right:{artwork:right,name:'Right blue',url:url+right+'/file'}}),f.set);
 const padded=await sharp({create:{width:900,height:1200,channels:4,background:'#000000'}}).composite([{input:await sharp({create:{width:120,height:1000,channels:4,background:'#cc3333'}}).png().toBuffer(),left:390,top:100}]).png().toBuffer(),leftUp=await f.api('artwork/upload',{name:'Left padded strip',collection:'Sizing collection',scope:'collection',target:'',product:null,placements:['front'],instructions:'Preserve.',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'left.png',base64:padded.toString('base64')}]});assert.equal(leftUp.status,200);const left=leftUp.data.artworks[0].id;const parts=JSON.parse(f.db.prepare('SELECT parts FROM idea_sets WHERE id=?').get(f.set).parts);parts.sleeve_left={artwork:left,name:'Padded red strip',url:url+left+'/file'};f.db.prepare('UPDATE idea_sets SET parts=? WHERE id=?').run(JSON.stringify(parts),f.set);
 const layout=f.layout(42),choice={...f.choice,layout},reply=await f.basic('/inspect',choice);assert.equal(reply.status,200,JSON.stringify(reply.data));const p=reply.data,front=p.numericLayout.variants[0].measurements.filter(m=>m.placement==='front');assert.equal(front.length,2);assert.deepEqual(new Set(front.map(m=>m.region)),new Set(['leg_left','leg_right']));assert.ok(front.every(m=>{const v=visibleGeometry(m.geometry);return v.x+v.width<900||v.x>1100;}),'neither graphic overlaps the center gap');assert.equal(p.numericLayout.requiresAcceptance,false);const leftSize=front.find(m=>m.region==='leg_left');assert.equal(leftSize.heightIn,16);assert.equal(leftSize.widthIn,1.92);assert.ok(leftSize.geometry.width>leftSize.geometry.safeRect.width,'full original extends beyond region but its visible artwork stays inside');
 const bad=await f.basic('/inspect',{...choice,layout:f.layout(42,{leg_left:{xIn:34}})});assert.equal(bad.status,409);assert.match(bad.data.error,/outside the reviewed safe region/);
 const made=await f.basic('/create',{...choice,inspectionToken:p.inspectionToken,requestKey:randomUUID()});assert.equal(made.status,200,JSON.stringify(made.data));for(let i=0;i<3;i++)await f.step();
 const file=f.db.prepare("SELECT f.* FROM factory_print_files f JOIN factory_job_profiles p ON f.draft IN (SELECT value FROM json_each(p.templates)) WHERE p.job=? AND f.placement='front'").get(made.data.job);assert.ok(file);const png=Buffer.from(file.data),at=async(x,y)=>[...await sharp(png).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer()];
 assert.deepEqual(await at(1020,750),[0,0,0]);for(const m of front)assert.deepEqual(await at(Math.round(visibleGeometry(m.geometry).x)+5,Math.round(visibleGeometry(m.geometry).y)+5),m.region==='leg_left'?[204,51,51]:[34,51,204]);
 const qc=factoryQuality({db:f.db});assert.equal((await qc.check(made.data.job)).passed,true);f.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify({reuse:false,crop:false,modify:false,recolor:false}),right);assert.throws(()=>qc.assert(made.data.job),/permission/);
 const native=p.numericLayout.variants[0].areas[0];assert.equal(legRegions(1479,{...native,template:{...native.template,template_id:999}}).length,0,'unknown supplier templates cannot inherit a checked leg map');
});

test('placement migration preserves owner memories, maps the catalog and seeds seven locked rules once',async t=>{
 const {PLACEMENT_RULES,PLACEMENT_PLAYBOOK,playbookSnapshot}=await import('./factory-placement-playbook.mjs');
 const {factoryIntelligence}=await import('./factory-intelligence.mjs');
 const f=await fixture(t),brain=(await f.api('intelligence')).data;
 assert.equal(PLACEMENT_PLAYBOOK.length,21);assert.equal(new Set(PLACEMENT_PLAYBOOK.map(g=>g.product)).size,21);
 const catalog=JSON.parse((await import('node:fs')).readFileSync(new URL('../products.json',import.meta.url))).products;
 const snapshot=playbookSnapshot();assert.deepEqual(new Set(snapshot.guides.flatMap(g=>g.listings.map(p=>p.id))),new Set(catalog.filter(p=>PLACEMENT_PLAYBOOK.some(g=>g.product===p.catalogProductId)).map(p=>p.id)));
 for(const [,title,body]of PLACEMENT_RULES){const rows=brain.rules.filter(r=>r.title===title);assert.equal(rows.length,1);assert.equal(rows[0].locked,1);assert.equal(rows[0].body,body);}
 assert.match(brain.rules.find(r=>r.title==='Pocket lines up with the front').body,/black by default/);
 await f.api('intelligence/memory',{kind:'preference',text:'Preserve my custom midnight reference.'});
 const n=f.db.prepare('SELECT count(*) n FROM brain_rules').get().n;factoryIntelligence({db:f.db});assert.equal(f.db.prepare('SELECT count(*) n FROM brain_rules').get().n,n);assert.equal(f.db.prepare("SELECT count(*) n FROM brain_memories WHERE text='Preserve my custom midnight reference.'").get().n,1);
 const text=(await f.api('intelligence/knowledge/tshirt')).data.text;assert.match(text,/No automatic tiling of scenes or portraits/);
});

test('only owner-approved pattern versions may repeat, including direct render and cached render requests',async t=>{
 const f=await fixture(t),{assertComposition,artworkComposition}=await import('./factory-placement-playbook.mjs');
 const source=f.db.prepare('SELECT * FROM factory_artwork WHERE id=?').get(f.art),permissions={reuse:true,crop:true,modify:false,recolor:false};
 f.db.prepare('UPDATE factory_artwork SET permissions=? WHERE id=?').run(JSON.stringify(permissions),f.art);
 const draft=await f.api('blueprints/draft',{title:'Pattern guard',product:328,variant:3281,technique:'default',placements:['front']});assert.equal(draft.status,200,JSON.stringify(draft.data));
 const path='rendering/draft/'+draft.data.id,plan={background:'Black',placements:{front:{artworkId:f.art,fit:'contain',tile:true,scale:50,spacing:100}}};
 let response=await f.api(path,plan);assert.equal(response.status,409);assert.match(response.data.error,/no automatic tiling/i);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_print_files').get().n,0);
 assert.equal((await f.api('intelligence/composition',{artwork:f.art,kind:'hero',repeatApproved:true})).status,409);
 assert.equal((await f.api('intelligence/composition',{artwork:f.art,kind:'pattern',repeatApproved:true})).status,200);
 response=await f.api(path,plan);assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.rendered,1);
 assert.equal((await f.api(path,plan)).data.rendered,0);
 assert.equal((await f.api('intelligence/composition',{artwork:f.art,kind:'panel',repeatApproved:false})).status,200);
 response=await f.api(path,plan);assert.equal(response.status,409,'cached pixels cannot bypass revoked repeat approval');
 assert.throws(()=>assertComposition(f.db,{elements:[{},{}]},[{...source,effectivePermissions:permissions},{...source,effectivePermissions:permissions}]),/one hero/);
 assert.equal(artworkComposition(f.db,{...source,sha256:'changed-version'}).repeatApproved,false);
 assert.equal(f.db.prepare('SELECT sha256 FROM factory_artwork WHERE id=?').get(f.art).sha256,source.sha256,'classification does not edit original pixels');
});

test('Basic persists exact inspected numeric profiles per product and layout and invalidates different variants',async t=>{
 const f=await fixture(t);await f.profile();
 const request={...f.choice,layout:f.layout(5,{front:{widthIn:3.5,heightIn:5}})},p=(await f.basic('/inspect',request)).data;
 assert.equal(p.numericLayout.requiresAcceptance,false);
 assert.equal((await f.basic('/layouts/save',{...request,inspectionToken:'invalid'})).status,409);
 const saved=await f.basic('/layouts/save',{...request,inspectionToken:p.inspectionToken});assert.equal(saved.status,200,JSON.stringify(saved.data));
 const profile=saved.data.layoutOptions.savedProfiles.find(s=>s.number===5);assert.equal(profile.compatible,true);assert.equal(profile.product,328);assert.equal(profile.sources.front.id,f.art);assert.equal(profile.variants[0].placements.front.geometry.width,525);
 const fresh=(await f.basic('/inspect',f.choice)).data;assert.equal(fresh.layoutOptions.savedProfiles[0].compatible,true);
 const changed=(await f.basic('/inspect',{...f.choice,sizes:['L']})).data;assert.equal(changed.layoutOptions.savedProfiles[0].compatible,false);
 const templateKey=fresh.layoutOptions.areas[0].key;assert.ok(templateKey);assert.equal(profile.variants[0].areas[0].width,1800);assert.equal(profile.variants[0].areas[0].printfile_id,1);
 const {basicSizing}=await import('./factory-basic-sizing.mjs'),sizing=basicSizing({db:f.db,workflow:null}),bp=(await f.api('blueprints/product/328')).data;bp.layouts={templates:[{template_id:91,image_url:'https://files.cdn.printful.com/new-template.png',template_width:1800,template_height:2400,print_area_width:1800,print_area_height:2400,print_area_left:0,print_area_top:0}],variant_mapping:[{variant_id:3281,templates:[{placement:'front',template_id:91},{placement:'back',template_id:91}]}]};assert.equal(sizing.options(fresh,bp).savedProfiles[0].compatible,false,'a different exact supplier template invalidates a same-size profile');
});


test('multiple reviewed native maps save atomically and reject an invalid map without partial writes',async t=>{
 const f=await fixture(t,{shoes:true}),base=await f.basic('/inspect',{...f.choice,geometryOnly:true}),areas=base.data.layoutOptions.areas;
 const profile=areaKey=>({areaKey,reviewed:true,orientation:'wearer',reference:'Reviewed fixture native guideline',anchor:'outer_canvas',safeRect:{x:1,y:1,width:10,height:10},xIn:5,yIn:5});
 const invalid=await f.basic('/layouts/profiles',{...f.choice,profiles:[profile(areas[0].key),{...profile(areas[1].key),xIn:99}]});assert.equal(invalid.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_basic_geometry').get().n,0);
 assert.equal((await f.basic('/layouts/profiles',{...f.choice,profiles:areas.slice(0,2).map(a=>profile(a.key))})).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM factory_basic_geometry').get().n,2);
});
