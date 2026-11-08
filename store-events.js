(()=>{
'use strict';
const paths={'/':'home','/index.html':'home','/shop.html':'shop','/product.html':'product','/designs.html':'designs','/outfits.html':'outfits','/cart.html':'bag','/checkout-result.html':'checkout-result','/custom.html':'custom'},page=paths[location.pathname]||(/^\/products\/\d+\.html$/.test(location.pathname)?'product':null);if(!page)return;
const base=new URL('.',document.currentScript?.src||document.baseURI);
const consentKey='midnightDesignAnalyticsConsentV1',visitorKey='midnightDesignAnalyticsVisitorV1',sessionKey='midnightStoreSessionV1',queueKey='midnightStorePendingV1',seen=new Set();
let endpoint=null,visitor=null,session=null,sending=false,retryTimer=null,attempt=0;
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}},allowed=()=>navigator.globalPrivacyControl!==true&&navigator.doNotTrack!=='1'&&read(consentKey)?.value!=='deny';
const uuid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:(r&3)|8).toString(16);});
let pending=[];try{const saved=JSON.parse(sessionStorage.getItem(queueKey)||'[]');if(Array.isArray(saved))pending=saved.filter(x=>x?.payload&&typeof x.at==='number'&&Date.now()-x.at<86400000).slice(-100);}catch{}
function persist(){try{if(pending.length)sessionStorage.setItem(queueKey,JSON.stringify(pending));else sessionStorage.removeItem(queueKey);}catch{}}
function stop(){seen.clear();pending=[];persist();clearTimeout(retryTimer);retryTimer=null;try{localStorage.removeItem(sessionKey);}catch{}}
function context(){if(!allowed()||!endpoint)return null;try{visitor=localStorage.getItem(visitorKey);if(!/^[a-f0-9-]{36}$/.test(visitor||'')){visitor=uuid();localStorage.setItem(visitorKey,visitor);}const saved=read(sessionKey);session=saved&&/^[a-f0-9-]{36}$/.test(saved.id||'')&&Date.now()-saved.at<1800000?saved.id:uuid();localStorage.setItem(sessionKey,JSON.stringify({id:session,at:Date.now()}));return {consented:true,visitorId:visitor,sessionId:session};}catch{return null;}}
function source(){try{const host=new URL(document.referrer).hostname;return host&&host!==location.hostname?host:'direct';}catch{return 'direct';}}
async function drain(){
 if(sending||!endpoint||!pending.length)return;if(!allowed()){stop();return;}sending=true;
 try{while(pending.length&&allowed()){
  const entry=pending[0];const response=await fetch(endpoint+'/api/store-events',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry.payload),keepalive:true,signal:AbortSignal.timeout(20000)});
  if(response.status===429||response.status>=500)throw Error('Tracking service temporarily unavailable');
  // Retrying a rejected payload cannot fix it. Successful retries keep the same event ID.
  if(pending[0]===entry)pending.shift();persist();attempt=0;
 }}
 catch{clearTimeout(retryTimer);retryTimer=setTimeout(()=>{retryTimer=null;drain();},Math.min(60000,1000*2**Math.min(attempt++,6)));}
 finally{sending=false;}
}
function event(type,productId,extra){const c=context();if(!c)return;const once=['page_view','product_view','checkout_start'].includes(type),dedup=c.sessionId+':'+type+':'+(productId||'')+':'+page;if(once&&seen.has(dedup))return;if(once)seen.add(dedup);pending.push({at:Date.now(),payload:{eventId:uuid(),visitorId:c.visitorId,sessionId:c.sessionId,type,page,source:source(),device:innerWidth<768?'phone':innerWidth<1025?'tablet':'desktop',...(productId?{productId}:{}),...(extra||{})}});pending=pending.slice(-100);persist();drain();}
const currentProduct=()=>page==='product'?document.body.dataset.productId||new URLSearchParams(location.search).get('id')||location.pathname.match(/products\/(\d+)\.html/)?.[1]||null:null;
let shownSince=document.visibilityState==='visible'?Date.now():null,shownMs=0,sentSeconds=0;
function flushTime(){if(shownSince!==null){shownMs+=Date.now()-shownSince;shownSince=document.visibilityState==='visible'?Date.now():null;}if(!allowed()||!endpoint){shownMs=0;return;}const seconds=Math.min(1800-sentSeconds,Math.floor(shownMs/1000));if(seconds<1)return;shownMs-=seconds*1000;sentSeconds+=seconds;event('page_time',currentProduct(),{seconds});}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushTime();else if(shownSince===null)shownSince=Date.now();});window.addEventListener('pagehide',flushTime);
setInterval(()=>{if(document.visibilityState==='visible')flushTime();},15000);
function start(){if(!allowed()){stop();return;}drain();event('page_view');const id=currentProduct();if(id)event('product_view',id);}
window.MidnightStoreTracking={context};
document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a||!a.closest('.product-card,.home-outfit-images,.opening-product,.hero-product'))return;try{const u=new URL(a.href);if(u.origin!==location.origin)return;const id=u.searchParams.get('id')||u.pathname.match(/products\/(\d+)\.html/)?.[1];if(id)event('product_click',id);}catch{}});
document.addEventListener('midnight:commerce',e=>{if(e.detail?.event==='add_to_cart')for(const item of e.detail.items||[])event('add_to_bag',String(item.item_id));});document.addEventListener('midnight:checkout-start',()=>event('checkout_start'));
window.addEventListener('storage',e=>{if(e.key===consentKey)start();});window.addEventListener('midnight:analytics-consent',start);
let configuring=false,configurationAttempt=0;
async function connect(){
 if(configuring)return;configuring=true;
 try{const response=await fetch(new URL('request-service-config.json',base),{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Missing public store connection file');const c=await response.json(),u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid public store connection');endpoint=u.origin;configurationAttempt=0;start();}
 catch{console.warn('Midnight Designs: store tracking connection is unavailable; retrying.');setTimeout(connect,Math.min(60000,2000*2**Math.min(configurationAttempt++,5)));}
 finally{configuring=false;}
}
window.addEventListener('online',()=>{if(endpoint)drain();else connect();});
connect();
})();

