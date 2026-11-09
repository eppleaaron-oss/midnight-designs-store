import {REPORTING_ZONE, mountainDate, mountainMidnight, shiftDate} from './reporting-range.mjs';
const unique=(rows,key)=>new Set(rows.map(r=>r[key])).size;
const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]||0),0);
export function shoppingJourney(events, paidOrders) {
  const steps = [
    ['page_view', 'Visited the store'],
    ['product_view', 'Viewed a product'],
    ['add_to_bag', 'Added to bag'],
    ['checkout_start', 'Started checkout'],
    ['paid_order', 'Paid orders'],
  ];
  const stageBySession = new Map();
  // Events arrive ordered by recorded time. A session advances one step at a time.
  for (const event of events) {
    const stage = stageBySession.get(event.session) ?? -1;
    if (steps[stage + 1]?.[0] === event.type) stageBySession.set(event.session, stage + 1);
  }
  const matchedOrders = new Set();
  for (const order of paidOrders) {
    if (!matchedOrders.has(order.session) && stageBySession.get(order.checkoutSession) >= 3) {
      matchedOrders.add(order.session);
      stageBySession.set(order.checkoutSession, 4);
    }
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
    orders: key === 'paid_order' ? matchedOrders.size : null,
    noNext: step < steps.length - 1 ? counts[step] - counts[step + 1] : null,
    nextPercent: step < steps.length - 1 && counts[step] ? 100 * counts[step + 1] / counts[step] : null,
  }));
}

const HOUR = 3600000;
const hourLabel = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORTING_ZONE, month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortGeneric',
});
const hourOffset = new Intl.DateTimeFormat('en', {
  timeZone: REPORTING_ZONE, timeZoneName: 'shortOffset',
});
function bucketDate(date, grouping) {
  if (grouping === 'month') return date.slice(0, 7) + '-01';
  if (grouping === 'week') {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    return shiftDate(date, -((weekday + 6) % 7));
  }
  return date;
}

function trendSeries(range, grouping, visits, orders, trafficAvailable = true, history = null) {
  const {start, end, startDate, endDate} = range;
  const hourly = grouping === 'hour';
  const keyAt = at => hourly ? Math.floor(at / HOUR) * HOUR : bucketDate(mountainDate(at), grouping);
  const buckets = new Map();
  const archived = new Map((history?.archived || []).map(row => [row.date, row]));
  const add = (key, date, label) => buckets.set(key, {
    date, label, visitors: new Set(), sessions: new Set(), pageViews: 0,
    orders: 0, revenue: 0, refunds: 0,
  });
  if (hourly) {
    for (let at = keyAt(start); at < end; at += HOUR) {
      const offset = hourOffset.formatToParts(at).find(part => part.type === 'timeZoneName').value;
      add(at, new Date(at).toISOString(), hourLabel.format(at) + ' (' + offset + ')');
    }
  } else {
    let date = bucketDate(startDate, grouping);
    while (date <= endDate) {
      add(date, date, grouping === 'month' ? date.slice(0, 7) : date);
      if (grouping === 'month') {
        const [year, month] = date.split('-').map(Number);
        date = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      } else {
        date = shiftDate(date, grouping === 'week' ? 7 : 1);
      }
    }
  }
  if (trafficAvailable || history) for (const visit of visits) {
    if (archived.has(mountainDate(visit.at))) continue;
    const row = buckets.get(keyAt(visit.at));
    if (!row) continue;
    row.visitors.add(visit.visitor);
    row.sessions.add(visit.session);
    row.pageViews++;
  }
  if (history) {
    const hasDay = date => history.startedOn && date >= history.startedOn && mountainMidnight(date) >= history.cutoff;
    if (hourly) {
      for (const row of buckets.values()) {
        const at = Date.parse(row.date);
        const date = mountainDate(at);
        if (!history.startedOn || date < history.startedOn || at < history.cutoff) row.missingTraffic = true;
      }
    } else {
      for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) {
        const row = buckets.get(bucketDate(date, grouping));
        const saved = archived.get(date);
        if (saved) {
          row.pageViews += saved.pageViews;
          if (grouping === 'day') row.archived = saved;
          else row.missingDistinct = true;
        } else if (!hasDay(date)) {
          row.missingTraffic = true;
        }
      }
    }
  }
  for (const order of orders) {
    if (order.sale.paidAt >= start && order.sale.paidAt < end) {
      const row = buckets.get(keyAt(order.sale.paidAt));
      row.orders++;
      row.revenue += order.sale.subtotal;
    }
    for (const refund of order.sale.refundEvents || []) {
      if (refund.at >= start && refund.at < end) buckets.get(keyAt(refund.at)).refunds += refund.amount;
    }
  }
  return [...buckets.values()].map(row => ({
    date: row.date,
    label: row.label,
    orders: row.orders,
    revenue: row.revenue,
    refunds: row.refunds,
    visitors: (history || trafficAvailable) && !row.missingTraffic && !row.missingDistinct ? (row.archived?.visitors ?? row.visitors.size) : null,
    sessions: (history || trafficAvailable) && !row.missingTraffic && !row.missingDistinct ? (row.archived?.sessions ?? row.sessions.size) : null,
    pageViews: (history || trafficAvailable) && !row.missingTraffic ? row.pageViews : null,
  }));
}

