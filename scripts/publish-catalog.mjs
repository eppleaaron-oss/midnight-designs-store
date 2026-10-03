import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const repo=process.env.GITHUB_REPOSITORY;
if(!repo||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Publishing requires main.');
const expected=JSON.parse(await readFile('products.json','utf8'));
const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8'}));
execFileSync('gh',['api','--method','POST','repos/'+repo+'/pages/builds'],{stdio:'pipe'});
const base=api('repos/'+repo+'/pages').html_url;
const delay=()=>new Promise(resolve=>setTimeout(resolve,10000));
let verified=false;
for(let attempt=0;attempt<48;attempt++){
 await delay();
 try{
  const response=await fetch(new URL('products.json?sync='+Date.now(),base),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)continue;
  const actual=await response.json();
  if(actual.lastSyncedAt!==expected.lastSyncedAt)continue;
  assert.deepEqual(actual,expected);
  verified=true;break;
 }catch{}
}
if(!verified)throw Error('Catalog saved, but the live catalog could not be verified. Check Pages deployment; do not report this refresh as published.');
console.log('Verified live catalog: '+expected.products.length+' products; last supplier sync '+expected.lastSyncedAt);
