import fs from 'node:fs/promises';
const catalog=JSON.parse(await fs.readFile('products.json','utf8')),info=JSON.parse(await fs.readFile('product-information.json','utf8')).products;let photos={products:{}};try{photos=JSON.parse(await fs.readFile('product-photos.json','utf8'))}catch{}
const template=(await fs.readFile('product.html','utf8')).trimEnd()+'\n',origin='https://midnight-designs.store/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=x=>JSON.stringify(x).replaceAll('<','\\u003c');
await fs.mkdir('products',{recursive:true});const desired=new Set();
for(const p of catalog.products){
 if(!/^\d+$/.test(p.id))throw Error('Invalid product ID');
 const path='products/'+p.id+'.html',url=origin+path;desired.add(p.id+'.html');
 const detail=info[p.catalogProductId],gallery=photos.products[p.id],photo=gallery?.originalImage===p.image?gallery.photos.find(x=>x.category==='product'&&/front/i.test(x.view)&&x.storeVariantIds?.includes(p.variants[0]?.id)):null;
 const image=new URL(photo?.image||p.image,origin).href,description=p.description||detail?.description||p.name+' from Midnight Designs.',meta=description.slice(0,180);
 let html=template.replace('<head>','<head><base href="/">').replace('<body>','<body data-product-id="'+p.id+'">');
 html=html.replace(/<title>.*?<\/title>/,'<title>'+esc(p.name)+' | Midnight Designs</title>');
 html=html.replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="'+esc(meta)+'">').replace(/<link rel="canonical"[^>]*>/,'<link rel="canonical" href="'+url+'">').replace(/<meta name="robots"[^>]*>/,'<meta name="robots" content="index,follow">');
 for(const [property,value]of Object.entries({'og:type':'product','og:title':p.name+' | Midnight Designs','og:url':url,'og:description':meta})){html=html.replace(new RegExp('<meta property="'+property+'" content="[^"]*">'),'<meta property="'+property+'" content="'+esc(value)+'">');}
 html=html.replace('</head>','<meta name="twitter:image" content="'+esc(image)+'"><meta property="og:image" content="'+esc(image)+'"><script id="productSchema" type="application/ld+json">'+json({'@context':'https://schema.org','@type':'Product',name:p.name,description,image:[...new Set([image,...(gallery?.originalImage===p.image?gallery.photos.filter(x=>!x.storeVariantIds?.length||x.storeVariantIds.includes(p.variants[0]?.id)).map(x=>new URL(x.image,origin).href):[])])],sku:p.id,url,brand:{'@type':'Brand',name:'Midnight Designs'},category:p.category})+'</script></head>');
 html=html.replace('<h1 id="name">Loading product…</h1>','<h1 id="name">'+esc(p.name)+'</h1>').replace('<p id="description"></p>','<p id="description">'+esc(description.split(/\n\n/)[0])+'</p>').replace('<p id="cat" class="eyebrow"></p>','<p id="cat" class="eyebrow">'+esc(p.category)+'</p>');
 const photoSet=gallery?.originalImage===p.image?gallery.photos.filter(x=>!x.storeVariantIds?.length||x.storeVariantIds.includes(p.variants[0]?.id)):[];
 html=html.replace('<div id="gallery" class="gallery" aria-label="Product images"></div>','<div id="gallery" class="gallery" aria-label="Product images"><noscript class="static-photo-gallery">'+photoSet.map(x=>'<a href="'+esc(x.image)+'"><img src="'+esc(x.image)+'" loading="lazy" alt="'+esc(p.name+' · '+x.label)+'"><span>'+esc(x.label)+'</span></a>').join('')+'</noscript></div>');
 html=html.replace('<div id="visual" class="visual"></div>','<div id="visual" class="visual"><img src="'+esc(image)+'" alt="'+esc(p.imageAlt||p.name)+' — front product view" loading="eager"></div>');
 const available=p.variants.filter(v=>v.availability==='active'&&typeof v.size==='string'&&v.size.trim());const price=available.length?'From '+new Intl.NumberFormat('en-US',{style:'currency',currency:available[0].currency}).format(Math.min(...available.map(v=>v.price))):'Unavailable';html=html.replace('<div id="price" class="price"></div>','<div id="price" class="price">'+esc(price)+'</div>');
 const section=(heading,values)=>values?.length?'<section class="product-spec-section"><h2>'+heading+'</h2><ul>'+values.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>':'';
 html=html.replace('<p class="notice">Loading product details…</p>','<section class="product-spec-section"><h2>About this piece</h2>'+description.split(/\n\n/).map(x=>'<p>'+esc(x)+'</p>').join('')+'</section>'+section('Materials',detail?.materials)+section('Fit',detail?.fit)+section('Care',detail?.care));
 html=html.replace('<section id="availableOptions" aria-label="Available product options"></section>','<section id="availableOptions" aria-label="Available product options"><h2>Sizes &amp; colors</h2><p>Sizes: '+esc([...new Set(p.variants.map(v=>v.size).filter(Boolean))].join(' · '))+'</p><p>Base options: '+esc([...new Set(p.variants.map(v=>v.color).filter(Boolean))].join(' · '))+'</p></section>');
 html=html.replace('</main>','<noscript><p class="notice">Enable JavaScript to select a variant, explore all photos and use the bag. Checkout is currently unavailable.</p></noscript></main>');
 await fs.writeFile(path,html);
}
for(const name of await fs.readdir('products'))if(/^\d+\.html$/.test(name)&&!desired.has(name))await fs.unlink('products/'+name);
const pages=['','shop.html','designs.html','shipping.html','returns.html','contact.html','order-help.html',...catalog.products.map(p=>'products/'+p.id+'.html')];
await fs.writeFile('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(path=>'<url><loc>'+origin+path+'</loc></url>').join('')+'</urlset>\n');
let shop=await fs.readFile('shop.html','utf8');shop=shop.replace(/<!-- SEARCH_LINKS_START -->[\s\S]*?<!-- SEARCH_LINKS_END -->/,'');
shop=shop.replace('</main>','<!-- SEARCH_LINKS_START --><noscript><section><h2>The full collection</h2><ul>'+catalog.products.map(p=>'<li><a href="'+esc(p.url||('products/'+p.id+'.html'))+'">'+esc(p.name)+'</a></li>').join('')+'</ul></section></noscript><!-- SEARCH_LINKS_END --></main>');await fs.writeFile('shop.html',shop);
console.log('Generated '+catalog.products.length+' crawlable product pages and sitemap.');