export function statisticsDetail({range,device,events,previousEvents,earlierVisitors,liveOrders,catalog,selectedHistory,baselineHistory}){
 const {start,end,startDate,endDate,today,grouping,baseline}=range;
 const paid=liveOrders.filter(o=>o.sale.paidAt>=start&&o.sale.paidAt<end);
 const visits=events.filter(e=>e.type==='page_view'),oldVisits=previousEvents.filter(e=>e.type==='page_view');
 const metric=(current,previous)=>({current,previous,change:previous>0?100*(current-previous)/previous:null});
 const currentGross=sum(paid.map(o=>o.sale),'subtotal');
 const daily=trendSeries(range,'day',visits,liveOrders,true,selectedHistory);
 const trend=grouping==='day'?daily:trendSeries(range,grouping,visits,liveOrders,true,selectedHistory);
 let comparison=null;
 if(baseline){
   const previousOrders=liveOrders.filter(o=>o.sale.paidAt>=baseline.start&&o.sale.paidAt<baseline.end);
   const trafficAvailable=baseline.trafficAvailable&&(!baselineHistory||Boolean(baselineHistory.startedOn&&baseline.startDate>=baselineHistory.startedOn));
   comparison={
     mode:baseline.mode,label:baseline.label,startDate:baseline.startDate,endDate:baseline.endDate,
     start:new Date(baseline.start).toISOString(),end:new Date(baseline.end).toISOString(),
     trafficAvailable,
     visitors:metric(unique(visits,'visitor'),trafficAvailable?unique(oldVisits,'visitor'):null),
     sessions:metric(unique(visits,'session'),trafficAvailable?unique(oldVisits,'session'):null),
     orders:metric(paid.length,previousOrders.length),
     revenue:metric(currentGross,sum(previousOrders.map(o=>o.sale),'subtotal')),
     trend:trendSeries(baseline,grouping,oldVisits,liveOrders,trafficAvailable,baselineHistory),
   };
 }
 const devices=[...new Set(visits.map(e=>e.device))].map(device=>{const rows=visits.filter(e=>e.device===device);return {device,visitors:unique(rows,'visitor'),sessions:unique(rows,'session'),pageViews:rows.length};}).sort((a,b)=>b.sessions-a.sessions);
 const pages=[...new Set(events.map(e=>e.page))].map(page=>{const rows=events.filter(e=>e.page===page),views=rows.filter(e=>e.type==='page_view');return {page,views:views.length,visitors:unique(views,'visitor'),seconds:sum(rows.filter(e=>e.type==='page_time'),'seconds')};}).sort((a,b)=>b.views-a.views);
 const catalogProducts=[...catalog.values()];
 return {window:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),startDate,endDate,today,timezone:REPORTING_ZONE,salesDeviceFilter:'All devices'},comparison,grouping,trend,daily,devices,pages,averageOrderValue:paid.length?Math.round(currentGross/paid.length):null,observedVisitors:{firstObserved:[...new Set(visits.map(e=>e.visitor))].filter(v=>!earlierVisitors.has(v)).length,returning:[...new Set(visits.map(e=>e.visitor))].filter(v=>earlierVisitors.has(v)).length,label:'First observed / seen earlier in retained consented browsing history; not new or returning customers.'},catalog:{products:catalogProducts.length,variants:catalogProducts.reduce((n,p)=>n+p.variants.length,0),availableVariants:catalogProducts.reduce((n,p)=>n+p.variants.filter(v=>v.availability==='active'&&v.ownerAvailable!==false&&v.size&&v.price>0).length,0)},unavailableMetrics:['Profit and margin: supplier costs, payment fees and other business expenses are not reconciled here.','Abandoned carts: a checkout start without an attributed purchase is not proof of abandonment.','All-customer conversion, demographics and locations: consented browsing is incomplete and these attributes are not collected.','Historical visits before tracking and visits outside the retention window cannot be reconstructed.'],scope:{traffic:device==='all'?'All consenting screen-size cohorts':'Consenting '+device+' screen-size cohort',sales:'All devices, verified live payments in the selected period',operations:'Verified live orders paid in the selected range',reactions:'Current choices updated in the selected range'}};
}
