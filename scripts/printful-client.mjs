const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Read-only supplier client: pace reads and honor the supplier's actual cooldown.
export function printfulClient({token,storeId,fetcher=fetch,wait=sleep,clock=Date.now,log=console.log}={}){
 if(!token)throw Error('Protected Printful token is required.');
 let next=0,gap=600;
 const headers={Authorization:'Bearer '+token,...(storeId?{'X-PF-Store-Id':storeId}:{})};
 async function pause(ms){while(ms>0){const chunk=Math.min(ms,60000);await wait(chunk);ms-=chunk;}}
 return async function get(path){
  for(let attempt=0;attempt<6;attempt++){
   await pause(Math.max(0,next-clock()));
   let response;try{response=await fetcher('https://api.printful.com/'+path,{headers,signal:AbortSignal.timeout(30000)});}catch{if(attempt===5)throw Error('Printful network failure at '+path+'. Existing catalog preserved.');await pause(Math.min(30000,1000*2**attempt));continue;}
   const h=name=>response.headers?.get(name),limit=Number(h('x-ratelimit-limit')),remaining=h('x-ratelimit-remaining'),reset=Number(h('x-ratelimit-reset'));
   if(limit>0)gap=Math.max(600,Math.ceil(66000/limit));next=clock()+gap;
   if(response.status===429||response.status===419||response.status>=500){
    if(attempt===5)throw Error('Printful request failed (HTTP '+response.status+') at '+path+'. Existing catalog preserved.');
    const raw=h('retry-after'),n=raw===null||raw===undefined?NaN:Number(raw),date=Date.parse(raw||'');
    const cooldown=Number.isFinite(n)&&n>=0?n*1000:Number.isFinite(date)?Math.max(0,date-clock()):reset>0?reset*1000:response.status<500?60000:Math.min(30000,2000*2**attempt);
    await response.body?.cancel().catch(()=>{});log('Printful HTTP '+response.status+' at '+path+'; retrying after '+Math.ceil(cooldown/1000)+' seconds.');await pause(cooldown+250);next=clock();continue;
   }
   if(!response.ok)throw Error('Printful request failed (HTTP '+response.status+') at '+path+'. Check token scope and store ID.');
   const data=await response.json();if(data.code!==200)throw Error('Printful returned invalid data at '+path+'. Existing catalog preserved.');
   if(remaining!==null&&remaining!==undefined&&Number(remaining)===0&&reset>0)next=Math.max(next,clock()+reset*1000+250);
   return data;
  }
 };
}
