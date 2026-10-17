import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {createService} from './server.mjs';
import {factoryArtwork} from './factory-artwork.mjs';
import {factoryRendering} from './factory-rendering.mjs';
import {garmentColorCapability,supplierTechnique} from './factory-color.mjs';

function seed(db,renderer,art,variant,areas,plan){
 const job=randomUUID(),draft=randomUUID(),date=new Date().toISOString();
 db.prepare('INSERT INTO factory_job_profiles VALUES(?,?,?)').run(job,'',JSON.stringify([draft]));
 db.prepare('INSERT INTO factory_job_audiences VALUES(?,?)').run(job,JSON.stringify({product:71,artworkIds:[art]}));
 db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(draft,'Color test',71,variant,'default',JSON.stringify(areas),'live',date);
 renderer.savePlan(job,plan);return {job,draft};
}
async function setup(blueprint){
 const salt='ad'.repeat(16),service=createService({dbPath:':memory:',origin:'http://localhost:3000',secure:false,passwordHash:salt+':'+scryptSync('color-test-password',salt,64).toString('hex')});
 const image=await sharp({create:{width:16,height:16,channels:4,background:'#ffffff'}}).png().toBuffer();
 const art=factoryArtwork({db:service.db}).importFile({data:image,filename:'white-emblem.png'},{name:'White emblem',collection:'Night',scope:'collection',target:'',product:null,placements:['back'],instructions:'Preserve the emblem.',permissions:{reuse:true,crop:false,modify:false,recolor:false}});
 const renderer=factoryRendering({db:service.db,blueprints:{load:async()=>blueprint},manager:{productDetails:async()=>({variants:blueprint.variants})}});
 return {db:service.db,renderer,art};
}

test('full garment coverage requires live supplier method evidence, not a name or sublimation alone',()=>{
 const live={source:'live',name:'All-Over Print Jacket',technique:'default'};
 assert.equal(garmentColorCapability(live).mode,'hold');
 assert.equal(garmentColorCapability({...live,effectiveTechnique:'dtg'}).mode,'hold');
 assert.equal(garmentColorCapability({...live,catalogType:'CUT-SEW',effectiveTechnique:'cut-sew'}).mode,'print');
 assert.equal(garmentColorCapability({...live,source:'snapshot',catalogType:'CUT-SEW'}).mode,'hold');
 assert.equal(garmentColorCapability({source:'live',name:'Unisex Hoodie',effectiveTechnique:'dtg'}).mode,'fabric');
 assert.equal(garmentColorCapability({source:'live',name:'Mug',effectiveTechnique:'sublimation'}).mode,'fabric');
 assert.equal(garmentColorCapability({...live,name:'All-Over Print Unisex Cotton Wide-Leg Pants',catalogType:'DIRECT-TO-FABRIC',effectiveTechnique:'direct-to-fabric'}).mode,'print');
 assert.equal(garmentColorCapability({...live,catalogType:'HOODIE',effectiveTechnique:'direct-to-fabric'}).mode,'hold');
 assert.equal(supplierTechnique({type:'DIRECT-TO-FABRIC'},{techniques:[{key:'dtg'},{key:'direct-to-fabric',is_default:true}]}),'direct-to-fabric');
 assert.equal(supplierTechnique({type:'CUT-SEW'},{techniques:[{key:'cut-sew'}]}),'cut-sew');
 assert.equal(supplierTechnique({title:'All-Over Print Jacket'},{techniques:[{key:'dtg'}]}),'dtg');
});

