import {DAILY_HISTORY_DAYS, storeDailyHistory} from './store-daily-history.mjs';
import {DAY, RETENTION_DAYS, mountainDate, reportingRange} from './reporting-range.mjs';
import {shoppingJourney, statisticsDetail} from './store-statistics-detail.mjs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex'),uuid=x=>/^[a-f0-9-]{36}$/.test(x||'');
const trackingTag=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)?value.toLowerCase():'';
function trafficSource(value){
 const source=typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(value)?value.toLowerCase():'direct';
 if(source==='fb'||source==='facebook'||/(^|\.)facebook\.com$/.test(source))return 'facebook';
 if(source==='ig'||source==='instagram'||/(^|\.)instagram\.com$/.test(source))return 'instagram';
 return source;
}
function attributionRows(events,visits){
 const sessions=new Map();
 for(const visit of visits)if(!sessions.has(visit.session))sessions.set(visit.session,visit);
 const groups=new Map();
 const counted=new Set();
 const steps={page_view:'sessions',product_view:'productViewSessions',add_to_bag:'bagSessions',checkout_start:'checkoutSessions'};
 for(const event of events){
  const step=steps[event.type],key=event.session+':'+event.type;
  if(!step||counted.has(key))continue;
  counted.add(key);
  const entry=sessions.get(event.session)||event;
  const source=trafficSource(entry.source),campaign=entry.campaign,post=entry.post;
  const groupKey=JSON.stringify([source,campaign,post]);
  if(!groups.has(groupKey))groups.set(groupKey,{source,campaign,post,sessions:0,productViewSessions:0,bagSessions:0,checkoutSessions:0});
  groups.get(groupKey)[step]++;
 }
 return [...groups.values()].sort((a,b)=>b.sessions-a.sessions||b.checkoutSessions-a.checkoutSessions);
}
export function storeStatistics({db,products,orders,artworkReport,auth,body,send,fail,limit,origin,storefrontOrigin,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS store_events(id TEXT PRIMARY KEY,visitor TEXT NOT NULL,session TEXT NOT NULL,type TEXT NOT NULL,product TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,page TEXT NOT NULL,device TEXT NOT NULL,at INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS store_events_time ON store_events(at);`);
 const columns=new Set(db.prepare('PRAGMA table_info(store_events)').all().map(c=>c.name));
 if(!columns.has('seconds'))db.exec('ALTER TABLE store_events ADD COLUMN seconds INTEGER NOT NULL DEFAULT 0');
 for(const column of ['campaign','post'])if(!columns.has(column))db.exec("ALTER TABLE store_events ADD COLUMN "+column+" TEXT NOT NULL DEFAULT ''");
 if(!columns.has('is_test'))db.exec('ALTER TABLE store_events ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0');
 db.exec('CREATE INDEX IF NOT EXISTS store_events_test ON store_events(at,session) WHERE is_test=1');
 const history=storeDailyHistory(db,clock);
 history.seal();
 const rows=(sql,...args)=>db.prepare(sql).all(...args),count=(table,where='',args=[])=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare('SELECT count(*) n FROM '+table+(where?' WHERE '+where:'')).get(...args).n:0;
 async function report(range=reportingRange(new URLSearchParams(),clock()),device='all',includeArtwork=false,includeTests=false){
  const {start,end,now,period,baseline}=range;
  history.seal(now);
  const selectedHistory=history.coverage(range,device,now);
  const baselineHistory=baseline?history.coverage(baseline,device,now):null;
  const archivedDates=new Set(selectedHistory.archived.map(row=>row.date));
  const archiveTotal=key=>selectedHistory.archived.reduce((sum,row)=>sum+row[key],0);
  const dateBounds=[new Date(start).toISOString(),new Date(end).toISOString()];
  const catalog=await products(),events=rows('SELECT * FROM store_events WHERE at>=? AND at<? AND (?=\'all\' OR device=?) ORDER BY at,rowid',start,end,device,device),visits=events.filter(e=>e.type==='page_view'),visitors=new Set(visits.map(e=>e.visitor)),sessions=new Map();for(const e of visits)if(!sessions.has(e.session))sessions.set(e.session,trafficSource(e.source));
  const allOrders=orders(),dedup=new Map();for(const o of allOrders)if(o.session&&o.sale?.verified)dedup.set(o.session,o);const verified=[...dedup.values()],live=verified.filter(o=>o.sale.livemode===true),periodOrders=live.filter(o=>o.sale.paidAt>=start&&o.sale.paidAt<end),sales={paidOrders:periodOrders.length,units:0,merchandiseGross:0,paidTotal:0,shipping:0,tax:0,refunds:0,currency:'USD'},best=new Map(),collections=new Map(),buyers=new Set(),viewerBuyers=new Set(),productViewers=new Set(events.filter(e=>e.type==='product_view').map(e=>e.visitor));let unattributedOrders=0;
  const testSessions=new Set(rows('SELECT DISTINCT session FROM store_events WHERE is_test=1 AND at>=?',now-RETENTION_DAYS*DAY).map(e=>e.session));
  for(const order of verified)if(order.checkoutSession&&(order.ownerTest||order.sale.livemode!==true))testSessions.add(order.checkoutSession);
  const funnelEvents=events.filter(e=>e.at>=selectedHistory.cutoff);
  const excludedFunnelSessions=new Set(funnelEvents.filter(e=>testSessions.has(e.session)).map(e=>e.session));
  const funnelOrders=verified.filter(o=>o.sale.paidAt>=start&&o.sale.paidAt<end&&(includeTests||
    (o.sale.livemode===true&&!o.ownerTest&&!testSessions.has(o.checkoutSession))));
  const journey=shoppingJourney(includeTests?funnelEvents:funnelEvents.filter(e=>!testSessions.has(e.session)),funnelOrders);
  const funnel={includeTests,excludedSessions:includeTests?0:excludedFunnelSessions.size,
    paidOrdersOutsideFunnel:funnelOrders.length-journey.at(-1).orders,
    testOrders:includeTests?funnelOrders.filter(o=>o.sale.livemode!==true).length:0};
  for(const o of periodOrders){const s=o.sale;sales.merchandiseGross+=s.subtotal;sales.paidTotal+=s.total;sales.shipping+=s.shipping;sales.tax+=s.tax;const visitor=o.visitor;if(visitor&&visitors.has(visitor))buyers.add(visitor);else unattributedOrders++;if(visitor&&productViewers.has(visitor))viewerBuyers.add(visitor);for(const p of o.items){sales.units+=p.qty;const current=catalog.get(p.productId),r=best.get(p.productId)||{id:p.productId,name:current?.name||p.name,units:0,revenue:0};r.units+=p.qty;r.revenue+=p.unitAmount*p.qty;best.set(p.productId,r);if(p.collectionId){const c=collections.get(p.collectionId)||{id:p.collectionId,name:current?.collectionName||p.collectionName||p.collectionId,units:0,revenue:0};c.units+=p.qty;c.revenue+=p.unitAmount*p.qty;collections.set(c.id,c);}}}
  // Refunds are reported by the time the verified refunded amount changes.
  for(const o of live)for(const refund of o.sale.refundEvents||[])if(refund.at>=start&&refund.at<end)sales.refunds+=refund.amount;
  const blank=id=>({id,name:catalog.get(id)?.name||id,clicks:0,views:0,adds:0,bought:0,seconds:0}),popular=new Map([...catalog.keys()].map(id=>[id,blank(id)]));for(const e of events)if(e.product){const p=popular.get(e.product)||blank(e.product);if(e.type==='product_click')p.clicks++;if(e.type==='product_view')p.views++;if(e.type==='add_to_bag')p.adds++;if(e.type==='page_time')p.seconds+=e.seconds||0;popular.set(e.product,p);}for(const b of best.values()){const p=popular.get(b.id)||{...blank(b.id),name:b.name};p.bought=b.units;popular.set(b.id,p);}
  const votes=rows('SELECT product,sum(choice=\'like\') likes,sum(choice=\'dislike\') dislikes FROM product_votes WHERE updated>=? AND updated<? GROUP BY product',...dateBounds);for(const v of votes){const p=popular.get(v.product)||blank(v.product);Object.assign(p,{likes:v.likes,dislikes:v.dislikes});popular.set(p.id,p);}
  const sessionSeconds=new Map();for(const e of events)if(e.type==='page_time')sessionSeconds.set(e.session,(sessionSeconds.get(e.session)||0)+(e.seconds||0));const totalSeconds=[...sessionSeconds.values()].reduce((a,b)=>a+b,0),timedVisits=[...sessions.keys()].filter(k=>sessionSeconds.has(k)).length;
  const ratio=(n,d)=>({numerator:n,denominator:d,percent:d?100*n/d:null});const operations={awaitingApproval:0,production:0,shipping:0,failures:0,unmapped:0};for(const o of periodOrders){if(['paid_waiting','draft_ready'].includes(o.stage))operations.awaitingApproval++;else if(o.stage==='in_fulfillment')operations.production++;else if(o.stage==='shipped')operations.shipping++;else if(/hold|failed|unknown/.test(o.stage))operations.failures++;else operations.unmapped++;}
  const previousEvents=!baseline?[]:rows("SELECT * FROM store_events WHERE at>=? AND at<? AND (?='all' OR device=?) ORDER BY at,rowid",baseline.start,baseline.end,device,device);
  const earlierVisitors=new Set(rows("SELECT DISTINCT visitor FROM store_events WHERE at<? AND (?='all' OR device=?)",start,device,device).map(e=>e.visitor));
  const details=statisticsDetail({range,device,events,previousEvents,earlierVisitors,liveOrders:live,catalog,selectedHistory,baselineHistory});
  const countRecorded=(type,key)=>archiveTotal(key)+events.filter(e=>e.type===type&&(!archivedDates.size||!archivedDates.has(mountainDate(e.at)))).length;
  const recordedSeconds=archiveTotal('seconds')+events.reduce((n,e)=>e.type==='page_time'&&(!archivedDates.size||!archivedDates.has(mountainDate(e.at)))?n+(e.seconds||0):n,0);
  const historySummary={startedOn:selectedHistory.startedOn,archiveStartedOn:selectedHistory.archiveStartedOn,dailyRetentionDays:DAILY_HISTORY_DAYS,rawAvailable:Boolean(selectedHistory.startedOn&&range.endDate>=selectedHistory.startedOn&&range.end>selectedHistory.cutoff)};
  return {...details,journey,funnel,history:historySummary,...(includeArtwork&&artworkReport?{artwork:artworkReport(range,device)}:{}),period,device,generatedAt:new Date(now).toISOString(),traffic:{attribution:attributionRows(events,visits),visitors:visitors.size,sessions:sessions.size,pageViews:countRecorded('page_view','pageViews'),totalSeconds:recordedSeconds,averageVisitSeconds:timedVisits?Math.round(totalSeconds/timedVisits):null,sources:[...new Set(sessions.values())].map(source=>({source,sessions:[...sessions.values()].filter(s=>s===source).length}))},shopping:{productClicks:countRecorded('product_click','productClicks'),productViews:countRecorded('product_view','productViews'),addToBag:countRecorded('add_to_bag','addToBag'),checkoutStarts:countRecorded('checkout_start','checkoutStarts')},sales,testOrdersExcluded:verified.filter(o=>o.sale.livemode!==true&&o.sale.paidAt>=start&&o.sale.paidAt<end).length,unattributedOrders,bestSellers:[...best.values()].sort((a,b)=>b.units-a.units||b.revenue-a.revenue),collections:[...collections.values()].sort((a,b)=>b.units-a.units||b.revenue-a.revenue),popular:[...popular.values()].sort((a,b)=>b.views-a.views||b.bought-a.bought||b.clicks-a.clicks),conversion:{visitors:ratio(buyers.size,visitors.size),productViewers:ratio(viewerBuyers.size,productViewers.size),label:'Distinct attributed purchasing browsers / distinct consenting browsers in the selected period; not all customers or people'},feedback:{productReviews:count('product_reviews','updated>=? AND updated<?',dateBounds),pendingReviews:count('product_reviews',"status='pending' AND updated>=? AND updated<?",dateBounds),designRatings:count('design_ratings','updated>=? AND updated<?',dateBounds),designLikes:count('design_votes',"choice='like' AND updated>=? AND updated<?",dateBounds),designDislikes:count('design_votes',"choice='dislike' AND updated>=? AND updated<?",dateBounds),appComments:count('requests',"created>=? AND created<? AND (lower(type) LIKE '%comment%' OR lower(type) LIKE '%feedback%')",dateBounds),customRequests:count('requests',"created>=? AND created<? AND lower(type) LIKE '%custom%'",dateBounds)},operations,coverage:{retentionDays:RETENTION_DAYS,unclassifiedPaidOrders:allOrders.filter(o=>o.savedPaid&&!o.sale?.verified).length,traffic:'Optional consenting browsers only; blocked analytics are absent. Sessions expire after 30 minutes of inactivity. Time on store counts only seconds the store tab was visible, capped at 30 minutes per page; average visit length uses visits that reported time.',sales:'Verified saved payment facts only. Test purchases excluded. Payment dates use the Stripe charge timestamp when present, otherwise first verified observation; refund deltas use observation time. Best sellers show gross paid units and merchandise revenue excluding shipping/tax; refunds are separate and not allocated to products.',feedback:'Current reactions, reviews and ratings last updated in the selected range, plus requests created in that range. Feedback is not filtered by browsing device.',operations:'Current statuses of verified live orders paid in the selected range.',salesDeviceFilter:'Sales totals are not device-filtered. Conversion uses the selected traffic cohort; untracked orders are never assigned a device.'}};
 }
 return {report,async handle(req,res,path,method,url){
  if(path==='/api/store-events'){
   if(![origin,storefrontOrigin].includes(req.headers.origin))fail(403,'Origin rejected.');res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');if(method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST');res.writeHead(204);res.end();return true;}if(method!=='POST')fail(405,'Use POST.');limit(req,'store-events',150);const b=await body(req),catalog=await products();if(!b||!uuid(b.eventId)||!uuid(b.visitorId)||!uuid(b.sessionId)||!['page_view','product_click','product_view','add_to_bag','checkout_start','page_time'].includes(b.type)||b.type==='page_time'&&!(Number.isInteger(b.seconds)&&b.seconds>=1&&b.seconds<=1800)||!['phone','tablet','desktop'].includes(b.device)||!['home','shop','product','designs','outfits','bag','checkout-result','custom'].includes(b.page)||b.productId&&!catalog.has(b.productId)||['product_click','product_view','add_to_bag'].includes(b.type)&&!b.productId)fail(400,'Invalid store event.');const source=trafficSource(b.source),campaign=source==='direct'?'':trackingTag(b.campaign),post=source==='direct'?'':trackingTag(b.post);const at=clock();history.seal(at);const saved=db.prepare('INSERT OR IGNORE INTO store_events(id,visitor,session,type,product,source,page,device,at,seconds,campaign,post,is_test) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.eventId,hash(b.visitorId),hash(b.sessionId),b.type,b.productId||'',source,b.page,b.device,at,b.type==='page_time'?b.seconds:0,campaign,post,b.test===true?1:0);if(saved.changes&&b.type==='page_view')history.recordVisit(at);db.prepare('DELETE FROM store_events WHERE at<?').run(at-RETENTION_DAYS*DAY);send(res,200,{ok:true});return true;
  }
  if(path==='/api/owner/store-statistics'){const bearer=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!bearer||db.prepare('SELECT role FROM sessions WHERE hash=? AND expires>?').get(hash(bearer),clock())?.role!=='owner')auth(req,null,true);if(method!=='GET')fail(405,'Use GET.');const device=url.searchParams.get('device')||'all';if(!['all','phone','tablet','desktop','unknown'].includes(device))fail(400,'Choose a valid screen size.');
   let range;try{range=reportingRange(url.searchParams,clock());}catch(error){fail(400,error.message);}
   send(res,200,await report(range,device,url.searchParams.get('include')==='artwork',url.searchParams.get('tests')==='show'));return true;}return false;
 }};
}

