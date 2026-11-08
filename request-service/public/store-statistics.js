(()=>{
'use strict';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
const number=n=>new Intl.NumberFormat('en-US').format(n);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const duration=n=>{if(n===null||n===undefined)return 'No data yet';n=Math.round(n);const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?h+'h '+m+'m':m?m+'m '+s+'s':s+'s';};
let current=null,sequence=0,controller=null,productPage=0;
function table(target,rows,columns,limit=30){const box=$(target);box.replaceChildren();if(!rows.length){box.append(node('p','No recorded data.'));return;}
 const wrap=node('div');wrap.className='stats-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Scrollable data table');
 const t=node('table');t.className='analytics-table';const head=node('thead'),h=node('tr');for(const [label]of columns){const th=node('th',label);th.scope='col';h.append(th);}head.append(h);t.append(head);const body=node('tbody');
 for(const r of rows.slice(0,limit)){const tr=node('tr');for(const [,value]of columns)tr.append(node('td',value(r)));body.append(tr);}t.append(body);wrap.append(t);box.append(wrap);
 if(rows.length>limit)box.append(node('p','Top '+limit+' of '+rows.length+' shown. Full data is included in the report download.'));
}
function cards(target,values){const box=$(target);box.replaceChildren();for(const [label,value,note]of values){const card=node('article');card.className='analytics-card';card.append(node('span',label),node('strong',value));if(note)card.append(node('small',note));box.append(card);}}
function comparison(key){const c=current.comparison?.[key];if(!c)return 'Comparison unavailable for this reporting window';if(c.change===null)return 'Previous window: '+(key==='revenue'?money(c.previous):number(c.previous))+' · percentage change unavailable';return (c.change>0?'+':'')+c.change.toFixed(1)+'% vs previous window';}
function renderTrend(){const rows=current?.daily;if(!rows){$('storeTrend').replaceChildren(node('p','Daily history is unavailable from this backend version.'));return;}
 const key=$('storeTrendMetric').value,currency=['revenue','refunds'].includes(key),format=currency?money:number,max=Math.max(0,...rows.map(r=>r[key]||0)),box=$('storeTrend');box.replaceChildren();
 const chart=node('div');chart.className='stats-chart';chart.setAttribute('role','img');chart.setAttribute('aria-label',$('storeTrendMetric').selectedOptions[0].textContent+' by UTC date. Exact values in the table below.');
 for(const r of rows){const col=node('div');col.className='stats-chart-column';const bar=node('span');bar.className='stats-chart-bar';bar.style.height=(max?100*(r[key]||0)/max:0)+'%';col.title=r.date+': '+format(r[key]||0);col.append(bar);chart.append(col);}box.append(chart);
 const axis=node('div');axis.className='stats-chart-axis';axis.append(node('span',rows[0]?.date||''),node('span',max?'Peak '+format(max):'No recorded activity'),node('span',rows.at(-1)?.date||''));box.append(axis);
 const details=node('details'),summary=node('summary','View exact daily values');details.append(summary);const wrap=node('div');wrap.className='stats-table-wrap';const t=node('table');t.className='analytics-table';const h=node('tr');for(const text of ['Date (UTC)','Visitors','Sessions','Page views','Paid orders','Merchandise revenue','Refunds observed'])h.append(node('th',text));t.append(h);for(const r of rows){const tr=node('tr');for(const value of [r.date,r.visitors,r.sessions,r.pageViews,r.orders,money(r.revenue),money(r.refunds)])tr.append(node('td',value));t.append(tr);}wrap.append(t);details.append(wrap);box.append(details);
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
 cards('storeSales',[['Verified paid orders',d.sales.paidOrders],['Gross paid units',d.sales.units],['Merchandise revenue',money(d.sales.merchandiseGross)],['Total payments incl. shipping/tax',money(d.sales.paidTotal)],['Shipping collected',money(d.sales.shipping)],['Tax collected',money(d.sales.tax)],['Refunds observed in period',money(d.sales.refunds)],['Test orders excluded',d.testOrdersExcluded,'All saved verified test orders, outside live sales']]);
 const opLabels={awaitingApproval:'Awaiting owner approval',production:'In production',shipping:'Shipped (cumulative)',failures:'Failed, held or unknown',unmapped:'Other saved status'};
 cards('storeOperations',Object.entries(d.operations).map(([k,v])=>[opLabels[k]||k,v]));
 const feedbackLabels={productReviews:'Reviews updated in period',pendingReviews:'Pending reviews (all time)',designRatings:'Ratings updated in period',designLikes:'Design likes (all time)',designDislikes:'Design dislikes (all time)',appComments:'Comments / feedback in period',customRequests:'Custom requests in period'};
 cards('storeFeedback',Object.entries(d.feedback).map(([k,v])=>[feedbackLabels[k]||k,v]));
 cards('storeAudience',d.observedVisitors?[['First observed in period',d.observedVisitors.firstObserved],['Seen in earlier retained visits',d.observedVisitors.returning]]:[['Visitor history','Unavailable']]);
 if(d.observedVisitors)$('storeAudience').append(node('p',d.observedVisitors.label));
 cards('storeCatalog',d.catalog?[['Listed products',d.catalog.products],['Store variants',d.catalog.variants],['Available variants',d.catalog.availableVariants]]:[['Catalog totals','Unavailable']]);
 table('storeSources',[...d.traffic.sources].sort((a,b)=>b.sessions-a.sessions),[['Traffic source',r=>r.source],['Sessions',r=>r.sessions]]);
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
 $('storeScope').textContent=(d.window?new Date(d.window.start).toLocaleString()+' → '+new Date(d.window.end).toLocaleString()+' · ':'')+'Traffic: '+(d.scope?.traffic||d.device)+' · Sales: all devices · Orders: all saved live paid orders · Reactions: all time.';
 $('exportStoreStats').disabled=false;$('exportProductCsv').disabled=false;
}
async function refresh(e){e?.preventDefault();const request=++sequence;controller?.abort();controller=new AbortController();const status=$('storeStatsStatus');status.textContent='Loading verified store statistics…';$('refreshStoreStats').disabled=true;
 try{const r=await fetch('/api/owner/store-statistics?period='+encodeURIComponent($('analyticsPeriod').value)+'&device='+encodeURIComponent($('analyticsDevice').value),{cache:'no-store',signal:controller.signal});if(r.status===401){location.replace('/login?next=analytics');return;}const d=await r.json();if(!r.ok)throw Error(d.error||'Statistics unavailable.');if(request!==sequence)return;if(!d?.traffic||!d?.sales||!d?.conversion||!Array.isArray(d.popular)||!Array.isArray(d.bestSellers)||!Array.isArray(d.collections))throw Error('The statistics service returned an incomplete report.');render(d);status.className='';status.textContent='Verified saved records · Updated '+new Date(d.generatedAt).toLocaleString();}
 catch(e){if(e.name==='AbortError'||request!==sequence)return;status.className='stats-error';status.textContent=(e.name==='SyntaxError'?'The statistics service did not return a valid report. Please retry.':e.message)+' No missing metric has been replaced with zero.'+(current?' Showing the last successful report from '+new Date(current.generatedAt).toLocaleString()+'; its filters are shown below.':'');}
 finally{if(request===sequence)$('refreshStoreStats').disabled=false;}
}
function download(content,type,name){const u=URL.createObjectURL(new Blob([content],{type})),a=node('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
$('refreshStoreStats').onclick=refresh;$('analyticsFilters').addEventListener('submit',refresh);
$('storeRanking').onchange=()=>{if(current)rankings();};$('storeTrendMetric').onchange=renderTrend;
for(const id of ['storeProductSearch','storeProductSort'])$(id).addEventListener(id==='storeProductSearch'?'input':'change',()=>{productPage=0;renderProducts();});
$('storeProductPrevious').onclick=()=>{productPage--;renderProducts();};$('storeProductNext').onclick=()=>{productPage++;renderProducts();};
$('exportStoreStats').onclick=()=>{if(current)download(JSON.stringify(current,null,2),'application/json','midnight-store-statistics.json');};
$('exportProductCsv').onclick=()=>{if(!current)return;const safe=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';},rows=[['Product ID','Product','Views','Visible seconds','Clicks','Bag actions','Gross paid units','Current all-time likes','Current all-time dislikes','Report period','Traffic cohort','Generated at'],...activityRows().map(r=>[r.id,r.name,r.views,r.seconds||0,r.clicks,r.adds,r.bought||0,r.likes||0,r.dislikes||0,current.period,current.device,current.generatedAt])];download(rows.map(r=>r.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8','midnight-product-activity.csv');};
// Keep the report current while the owner watches incoming traffic.
setInterval(()=>{if(!document.hidden&&!$('refreshStoreStats').disabled)refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('refreshStoreStats').disabled)refresh();});
refresh();
})();

