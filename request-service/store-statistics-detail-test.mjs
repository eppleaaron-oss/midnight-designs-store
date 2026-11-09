import test from 'node:test';import assert from 'node:assert/strict';import {shoppingJourney, statisticsDetail} from './store-statistics-detail.mjs';
import {reportingRange} from './reporting-range.mjs';
const rangeFor = (period, now) => reportingRange(new URLSearchParams({period}), now);
test('period comparison, Mountain Time day grouping and refunds keep independent time scopes',()=>{
 const now=Date.parse('2026-11-07T12:00:00Z'),range=rangeFor('7',now),{start}=range;
 const view=(visitor,at,device='phone')=>({visitor,session:visitor,type:'page_view',page:'shop',device,at});
 const liveOrders=[{sale:{paidAt:start-1,subtotal:2000,refundEvents:[{at:start+1,amount:500}]}},{sale:{paidAt:now-1,subtotal:3500,refundEvents:[]}}];
 const d=statisticsDetail({range,device:'phone',events:[view('old',now-1),view('new',now-1)],previousEvents:[view('old',start-2)],earlierVisitors:new Set(['old']),liveOrders,catalog:new Map()});
 assert.equal(d.comparison.revenue.change,75);assert.equal(d.averageOrderValue,3500);assert.equal(d.daily.at(-1).orders,1);assert.equal(d.daily.reduce((n,r)=>n+r.refunds,0),500);assert.equal(d.daily.reduce((n,r)=>n+r.revenue,0),3500);assert.equal(d.observedVisitors.returning,1);assert.equal(d.observedVisitors.firstObserved,1);assert.equal(d.scope.sales,'All devices, verified live payments in the selected period');
});
test('empty denominators and missing history remain unavailable, not fabricated percentages',()=>{
 const d=statisticsDetail({range:rangeFor('all',Date.now()),device:'all',events:[],previousEvents:[],earlierVisitors:new Set(),liveOrders:[],catalog:new Map()});
 assert.equal(d.comparison,null);assert.equal(d.averageOrderValue,null);assert.equal(d.devices.length,0);assert(d.unavailableMetrics.some(s=>s.startsWith('Profit')));
});

test('journey counts ordered steps per session and keeps direct checkout outside the ordered sequence', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const event = (session, type) => ({
    session, visitor: session, type, page: 'shop', device: 'phone', at: now,
  });
  const events = [
    event('full', 'page_view'),
    event('full', 'product_view'),
    event('full', 'product_view'),
    event('full', 'add_to_bag'),
    event('full', 'checkout_start'),
    event('browsed', 'page_view'),
    event('browsed', 'product_view'),
    event('only-visit', 'page_view'),
    event('direct', 'checkout_start'),
  ];
  const journey = shoppingJourney(events, [
    {session:'paid-1',checkoutSession:'full'}, {session:'paid-1',checkoutSession:'full'},
    {session:'paid-2',checkoutSession:'full'}, {session:'paid-3',checkoutSession:'direct'},
    {session:'legacy',checkoutSession:null},
  ]);
  assert.deepEqual(journey.map(step => [step.sessions, step.noNext, step.orders]), [
    [3, 1, null], [2, 1, null], [1, 0, null], [1, 0, null], [1, null, 2],
  ]);
  assert.equal(journey[1].nextPercent,50);
  assert.equal(journey[3].nextPercent,100);
  assert.equal(shoppingJourney([],[])[0].nextPercent,null);
});

test('Mountain Time presets and exact dates cross both daylight saving changes', () => {
  const custom = (start, end) => reportingRange(new URLSearchParams({period:'custom',start,end}), Date.parse('2026-11-09T06:59:00Z'));
  const spring = custom('2026-03-08','2026-03-08');
  assert.equal(new Date(spring.start).toISOString(),'2026-03-08T07:00:00.000Z');
  assert.equal(spring.end - spring.start,23 * 3600000);
  const fall = custom('2026-11-01','2026-11-01');
  assert.equal(new Date(fall.start).toISOString(),'2026-11-01T06:00:00.000Z');
  assert.equal(fall.end - fall.start,25 * 3600000);
  const now = Date.parse('2026-11-09T06:59:00Z');
  assert.equal(rangeFor('today',now).startDate,'2026-11-08');
  assert.equal(rangeFor('yesterday',now).endDate,'2026-11-07');
  assert.equal(rangeFor('365',now).startDate,'2025-11-09');
  assert.throws(() => custom('2026-02-30','2026-03-01'),RangeError);
  assert.throws(() => custom('2026-11-08','2026-11-07'),RangeError);
  assert.throws(() => custom('2026-11-09','2026-11-09'),RangeError);
});

test('Today uses hourly buckets and compares the same Mountain Time clock across DST', () => {
  const now = Date.parse('2026-03-09T16:30:00Z'); // 10:30 MDT
  const range = rangeFor('today', now);
  assert.equal(range.grouping, 'hour');
  assert.equal(new Date(range.baseline.end - 1).toISOString(), '2026-03-08T16:30:00.000Z');
  const beforeSwitch = rangeFor('today', Date.parse('2026-03-08T16:30:00Z'));
  assert.equal(new Date(beforeSwitch.baseline.end - 1).toISOString(), '2026-03-07T17:30:00.000Z');
  const year = reportingRange(new URLSearchParams({period:'today',compare:'year'}), Date.parse('2024-02-29T19:15:00Z'));
  assert.equal(year.baseline.startDate, '2023-02-28');
  assert.equal(new Date(year.baseline.end - 1).toISOString(), '2023-02-28T19:15:00.000Z');
});

