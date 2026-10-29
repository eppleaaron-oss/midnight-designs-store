import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerApproved,importApproved} from './publication-policy.mjs';
import {applyStudioUpdates} from './publish-studio-product.mjs';
test('new IDs, drafts, rejected releases and mismatched revisions cannot be imported',()=>{
 const prior={id:'1',factoryExternalId:'midnight-factory-old',studioRevision:'old'};
 assert.equal(importApproved({...prior},prior),true);
 assert.equal(importApproved({...prior,id:'2'},prior),false);
 assert.equal(importApproved({...prior,studioRevision:'new'},prior),false);
 for(const state of ['draft','rejected','unfinished','approved'])assert.equal(ownerApproved({...prior,publicationApproval:{state,revision:'another'}}),false);
 const next={...prior,studioRevision:'new',publicationApproval:{state:'approved',revision:'new'}};
 assert.equal(importApproved(next,prior),true);assert.equal(ownerApproved(next),true);
 next.studioRevision='changed';assert.equal(importApproved(next,prior),false);
});
