import {REPORTING_ZONE, mountainDate, shiftDate} from './reporting-range.mjs';
const unique=(rows,key)=>new Set(rows.map(r=>r[key])).size;
const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]||0),0);
function shoppingJourney(events) {
  const steps = [
    ['page_view', 'Visited the store'],
    ['product_view', 'Viewed a product'],
    ['add_to_bag', 'Added to bag'],
    ['checkout_start', 'Started checkout'],
  ];
  const stageBySession = new Map();
  // Events arrive ordered by recorded time. A session advances one step at a time.
  for (const event of events) {
    const stage = stageBySession.get(event.session) ?? -1;
    if (steps[stage + 1]?.[0] === event.type) stageBySession.set(event.session, stage + 1);
  }
  const counts = steps.map((_, step) => {
    let reached = 0;
    for (const stage of stageBySession.values()) if (stage >= step) reached++;
    return reached;
  });
  return steps.map(([key, label], step) => ({
    key,
    label,
    sessions: counts[step],
    noNext: step < steps.length - 1 ? counts[step] - counts[step + 1] : null,
  }));
}

export function statisticsDetail({range,device,events,previousEvents,earlierVisitors,liveOrders,catalog}){
 const {start,end,startDate,endDate,today,previousStart}=range;
 const previousOrders=liveOrders.filter(o=>previousStart!==null&&o.sale.paidAt>=previousStart&&o.sale.paidAt<start);
 const paid=liveOrders.filter(o=>o.sale.paidAt>=start&&o.sale.paidAt<end);
 const visits=events.filter(e=>e.type==='page_view'),oldVisits=previousEvents.filter(e=>e.type==='page_view');
 const metric=(n,b)=>({current:n,previous:b,change:b?100*(n-b)/b:null});
 const currentGross=paid.reduce((n,o)=>n+o.sale.subtotal,0),oldGross=previousOrders.reduce((n,o)=>n+o.sale.subtotal,0);
 const comparison=previousStart===null?null:{label:'Previous Mountain Time calendar range',start:new Date(previousStart).toISOString(),end:new Date(start).toISOString(),visitors:metric(unique(visits,'visitor'),unique(oldVisits,'visitor')),sessions:metric(unique(visits,'session'),unique(oldVisits,'session')),orders:metric(paid.length,previousOrders.length),revenue:metric(currentGross,oldGross)};
 const trend=new Map();
 for(let date=startDate;date<=endDate;date=shiftDate(date,1)){
   trend.set(date,{date,visitors:new Set(),sessions:new Set(),pageViews:0,orders:0,revenue:0,refunds:0});
 }
 for(const visit of visits){
   const row=trend.get(mountainDate(visit.at));
   if(!row)continue;
   row.visitors.add(visit.visitor);
   row.sessions.add(visit.session);
   row.pageViews++;
 }
 for(const o of paid){const row=trend.get(mountainDate(o.sale.paidAt));if(row){row.orders++;row.revenue+=o.sale.subtotal;}}
 for(const o of liveOrders)for(const refund of o.sale.refundEvents||[])if(refund.at>=start&&refund.at<end){const row=trend.get(mountainDate(refund.at));if(row)row.refunds+=refund.amount;}
 const daily=[...trend.values()].map(row=>({...row,visitors:row.visitors.size,sessions:row.sessions.size}));
 const devices=[...new Set(visits.map(e=>e.device))].map(device=>{const rows=visits.filter(e=>e.device===device);return {device,visitors:unique(rows,'visitor'),sessions:unique(rows,'session'),pageViews:rows.length};}).sort((a,b)=>b.sessions-a.sessions);
 const pages=[...new Set(events.map(e=>e.page))].map(page=>{const rows=events.filter(e=>e.page===page),views=rows.filter(e=>e.type==='page_view');return {page,views:views.length,visitors:unique(views,'visitor'),seconds:sum(rows.filter(e=>e.type==='page_time'),'seconds')};}).sort((a,b)=>b.views-a.views);
 const catalogProducts=[...catalog.values()];
 return {journey:shoppingJourney(events),window:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),startDate,endDate,today,timezone:REPORTING_ZONE,salesDeviceFilter:'All devices'},comparison,daily,devices,pages,averageOrderValue:paid.length?Math.round(currentGross/paid.length):null,observedVisitors:{firstObserved:[...new Set(visits.map(e=>e.visitor))].filter(v=>!earlierVisitors.has(v)).length,returning:[...new Set(visits.map(e=>e.visitor))].filter(v=>earlierVisitors.has(v)).length,label:'First observed / seen earlier in retained consented browsing history; not new or returning customers.'},catalog:{products:catalogProducts.length,variants:catalogProducts.reduce((n,p)=>n+p.variants.length,0),availableVariants:catalogProducts.reduce((n,p)=>n+p.variants.filter(v=>v.availability==='active'&&v.ownerAvailable!==false&&v.size&&v.price>0).length,0)},unavailableMetrics:['Profit and margin: supplier costs, payment fees and other business expenses are not reconciled here.','Abandoned carts: a checkout start without an attributed purchase is not proof of abandonment.','All-customer conversion, demographics and locations: consented browsing is incomplete and these attributes are not collected.','Historical visits before tracking and visits outside the retention window cannot be reconstructed.'],scope:{traffic:device==='all'?'All consenting screen-size cohorts':'Consenting '+device+' screen-size cohort',sales:'All devices, verified live payments in the selected period',operations:'Verified live orders paid in the selected range',reactions:'Current choices updated in the selected range'}};
}
