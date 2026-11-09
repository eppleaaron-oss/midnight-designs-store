(()=>{
'use strict';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
const number=n=>new Intl.NumberFormat('en-US').format(n);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const duration=n=>{if(n===null||n===undefined)return 'No data yet';n=Math.round(n);const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?h+'h '+m+'m':m?m+'m '+s+'s':s+'s';};
let current=null,sequence=0,controller=null,productPage=0;
let sessionExpired = false;
let appliedFilters = new URLSearchParams({period: '30', device: 'all', include: 'artwork', group: 'auto', compare: 'previous'});
const requiredCounts = {
  traffic: ['visitors', 'sessions', 'pageViews'],
  shopping: ['productClicks', 'productViews', 'addToBag', 'checkoutStarts'],
  sales: ['paidOrders', 'units', 'merchandiseGross', 'paidTotal', 'shipping', 'tax', 'refunds'],
};

function validateReport(report) {
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  for (const [section, keys] of Object.entries(requiredCounts)) {
    if (!keys.every(key => numeric(report?.[section]?.[key]))) {
      throw new Error('The statistics service returned an incomplete report.');
    }
  }
  const ratio = report.conversion?.visitors;
  if (!ratio || !numeric(ratio.numerator) || !numeric(ratio.denominator) ||
      !(ratio.percent === null || numeric(ratio.percent)) ||
      !Number.isFinite(Date.parse(report.generatedAt)) ||
      !['operations', 'feedback', 'coverage'].every(key => report[key] && typeof report[key] === 'object') ||
      !['popular', 'bestSellers', 'collections'].every(key => Array.isArray(report[key])) ||
      !report.window?.startDate || !report.window?.endDate || !report.window?.today ||
      !Array.isArray(report.trend) || !['hour','day','week','month'].includes(report.grouping) ||
      (report.comparison && !Array.isArray(report.comparison.trend)) || !report.artwork?.coverage || !Array.isArray(report.traffic.sources) || !numeric(report.testOrdersExcluded) ||
      !report.popular.every(row => row && typeof row.name === 'string' &&
        ['views', 'clicks', 'adds'].every(key => numeric(row[key])))) {
    throw new Error('The statistics service returned an incomplete report.');
  }
}

function showSignIn() {
  sessionExpired = true;
  sequence++;
  controller?.abort();
  current = null;
  $('storeReport').hidden = true;
  $('storeStatsEmpty').hidden = true;
  $('storeStatsStatus').className = 'stats-error';
  $('storeStatsStatus').textContent = 'Your owner session expired.';
  $('storeStatsSignIn').hidden = false;
  $('refreshStoreStats').hidden = true;
  $('exportStoreStats').disabled = true;
  $('exportProductCsv').disabled = true;
}
document.addEventListener('midnight:owner-session-expired', showSignIn);

function table(target,rows,columns,limit=30){const box=$(target);box.replaceChildren();if(!rows.length){box.append(node('p','No recorded data.'));return;}
 const wrap=node('div');wrap.className='stats-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Scrollable data table');
 const t=node('table');t.className='analytics-table';const head=node('thead'),h=node('tr');for(const [label]of columns){const th=node('th',label);th.scope='col';h.append(th);}head.append(h);t.append(head);const body=node('tbody');
 for(const r of rows.slice(0,limit)){const tr=node('tr');for(const [,value]of columns)tr.append(node('td',value(r)));body.append(tr);}t.append(body);wrap.append(t);box.append(wrap);
 if(rows.length>limit)box.append(node('p','Top '+limit+' of '+rows.length+' shown. Full data is included in the report download.'));
}
function cards(target,values){const box=$(target);box.replaceChildren();for(const [label,value,note]of values){const card=node('article');card.className='analytics-card';card.append(node('span',label),node('strong',value));if(note)card.append(node('small',note));box.append(card);}}
function comparison(key) {
  const baseline = current.comparison;
  const metric = baseline?.[key];
  if (!metric) return '';
  if (metric.previous === null) return baseline.label + ' traffic unavailable';
  const previous = key === 'revenue' ? money(metric.previous) : number(metric.previous);
  if (metric.change === null) return baseline.label + ' · ' + previous + ' · percentage unavailable';
  return (metric.change > 0 ? '+' : '') + metric.change.toFixed(1) + '% vs ' + baseline.label.toLowerCase() + ' (' + previous + ')';
}

function trendRangeLabel(range) {
  const dates = range.startDate === range.endDate ? range.startDate : range.startDate + ' to ' + range.endDate;
  if (current.window.startDate !== current.window.today || current.window.endDate !== current.window.today) return dates;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(Date.parse(range.end) - 1);
  return dates + ' through ' + time;
}

function trendTable(rows) {
  const details = node('details');
  details.append(node('summary', 'View exact values'));
  // Build the table only when opened, especially for long hourly reports.
  details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('table')) return;
    const wrap = node('div');
    wrap.className = 'stats-table-wrap';
    const t = node('table');
    t.className = 'analytics-table';
    const head = node('thead');
    const header = node('tr');
    for (const label of ['Period (MT)', 'Visitors', 'Sessions', 'Page views', 'Paid orders', 'Merchandise revenue', 'Refunds observed']) {
      const cell = node('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    head.append(header);
    const body = node('tbody');
    for (const row of rows) {
      const tr = node('tr');
      for (const value of [row.label, row.visitors, row.sessions, row.pageViews, row.orders, money(row.revenue), money(row.refunds)]) {
        tr.append(node('td', value ?? 'Unavailable'));
      }
      body.append(tr);
    }
    t.append(head, body);
    wrap.append(t);
    details.append(wrap);
  });
  return details;
}

