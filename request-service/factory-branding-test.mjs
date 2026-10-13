import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {createService} from './server.mjs';
import {factoryIntelligence} from './factory-intelligence.mjs';
import {BRANDING_RULE,brandingPolicy,assertBrandingPlacement,isBrandArtwork} from './factory-branding.mjs';
import {labelInstruction} from './factory-runs.mjs';
import {tagArea} from './factory-ideas.mjs';
import {CLOTHING_LAYOUTS} from './factory-layout-library.mjs';

const base='/api/owner/ai-factory/',origin='http://localhost:3000',password='branding-fixture-password',salt='bb'.repeat(16);
async function fixture(){const service=createService({dbPath:':memory:',origin,secure:false,passwordHash:salt+':'+scryptSync(password,salt,64).toString('hex'),productionSettings:{storageDurable:true},editorSettings:{env:{},storageDurable:true},pipelineSettings:{env:{},storageDurable:true}});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));let cookie='';const root='http://127.0.0.1:'+service.server.address().port;
 async function call(path,body,{session=cookie,source=origin}={}){const r=await fetch(root+path,{method:body?'POST':'GET',headers:{Origin:source,...(session?{Cookie:session}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 cookie=(await call('/api/owner/login',{password})).cookie;await call(base+'employee',{id:'shirts',enabled:true});const job=(await call(base+'enqueue',{title:'Raven tee',brief:'Small thematic raven chest and statement back.',employee:'shirts',kind:'product',gender:'unisex'})).data.jobs[0].id;
 return {service,db:service.db,call,job,close:()=>new Promise(r=>service.server.close(r))};
}

test('no-label and exterior-label products never get a branding fallback; all 66 recipes use thematic artwork',()=>{
 assert.equal(tagArea(['front','label_outside','label_outside_back']),null);assert.equal(tagArea(['front','label_outside','label_inside']),'label_inside');assert.equal(tagArea(['label_panel']),'label_panel');
 assert.match(labelInstruction(undefined,null),/Skip garment branding/);assert.match(labelInstruction(undefined,'label_outside'),/no supported internal/);assert.match(labelInstruction(undefined,'label_inside'),/print area label_inside/);assert.ok(!labelInstruction(undefined,null).includes('1.5 inches'));
 assert.equal(CLOTHING_LAYOUTS.length,66);assert.equal(CLOTHING_LAYOUTS[0].name,'Minimal Chest / Statement Back');assert.match(CLOTHING_LAYOUTS[0].recipe,/Small thematic artwork element on chest/);assert.equal(CLOTHING_LAYOUTS[18].name,'Center Crest / Sleeve Graphics');assert.equal(CLOTHING_LAYOUTS[55].name,'Tiny Thematic Mark');assert.ok(CLOTHING_LAYOUTS.every(l=>!/Midnight.*(?:mark|crest|brand)|symbol\/logo|typography\/logo|front logo/i.test(l.recipe)));
});

test('legacy Brain branding defaults migrate once while custom guidance and locks survive; primary policy remains hard-coded',async()=>{
 const c=await fixture();try{const {db}=c;db.prepare("DELETE FROM brain_migrations WHERE name='design-first-branding-v1'").run();db.prepare("UPDATE brain_rules SET body='Every product carries the logo. Use the outside label or inside back neck. Never skip it.' WHERE title='Logo on the tag'").run();db.prepare("UPDATE brain_rules SET body='Common layouts: left-chest logo about 4 inches wide.' WHERE title='Industry placement playbook'").run();const p=JSON.parse(db.prepare("SELECT profile FROM brain_garments WHERE garment='hat'").get().profile);p.placement.front='Brand / secondary';p.density=[1,2];p.hierarchy='Custom raven silhouette';db.prepare("UPDATE brain_garments SET profile=?,locked=1 WHERE garment='hat'").run(JSON.stringify(p));
  const brain=factoryIntelligence({db});const knowledge=brain.knowledge('hat',6000);assert.ok(knowledge.startsWith(BRANDING_RULE));assert.match(knowledge,/BRAND IDENTITY/);assert.match(knowledge,/PRODUCT ARTWORK/);assert.match(knowledge,/BRAND MARKING/);assert.ok(!knowledge.includes('Never skip it'));assert.ok(!knowledge.includes('left-chest logo about'));
  const saved=db.prepare("SELECT * FROM brain_garments WHERE garment='hat'").get(),profile=JSON.parse(saved.profile);assert.equal(saved.locked,1);assert.deepEqual(profile.density,[1,2]);assert.equal(profile.hierarchy,'Custom raven silhouette');assert.equal(profile.placement.front,'Thematic symbol / secondary');
  const count=db.prepare('SELECT count(*) n FROM brain_rules').get().n;factoryIntelligence({db});assert.equal(db.prepare('SELECT count(*) n FROM brain_rules').get().n,count,'restart does not duplicate rules');
  const row=db.prepare("SELECT id FROM brain_rules WHERE title='Design-first branding'").get();await c.call(base+'intelligence/rule',{id:row.id,locked:false});await c.call(base+'intelligence/rule',{id:row.id,delete:true});assert.ok(brain.knowledge('hat',6000).startsWith(BRANDING_RULE),'removing the editable record cannot remove backend policy');
 }finally{await c.close();}
});

test('known company artwork is blocked on exterior prints, allowed in supported labels and preserved apart from thematic graphics',async()=>{
 const c=await fixture();try{const png=readFileSync(new URL('../assets/designs/art-7d5ff833db11.png',import.meta.url)),upload=await c.call(base+'artwork/upload',{name:'Owner graphic',collection:'Raven',scope:'collection',target:'',product:null,placements:['front'],instructions:'Original',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'original.png',base64:png.toString('base64')}]});assert.equal(upload.status,200);const art=upload.data.artworks[0].id,row=c.db.prepare('SELECT * FROM factory_artwork WHERE id=?').get(art);assert.equal(isBrandArtwork(c.db,row),true,'identity uses the logo bytes even when renamed');assert.throws(()=>assertBrandingPlacement(c.db,c.job,'front',row),/Branding hold/);assert.doesNotThrow(()=>assertBrandingPlacement(c.db,c.job,'label_inside',row));assert.throws(()=>assertBrandingPlacement(c.db,c.job,'label_outside',row),/Branding hold/);
  const draft=randomUUID(),areas=['front','label_inside'].map(placement=>({placement,width:8,height:8,dpi:150}));c.db.prepare('INSERT INTO factory_print_drafts VALUES(?,?,?,?,?,?,?,?)').run(draft,'Fixture print',71,10,'default',JSON.stringify(areas),'live',new Date().toISOString());
  const recipe={background:null,placements:{front:{artworkId:art,fit:'contain',scale:100}},allowExteriorBranding:true};const blocked=await c.call(base+'rendering/draft/'+draft,recipe);assert.equal(blocked.status,409);assert.match(blocked.data.error,/Branding hold/);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_print_files').get().n,0,'an arbitrary request flag cannot bypass server permissions');
  const label=await c.call(base+'rendering/draft/'+draft,{background:null,placements:{label_inside:{artworkId:art,fit:'contain',scale:100}}});assert.equal(label.status,200,label.data.error);assert.equal(label.data.files[0].placement,'label_inside');assert.ok(c.db.prepare('SELECT sha256 FROM factory_artwork WHERE id=?').get(art).sha256===row.sha256,'the original remains intact');
  const thematic=await sharp({create:{width:8,height:8,channels:4,background:'#ff0000'}}).png().toBuffer(),theme=await c.call(base+'artwork/upload',{name:'Raven emblem',collection:'Raven',scope:'collection',target:'',product:null,placements:['front'],instructions:'Thematic artwork',permissions:{reuse:true,crop:false,modify:false,recolor:false},files:[{filename:'raven.png',base64:thematic.toString('base64')}]});const themeId=theme.data.artworks.find(a=>a.name==='Raven emblem').id;c.db.prepare('UPDATE factory_job_audiences SET selection=? WHERE job=?').run(JSON.stringify({product:null,artworkIds:[themeId,art]}),c.job);const acceptance=c.service.factoryAcceptance.inspect(c.job);assert.equal(acceptance.checks.find(x=>x.id==='single-design').passed,true,'label branding does not count as a second product design');assert.equal(acceptance.status,'blocked','this isolated file test is not full live acceptance');
  assert.equal(isBrandArtwork(c.db,{name:'Raven collection emblem',filename:'raven.png',sha256:'different'}),false,'thematic emblems are not company marks');
 }finally{await c.close();}
});

test('exterior exceptions require private owner confirmation, apply to one early product and do not publish or add logos',async()=>{
 const c=await fixture();try{const path=base+'branding/exception',choice={job:c.job,allowExterior:true,reason:'One clean company-logo edition',confirm:true};assert.equal((await c.call(path,choice,{session:''})).status,401);assert.equal((await c.call(path,choice,{source:'https://evil.example'})).status,403);assert.equal((await c.call(path,{...choice,confirm:false})).status,400);assert.equal((await c.call(path,{...choice,reason:''})).status,400);assert.equal((await c.call(path,choice)).status,200);assert.equal(brandingPolicy(c.db,c.job).allowExterior,true);assert.equal(brandingPolicy(c.db,randomUUID()).allowExterior,false);
  assert.equal(c.db.prepare('SELECT count(*) n FROM factory_print_files').get().n,0);assert.equal(c.db.prepare('SELECT count(*) n FROM factory_publish_operations').get().n,0);assert.equal((await c.call(path,{job:c.job,allowExterior:false,confirm:true})).status,200);assert.equal(brandingPolicy(c.db,c.job).allowExterior,false);
  c.db.prepare('INSERT OR REPLACE INTO factory_job_runtime(job,step) VALUES(?,3)').run(c.job);assert.equal((await c.call(path,choice)).status,409,'finished print files require a revision, not a quiet branding change');
 }finally{await c.close();}
});
