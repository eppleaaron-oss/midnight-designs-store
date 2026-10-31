import {ownerLoginDestination,ownerSignInLocation} from './public/login-destination.js';
export const FACTORY_PAGES=new Set(['/product-studio','/ai-made','/product-editor','/ai-factory','/ai-factory/basic','/ai-factory/tools','/ai-factory.html','/ai-artwork','/ai-intelligence','/ai-history','/ai-employees']);
export function factoryLoginIsRequired(value){if(value===undefined||value==='true'||value==='false')return true;throw Error('FACTORY_LOGIN_REQUIRED must be true or false.');}
export function factoryAuthFor({loginRequired,auth,origin}){
 if(typeof loginRequired!=='boolean')throw Error('Factory login setting must be a boolean.');
 return (req,id,owner)=>{
  const path=new URL(req.url,origin).pathname;
  if(!loginRequired&&(path==='/api/owner/ai-factory'||path.startsWith('/api/owner/ai-factory/')))return {role:'owner',request:null,factoryPublic:true};
  return auth(req,id,owner);
 };
}
export function factoryLoginDestination(url){return ownerLoginDestination(url.search);}
export function renderOpenFactory(html){return html.replace('<body','<body data-factory-public="true"').replace('</body>','<script src="/factory-access.js" defer></script></body>');}

export const factorySignInLocation=ownerSignInLocation;
