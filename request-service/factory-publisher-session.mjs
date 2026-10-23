// Keep the existing workflow connection warm for its bounded session. An empty
// queue is temporary: the owner can submit another product seconds later.
export async function publisherSession({call,sleep,clock=Date.now,minutes,shouldStop=()=>false,log=()=>{}}){
 if(!Number.isInteger(minutes)||minutes<1||minutes>345)throw Error('Publishing session must be between 1 and 345 minutes.');
 const deadline=clock()+minutes*60000;let connected=false,lastPending;
 try{while(!shouldStop()&&clock()<deadline){try{const d=await call('connect');connected=true;const pending=!!d.pending;if(pending!==lastPending){log(pending?'Publishing connection active; processing approved updates.':'Publishing connection ready; waiting for the next approved update.');lastPending=pending;}}catch(e){log('Publishing connection will retry '+JSON.stringify({status:e.status||'network'}));}await sleep(Math.min(15000,Math.max(0,deadline-clock())));}}
 finally{if(connected)try{await call('disconnect');}catch{}}
}
