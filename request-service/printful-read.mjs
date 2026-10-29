import {printfulResetDelay} from './printful-write-guard.mjs';
import {createHash} from 'node:crypto';

// Share a paced, single-flight lane for idempotent supplier reads only. Writes
// keep their existing external IDs, confirmation records and retry policies.
export function createPrintfulReader({clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),random=Math.random}={}){
 const clients=new WeakMap();
 return function read(url,options={},fetchImpl=fetch){
  const u=new URL(url);if(u.origin!=='https://api.printful.com'||options.method&&options.method!=='GET')throw Error('Printful reader accepts supplier GET requests only.');
  const headers=new Headers(options.headers),key=createHash('sha256').update((headers.get('authorization')||'anonymous')+'\n'+(headers.get('x-pf-store-id')||'')).digest('hex');
  let accounts=clients.get(fetchImpl);if(!accounts){accounts=new Map();clients.set(fetchImpl,accounts);}let state=accounts.get(key);if(!state){state={tail:Promise.resolve(),pending:new Map(),next:0,blocked:0,gap:0};accounts.set(key,state);}
  const requestKey=u.href+'\n'+(headers.get('x-pf-store-id')||'');
  if(state.pending.has(requestKey))return state.pending.get(requestKey).then(r=>r.clone());
  const rateError=()=>{const seconds=Math.max(1,Math.ceil((state.blocked-clock())/1000));return Object.assign(Error('Printful rate limit reached. Retrying is allowed in '+seconds+' seconds.'),{status:429,printfulStatus:429,retryAfter:seconds});};
  const run=state.tail.then(async()=>{
   if(state.blocked>clock())throw rateError();
   const delay=state.next-clock();if(delay>0)await sleep(delay);
   if(state.blocked>clock())throw rateError();
   let r;try{r=await fetchImpl(u.href,options);}catch{throw Object.assign(Error('Printful is temporarily unreachable. The same selection can be retried.'),{status:503});}
   const limit=Number(r.headers.get('x-ratelimit-limit')),remaining=r.headers.get('x-ratelimit-remaining'),reset=Number(r.headers.get('x-ratelimit-reset'));
   if(limit>0&&Number.isFinite(limit))state.gap=Math.max(50,Math.ceil(66000/limit));
   state.next=clock()+state.gap;
   if(r.status===429){state.blocked=clock()+Math.max(1000,printfulResetDelay(r.headers,clock))+Math.floor(random()*250);await r.body?.cancel().catch(()=>{});throw rateError();}
   if(remaining!==null&&Number(remaining)===0&&reset>0)state.blocked=clock()+printfulResetDelay(r.headers,clock);
   return r;
  });
  state.tail=run.catch(()=>{});state.pending.set(requestKey,run);run.finally(()=>{if(state.pending.get(requestKey)===run)state.pending.delete(requestKey);}).catch(()=>{});
  return run.then(r=>r.clone());
 };
}
export const readPrintful=createPrintfulReader();
