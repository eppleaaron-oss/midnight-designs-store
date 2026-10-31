import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApprovedMapping,assertSavedMappingApproval} from './factory-approved-mapping.mjs';
import {DatabaseSync} from 'node:sqlite';
import {factoryWorkflow} from './factory-workflow.mjs';
const profile={number:1007,exampleId:7,revision:3,compatible:true,slots:[{id:'shorts_leg_a',part:'front',placement:'front'},{id:'shorts_leg_b',part:'back',placement:'front'}]};
function setup(layouts=[profile]){let resolved=0;return {product:{set:{parts:{front:{artwork:'original-front'},back:{artwork:'original-back'}}}},blueprint:{},sizing:{options:()=>({version:2,layouts}),resolve:async()=>{resolved++;return {exampleId:7,requiresAcceptance:false,reductions:[],bindings:[]};}},count:()=>resolved};}
test('back source artwork can occupy a front shorts panel without becoming garment-back artwork',async()=>{const f=setup(),r=await loadApprovedMapping(f);assert.deepEqual(r.sourceRoleMapping.map(m=>[m.sourceArtworkRole,m.physicalPanel]),[['front','front'],['back','front']]);assert.deepEqual(r.profileApproval,{exampleId:7,revision:3});assert.equal(f.count(),1);});
test('missing, stale and ambiguous approved profiles hold before artwork resolution',async()=>{for(const profiles of [[],[{...profile,compatible:false}],[profile,{...profile,exampleId:8}]]){const f=setup(profiles);await assert.rejects(loadApprovedMapping(f),/approved.*profile/);assert.equal(f.count(),0);}});
test('no source-role substitutions, guessed measurements, or inherited crop mappings',async()=>{for(const input of [{number:1007,assignments:{shorts_leg_b:'front'}},{number:1007,overrides:{shorts_leg_a:{xIn:3}}},{number:1007,scaleMode:'proportional'}])await assert.rejects(loadApprovedMapping({...setup(),input}),/approved/);const f=setup();delete f.product.set.parts.back;await assert.rejects(loadApprovedMapping(f),/role is missing/);});
test('a generic preset or mismatched product profile cannot masquerade as approval',async()=>{const f=setup([{...profile,exampleId:null}]);await assert.rejects(loadApprovedMapping({...f,input:{number:1007}}),/no compatible approved/);});
test('new artwork requiring a size reduction needs a new review',async()=>{const f=setup();f.sizing.resolve=async()=>({exampleId:7,reductions:[{}]});await assert.rejects(loadApprovedMapping(f),/revised placement/);});
test('queued AI runs stop on absent, revoked or superseded approval',()=>{
 const db=new DatabaseSync(':memory:');try{
  assert.throws(()=>assertSavedMappingApproval(db,{mappingPolicyRequired:true}),/no approved measured/);
  assert.throws(()=>assertSavedMappingApproval(db,{assignments:[{zone:'front',artworkId:'source-front'}]}),/no approved measured/);
  db.exec('CREATE TABLE factory_placement_examples(id INTEGER,supplier TEXT,state TEXT,revision INTEGER,created INTEGER)');
  db.exec("INSERT INTO factory_placement_examples VALUES(7,'supplier','approved',3,1)");
  const plan={mappingPolicyRequired:true,numericLayout:{profileApproval:{exampleId:7,revision:3}}};
  assert.doesNotThrow(()=>assertSavedMappingApproval(db,plan));
  db.exec("INSERT INTO factory_placement_examples VALUES(8,'supplier','correction',4,2)");
  assert.throws(()=>assertSavedMappingApproval(db,plan),/superseded/);
 }finally{db.close();}
});
test('production workflow requires approved profiles by default',()=>{const db=new DatabaseSync(':memory:');try{assert.equal(factoryWorkflow({db}).requiresApprovedProfiles,true);}finally{db.close();}});
