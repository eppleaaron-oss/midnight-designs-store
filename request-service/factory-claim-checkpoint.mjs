// A claim must finish quickly even when saving recovery takes minutes. No lease
// is issued until the checkpoint resolves. Repeated polls share that same save.
export function claimCheckpoint(save){
 let pending=null,ready=null,failure=null;
 return {
  check(key){
   if(ready===key)return true;
   if(pending)return false;
   if(failure){const error=failure;failure=null;throw error;}
   pending=Promise.resolve().then(save).then(()=>{ready=key;},error=>{failure=error;}).finally(()=>{pending=null;});
   return false;
  },
  consume(){ready=null;},
  settled:()=>pending||Promise.resolve()
 };
}
