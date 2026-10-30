import {createHash} from 'node:crypto';
export const journalConnection={repo:'owner/private-orders',token:'fixture-private-token',key:Buffer.alloc(32,7)};
export function journalGithub(){const sha=b=>createHash('sha1').update(b).digest('hex'),blobs=new Map(),trees=new Map(),commits=new Map(),refs=new Map(),calls=[],root=sha('root'),tree=sha('tree');trees.set(tree,[]);commits.set(root,{tree:{sha:tree},parents:[]});refs.set('main',root);const state={private:true,rateLimit:false,loseAcknowledgements:false};
 const reply=(d,status=200,headers={})=>Response.json(d,{status,headers});
 async function fetch(url,o={}){const u=new URL(url),path=u.pathname.slice('/repos/owner/private-orders'.length),method=o.method||'GET',b=o.body?JSON.parse(o.body):null;calls.push({path,method,body:b});if(!path)return reply({id:77,private:state.private,visibility:state.private?'private':'public',default_branch:'main',size:1});if(method!=='GET'&&state.rateLimit){state.rateLimit=false;return reply({},429,{'Retry-After':'120'});}
 if(path.startsWith('/git/ref/heads/')){const name=decodeURIComponent(path.slice('/git/ref/heads/'.length)),head=refs.get(name);return head?reply({object:{sha:head}}):reply({},404);}
 if(path==='/git/blobs'&&method==='POST'){const bytes=Buffer.from(b.content,'base64'),id=sha(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]));blobs.set(id,bytes);return reply({sha:id});}
 if(path.startsWith('/git/blobs/')){const id=path.split('/').at(-1),bytes=blobs.get(id);return bytes?reply({sha:id,encoding:'base64',content:bytes.toString('base64'),size:bytes.length}):reply({},404);}
 if(path==='/git/trees'&&method==='POST'){const id=sha(JSON.stringify(b.tree));trees.set(id,b.tree);return reply({sha:id});}
 if(path.startsWith('/git/trees/'))return reply({tree:trees.get(path.split('/').at(-1))});
 if(path==='/git/commits'&&method==='POST'){const id=sha(JSON.stringify(b));commits.set(id,{tree:{sha:b.tree},parents:b.parents});return reply({sha:id});}
 if(path.startsWith('/git/commits/'))return reply(commits.get(path.split('/').at(-1)));
 if(path==='/git/refs'&&method==='POST'){const name=b.ref.slice('refs/heads/'.length);if(refs.has(name))return reply({},422);refs.set(name,b.sha);return reply({object:{sha:b.sha}});}
 if(path.startsWith('/git/refs/heads/')&&method==='PATCH'){const name=decodeURIComponent(path.slice('/git/refs/heads/'.length)),head=refs.get(name);if(b.force||b.sha!==head&&!commits.get(b.sha)?.parents.includes(head))return reply({},422);refs.set(name,b.sha);if(state.loseAcknowledgements)throw Error('Lost acknowledgement');return reply({object:{sha:b.sha}});}
 throw Error('Unexpected journal fixture request '+method+' '+path);
 }
 return {fetch,state,calls,blobs,refs,commits,trees};}