function renderTrend() {
  const box = $('storeTrend');
  box.replaceChildren();
  if (!current?.trend) {
    box.append(node('p', 'Trend history is unavailable.'));
    return;
  }
  const metric = $('storeTrendMetric');
  const key = metric.value;
  const format = ['revenue', 'refunds'].includes(key) ? money : number;
  const baseline = current.comparison;
  const series = [{title:'Selected range', range:current.window, rows:current.trend}];
  if (baseline) series.push({title:baseline.label, range:baseline, rows:baseline.trend});
  const max = series.reduce((peak, item) => item.rows.reduce((value, row) => Math.max(value, row[key] ?? 0), peak), 0);
  const grouping = current.grouping;
  $('analyticsGrouping').options[0].textContent = 'Automatic · ' + grouping[0].toUpperCase() + grouping.slice(1);
  if ($('analyticsGrouping').value !== 'auto') $('analyticsGrouping').options[0].textContent = 'Automatic';
  if (baseline?.trend.some(row => row[key] !== null)) box.append(node('p', 'Both charts use the same scale.'));
  for (const [index, item] of series.entries()) {
    const region = node('div');
    region.className = 'stats-trend-series';
    region.append(node('h4', item.title), node('p', trendRangeLabel(item.range)));
    if (item.rows.every(row => row[key] === null)) {
      region.append(node('p', 'Traffic comparison is outside the retained browsing history.'));
    } else {
      const chart = node('div');
      chart.className = 'stats-chart';
      if (item.rows.length > 90) chart.classList.add('stats-chart-dense');
      if (index) chart.classList.add('stats-comparison-chart');
      chart.setAttribute('role','img');
      chart.setAttribute('aria-label',item.title+' · '+metric.selectedOptions[0].textContent+' by '+grouping+' in Mountain Time');
      for (const row of item.rows) {
        const col = node('div');
        col.className = 'stats-chart-column';
        const bar = node('span');
        bar.className = 'stats-chart-bar';
        bar.style.height = (max ? 100 * row[key] / max : 0) + '%';
        col.title = row.label + ' · ' + format(row[key]);
        col.append(bar);
        chart.append(col);
      }
      const axis = node('div');
      axis.className = 'stats-chart-axis';
      axis.append(node('span',item.rows[0]?.label||''),node('span',max?'Scale max '+format(max):'No recorded activity'),node('span',item.rows.at(-1)?.label||''));
      region.append(chart, axis);
    }
    region.append(trendTable(item.rows));
    box.append(region);
  }
}

