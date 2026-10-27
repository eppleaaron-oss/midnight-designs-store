import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {renderStudioPanel} from './factory-product-studio.mjs';
import {renderArea} from './factory-rendering.mjs';

sharp.cache(false);sharp.concurrency(1);
const folder=process.argv[2];
try{
 const {area,panel,artwork,mode,recipe}=JSON.parse(await readFile(join(folder,'input.json'),'utf8')),inputs=new Map();
 for(const a of artwork)inputs.set(a.id,{data:await readFile(join(folder,a.file)),permissions:a.permissions,recipe:a.recipe});
 const {data,...result}=await (mode==='area'?renderArea(area,[...inputs.values()],recipe):renderStudioPanel(area,panel,async id=>inputs.get(id)));
 await writeFile(join(folder,'output.png'),data,{mode:0o600});
 await writeFile(join(folder,'result.json'),JSON.stringify({...result,peakKiB:process.resourceUsage().maxRSS}),{mode:0o600});
}catch(e){await writeFile(join(folder,'result.json'),JSON.stringify({error:String(e.message).slice(0,600),status:e.status||409}),{mode:0o600});}
