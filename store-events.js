(()=>{
'use strict';
const paths={'/':'home','/index.html':'home','/shop.html':'shop','/product.html':'product','/designs.html':'designs','/outfits.html':'outfits','/cart.html':'bag','/checkout-result.html':'checkout-result','/custom.html':'custom'},page=paths[location.pathname]||(/^\/products\/\d+\.html$/.test(location.pathname)?'product':null);if(!page)return;
const base=new URL('.',document.currentScript?.src||document.baseURI);
const consentKey='midnightDesignAnalyticsConsentV1',visitorKey='midnightDesignAnalyticsVisitorV1',sessionKey='midnightStoreSessionV1',queueKey='midnightStorePendingV1',seen=new Set();
let endpoint=null,visitor=null,sending=false,retryTimer=null,attempt=0;
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}},allowed=()=>navigator.globalPrivacyControl!==true&&navigator.doNotTrack!=='1'&&read(consentKey)?.value!=='deny';
const uuid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:(r&3)|8).toString(16);});
let pending=[];try{const saved=JSON.parse(sessionStorage.getItem(queueKey)||'[]');if(Array.isArray(saved))pending=saved.filter(x=>x?.payload&&typeof x.at==='number'&&Date.now()-x.at<86400000).slice(-100);}catch{}
function persist(){try{if(pending.length)sessionStorage.setItem(queueKey,JSON.stringify(pending));else sessionStorage.removeItem(queueKey);}catch{}}
function stop(){seen.clear();pending=[];persist();clearTimeout(retryTimer);retryTimer=null;activeSession=null;try{localStorage.removeItem(sessionKey);}catch{}try{sessionStorage.removeItem(sessionKey);}catch{}}
const tag=value=>/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value||'')?value.toLowerCase():'';
const direct={source:'direct',campaign:'',post:''};
let activeSession;
const ownerTestKey='midnightOwnerTestTab';
let ownerTest=location.hash==='#midnight-owner-test';
try{
 if(ownerTest){
  sessionStorage.setItem(ownerTestKey,'1');
  window.history.replaceState(window.history.state,'',location.pathname+location.search);
 }
 ownerTest=sessionStorage.getItem(ownerTestKey)==='1';
}catch{}
function landing(){
 const query=new URLSearchParams(location.search);
 const source=tag(query.get('utm_source'));
 let referrer;
 try{const url=new URL(document.referrer);if(['https:','http:'].includes(url.protocol))referrer=url;}catch{}
 const sameStore=referrer&&referrer.hostname.replace(/^www\./,'')===location.hostname.replace(/^www\./,'');
 const paymentReturn=page==='checkout-result'&&(!referrer||referrer.hostname==='checkout.stripe.com');
 return {
  tags:source?{source,campaign:tag(query.get('utm_campaign')),post:tag(query.get('utm_content'))}:null,
  referral:!sameStore&&!paymentReturn?referrer?.hostname:null,
  continued:sameStore||paymentReturn||performance.getEntriesByType('navigation')[0]?.type==='reload',
 };
}
function context(){
 if(!allowed()||!endpoint)return null;
 try{
  visitor=localStorage.getItem(visitorKey);
  if(!/^[a-f0-9-]{36}$/.test(visitor||'')){visitor=uuid();localStorage.setItem(visitorKey,visitor);}
  const now=Date.now();
  const current=s=>s&&/^[a-f0-9-]{36}$/.test(s.id||'')&&now-s.at<1800000;
  if(!current(activeSession)){
   let tab;
   try{tab=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{}
   const entry=landing(),saved=tab||(entry.continued?read(sessionKey):null);
   const previous=saved?.attribution||direct;
   const sameTag=entry.tags&&['source','campaign','post'].every(key=>entry.tags[key]===previous[key]);
   const reuse=!activeSession&&current(saved)&&Boolean(saved.ownerTest)===ownerTest&&(entry.tags?sameTag:entry.continued);
   activeSession=reuse?saved:{id:uuid(),ownerTest,attribution:entry.tags||(entry.referral?{...direct,source:entry.referral}:direct)};
  }
  activeSession.at=now;
  localStorage.setItem(sessionKey,JSON.stringify(activeSession));
  try{sessionStorage.setItem(sessionKey,JSON.stringify(activeSession));}catch{}
  return {consented:true,visitorId:visitor,sessionId:activeSession.id,ownerTest,...(activeSession.attribution||direct)};
 }catch{return null;}
}
const bagKey='midnightCartV2', bagObservedKey='midnightStoreBagObservedV1';
let lastBag;
function bagState(){
 if(!allowed()||!endpoint)return;
 try{
  const stored=read(bagKey);
  if(stored!==null&&!Array.isArray(stored))return;
  if(stored===null&&localStorage.getItem(bagKey)!==null)return;
  const quantities=new Map();
  for(const row of stored||[]){
   const id=String(row?.productId??'');
   if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)||!Number.isInteger(row.qty)||row.qty<1||row.qty>99)continue;
   quantities.set(id,Math.min(9999,(quantities.get(id)||0)+row.qty));
  }
  const items=[...quantities].sort(([a],[b])=>a.localeCompare(b)).slice(0,100);
  if(!items.length&&!localStorage.getItem(bagObservedKey))return;
  const c=context();
  if(!c)return;
  const signature=JSON.stringify([c.sessionId,items]);
  if(signature===lastBag)return;
  if(items.length)localStorage.setItem(bagObservedKey,'1');
  lastBag=signature;
  event('bag_state',null,{items,observedAt:Date.now()});
 }catch{}
}
async function drain(){
 if(sending||!endpoint||!pending.length)return;if(!allowed()){stop();return;}sending=true;
 try{while(pending.length&&allowed()){
  const entry=pending[0];const response=await fetch(endpoint+'/api/store-events',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry.payload),keepalive:true,signal:AbortSignal.timeout(20000)});
  if(response.status===429||response.status>=500)throw Error('Tracking service temporarily unavailable');
  // Retrying a rejected payload cannot fix it. Successful retries keep the same event ID.
  if(pending[0]===entry)pending.shift();persist();attempt=0;
  if(response.ok&&entry.payload.type==='bag_state'&&!entry.payload.items.length){
   try{
    const current=read(bagKey);
    if(localStorage.getItem(bagKey)===null||Array.isArray(current)&&!current.length)localStorage.removeItem(bagObservedKey);
   }catch{}
  }
 }}
 catch{clearTimeout(retryTimer);retryTimer=setTimeout(()=>{retryTimer=null;drain();},Math.min(60000,1000*2**Math.min(attempt++,6)));}
 finally{sending=false;}
}
function event(type,productId,extra){const c=context();if(!c)return;const once=['page_view','product_view','checkout_start'].includes(type),dedup=c.sessionId+':'+type+':'+(productId||'')+':'+page;if(once&&seen.has(dedup))return;if(once)seen.add(dedup);pending.push({at:Date.now(),payload:{eventId:uuid(),visitorId:c.visitorId,sessionId:c.sessionId,type,page,test:c.ownerTest,source:c.source,campaign:c.campaign,post:c.post,device:innerWidth<768?'phone':innerWidth<1025?'tablet':'desktop',...(productId?{productId}:{}),...(extra||{})}});pending=pending.slice(-100);persist();drain();}
const currentProduct=()=>page==='product'?document.body.dataset.productId||new URLSearchParams(location.search).get('id')||location.pathname.match(/products\/(\d+)\.html/)?.[1]||null:null;
let shownSince=document.visibilityState==='visible'?Date.now():null,shownMs=0,sentSeconds=0;
function flushTime(){if(shownSince!==null){shownMs+=Date.now()-shownSince;shownSince=document.visibilityState==='visible'?Date.now():null;}if(!allowed()||!endpoint){shownMs=0;return;}const seconds=Math.min(1800-sentSeconds,Math.floor(shownMs/1000));if(seconds<1)return;shownMs-=seconds*1000;sentSeconds+=seconds;event('page_time',currentProduct(),{seconds});}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushTime();else if(shownSince===null)shownSince=Date.now();});window.addEventListener('pagehide',flushTime);
setInterval(()=>{if(document.visibilityState==='visible')flushTime();},15000);
function start(){if(!allowed()){stop();lastBag=undefined;return;}drain();event('page_view');const id=currentProduct();if(id)event('product_view',id);bagState();}
window.MidnightStoreTracking={context};
document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a||!a.closest('.product-card,.home-outfit-images,.opening-product,.hero-product'))return;try{const u=new URL(a.href);if(u.origin!==location.origin)return;const id=u.searchParams.get('id')||u.pathname.match(/products\/(\d+)\.html/)?.[1];if(id)event('product_click',id);}catch{}});
document.addEventListener('midnight:commerce',e=>{if(e.detail?.event==='add_to_cart')for(const item of e.detail.items||[])event('add_to_bag',String(item.item_id));if(e.detail?.event==='cart_update')bagState();});document.addEventListener('midnight:checkout-start',e=>event('checkout_start',null,{test:ownerTest||e.detail?.testMode===true}));
window.addEventListener('storage',e=>{if(e.key===consentKey)start();else if(e.key===bagKey||e.key===null)bagState();});window.addEventListener('midnight:analytics-consent',start);
let configuring=false,configurationAttempt=0;
async function connect(){
 if(configuring)return;configuring=true;
 try{const response=await fetch(new URL('request-service-config.json',base),{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Missing public store connection file');const c=await response.json(),u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid public store connection');endpoint=u.origin;configurationAttempt=0;start();}
 catch{console.warn('Midnight Designs: store tracking connection is unavailable; retrying.');setTimeout(connect,Math.min(60000,2000*2**Math.min(configurationAttempt++,5)));}
 finally{configuring=false;}
}
window.addEventListener('midnight:bag-changed',bagState);
window.addEventListener('pageshow',e=>{if(e.persisted)bagState();});
window.addEventListener('online',()=>{if(endpoint)drain();else connect();});
connect();
})();