function activityRows(){if(!current)return [];const q=$('storeProductSearch').value.trim().toLowerCase(),key=$('storeProductSort').value;return current.popular.filter(r=>(r.name+' '+r.id).toLowerCase().includes(q)).sort((a,b)=>(b[key]||0)-(a[key]||0)||a.name.localeCompare(b.name));}
function renderProducts(){const rows=activityRows(),pages=Math.max(1,Math.ceil(rows.length/20));productPage=Math.min(productPage,pages-1);table('storePopular',rows.slice(productPage*20,(productPage+1)*20),[['Product',r=>r.name],['Stable ID',r=>r.id],['Views',r=>r.views],['Time looking',r=>duration(r.seconds||0)],['Clicks',r=>r.clicks],['Bag actions',r=>r.adds],['Bought',r=>r.bought||0],['Likes',r=>r.likes||0],['Dislikes',r=>r.dislikes||0]]);
 $('storeProductCount').textContent=rows.length?'Showing '+(productPage*20+1)+'–'+Math.min((productPage+1)*20,rows.length)+' of '+rows.length+' products':'No matching products';$('storeProductPrevious').disabled=productPage===0;$('storeProductNext').disabled=productPage>=pages-1;
}
function rankings(){const key=$('storeRanking').value;table('storeBestSellers',[...current.bestSellers].sort((a,b)=>b[key]-a[key]),[['Product',r=>r.name],['Stable ID',r=>r.id],['Paid units',r=>r.units],['Gross revenue',r=>money(r.revenue)]]);table('storeCollections',[...current.collections].sort((a,b)=>b[key]-a[key]),[['Collection',r=>r.name],['Stable ID',r=>r.id],['Paid units',r=>r.units],['Gross revenue',r=>money(r.revenue)]]);}
function render(d){
 current=d;const ratio=d.conversion.visitors;
 cards('storeOverview',[['Consenting visitors',number(d.traffic.visitors),comparison('visitors')],['Sessions',number(d.traffic.sessions),comparison('sessions')],['Merchandise revenue',money(d.sales.merchandiseGross),comparison('revenue')],['Verified paid orders',number(d.sales.paidOrders),comparison('orders')],['Average merchandise order',d.averageOrderValue===null||d.averageOrderValue===undefined?'Unavailable':money(d.averageOrderValue),'Merchandise revenue ÷ paid orders; excludes shipping and tax'],['Observed visitor conversion',ratio.percent===null?'Unavailable':ratio.percent.toFixed(2)+'%',ratio.numerator+' attributed buying browsers / '+ratio.denominator+' consenting visitors']]);
 cards('storeTraffic',[['Consenting visitors',d.traffic.visitors],['Sessions',d.traffic.sessions],['Page views',d.traffic.pageViews],['Average time per visit',duration(d.traffic.averageVisitSeconds)],['Total time on store',duration(d.traffic.totalSeconds||0)],['Product-card clicks',d.shopping.productClicks],['Product views',d.shopping.productViews],['Add-to-bag actions',d.shopping.addToBag],['Checkout starts',d.shopping.checkoutStarts]]);
 cards('storeSales',[['Verified paid orders',d.sales.paidOrders],['Gross paid units',d.sales.units],['Merchandise revenue',money(d.sales.merchandiseGross)],['Total payments incl. shipping/tax',money(d.sales.paidTotal)],['Shipping collected',money(d.sales.shipping)],['Tax collected',money(d.sales.tax)],['Refunds observed in period',money(d.sales.refunds)],['Test orders excluded',d.testOrdersExcluded,'Verified test orders in the selected dates']]);
 const opLabels={awaitingApproval:'Awaiting owner approval',production:'In production',shipping:'Shipped (cumulative)',failures:'Failed, held or unknown',unmapped:'Other saved status'};
 cards('storeOperations',Object.entries(d.operations).map(([k,v])=>[opLabels[k]||k,v]));
 const feedbackLabels={productReviews:'Reviews updated in period',pendingReviews:'Pending reviews updated in range',designRatings:'Ratings updated in period',designLikes:'Design likes updated in range',designDislikes:'Design dislikes updated in range',appComments:'Comments / feedback in period',customRequests:'Custom requests in period'};
 cards('storeFeedback',Object.entries(d.feedback).map(([k,v])=>[feedbackLabels[k]||k,v]));
 cards('storeAudience',d.observedVisitors?[['First observed in period',d.observedVisitors.firstObserved],['Seen in earlier retained visits',d.observedVisitors.returning]]:[['Visitor history','Unavailable']]);
 if(d.observedVisitors)$('storeAudience').append(node('p',d.observedVisitors.label));
 table('storeSources', [...d.traffic.sources].sort((a,b) => b.sessions-a.sessions), [
   ['Traffic source', r => r.source === 'direct' ? 'Direct or unknown' : r.source],
   ['Sessions', r => number(r.sessions)],
   ['Share of sessions', r => d.traffic.sessions ? (100*r.sessions/d.traffic.sessions).toFixed(1)+'%' : 'Unavailable'],
 ]);
 if (Array.isArray(d.journey)) {
   table('storeJourney', d.journey, [
     ['Tracked step', row => row.label],
     ['Sessions reached', row => number(row.sessions)],
     ['No next step recorded', row => row.noNext === null ? 'Final tracked step' : number(row.noNext)],
   ]);
 } else {
   $('storeJourney').replaceChildren(node('p', 'Shopping journey data is unavailable.'));
 }
 table('storeDevices',d.devices||[],[['Screen-size cohort',r=>r.device],['Visitors',r=>r.visitors],['Sessions',r=>r.sessions],['Page views',r=>r.pageViews]]);
 table('storePages',d.pages||[],[['Page',r=>r.page],['Views',r=>r.views],['Visitors',r=>r.visitors],['Visible time',r=>duration(r.seconds)]]);
 rankings();renderProducts();renderTrend();
 $('storeConversion').replaceChildren(...Object.entries(d.conversion).filter(([,v])=>v&&typeof v==='object').map(([key,v])=>node('p',(key==='productViewers'?'Product-viewer conversion':'Visitor conversion')+': '+(v.percent===null?'Unavailable':v.percent.toFixed(2)+'%')+' ('+v.numerator+' attributed buying browsers / '+v.denominator+' consenting '+(key==='productViewers'?'product viewers':'visitors')+')')),...[d.conversion.label,d.unattributedOrders+' paid orders without an observed consenting visitor in this cohort.'].map(s=>node('p',s)));
 $('storeCoverage').replaceChildren(...Object.entries(d.coverage).map(([k,v])=>node('p',k.replace(/([a-z])([A-Z])/g,'$1 $2')+': '+v)));
 $('storeUnavailable').replaceChildren(...(d.unavailableMetrics||['Profit, abandoned carts and customer demographics are not available.']).map(s=>node('p',s)));
 const insights=[];if(d.operations.failures)insights.push(d.operations.failures+' saved paid orders have a held, failed or unknown status. Review Orders in Master controls.');
 if(d.coverage.unclassifiedPaidOrders)insights.push(d.coverage.unclassifiedPaidOrders+' historical paid records lack verified sales facts and are excluded from sales totals.');
 const best=[...d.bestSellers].sort((a,b)=>b.revenue-a.revenue)[0];if(best)insights.push('Revenue leader: '+best.name+' · '+money(best.revenue)+' gross merchandise sales.');
 if(!d.traffic.visitors)insights.push('No consenting visits were recorded in this cohort and period. This does not establish that the store had no visitors.');
 if(!d.sales.paidOrders)insights.push('No verified live paid orders were recorded in this period. Test orders and unclassified records do not count as sales.');
 $('storeInsights').replaceChildren(...insights.map(s=>node('p',s)));
 const dates=d.window;
 $('storeScope').textContent=dates.startDate+' to '+dates.endDate+' · Mountain Time · '+(d.scope?.traffic||d.device)+' · Sales across all screen sizes.';
 const note=$('storeRetentionNote');
 const retention=d.coverage.retentionDays;
 note.hidden=!(retention && Date.parse(d.generatedAt)-Date.parse(dates.start)>retention*86400000);
 note.textContent='Browsing and artwork events are retained for up to '+retention+' days. Earlier dates may have incomplete traffic data.';
 for(const id of ['analyticsStart','analyticsEnd'])$(id).max=dates.today;
 document.dispatchEvent(new CustomEvent('midnight:artwork-report',{detail:d.artwork}));
 $('exportStoreStats').disabled=false;$('exportProductCsv').disabled=false;
}
async function refresh(event) {
  event?.preventDefault();
  if (sessionExpired) return;
  const request = ++sequence;
  controller?.abort();
  const active = new AbortController();
  controller = active;
  const previous = current;
  const button = $('refreshStoreStats');
  const status = $('storeStatsStatus');
  status.className = '';
  status.textContent = 'Loading store statistics…';
  $('storeStatsEmpty').hidden = true;
  button.hidden = false;
  button.disabled = true;
  $('storeStatsReload').hidden = true;
  const timeout = setTimeout(() => active.abort(), 20000);
  try {
    const response = await fetch('/api/owner/store-statistics?' + appliedFilters, {
      cache: 'no-store',
      signal: active.signal,
    });
    if (request !== sequence) return;
    if (response.status === 401 || response.status === 403) {
      showSignIn();
      return;
    }
    if (response.status === 400) {
      const problem = await response.json();
      throw new Error(problem.error || 'Choose a valid date range and grouping.');
    }
    if (!response.ok) throw new Error('Store statistics could not load.');
    const report = await response.json();
    if (request !== sequence) return;
    validateReport(report);
    render(report);
    $('storeReport').hidden = false;
    $('storeStatsEmpty').hidden = Boolean(
      report.traffic.pageViews || report.traffic.totalSeconds ||
      Object.values(report.shopping).some(value => value > 0) ||
      report.sales.paidOrders || report.sales.refunds ||
      report.artwork.coverage.events || report.artwork.coverage.structuredRequests ||
      report.artwork.likes.length || report.artwork.dislikes.length ||
      report.popular.some(row => row.likes || row.dislikes) ||
      ['productReviews', 'designRatings', 'appComments', 'customRequests'].some(key => report.feedback[key] > 0)
    );
    button.textContent = 'Refresh';
    status.textContent = 'Verified saved records · Updated ' + new Date(report.generatedAt).toLocaleString();
  } catch (error) {
    if (request !== sequence) return;
    if (current !== previous && previous) render(previous);
    current = previous;
    $('storeReport').hidden = !previous;
    $('storeStatsEmpty').hidden = true;
    button.textContent = 'Retry';
    status.className = 'stats-error';
    const reason = error.name === 'AbortError' ? 'Store statistics took too long to load.'
      : error.name === 'SyntaxError' ? 'The statistics service returned an unreadable report.'
      : error.message;
    status.textContent = reason + (previous
      ? ' Showing the last successful report from ' + new Date(previous.generatedAt).toLocaleString() + '.'
      : '');
  } finally {
    clearTimeout(timeout);
    if (request === sequence) button.disabled = false;
  }
}
function download(content,type,name){const u=URL.createObjectURL(new Blob([content],{type})),a=node('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function applyFilters(event) {
  event?.preventDefault();
  const period = $('analyticsPeriod').value;
  const filters = new URLSearchParams({
    period, device: $('analyticsDevice').value, include: 'artwork',
    group: $('analyticsGrouping').value, compare: $('analyticsCompare').value,
  });
  if (period === 'custom') {
    if (!$('analyticsFilters').reportValidity()) return;
    const start = $('analyticsStart').value;
    const end = $('analyticsEnd').value;
    if (start > end) {
      $('analyticsEnd').setCustomValidity('End date must be on or after start date.');
      $('analyticsEnd').reportValidity();
      return;
    }
    filters.set('start', start);
    filters.set('end', end);
  }
  appliedFilters = filters;
  refresh();
}

const presets = [...document.querySelectorAll('.stats-date-options button')];
for (const button of presets) button.addEventListener('click', () => {
  const period = button.dataset.period;
  const custom = period === 'custom';
  $('analyticsPeriod').value = period;
  for (const preset of presets) preset.setAttribute('aria-pressed', String(preset === button));
  $('analyticsCustomDates').hidden = !custom;
  for (const [id, bound] of [['analyticsStart', 'startDate'], ['analyticsEnd', 'endDate']]) {
    const input = $(id);
    input.disabled = !custom;
    input.required = custom;
    if (custom && !input.value) input.value = current?.window?.[bound] || '';
    input.setCustomValidity('');
  }
  if (custom) $('analyticsStart').focus();
  else applyFilters();
});
for (const id of ['analyticsStart','analyticsEnd']) {
  $(id).addEventListener('input', () => $('analyticsEnd').setCustomValidity(''));
}
for (const [id, key] of [['analyticsGrouping', 'group'], ['analyticsCompare', 'compare']]) {
  $(id).addEventListener('change', () => {
    appliedFilters.set(key, $(id).value);
    refresh();
  });
}
$('refreshStoreStats').onclick = refresh;
$('analyticsFilters').addEventListener('submit', applyFilters);
$('storeRanking').onchange=()=>{if(current)rankings();};$('storeTrendMetric').onchange=renderTrend;
for(const id of ['storeProductSearch','storeProductSort'])$(id).addEventListener(id==='storeProductSearch'?'input':'change',()=>{productPage=0;renderProducts();});
$('storeProductPrevious').onclick=()=>{productPage--;renderProducts();};$('storeProductNext').onclick=()=>{productPage++;renderProducts();};
$('exportStoreStats').onclick=()=>{if(current)download(JSON.stringify(current,null,2),'application/json','midnight-store-statistics.json');};
$('exportProductCsv').onclick=()=>{if(!current)return;const safe=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';},rows=[['Product ID','Product','Views','Visible seconds','Clicks','Bag actions','Gross paid units','Likes updated in range','Dislikes updated in range','Start date (MT)','End date (MT)','Traffic cohort','Generated at'],...activityRows().map(r=>[r.id,r.name,r.views,r.seconds||0,r.clicks,r.adds,r.bought||0,r.likes||0,r.dislikes||0,current.window.startDate,current.window.endDate,current.device,current.generatedAt])];download(rows.map(r=>r.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8','midnight-product-activity.csv');};
// Keep the report current while the owner watches incoming traffic.
setInterval(()=>{if(!document.hidden&&!$('refreshStoreStats').disabled)refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('refreshStoreStats').disabled)refresh();});
refresh();
})();

