import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const config={repo:'owner/private-data',token:'private-fixture-token'};
const objectHash=b=>{const bytes=Buffer.from(b);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');};
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
export function githubFixture(){
 const blobs=new Map(),trees=new Map([['b'.repeat(40),new Map()]]),commits=new Map([['a'.repeat(40),{tree:{sha:'b'.repeat(40)},parents:[]}]]),calls=[];
 const g={head:'a'.repeat(40),private:true,blobs,trees,commits,calls,rate:false,conflict:false,failRef:false,dropResponse:false,failReads:false};
 g.fetch=async(url,options={})=>{
  assert.equal(options.headers.Authorization,'Bearer '+config.token);const u=new URL(url);assert.equal(u.origin,'https://api.github.com');const path=u.pathname.slice('/repos/owner/private-data'.length),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
  if(g.rate)return reply({message:'Do not surface secret provider responses'},429,{'retry-after':'120'});
  if(g.failReads&&method==='GET')throw Error('Sensitive network detail');
  if(path==='')return reply({id:123,private:g.private,visibility:g.private?'private':'public',default_branch:'main',size:2});
  if(path==='/git/ref/heads/main')return reply({object:{sha:g.head}});
  if(path.startsWith('/git/commits/')&&method==='GET')return reply(commits.get(path.split('/').at(-1)));
  if(path==='/contents/factory-backup/latest.enc'){const commit=commits.get(u.searchParams.get('ref')),tree=trees.get(commit.tree.sha),sha=tree.get('factory-backup/latest.enc');if(!sha)return reply({message:'Not Found'},404);const data=blobs.get(sha),download=g.alteredContents?Buffer.from(data.toString('utf8')):data;return reply({sha,encoding:'base64',content:download.toString('base64'),size:download.length});}
  if(path.startsWith('/git/blobs/')&&method==='GET'){const data=blobs.get(path.split('/').at(-1));return reply({encoding:'base64',content:data.toString('base64'),size:data.length});}
  if(path==='/git/blobs'&&method==='POST'){const data=Buffer.from(body.content,'base64'),sha=objectHash(data);blobs.set(sha,data);return reply({sha});}
  if(path==='/git/trees'&&method==='POST'){assert.equal(new Set(body.tree.map(t=>t.path)).size,body.tree.length,'No duplicate tree paths');const next=new Map(trees.get(body.base_tree));for(const t of body.tree){if(t.sha===null){assert.ok(next.has(t.path));next.delete(t.path);}else{assert.ok(blobs.has(t.sha));next.set(t.path,t.sha);}}const sha=objectHash(JSON.stringify([...next]));trees.set(sha,next);return reply({sha});}
  if(path==='/git/commits'&&method==='POST'){const sha=objectHash(JSON.stringify(body));commits.set(sha,{tree:{sha:body.tree},parents:body.parents});return reply({sha});}
  if(path==='/git/refs/heads/main'&&method==='PATCH'){
   assert.equal(body.force,false);if(g.failRef)return reply({},500);if(g.conflict)return reply({},422);if(body.sha!==g.head&&!commits.get(body.sha).parents.includes(g.head))return reply({},409);g.head=body.sha;
   if(g.dropResponse){g.dropResponse=false;throw Error('Lost acknowledgement');}return reply({object:{sha:g.head}});
  }
  throw Error('Unexpected fixture API: '+method+' '+path);
 };return g;
}

export function githubWorkingFixture(){
 const g=githubFixture(),original=g.fetch;g.releases=new Map();g.assets=new Map();g.next=100;g.failDelete=false;g.corrupt=false;
 g.fetch=async(url,o={})=>{
  const u=new URL(url),path=u.pathname.slice('/repos/owner/private-data'.length),method=o.method||'GET';
  if(!path.startsWith('/releases'))return original(url,o);
  assert.equal(o.headers.Authorization,'Bearer private-fixture-token');g.calls.push({path,method});
  const json=()=>JSON.parse(o.body),asset=id=>{const a=g.assets.get(id);return a&&{id:a.id,name:a.name,size:a.data.length};};
  if(path==='/releases'&&method==='GET')return reply([...g.releases.values()]);
  if(path==='/releases'&&method==='POST'){const r={...json(),id:g.next++};g.releases.set(r.id,r);return reply(r,201);}
  let m=path.match(/^\/releases\/(\d+)\/assets$/);if(m){const id=Number(m[1]);if(!g.releases.has(id))return reply({},404);if(method==='GET')return reply([...g.assets.values()].filter(a=>a.release===id).map(a=>asset(a.id)));if(method==='POST'){const name=u.searchParams.get('name');if([...g.assets.values()].some(a=>a.release===id&&a.name===name))return reply({},422);const a={id:g.next++,name,release:id,data:Buffer.from(o.body)};g.assets.set(a.id,a);return reply(asset(a.id),201);}}
  m=path.match(/^\/releases\/assets\/(\d+)$/);if(m){const id=Number(m[1]),a=g.assets.get(id);if(!a)return reply({},404);if(method==='DELETE'){if(g.failDelete)return reply({},500);g.assets.delete(id);return new Response(null,{status:204});}if(o.headers.Accept==='application/octet-stream')return new Response(g.corrupt?Buffer.from('damaged payload'):a.data);return reply(asset(id));}
  m=path.match(/^\/releases\/(\d+)$/);if(m){const id=Number(m[1]),r=g.releases.get(id);if(!r)return reply({},404);if(method==='DELETE'){g.releases.delete(id);return new Response(null,{status:204});}return reply(r);}
  throw Error('Unexpected release fixture request: '+method+' '+path);
 };return g;
}