test('black fills every supported AOP panel and its native edges for each exact size',async()=>{
 const names=['front','back','sleeve_left','sleeve_right','hood'];
 const blueprint={source:'live',catalogType:'CUT-SEW',effectiveTechnique:'cut-sew',name:'All-Over Print Jacket',variants:[{id:10,color:'White',size:'S'},{id:20,color:'White',size:'M'}],printfiles:{printfiles:[{printfile_id:1,width:8,height:12,dpi:150},{printfile_id:2,width:10,height:14,dpi:150}],variant_printfiles:[{variant_id:10,placements:Object.fromEntries(names.map(n=>[n,1]))},{variant_id:20,placements:Object.fromEntries(names.map(n=>[n,2]))}]},layouts:{templates:[],variant_mapping:[]}};
 const {db,renderer,art}=await setup(blueprint),plan={garmentColor:'Black',background:'Black',colorMode:'print',placements:{front:{artworkId:art,fit:'contain',scale:50,protect:true}}};
 const first=seed(db,renderer,art,10,[{placement:'front',width:8,height:12,dpi:150}],plan);
 const second=randomUUID();db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(second,'Size M',71,20,'default',JSON.stringify([{placement:'front',width:10,height:14,dpi:150}]),'live',new Date().toISOString());db.prepare('UPDATE factory_job_profiles SET templates=? WHERE job=?').run(JSON.stringify([first.draft,second]),first.job);
 const result=await renderer.renderJob(first.job);assert.equal(result.files.length,10);
 for(const f of db.prepare('SELECT * FROM factory_print_files').all()){
  const meta=await sharp(Buffer.from(f.data)).metadata(),raw=await sharp(Buffer.from(f.data)).ensureAlpha().raw().toBuffer();
  assert.equal(meta.density,150);assert.equal(f.width,f.draft===first.draft?8:10);assert.equal(f.height,f.draft===first.draft?12:14);
  for(const [x,y]of [[0,0],[f.width-1,0],[0,f.height-1],[f.width-1,f.height-1]])assert.deepEqual([...raw.subarray((y*f.width+x)*4,(y*f.width+x)*4+4)],[0,0,0,255],'native panel edges, including supplier bleed, stay opaque black');
 }
 const before=db.prepare('SELECT count(*) n FROM factory_print_files').get().n;assert.equal((await renderer.renderJob(first.job)).rendered,0);assert.equal(db.prepare('SELECT count(*) n FROM factory_print_files').get().n,before);
 renderer.savePlan(first.job,{...plan,placements:{hood_left:{artworkId:art}}});await assert.rejects(renderer.renderJob(first.job),/unsupported placement/);
});

test('quick production replaces a white blank with the real black variant and leaves unprinted pixels transparent',async()=>{
 const blueprint={source:'live',name:'Unisex Hoodie',catalogType:'HOODIE',effectiveTechnique:'dtg',variants:[{id:10,color:'Black',size:'M'},{id:11,color:'White',size:'M'}],printfiles:{printfiles:[{printfile_id:1,width:8,height:12,dpi:150}],variant_printfiles:[{variant_id:10,placements:{front:1,back:1}},{variant_id:11,placements:{front:1,back:1}}]},layouts:{}};
 const {db,renderer,art}=await setup(blueprint),plan={garmentColor:'Black',background:'Black',fit:'contain',assignments:[{zone:'back',artworkId:art}]};
 const {job,draft}=seed(db,renderer,art,11,[{placement:'front',width:8,height:12,dpi:150},{placement:'back',width:8,height:12,dpi:150}],plan);
 const result=await renderer.renderJob(job);assert.equal(result.files.length,1);assert.equal(result.files[0].placement,'back');
 assert.equal(db.prepare('SELECT variant FROM factory_print_drafts WHERE id=?').get(draft).variant,10);
 const selection=JSON.parse(db.prepare('SELECT selection FROM factory_job_audiences WHERE job=?').get(job).selection);assert.equal(selection.colorMode,'fabric');assert.deepEqual(selection.variantIds,[10]);
 const raw=await sharp(Buffer.from(db.prepare('SELECT data FROM factory_print_files').get().data)).ensureAlpha().raw().toBuffer();assert.deepEqual([...raw.subarray(0,4)],[0,0,0,0]);assert.deepEqual([...raw.subarray((6*8+4)*4,(6*8+4)*4+4)],[255,255,255,255]);
 blueprint.variants=blueprint.variants.filter(v=>v.id!==10);await assert.rejects(renderer.renderJob(job),/no available Black fabric/);assert.equal(db.prepare('SELECT count(*) n FROM factory_print_files').get().n,1,'missing black stock does not fall back to white');
});