test('grouped traffic deduplicates visitors and comparison respects its clock cutoff', () => {
  const now = Date.parse('2026-11-09T16:00:00Z');
  const range = reportingRange(new URLSearchParams({period:'today',group:'week'}), now);
  const visit = (at, session) => ({type:'page_view', at, visitor:'same-browser', session, page:'home', device:'phone'});
  const orders = [range.baseline.end - 1, range.baseline.end].map(paidAt => ({sale:{paidAt,subtotal:2500}}));
  const report = statisticsDetail({
    range, device:'all', events:[visit(range.start,'a'),visit(range.start+3600000,'b')],
    previousEvents:[], earlierVisitors:new Set(), liveOrders:orders, catalog:new Map(),
  });
  assert.equal(report.trend[0].date,'2026-11-09');
  assert.equal(report.trend[0].visitors,1);
  assert.equal(report.trend[0].sessions,2);
  assert.equal(report.comparison.orders.previous,1);
  assert.equal(report.comparison.trend[0].orders,1);
  assert.equal(rangeFor('7',now).grouping,'day');
  assert.equal(rangeFor('90',now).grouping,'week');
  assert.equal(rangeFor('365',now).grouping,'month');
  const lastYear = reportingRange(new URLSearchParams({period:'30',compare:'year'}), now);
  const historical = statisticsDetail({
    range:lastYear, device:'all', events:[], previousEvents:[], earlierVisitors:new Set(),
    liveOrders:[], catalog:new Map(),
  });
  assert.equal(historical.comparison.visitors.previous,null);
  assert.equal(historical.comparison.trend[0].sessions,null);
  assert.equal(historical.comparison.trend[0].orders,0);
});

test('hourly chart keeps both repeated hours on the fall DST day', () => {
  const range = reportingRange(new URLSearchParams({period:'custom',start:'2026-11-01',end:'2026-11-01',compare:'off'}), Date.parse('2026-11-09T16:00:00Z'));
  const report = statisticsDetail({
    range, device:'all', events:[], previousEvents:[], earlierVisitors:new Set(),
    liveOrders:[], catalog:new Map(),
  });
  assert.equal(report.trend.length,25);
  const repeated = report.trend.filter(row => row.label.includes('01:00'));
  assert.equal(repeated.length,2);
  assert.notEqual(repeated[0].label,repeated[1].label);
  assert.equal(report.comparison,null);
});

test('daily traffic and tracking start survive a database backup and raw-event expiry', async () => {
  const {DatabaseSync, backup} = await import('node:sqlite');
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {storeStatistics} = await import('./store-statistics.mjs');
  const folder = await mkdtemp(join(tmpdir(), 'store-history-'));
  const db = new DatabaseSync(':memory:');
  let restored;
  let now = Date.parse('2026-11-02T08:00:00Z');
  const options = {products: async () => new Map(), orders: () => [], clock: () => now};
  const day = '2026-11-01';
  const selected = (group, start=day, end=day) => reportingRange(
    new URLSearchParams({period:'custom',start,end,group,compare:'off'}), now);
  try {
    db.exec('CREATE TABLE product_votes(product TEXT,choice TEXT,updated TEXT)');
    storeStatistics({db,...options});
    const insert = db.prepare("INSERT INTO store_events(id,visitor,session,type,source,page,device,at) VALUES(?,'browser','session',?,'direct','home',?,?)");
    insert.run('a','page_view','phone',Date.parse('2026-11-01T07:30:00Z'));
    insert.run('b','page_view','desktop',Date.parse('2026-11-01T08:30:00Z'));
    insert.run('c','checkout_start','phone',Date.parse('2026-11-02T06:59:00Z'));
    const original = storeStatistics({db,...options});
    const before = await original.report(selected('day'));
    assert.equal(before.history.startedOn, day);
    assert.equal(before.daily[0].visitors, 1);
    assert.equal(before.daily[0].pageViews, 2);

    const file = join(folder, 'restored.sqlite');
    await backup(db, file);
    restored = new DatabaseSync(file);
    restored.exec('DELETE FROM store_events');
    now = Date.parse('2027-06-01T18:00:00Z');
    const recovered = storeStatistics({db:restored,...options});
    const after = await recovered.report(selected('day'));
    assert.equal(after.history.startedOn, day);
    assert.equal(after.traffic.pageViews, 2);
    assert.equal(after.shopping.checkoutStarts, 1);
    assert.equal(after.daily[0].visitors, 1);
    assert.equal(after.daily[0].sessions, 1);
    assert.equal((await recovered.report(selected('day'),'phone')).daily[0].pageViews, 1);
    assert.equal((await recovered.report(selected('month'))).trend[0].pageViews, 2);
    assert.equal((await recovered.report(selected('month'))).trend[0].visitors, null);
    assert.equal((await recovered.report(selected('hour'))).trend[0].pageViews, null);
    assert.equal((await recovered.report(selected('day','2026-10-31','2026-10-31'))).daily[0].pageViews, null);
  } finally {
    restored?.close();
    db.close();
    await rm(folder,{recursive:true,force:true});
  }
});
