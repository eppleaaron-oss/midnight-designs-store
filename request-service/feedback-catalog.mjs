// Resolve current public products without tying feedback to a name or mockup URL.
export function feedbackCatalog({local,remote,clock=Date.now,ttl=60000}) {
 let cached=null,next=0,pending=null;
 return async()=>{
  if(cached&&clock()<next)return cached;
  if(pending)return pending;
  pending=(async()=>{try{const rows=remote?await remote():await local();if(!Array.isArray(rows))throw Error('Invalid product catalog');cached=new Map(rows.map(p=>[String(p.id),p]));next=clock()+ttl;return cached;}catch{if(cached)return cached;cached=new Map((await local()).map(p=>[String(p.id),p]));next=clock()+10000;return cached;}finally{pending=null;}})();return pending;
 };
}
