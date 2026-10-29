const fail=(message,status=409,extra={})=>Object.assign(Error(message),{status,...extra});
export function sourceArtworkUrl(value){let u;try{u=new URL(value,'https://midnight-designs.store');}catch{throw fail('Import the original artwork into the upload library first.');}const supplier=u.hostname.endsWith('.printful.com'),own=u.hostname==='midnight-designs.store'&&/^\/assets\/designs\/[^/]+\.(png|jpe?g|webp)$/i.test(u.pathname);if(u.protocol!=='https:'||u.username||u.password||u.port||!(supplier||own))throw fail('Import the original artwork into the upload library. This external file host is not supported.');return u;}
export async function downloadSourceArtwork(value,fetchImpl=fetch){
 let u=sourceArtworkUrl(value),redirects=0;for(let attempt=0;attempt<3;attempt++){
  let r;try{r=await fetchImpl(u.href,{redirect:'manual',signal:AbortSignal.timeout(25000)});}catch{if(attempt<2)continue;throw fail('Artwork download temporarily unavailable. Retry the same saved design.',503);}
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel().catch(()=>{});if(!location||++redirects>3)throw fail('Artwork download redirect could not be verified. Re-upload its original file.');u=sourceArtworkUrl(new URL(location,u).href);attempt--;continue;}
  if(r.status===429){const value=r.headers.get('retry-after'),n=Number(value),date=Date.parse(value||'');const retryAfter=value&&Number.isFinite(n)?Math.max(1,n):Number.isFinite(date)?Math.max(1,Math.ceil((date-Date.now())/1000)):60;await r.body?.cancel().catch(()=>{});throw fail('Artwork download rate limit reached. Retry after the supplier wait.',429,{retryAfter});}
  if([500,502,503,504].includes(r.status)){await r.body?.cancel().catch(()=>{});if(attempt<2)continue;throw fail('Artwork download temporarily unavailable. Retry the same saved design.',503);}
  if(!r.ok)throw fail('Original artwork download returned HTTP '+r.status+'. Re-upload or refresh this design’s source file.');
  const mime=r.headers.get('content-type')?.split(';')[0].trim().toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(mime))throw fail('The original artwork URL did not return a PNG, JPEG or WebP image.');
  let size=0;const chunks=[];try{for await(const chunk of r.body){size+=chunk.length;if(size>5*1024*1024)throw fail('Original artwork exceeds 5 MB. Import a smaller original file.',413);chunks.push(chunk);}}catch(e){if(e.status)throw e;if(attempt<2)continue;throw fail('Artwork download temporarily unavailable. Retry the same saved design.',503);}
  return {data:Buffer.concat(chunks),mime,url:u.href};
 }throw fail('Artwork download temporarily unavailable. Retry the same saved design.',503);
}
