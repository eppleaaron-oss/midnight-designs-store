(()=>{
'use strict';
const CHOICE='midnightAnalyticsConsentV1',ACTIVITY='midnightAnalyticsCartV1',RETENTION=7*24*60*60*1000;
let config={},enabled=false,started=false,timer=null,lastCartSignature='',seen=new Set();
const eligible=()=>/\/(?:index\.html|shop\.html|cart\.html|product\.html|products\/\d+\.html)?$/.test(location.pathname);
const blocked=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}};
const remove=key=>{try{localStorage.removeItem(key)}catch{}};
const validId=id=>typeof id==='string'&&/^G-[A-Z0-9]{4,20}$/.test(id);
const cleanItems=items=>(Array.isArray(items)?items:[]).filter(x=>/^\d+$/.test(x.item_id)&&Number.isFinite(x.price)&&x.price>0&&Number.isInteger(x.quantity)&&x.quantity>0&&/^[A-Z]{3}$/.test(x.currency)).map(x=>({item_id:x.item_id,item_name:String(x.item_name).slice(0,150),item_brand:'Midnight Designs',item_category:String(x.item_category).slice(0,80),item_variant:String(x.item_variant).slice(0,100),price:x.price,currency:x.currency,quantity:x.quantity}));
function send(event,items=[],extra={}){
 if(!enabled||blocked())return;
 const allowed=['page_view','view_item','view_cart','add_to_cart','remove_from_cart','cart_inactive','cart_returned'];if(!allowed.includes(event))return;
 items=cleanItems(items);
 if(['view_item','view_cart'].includes(event)){const key=event+':'+(event==='view_item'?items[0]?.item_id:'page');if(seen.has(key))return;seen.add(key)}
 const currencies=[...new Set(items.map(x=>x.currency))],params={send_to:config.measurementId,page_location:location.origin+location.pathname,page_referrer:'',page_title:'Midnight Designs',...extra};
 if(items.length){params.items=items;if(currencies.length===1){params.currency=currencies[0];params.value=Math.round(items.reduce((n,x)=>n+x.price*x.quantity,0)*100)/100}}
 window.gtag('event',event,params);
}
function schedule(){clearTimeout(timer);if(!enabled)return;const state=read(ACTIVITY);if(!state?.items?.length||state.inactive)return;timer=setTimeout(checkInactive,Math.max(0,state.at+config.cartInactivityMinutes*60000-Date.now()))}
function checkInactive(){
 const check=()=>{if(!enabled||blocked())return;const state=read(ACTIVITY);if(!state?.items?.length||state.inactive)return;if(Date.now()-state.at>RETENTION){remove(ACTIVITY);return}if(Date.now()-state.at<config.cartInactivityMinutes*60000){schedule();return}state.inactive=true;if(write(ACTIVITY,state))send('cart_inactive',state.items,{inactivity_minutes:config.cartInactivityMinutes,checkout_available:false});};
 if(navigator.locks?.request)navigator.locks.request('midnight-cart-analytics',check).catch(()=>{});else check();
}
function updateCart(items,changed=false){
 if(!enabled)return;items=cleanItems(items);const signature=JSON.stringify(items),old=read(ACTIVITY);
 if(!items.length){remove(ACTIVITY);lastCartSignature=signature;clearTimeout(timer);return}
 if(old&&Date.now()-old.at>RETENTION){remove(ACTIVITY);lastCartSignature='';}
 const current=read(ACTIVITY);
 if(changed||!current||JSON.stringify(current.items)!==signature){if(current?.inactive)send('cart_returned',items,{checkout_available:false});write(ACTIVITY,{at:Date.now(),items,inactive:false});}
 lastCartSignature=signature;checkInactive();schedule();
}
function snapshot(){const data=window.midnightAnalyticsSnapshot?.();if(!data)return;if(data.product?.length)send('view_item',data.product);if(document.getElementById('items'))send('view_cart',data.cart);updateCart(data.cart);}
function cookieOff(){for(const cookie of document.cookie.split(';')){const name=cookie.split('=')[0].trim();if(!/^_ga(?:_|$)/.test(name))continue;for(const domain of ['',location.hostname,'.'+location.hostname])document.cookie=name+'=; Max-Age=0; path=/'+(domain?'; domain='+domain:'');}}
function stop(){enabled=false;seen.clear();clearTimeout(timer);remove(ACTIVITY);if(validId(config.measurementId))window['ga-disable-'+config.measurementId]=true;if(started)window.gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});cookieOff();}
function start(){
 if(!validId(config.measurementId)||blocked()||!eligible())return;
 enabled=true;window['ga-disable-'+config.measurementId]=false;
 if(!started){window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});window.gtag('js',new Date());window.gtag('config',config.measurementId,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:location.origin+location.pathname,page_referrer:'',page_title:'Midnight Designs'});const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+config.measurementId;document.head.append(script);started=true;}
 window.gtag('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});send('page_view');snapshot();
}
const dialog=document.createElement('dialog');dialog.className='analytics-panel';dialog.setAttribute('aria-label','Optional analytics preferences');
const heading=document.createElement('h2');heading.textContent='Optional analytics.';
const copy=document.createElement('p');copy.textContent='Analytics help us understand product views and unfinished bags. Uploads, support messages and payment details are excluded. Shopping works with analytics off.';
const status=document.createElement('p');status.className='notice';status.setAttribute('role','status');
const actions=document.createElement('div');actions.className='hero-actions';
const allow=document.createElement('button');allow.type='button';allow.className='btn dark';allow.textContent='Allow analytics';
const deny=document.createElement('button');deny.type='button';deny.className='btn outline';deny.textContent='Keep analytics off';
actions.append(allow,deny);dialog.append(heading,copy,status,actions);document.body.append(dialog);
function show(){allow.hidden=!validId(config.measurementId)||blocked();status.textContent=blocked()?'Your browser’s privacy preference keeps analytics off.':!validId(config.measurementId)?'Analytics are not connected. No analytics events are sent.':!eligible()?'Analytics do not run on design, support or owner pages. Your choice applies to shopping pages.':enabled?'Optional Google Analytics is currently on. You can turn it off here.':'Optional Google Analytics is currently off. It uses analytics cookies only if you allow it.';if(!dialog.open)dialog.show();}
allow.onclick=()=>{if(!write(CHOICE,{value:'allow',at:Date.now()})){status.textContent='Your preference could not be saved. Analytics stays off.';return}start();dialog.close()};
deny.onclick=()=>{write(CHOICE,{value:'deny',at:Date.now()});stop();dialog.close()};
const footer=document.querySelector('.footer');if(footer){const button=document.createElement('button');button.type='button';button.className='analytics-preferences text-link';button.textContent='Analytics preferences';button.onclick=show;footer.append(button)}
document.addEventListener('midnight:commerce',event=>{if(!enabled)return;const {event:type,items}=event.detail||{};if(type==='cart_update')updateCart(items,true);else{send(type,items);if(type==='view_cart')updateCart(items);}});
window.addEventListener('storage',event=>{if(event.key===CHOICE){const value=read(CHOICE)?.value;value==='allow'?start():stop()}if(event.key==='midnightCartV2')snapshot()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkInactive();snapshot()}});
fetch(new URL('analytics-config.json',document.baseURI),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(value=>{config={measurementId:validId(value.measurementId)?value.measurementId:null,cartInactivityMinutes:Number.isFinite(value.cartInactivityMinutes)&&value.cartInactivityMinutes>=1?value.cartInactivityMinutes:30};const choice=read(CHOICE);if(choice?.value==='allow'&&!blocked()&&validId(config.measurementId))start();else if(validId(config.measurementId)&&!choice&&!blocked())show();else if(blocked())stop();}).catch(()=>{config={measurementId:null};stop()});
})();
