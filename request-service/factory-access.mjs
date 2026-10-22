export const FACTORY_PAGES=new Set(['/ai-made','/product-editor','/ai-factory','/ai-factory/basic','/ai-factory/tools','/ai-factory.html','/ai-artwork','/ai-intelligence','/ai-history','/ai-employees']);
const destinations={'ai-made':'/ai-made','product-editor':'/product-editor','ai-factory-basic':'/ai-factory/basic','ai-factory':'/ai-factory','ai-artwork':'/ai-artwork','ai-intelligence':'/ai-intelligence','ai-history':'/ai-history','ai-employees':'/ai-employees'};
export function factoryLoginIsRequired(value){if(value===undefined||value==='true')return true;if(value==='false')return false;throw Error('FACTORY_LOGIN_REQUIRED must be true or false.');}
export function factoryAuthFor({loginRequired,auth,origin}){
 if(typeof loginRequired!=='boolean')throw Error('Factory login setting must be a boolean.');
 return (req,id,owner)=>{
  const path=new URL(req.url,origin).pathname;
  if(!loginRequired&&(path==='/api/owner/ai-factory'||path.startsWith('/api/owner/ai-factory/')))return {role:'owner',request:null,factoryPublic:true};
  return auth(req,id,owner);
 };
}
export function factoryLoginDestination(url){return destinations[url.searchParams.get('next')]||null;}
export function renderOpenFactory(html){return html.replace('<body','<body data-factory-public="true"').replace('</body>','<script src="/factory-access.js" defer></script></body>');}
