import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {factoryTapestries} from './factory-tapestries.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE factory_artwork(id TEXT PRIMARY KEY,original TEXT,kind TEXT,name TEXT,filename TEXT,collection TEXT,data BLOB,sha256 TEXT,permissions TEXT);
 CREATE TABLE idea_sets(id TEXT,name TEXT,parts TEXT);
 CREATE TABLE factory_outfits(id TEXT,name TEXT,collection TEXT,artwork_collection TEXT);
 CREATE TABLE factory_basic_outfit_pieces(outfit TEXT,choice TEXT);`);
 for(const [id,name]of [['f','Front artwork'],['b','Back artwork'],['m','Front mockup']]){const data=Buffer.from(id);db.prepare('INSERT INTO factory_artwork VALUES(?,?,?,?,?,?,?,?,?)').run(id,id,'original',name,id+'.png','Night',data,createHash('sha256').update(data).digest('hex'),'{"reuse":true}');}
 db.prepare('INSERT INTO idea_sets VALUES(?,?,?)').run('night','Night','{}');
 db.prepare('INSERT INTO factory_outfits VALUES(?,?,?,?)').run('o','Night outfit','Night','Night');
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 const service=factoryTapestries({db,auth:()=>{},body:async r=>r.body,send:(r,s,d)=>{r.status=s;r.data=d;},fail,limit:()=>{},origin:'https://owner.test'});
 return {db,service};
}
test('two private editions per collection; repeated preparation preserves IDs and edits',async()=>{
 const {db,service}=fixture();let s=await service.prepare();assert.equal(s.collections.length,1);const c=s.collections[0];assert.equal(c.front.document.artworkId,'f');assert.equal(c.back.document.artworkId,'b');assert.notEqual(c.front.id,c.back.id);assert.equal(c.front.status,'blocked');assert.equal(c.front.supplierProductCreated,false);
 await service.save({id:c.front.id,revision:1,changes:{name:'Owner title',background:'#112233'}});
 s=await service.prepare();assert.equal(s.collections[0].front.id,c.front.id);assert.equal(s.collections[0].front.document.name,'Owner title');assert.equal(s.collections[0].front.revision,2);assert.equal(db.prepare('SELECT count(*) n FROM factory_tapestry_editions').get().n,2);
 await assert.rejects(service.save({id:c.front.id,revision:1,changes:{name:'Stale'}}),/changed/);db.close();
});
test('missing, ambiguous, previews and edited files are not substituted',async()=>{
 const {db,service}=fixture();db.prepare("UPDATE factory_artwork SET name='unassigned' WHERE id='b'").run();let s=await service.prepare();const c=s.collections[0];assert.equal(c.back.document.artworkId,null);assert.equal(c.front.candidates.length,1);
 await assert.rejects(service.save({id:c.front.id,revision:1,changes:{artworkId:'m'}}),/preserved original/);
 db.prepare("UPDATE factory_artwork SET data=? WHERE id='f'").run(Buffer.from('changed'));s=service.snapshot();assert.match(s.collections[0].front.reasons[0],/changed bytes/);db.close();
});
test('newer collections included; all records survive reopening the module',async()=>{
 const {db,service}=fixture();await service.prepare();db.prepare('INSERT INTO idea_sets VALUES(?,?,?)').run('new','New Collection','{}');const s=await service.prepare();assert.equal(s.collections.length,2);assert.equal(db.prepare('SELECT count(*) n FROM factory_tapestry_editions').get().n,4);assert.equal(service.snapshot().collections[0].front.revision,1);db.close();
});
test('owner and origin checks precede writes; no production action exists',async()=>{
 const {db,service}=fixture();await assert.rejects(service.handle({headers:{origin:'https://attacker.test'}},{},'/api/owner/ai-factory/tapestries/prepare','POST'),/Origin/);
 await assert.rejects(service.handle({headers:{origin:'https://owner.test'}},{},'/api/owner/ai-factory/tapestries/publish','POST'),/blocked/);assert.equal(db.prepare('SELECT count(*) n FROM factory_tapestry_editions').get().n,0);db.close();
});
