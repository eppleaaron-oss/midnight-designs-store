import {createPublicKey,verify} from 'node:crypto';

export const PUBLISHER_AUDIENCE='midnight-designs-basic-publisher';
const ISSUER='https://token.actions.githubusercontent.com',REPO='eppleaaron-oss/midnight-designs-store';
const reject=()=>{throw Object.assign(Error('Verified GitHub publishing workflow required.'),{status:401});};
export function githubPublisherIdentity({fetchImpl=fetch,clock=Date.now}={}){
 let cached=null,until=0;
 return async raw=>{
  if(typeof raw!=='string'||raw.length>16000)return reject();let header,claims,parts=raw.split('.');if(parts.length!==3||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)))return reject();
  try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{return reject();}
  const now=clock()/1000;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||claims.iss!==ISSUER||claims.aud!==PUBLISHER_AUDIENCE||claims.repository_visibility!=='public'||claims.repository!==REPO||String(claims.repository_id)!=='1393932711'||claims.ref!=='refs/heads/main'||claims.workflow_ref!==REPO+'/.github/workflows/basic-github-publisher.yml@refs/heads/main'||!['push','schedule','workflow_dispatch'].includes(claims.event_name)||claims.runner_environment!=='github-hosted'||!Number.isFinite(claims.exp)||!Number.isFinite(claims.iat)||!Number.isFinite(claims.nbf)||claims.exp<=now||claims.exp>now+900||claims.iat>now+30||claims.iat<now-900||claims.nbf>now+30||!/^\d{1,30}$/.test(String(claims.run_id)))return reject();
  if(!cached||until<clock()||!cached.some(k=>k.kid===header.kid)){let r;try{r=await fetchImpl(ISSUER+'/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.keys)||d.keys.length>30)throw Error();cached=d.keys;until=clock()+300000;}catch{throw Object.assign(Error('GitHub identity verification is temporarily unavailable.'),{status:503});}}
  const jwk=cached.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));if(!jwk)return reject();
  try{if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))return reject();}catch{return reject();}
  return claims;
 };
}

export function factoryGithubPublisher({workspace,db,body,send,fail,limit,fetchImpl=fetch,clock=Date.now}){
 const identity=githubPublisherIdentity({fetchImpl,clock});
 return {async handle(req,res,path,method){
  if(path!=='/internal/basic-github-publisher')return false;if(method!=='POST')fail(405,'Use POST.');limit(req,'github-publisher',120);
  const claims=await identity(req.headers.authorization?.replace(/^Bearer /,'')),b=await body(req);
  if(b.action==='disconnect'){workspace.disconnectPublisher(String(claims.run_id));send(res,200,{ok:true});return true;}
  if(b.action!=='connect')fail(400,'Unknown publishing connection action.');const token=req.headers['x-midnight-github-token'];
  if(typeof token!=='string'||token.length<20||token.length>500||/[\r\n]/.test(token))fail(400,'GitHub workflow credential is missing.');
  await workspace.connectPublisher(token,String(claims.run_id),claims.exp*1000);
  const pending=!!db.prepare("SELECT b.id FROM factory_basic_items b LEFT JOIN factory_listings l ON l.job=b.job WHERE b.closed=0 AND b.decision='approved' AND coalesce(l.status,'')<>'published'").get();
  const hasBatch=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='factory_basic_batches'").get(),batch=!!(hasBatch&&db.prepare("SELECT id FROM factory_basic_batches WHERE status='running' LIMIT 1").get());
  send(res,200,{connected:true,pending:pending||batch,batch});return true;
 }};
}
