import {readFileSync} from 'node:fs';
import {mountainDate, mountainMidnight, shiftDate} from './reporting-range.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {paymentFixture} from './payment-fixture.mjs';
const event=(visitor,session,type='page_view',product)=>({eventId:randomUUID(),visitorId:visitor,sessionId:session,type,page:product?'product':'home',source:'search.example',device:'phone',...(product?{productId:product}:{})});
async function send(f,p){const r=await f.call('/api/store-events',p);assert.equal(r.status,200);return p;}
async function report(f){const r=await f.call('/api/owner/store-statistics',undefined,await f.login());assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
test('visit, product click, feedback and test purchase remain deduplicated and separate from real sales',async t=>{const f=await paymentFixture();t.after(()=>f.close());const visitor=randomUUID(),session=randomUUID();assert.equal((await f.call('/api/owner/store-statistics')).status,401);const v=await send(f,event(visitor,session));await send(f,v);const click=await send(f,event(visitor,session,'product_click','900'));await send(f,click);await send(f,event(visitor,session,'product_view','900'));await send(f,event(visitor,session,'add_to_bag','900'));await send(f,event(visitor,session,'checkout_start'));assert.equal((await f.call('/api/store-events',{...v,eventId:randomUUID(),type:'purchase',revenue:99999})).status,400);
 assert.equal((await f.call('/api/product-votes',{productId:'900',voterId:visitor,choice:'like'})).status,200);await f.call('/api/product-votes',{productId:'900',voterId:visitor,choice:'like'});const c=await f.checkout();assert.equal(c.response.status,200,JSON.stringify(c.response.data));c.session.payment_status='paid';c.session.status='complete';await f.webhook(c.session);await f.webhook(c.session);let r=await report(f);assert.equal(r.traffic.visitors,1);assert.equal(r.traffic.sessions,1);assert.equal(r.traffic.pageViews,1);assert.equal(r.shopping.productClicks,1);assert.equal(r.popular[0].likes,1);assert.equal(r.testOrdersExcluded,1);assert.equal(r.sales.paidOrders,0);assert.equal(r.bestSellers.length,0);assert.equal(r.conversion.visitors.percent,0);assert.equal(JSON.stringify(r).includes(visitor),false);assert.equal(JSON.stringify(r).includes('buyer@example.test'),false);await f.reboot();r=await report(f);assert.equal(r.traffic.visitors,1);assert.equal(r.testOrdersExcluded,1);});
test('verified live fixture sales/refunds and collection rankings use stable IDs; conversion states consented denominator',async t=>{const f=await paymentFixture({live:true});t.after(()=>f.close());const token=await f.login();const filtered=async(params='')=>{const result=await f.call('/api/owner/store-statistics?'+params,undefined,token);assert.equal(result.status,200);return result.data;};f.service().githubBackups.snapshot=()=>({configured:true});f.service().githubBackups.checkpoint=async()=>true;const visitor=randomUUID(),session=randomUUID();f.bag.analytics={consented:true,visitorId:visitor,sessionId:session};f.product.collectionId='family-1';f.product.collectionName='Original collection';await send(f,event(visitor,session));await send(f,event(visitor,session,'product_view','900'));await send(f,event(visitor,session,'add_to_bag','900'));await send(f,event(visitor,session,'checkout_start'));const c=await f.checkout();assert.equal((await filtered()).journey.at(-1).orders,0);assert.equal(c.response.status,200,JSON.stringify(c.response.data));c.session.payment_status='paid';c.session.status='complete';await f.webhook(c.session);await f.webhook(c.session);let r=await filtered();assert.equal(r.sales.paidOrders,1);assert.equal(r.journey.at(-1).orders,1);assert.equal(r.journey.at(-2).nextPercent,100);assert.equal(r.funnel.paidOrdersOutsideFunnel,0);assert.equal(r.sales.units,1);assert.equal(r.sales.merchandiseGross,3999);assert.equal(r.sales.paidTotal,4724);assert.equal(r.sales.shipping,525);assert.equal(r.sales.tax,200);assert.equal(r.bestSellers[0].id,'900');assert.equal(r.popular.find(x=>x.id==='900').bought,1);assert.equal(r.collections[0].id,'family-1');assert.equal(r.conversion.visitors.percent,100);assert.equal(r.conversion.visitors.denominator,1);assert.equal(r.conversion.productViewers.numerator,1);assert.equal(r.operations.awaitingApproval,1);
 const design=JSON.parse(readFileSync(new URL('./design-catalog.json',import.meta.url))).find(d=>d.kind!=='reference');
 f.service().db.prepare('INSERT INTO design_product_links VALUES(?,?)').run('900',design.id);
 f.product.name='Renamed top';f.product.collectionName='Renamed family';r=await filtered();
 
 const phone=await filtered('device=phone&productSource=search.example');
 const product=phone.popular.find(row=>row.id==='900');
 assert.deepEqual([product.name,product.views,product.adds,product.bought,product.revenue,product.viewSessions,product.bagViewSessions,product.paidViewSessions],['Renamed top',1,1,1,3999,1,1,1]);
 assert.deepEqual(product.designs,[{id:design.id,name:design.name}]);
 assert.deepEqual(phone.productReport.designs.map(row=>[row.id,row.bought,row.revenue]),[[design.id,1,3999]]);
 for(const params of ['device=desktop&productSource=search.example','device=phone&productSource=facebook']){
  const unmatched=(await filtered(params)).popular.find(row=>row.id==='900');
  assert.deepEqual([unmatched.views,unmatched.adds,unmatched.bought,unmatched.revenue],[0,0,0,0]);
 }
 assert.equal(r.bestSellers[0].units,1);assert.equal(r.bestSellers[0].name,'Renamed top');assert.equal(r.collections[0].name,'Renamed family');c.session.payment_intent={latest_charge:{amount_refunded:100,refunded:false}};await f.webhook(c.session);await f.webhook(c.session);r=await filtered();assert.equal(r.sales.refunds,100);c.session.payment_intent.latest_charge.amount_refunded=200;await f.webhook(c.session);r=await filtered();assert.equal(r.sales.refunds,200);assert.equal(r.sales.paidOrders,1);assert.equal(r.operations.failures,1);assert.equal(f.sessions.size,1);
});
test('review and request retries appear once as feedback without exposing customer content',async t=>{const f=await paymentFixture();t.after(()=>f.close());const voter=randomUUID(),review={quality:4,print:5,fit:3,comfort:4,value:4,shipping:3,overall:4,displayName:'Private customer',text:'Private review body',size:'L',color:'Black',consent:true,photos:[]};for(let i=0;i<2;i++)assert.equal((await f.call('/api/product-reviews',{productId:'900',voterId:voter,review})).status,200);for(const type of ['Custom design request','Question / comment']){const request={submissionId:randomUUID(),type,title:'Private request',name:'Private customer',email:'private@example.test',brief:'Do not expose this message'};for(let i=0;i<2;i++)assert.equal((await f.call('/api/requests',request)).status,201);}const r=await report(f);assert.equal(r.feedback.productReviews,1);assert.equal(r.feedback.pendingReviews,1);assert.equal(r.feedback.customRequests,1);assert.equal(r.feedback.appComments,1);assert.equal(JSON.stringify(r).includes('private@example.test'),false);assert.equal(JSON.stringify(r).includes('Private review body'),false);assert.equal(JSON.stringify(r).includes('Do not expose this message'),false);});
test('time on store adds visible seconds per visit and per product; bad durations are rejected',async t=>{const f=await paymentFixture();t.after(()=>f.close());const visitor=randomUUID(),a=randomUUID(),b=randomUUID();await send(f,event(visitor,a));await send(f,event(visitor,b));const timed=(session,seconds,product)=>({...event(visitor,session,'page_time',product),seconds});await send(f,timed(a,30));const twice=await send(f,timed(a,90,'900'));await send(f,twice);await send(f,timed(b,60));for(const seconds of [0,1801,2.5,'60',undefined])assert.equal((await f.call('/api/store-events',timed(a,seconds))).status,400);const r=await report(f);assert.equal(r.traffic.totalSeconds,180);assert.equal(r.traffic.averageVisitSeconds,90);const p=r.popular.find(x=>x.id==='900');assert.equal(p.seconds,90);assert.equal(p.bought,0);await f.reboot();assert.equal((await report(f)).traffic.totalSeconds,180);});

test('every catalog product is discoverable before it receives tracked activity',async t=>{const f=await paymentFixture();t.after(()=>f.close());const r=await report(f);const p=r.popular.find(p=>p.id==='900');assert(p);assert.equal(p.views,0);assert.equal(p.adds,0);assert.equal(p.bought,0);assert.equal(r.catalog.products,1);assert.equal(r.averageOrderValue,null);assert.equal(r.comparison.revenue.change,null);});

test('a single custom Mountain Time range bounds traffic, artwork and reactions', async t => {
  const fixture = await paymentFixture();
  t.after(() => fixture.close());
  const db = fixture.service().db;
  const day = shiftDate(mountainDate(Date.now()), -2);
  const following = shiftDate(day, 1);
  const start = mountainMidnight(day);
  const end = mountainMidnight(following);
  for (const at of [start - 1, start, end - 1, end]) {
    const id = randomUUID();
    db.prepare("INSERT INTO store_events(id,visitor,session,type,source,page,device,at) VALUES(?,?,?,'page_view','direct','home','phone',?)")
      .run(id, id, id, at);
    db.prepare("INSERT INTO design_events VALUES(?,'fixture-art','','visitor','view','phone',?)")
      .run(id, at);
    db.prepare("INSERT INTO product_votes VALUES('900',?,'like',?)").run(id, new Date(at).toISOString());
    db.prepare("INSERT INTO design_votes VALUES('fixture-art',?,'like',?)").run(id, new Date(at).toISOString());
  }
  await fixture.reboot();
  const owner = await fixture.login();
  const range = new URLSearchParams({period:'custom', start:day, end:day});
  const result = await fixture.call('/api/owner/store-statistics?include=artwork&' + range, undefined, owner);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const report = result.data;
  assert.equal(report.traffic.pageViews, 2);
  assert.equal(report.artwork.coverage.events, 2);
  assert.equal(report.artwork.likes[0].count, 2);
  assert.equal(report.popular.find(p => p.id === '900').likes, 2);
  assert.equal(report.feedback.designLikes, 2);
  assert.deepEqual(report.daily.map(day => [day.date, day.pageViews]), [[day, 2]]);
  assert.equal(report.window.timezone, 'America/Denver');
  assert.equal((await fixture.call('/api/owner/store-statistics?period=custom&start=2025-03-10&end=2025-03-09', undefined, owner)).status, 400);
});

test('owner browsing and Stripe test orders are hidden from the funnel until requested',async t=>{
 const f=await paymentFixture();t.after(()=>f.close());
 const visitor=randomUUID(),session=randomUUID(),owner=randomUUID();
 for(const type of ['page_view','product_view','add_to_bag','checkout_start']){
  const product=['product_view','add_to_bag'].includes(type)?'900':undefined;
  await send(f,event(visitor,session,type,product));
 }
 await send(f,{...event(visitor,owner),test:true});
 f.bag.analytics={consented:true,visitorId:visitor,sessionId:session};
 const c=await f.checkout();
 c.session.payment_status='paid';c.session.status='complete';
 await f.webhook(c.session);await f.webhook(c.session);
 const standard=await report(f);
 assert.deepEqual(standard.journey.map(step=>step.sessions),[0,0,0,0,0]);
 assert.equal(standard.funnel.excludedSessions,2);
 const expanded=await f.call('/api/owner/store-statistics?tests=show',undefined,await f.login());
 assert.equal(expanded.status,200);
 assert.deepEqual(expanded.data.journey.map(step=>step.sessions),[2,1,1,1,1]);
 assert.equal(expanded.data.journey[0].nextPercent,50);
 assert.equal(expanded.data.journey.at(-1).orders,1);
 assert.equal(expanded.data.funnel.testOrders,1);
 assert.equal(expanded.data.sales.paidOrders,0);
});

test('saved bags count browser state, later sessions, clears and the test filter',async t=>{
 const f=await paymentFixture();t.after(()=>f.close());
 const visitor=randomUUID(),first=randomUUID(),second=randomUUID(),owner=randomUUID();
 const snapshot=(session,items,extra={})=>({...event(visitor,session,'bag_state'),page:'bag',items,...extra});
 const initial=await send(f,snapshot(first,[['900',2]]));
 await send(f,initial);
 await send(f,snapshot(second,[['900',3]]));
 await send(f,snapshot(owner,[['900',8]],{test:true}));
 const token=await f.login();
 const get=async(query='')=>(await f.call('/api/owner/store-statistics?'+query,undefined,token)).data;
 const saved=await get();
 assert.equal(saved.bags.observations,2);
 assert.equal(saved.bags.savedBags,1);
 assert.equal(saved.bags.units,3);
 assert.equal(saved.bags.returningBags,1);
 assert.equal(saved.bags.openedSessions,2);
 assert.equal(saved.bags.recent[0].items[0].quantity,3);
 assert.ok(!JSON.stringify(saved.bags).includes(visitor));
 assert.equal((await get('tests=show')).bags.savedBags,2);
 assert.equal((await get('device=desktop')).bags.savedBags,0);
 await send(f,snapshot(second,[]));
 await send(f,snapshot(first,[['900',1]],{observedAt:Date.now()-60000}));
 const cleared=(await get()).bags;
 assert.equal(cleared.savedBags,0);
 assert.equal(cleared.clearedBags,1);
 assert.equal((await f.call('/api/store-events',snapshot(second,[['900',-1]]))).status,400);
});
