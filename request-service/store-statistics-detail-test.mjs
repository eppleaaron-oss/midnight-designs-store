import test from 'node:test';import assert from 'node:assert/strict';import {statisticsDetail} from './store-statistics-detail.mjs';
test('period comparison, UTC day grouping and refunds keep independent time scopes',()=>{
 const now=Date.parse('2026-11-07T12:00:00Z'),start=now-7*86400000;
 const view=(visitor,at,device='phone')=>({visitor,session:visitor,type:'page_view',page:'shop',device,at});
 const liveOrders=[{sale:{paidAt:start-1,subtotal:2000,refundEvents:[{at:start+1,amount:500}]}},{sale:{paidAt:now-1,subtotal:3500,refundEvents:[]}}];
 const d=statisticsDetail({now,start,period:'7',device:'phone',events:[view('old',now-1),view('new',now-1)],previousEvents:[view('old',start-2)],earlierVisitors:new Set(['old']),liveOrders,catalog:new Map()});
 assert.equal(d.comparison.revenue.change,75);assert.equal(d.averageOrderValue,3500);assert.equal(d.daily.at(-1).orders,1);assert.equal(d.daily.reduce((n,r)=>n+r.refunds,0),500);assert.equal(d.daily.reduce((n,r)=>n+r.revenue,0),3500);assert.equal(d.observedVisitors.returning,1);assert.equal(d.observedVisitors.firstObserved,1);assert.equal(d.scope.sales,'All devices, verified live payments in the selected period');
});
test('empty denominators and missing history remain unavailable, not fabricated percentages',()=>{
 const d=statisticsDetail({now:Date.now(),start:Date.now()-86400000,period:'all',device:'all',events:[],previousEvents:[],earlierVisitors:new Set(),liveOrders:[],catalog:new Map()});
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
    now, start: now - 86400000, period: '7', device: 'phone', events,
    previousEvents: [], earlierVisitors: new Set(), liveOrders: [], catalog: new Map(),
  });
  assert.deepEqual(report.journey.map(step => [step.sessions, step.noNext]), [
    [3, 1], [2, 1], [1, 0], [1, null],
  ]);
});
