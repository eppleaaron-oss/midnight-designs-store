import fs from 'node:fs';
const action=process.env.CATALOG_ACTION,id=process.env.CATALOG_ITEM_ID?.trim();
if(!id||id.length>120||!/^[-a-zA-Z0-9_:]+$/.test(id))throw Error('A valid exact item ID is required');
const read=path=>JSON.parse(fs.readFileSync(path,'utf8')),write=(path,data)=>fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n');
if(action==='delete-design'){const designs=read('designs.json');if(!designs.some(d=>d.id===id))throw Error('Design ID not found');write('designs.json',designs.filter(d=>d.id!==id));}
else if(action==='hide-product'){const products=read('products.json'),exclusions=read('catalog-exclusions.json');if(!products.products.some(p=>p.id===id))throw Error('Product ID not found');exclusions.productIds=[...new Set([...exclusions.productIds,id])];write('catalog-exclusions.json',exclusions);products.products=products.products.filter(p=>p.id!==id);write('products.json',products);}
else if(action==='restore-product'){const exclusions=read('catalog-exclusions.json');if(!exclusions.productIds.includes(id))throw Error('Product is not hidden');exclusions.productIds=exclusions.productIds.filter(x=>x!==id);write('catalog-exclusions.json',exclusions);}
else throw Error('Unknown catalog action');
