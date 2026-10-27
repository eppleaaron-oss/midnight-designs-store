import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Native image allocators retain high-water allocations across jobs. A short
// lived process releases those pages before the next panel or network step.
// Only this panel's original bytes and permissions enter it, never API keys.
export async function renderStudioPanelIsolated(area,panel,read){
 const artwork=[];for(const id of new Set((panel.layers||[]).map(l=>l.asset)))artwork.push({id,...await read(id)});
 return isolatedRender(area,{panel,mode:'studio'},artwork);
}

export async function renderAreaIsolated(area,sources,recipe){
 return isolatedRender(area,{recipe,mode:'area'},sources.map((s,i)=>({...s,id:String(i)})));
}

async function isolatedRender(area,request,sources){
 const folder=await mkdtemp(join(tmpdir(),'midnight-studio-render-'));
 try{
  const artwork=[];
  for(const source of sources){const {data,...metadata}=source,file='source-'+artwork.length;await writeFile(join(folder,file),Buffer.from(data),{mode:0o600});artwork.push({...metadata,file});}
  await writeFile(join(folder,'input.json'),JSON.stringify({area,...request,artwork}),{mode:0o600});
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--max-old-space-size=128',new URL('./factory-studio-render-worker.mjs',import.meta.url).pathname,folder],{stdio:'ignore',env:{PATH:process.env.PATH||'',MALLOC_ARENA_MAX:'2',VIPS_CONCURRENCY:'1'}});
   let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},20*60*1000);timer.unref();
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',(code,signal)=>{clearTimeout(timer);if(code===0)resolve();else reject(Object.assign(Error(timedOut?'Print rendering timed out. The saved design is retained.':signal?'Print rendering stopped before completing. The saved design is retained.':'Print rendering could not complete. The saved design is retained.'),{status:503}));});
  });
  const result=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));
  if(result.error)throw Object.assign(Error(result.error),{status:result.status||409});
  const data=await readFile(join(folder,'output.png'));
  if(result.width!==area.width||result.height!==area.height||data.length>25*1024*1024||createHash('sha256').update(data).digest('hex')!==result.sha256)throw Object.assign(Error('Rendered print file did not match its receipt. No supplier changes were made.'),{status:409});
  return {...result,data};
 }finally{await rm(folder,{recursive:true,force:true});}
}
