import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The Basic worker shares the existing service. It does not keep a free host
// awake; verified GitHub checkpoints resume the same item after a cold start.
export function startBasicWorker({server,token,enabled=true,spawnImpl=spawn}){
 let child=null,timer=null,closed=false,attempt=0;
 function launch(){
  if(closed||!enabled)return;const address=server.address();if(!address||typeof address==='string'||!token||token.length<32)throw Error('Basic worker requires a listening backend and an internal credential.');
  child=spawnImpl(process.execPath,[fileURLToPath(new URL('./factory-worker.mjs',import.meta.url))],{stdio:['ignore','inherit','inherit'],env:{PATH:process.env.PATH||'',NODE_ENV:'production',FACTORY_BACKEND_URL:'http://127.0.0.1:'+address.port,FACTORY_WORKER_TOKEN:token,FACTORY_BASIC_ONLY:'1',DEV_HTTP:'1'}});
  child.once('error',()=>{});child.once('exit',()=>{child=null;if(!closed){timer=setTimeout(launch,Math.min(60000,1000*2**Math.min(attempt++,6)));timer.unref();}});
 }
 if(enabled)launch();
 return {async close(){closed=true;clearTimeout(timer);const current=child;if(!current)return;await new Promise(resolve=>{const timeout=setTimeout(()=>{current.kill('SIGKILL');resolve();},22000);current.once('exit',()=>{clearTimeout(timeout);resolve();});current.kill('SIGTERM');});}};
}
