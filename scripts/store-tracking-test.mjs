import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const code=await fs.readFile(new URL('../store-events.js',import.meta.url),'utf8');
const storage=(entries=[])=>{const m=new Map(entries);return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
async function fixture({path='/',configStatuses=[200],eventStatuses=[],local=storage(),session=storage(),privacy=false,referrer='https://l.facebook.com/l.php?secret=excluded',navigationType='navigate'}={}){
 let now=100000,warnings=0;const timers=[],intervals=[],sent=[],configURLs=[],docEvents={},winEvents={};
 const document={baseURI:'https://midnight-designs.store'+path,currentScript:{src:'https://midnight-designs.store/store-events.js?v=3'},body:{dataset:{}},referrer,visibilityState:'visible',addEventListener:(k,f)=>(docEvents[k]??=[]).push(f)};
 const window={addEventListener:(k,f)=>(winEvents[k]??=[]).push(f)};
 class Clock extends Date {static now(){return now;}}
 const fetch=async (url,options)=>{if(!options?.method){configURLs.push(String(url));const status=configStatuses.shift()??200;return {ok:status===200,status,json:async()=>({url:'https://midnight-designs-backend.onrender.com'})};}sent.push(JSON.parse(options.body));const status=eventStatuses.shift()??200;return {ok:status===200,status};};
 vm.runInNewContext(code,{window,document,location:new URL('https://midnight-designs.store'+path),navigator:{globalPrivacyControl:privacy},localStorage:local,sessionStorage:session,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},URL,URLSearchParams,Date:Clock,performance:{getEntriesByType:()=>[{type:navigationType}]},AbortSignal,fetch,innerWidth:390,console:{warn:()=>warnings++},setTimeout:(fn,ms)=>{const x={fn,ms};timers.push(x);return x;},clearTimeout:x=>{if(x)x.cancelled=true;},setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;}});
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 const emit=async (target,key,value={})=>{for(const fn of (target==='document'?docEvents:winEvents)[key]||[])fn(value);await settle();};
 await settle();
 return {sent,timers,intervals,configURLs,document,local,session,settle,emit,advance:ms=>now+=ms,warnings:()=>warnings,retry:async()=>{const timer=timers.find(t=>!t.ran&&!t.cancelled);assert.ok(timer);timer.ran=true;await timer.fn();await settle();}};
}
test('Facebook landing and new hoodie events reach configured backend; nested pages use public root config',async()=>{
 const f=await fixture({path:'/products/490162548.html?id=490162548'});
 assert.equal(f.configURLs[0],'https://midnight-designs.store/request-service-config.json');
 assert.deepEqual(f.sent.map(x=>x.type),['page_view','product_view']);
 assert.equal(f.sent[1].productId,'490162548');assert.equal(f.sent[0].source,'l.facebook.com');
 assert.match(f.sent[0].visitorId,/^[a-f0-9-]{36}$/);assert.equal(f.sent[0].device,'phone');
 assert.ok(!JSON.stringify(f.sent).includes('secret'));assert.ok(!JSON.stringify(f.sent).includes('l.php'));
});
test('campaign and post follow store navigation while a fresh untagged entry starts direct',async()=>{
 const landing=await fixture({path:'/shop.html?utm_source=facebook&utm_campaign=Hoodies&utm_content=Rose-Video',referrer:'https://www.instagram.com/'});
 const product=await fixture({path:'/product.html?id=490162548',referrer:'https://midnight-designs.store/shop.html',local:landing.local,session:landing.session});
 const bag=await fixture({path:'/cart.html',referrer:'https://midnight-designs.store/product.html',local:landing.local,session:landing.session});
 await bag.emit('document','midnight:checkout-start');
 for(const event of [...landing.sent,...product.sent,...bag.sent]){
  assert.equal(event.sessionId,landing.sent[0].sessionId);
  assert.equal(event.source,'facebook');
  assert.equal(event.campaign,'hoodies');
  assert.equal(event.post,'rose-video');
 }
 assert.ok(bag.sent.some(event=>event.type==='checkout_start'));
 const direct=await fixture({path:'/shop.html',referrer:'',local:landing.local,session:landing.session});
 assert.equal(direct.sent[0].source,'direct');
 assert.notEqual(direct.sent[0].sessionId,landing.sent[0].sessionId);
});
test('missing configuration retries and starts counting after recovery',async()=>{
 const f=await fixture({configStatuses:[404,200]});assert.equal(f.sent.length,0);assert.equal(f.warnings(),1);
 await f.retry();assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'page_view');
});
test('temporary supplier-independent backend failure replays same event UUID and removes acknowledged queue',async()=>{
 const f=await fixture({eventStatuses:[503,200]});assert.equal(f.sent.length,1);
 assert.equal(JSON.parse(f.session.getItem('midnightStorePendingV1')).length,1);
 await f.retry();assert.equal(f.sent.length,2);assert.equal(f.sent[0].eventId,f.sent[1].eventId);
 assert.equal(f.session.getItem('midnightStorePendingV1'),null);
});
test('unacknowledged events survive reload without being re-keyed',async()=>{
 const a=await fixture({eventStatuses:[503]}),id=a.sent[0].eventId;
 const b=await fixture({local:a.local,session:a.session,navigationType:'reload'});
 assert.equal(b.sent[0].eventId,id);assert.equal(b.sent[0].visitorId,a.sent[0].visitorId);
 assert.equal(b.session.getItem('midnightStorePendingV1'),null);
});
test('denied consent and browser privacy settings prevent collection',async()=>{
 for(const options of [{privacy:true},{local:storage([['midnightDesignAnalyticsConsentV1',JSON.stringify({value:'deny'})]])}]){
 const f=await fixture(options);assert.equal(f.sent.length,0);
 await f.emit('document','midnight:commerce',{detail:{event:'add_to_cart',items:[{item_id:'490162548'}]}});assert.equal(f.sent.length,0);
 }
});
test('product bag and checkout events retain stable product IDs; visible time arrives while browsing and is capped',async()=>{
 const f=await fixture({path:'/product.html?id=490162548'});
 await f.emit('document','midnight:commerce',{detail:{event:'add_to_cart',items:[{item_id:'490162548'}]}});
 await f.emit('document','midnight:checkout-start');assert.equal(f.sent.find(x=>x.type==='add_to_bag').productId,'490162548');
 f.advance(15000);f.intervals.find(x=>x.ms===15000).fn();await f.settle();
 assert.equal(f.sent.find(x=>x.type==='page_time').seconds,15);
 f.document.visibilityState='hidden';await f.emit('document','visibilitychange');
 const n=f.sent.length;f.advance(60000);f.intervals[0].fn();await f.settle();assert.equal(f.sent.length,n);
 f.document.visibilityState='visible';await f.emit('document','visibilitychange');f.advance(3600000);f.intervals[0].fn();await f.settle();
 assert.equal(f.sent.filter(x=>x.type==='page_time').reduce((n,x)=>n+x.seconds,0),1800);
});
test('publication retains only exact public connection file alongside private backend exclusion',async()=>{
 const config=await fs.readFile(new URL('../_config.yml',import.meta.url),'utf8');
 assert.match(config,/include:\n  - request-service-config\.json\nexclude:/);
 assert.match(config,/\n  - request-service\n/);
});


test('observes persisted bags, changes, and clearing without sending variant IDs',async()=>{
 const f=await fixture();
 f.local.setItem('midnightCartV2',JSON.stringify([{productId:'900',variantId:'901',qty:2},{productId:'900',variantId:'902',qty:1}]));
 await f.emit('document','midnight:commerce',{detail:{event:'cart_update'}});
 await f.emit('document','midnight:commerce',{detail:{event:'cart_update'}});
 const restored=await fixture({path:'/cart.html',local:f.local});
 assert.deepEqual(restored.sent.find(row=>row.type==='bag_state').items,[['900',3]]);
 f.local.removeItem('midnightCartV2');
 await f.emit('window','midnight:bag-changed');
 const states=f.sent.filter(row=>row.type==='bag_state');
 assert.deepEqual(states.map(row=>row.items),[[['900',3]],[]]);
 assert.equal(JSON.stringify(states).includes('variantId'),false);
});
