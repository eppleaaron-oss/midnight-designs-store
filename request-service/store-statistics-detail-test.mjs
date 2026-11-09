import test from 'node:test';import assert from 'node:assert/strict';import {statisticsDetail} from './store-statistics-detail.mjs';
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
  const report = statisticsDetail({
    range: rangeFor('7', now), device: 'phone', events,
    previousEvents: [], earlierVisitors: new Set(), liveOrders: [], catalog: new Map(),
  });
  assert.deepEqual(report.journey.map(step => [step.sessions, step.noNext]), [
    [3, 1], [2, 1], [1, 0], [1, null],
  ]);
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
