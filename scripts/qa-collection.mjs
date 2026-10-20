import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// A lightweight DOM harness covers filtering/pagination without remote product images.
const {parseHTML}=await import(process.env.MIDNIGHT_DOM_MODULE||'linkedom');
const {window}=parseHTML(fs.readFileSync('shop.html','utf8')),document=window.document;
for(const select of document.querySelectorAll('select')){
 let chosen=select.querySelector('option')?.getAttribute('value')||'';
 Object.defineProperty(select,'value',{get:()=>chosen,set:v=>{chosen=[...select.querySelectorAll('option')].some(o=>o.value===v)?v:'';},configurable:true});
}
const products=JSON.parse(fs.readFileSync('products.json')).products;
const loc={href:'https://midnight-designs.store/shop.html',search:'',pathname:'/shop.html'};
const ctx={window,document,location:loc,URL,URLSearchParams,console,performance:{getEntriesByType:()=>[]},requestAnimationFrame:fn=>fn(),scrollTo:()=>{},scrollY:0,sessionStorage:{getItem:()=>null,setItem:()=>{}},history:{state:null,replaceState(_a,_b,url){loc.href=String(url);loc.search=new URL(url).search;}},Intl,setTimeout};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('catalog-browse.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('app.js','utf8').split('async function init()')[0],ctx);
vm.runInContext('PRODUCTS='+JSON.stringify(products),ctx);
vm.runInContext('shop()',ctx);
const $=id=>document.getElementById(id),cards=()=>[...document.querySelectorAll('#grid .product-card')],ids=()=>cards().map(c=>c.dataset.productId);
assert.equal(cards().length,12);assert.equal($('sort').value,'newest');assert.deepEqual(ids(),[...products].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,12).map(p=>p.id));
const first=cards()[0];$('loadMore').onclick();assert.equal(cards().length,24);assert.equal(cards()[0],first,'Load More retains existing DOM cards');assert.ok(loc.search.includes('shown=24'));
const category=[...document.querySelectorAll('#categoryTabs a')].find(a=>a.dataset.type==='Hoodies');category.onclick({preventDefault(){}});assert.equal(cards().length,12);assert.ok(loc.search.includes('type=Hoodies'));assert.ok(cards().every(c=>/hoodie|hooded|sweatshirt/i.test(products.find(p=>p.id===c.dataset.productId).name)));assert.equal(category.getAttribute('aria-current'),'page');
$('browseFilters').onclick();assert.equal($('filterPanel').hidden,false);assert.equal($('browseFilters').getAttribute('aria-expanded'),'true');
$('sizeFilter').value='L';$('sizeFilter').dispatchEvent(new window.Event('change'));
assert.ok(cards().every(c=>products.find(p=>p.id===c.dataset.productId).variants.some(v=>v.size==='L')));
const shown=cards()[0];if(!$('loadMore').hidden){$('loadMore').onclick();assert.equal(cards()[0],shown);assert.equal($('sizeFilter').value,'L');assert.ok(loc.search.includes('size=L'));}
$('clearFilters').onclick();assert.equal($('category').value,'');assert.equal($('sort').value,'newest');assert.equal(cards().length,12);
$('sort').value='low';$('sort').dispatchEvent(new window.Event('change'));const prices=cards().map(c=>Number(c.querySelector('.price')?.textContent.replace(/[^0-9.]/g,'')));assert.ok(prices.every((v,i)=>!i||v>=prices[i-1]));
$('search').value='no-such-midnight-design-928741';$('search').dispatchEvent(new window.Event('input'));assert.equal(cards().length,0);assert.equal($('loadMore').hidden,true);assert.match($('catalogStatus').textContent,/0 pieces/);
$('clearFilters').onclick();assert.equal(cards().length,12);
const photoCode=fs.readFileSync('catalog-photos.js','utf8').split('(async()=>')[0];vm.runInContext(photoCode,ctx);
const photoPair=(p,e)=>{ctx.p=p;ctx.e=e;return vm.runInContext('catalogPhotoPair(p,e,null)',ctx);};
const photos=JSON.parse(fs.readFileSync('product-photos.json')).products;
const known=products.find(p=>photos[p.id]?.photos.some(x=>/back/i.test(x.view)));
const pair=photoPair(known,photos[known.id]);assert.ok(pair.second);assert.equal(pair.secondLabel,'Back view');
const single=products.find(p=>p.images?.length===1&&!photos[p.id]);assert.equal(photoPair(single,null).second,null,'Never invent a reverse image');
const other=products.find(p=>p.images?.length>1&&!photos[p.id]);assert.equal(photoPair(other,null).secondLabel,'Next photo','Unlabelled supplier image is not claimed as back artwork');
console.log('PASS: newest 12, append without losing cards, category tabs, size filtering, active state, filters disclosure, price sorting, empty results, reset, and truthful supplier photo selection.');
