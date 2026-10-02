import fs from 'node:fs';
const d=JSON.parse(process.env.LAYOUT_SETTINGS||'');
if(d.version!==1)throw Error('Unsupported layout settings');
for(const [key,max]of [['announcement',120],['headline',100],['intro',500]])if(typeof d[key]!=='string'||!d[key].trim()||d[key].length>max)throw Error('Invalid '+key);
if(![3,6,9,12].includes(d.featuredCount))throw Error('Invalid featured product count');
for(const key of ['showStory','showTicker','showCatalog','showDesigns','showCustom','showAi'])if(typeof d[key]!=='boolean')throw Error('Invalid '+key);
fs.writeFileSync('store-layout.json',JSON.stringify(d,null,2)+'\n');
