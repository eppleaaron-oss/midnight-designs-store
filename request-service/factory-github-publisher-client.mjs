import {PUBLISHER_AUDIENCE} from './factory-github-publisher.mjs';
import {publisherSession} from './factory-publisher-session.mjs';

const backend='https://midnight-designs-backend.onrender.com/internal/basic-github-publisher',githubToken=process.env.GITHUB_TOKEN;
if(!githubToken||!process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('Run this publisher only in the authorized GitHub workflow.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let stopping=false;process.on('SIGTERM',()=>{stopping=true;});
async function oidc(){const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unrecognized GitHub identity endpoint.');url.searchParams.set('audience',PUBLISHER_AUDIENCE);const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('GitHub identity request failed.');const d=await r.json();if(typeof d.value!=='string')throw Error('GitHub did not return a workflow identity.');return d.value;}
async function call(action){const r=await fetch(backend,{method:'POST',headers:{Authorization:'Bearer '+await oidc(),'X-Midnight-Github-Token':githubToken,'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Object.assign(Error('Publishing connection is not available yet.'),{status:r.status});return r.json();}
await publisherSession({call,sleep,minutes:Number(process.env.BASIC_PUBLISHER_MINUTES||12),shouldStop:()=>stopping,log:console.log});
