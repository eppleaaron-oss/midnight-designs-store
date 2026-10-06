import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function catalogManagement({db,origin,storefrontOrigin,passwordHash,body,send,fail,limit,token=process.env.CATALOG_GITHUB_TOKEN,fetchImpl=fetch}){
 const repository='eppleaaron-oss/midnight-designs-store';
 async function github(path,options={}){
  const response=await fetchImpl('https://api.github.com/repos/'+repository+path,{...options,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)fail(response.status===409?409:502,response.status===409?'The catalog changed. Refresh and try again.':'The catalog could not be saved. Try again.');
  return response.json();
 }
 return {async handle(req,res,path,method){
  if(!['/api/owner/catalog-login','/api/owner/delete-design'].includes(path))return false;
  if(![origin,storefrontOrigin].includes(req.headers.origin))fail(403,'Origin rejected.');
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
  if(method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.writeHead(204);res.end();return true;}
  if(method!=='POST')fail(405,'Use POST.');
  if(path.endsWith('catalog-login')){
   limit(req,'catalog-login',5);const b=await body(req);
   if(typeof b.password!=='string'||b.password.length>200)fail(400,'Enter your owner password.');
   const [salt,wanted]=passwordHash.split(':');
   if(b.email?.trim().toLowerCase()!=='midnightdesign107@gmail.com'||!timingSafeEqual(scryptSync(b.password,salt,64),Buffer.from(wanted,'hex')))fail(401,'Sign-in failed.');
   const sessionToken=randomBytes(32).toString('hex');
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(sessionToken),'owner',null,Date.now()+28800000);
   send(res,200,{token:sessionToken});return true;
  }
  const bearer=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const session=bearer&&db.prepare('SELECT role FROM sessions WHERE hash=? AND expires>?').get(hash(bearer),Date.now());
  if(session?.role!=='owner')fail(401,'Sign in with your owner account.');
  limit(req,'catalog-delete',30);const b=await body(req);
  if(b.confirm!==true||typeof b.designId!=='string'||!/^[-a-zA-Z0-9_:]{1,120}$/.test(b.designId))fail(400,'Confirm the design to delete.');
  if(!token)fail(503,'Catalog saving is not connected on the server.');
  const file=await github('/contents/designs.json?ref=main');
  const catalog=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
  if(!Array.isArray(catalog))fail(502,'The design catalog could not be read.');
  if(!catalog.some(d=>d.id===b.designId))fail(404,'This design is already removed. Refresh the catalog.');
  const next=catalog.filter(d=>d.id!==b.designId);
  await github('/contents/designs.json',{method:'PUT',body:JSON.stringify({message:'Delete design '+b.designId+' from owner dashboard',branch:'main',sha:file.sha,content:Buffer.from(JSON.stringify(next,null,2)+'\n').toString('base64')})});
  send(res,200,{ok:true,designId:b.designId,deploymentPending:true});return true;
 }};
}
