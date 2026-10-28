import {request} from 'node:http';
// The inline worker talks only to this service's loopback address. Node fetch's
// response-header timer can expire while a long native render is still renewing
// its lease. Give this one local operation its explicit bounded lifetime.
export function callInlineWorker(url,{token,payload,timeoutMs=70000}){
 if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.startsWith('/internal/factory/')||url.username||url.password)throw Error('Inline worker transport requires its local factory endpoint.');
 return new Promise((resolve,reject)=>{
  let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=request(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
   const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){const error=Error('Worker response exceeds its limit');res.destroy(error);finish(error);return;}chunks.push(chunk);});res.on('error',error=>finish(error));res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return finish(Object.assign(Error('Worker backend rejected request'),{status:res.statusCode}));try{finish(null,JSON.parse(Buffer.concat(chunks)));}catch(error){finish(error);}});
  });
  const timer=setTimeout(()=>{const error=Object.assign(Error('Worker operation timed out'),{name:'TimeoutError'});req.destroy(error);finish(error);},timeoutMs);timer.unref();req.on('error',error=>finish(error));req.end(JSON.stringify(payload));
 });
}
