'use strict';
(()=>{
 const status=document.getElementById('backupStatus'),details=document.getElementById('backupDetails'),button=document.getElementById('backupNow');
 if(!status||!details||!button)return;
 let state=null,busy=false;
 function render(data){state=data;button.disabled=!data.configured||data.running||data.conflict||!!data.retryAt&&Date.parse(data.retryAt)>Date.now();button.textContent=data.initialized?'Save backup now':'Save first backup';
  status.textContent=data.running?'Uploading encrypted backup. Waiting for GitHub confirmation…':data.error?data.error:!data.configured?'Private GitHub backup connection has not been configured.':data.lastSaved?'Last saved to GitHub: '+new Date(data.lastSaved).toLocaleString()+(data.unsavedChanges?' · New changes are waiting for backup.':' · No unsaved database changes detected.'):'No completed Factory backup exists yet.';
  details.textContent=[data.repository?'Private repository: '+data.repository:'',data.commit?'Commit: '+data.commit.slice(0,12):'',data.bytes?(data.bytes/1048576).toFixed(1)+' MB database snapshot':'',data.configured?'Automatic backup check every '+Math.round(data.intervalSeconds/60)+' minutes':''].filter(Boolean).join(' · ');
 }
 async function request(path,body){const r=await fetch('/api/owner/ai-factory/storage'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(r.status===401&&document.body.dataset.factoryPublic!=='true'){location.replace('/login?next=ai-factory');throw Error('Sign in to view private backup storage.');}const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to check GitHub backup storage.');return data;}
 async function load(){if(busy)return;busy=true;try{render(await request(''));}catch(e){status.textContent=e.message;button.disabled=true;}finally{busy=false;}}
 button.onclick=async()=>{if(busy||!state)return;if(!state.initialized&&!confirm('Save the entire current database as the first encrypted backup in '+state.repository+'? This does not recover records already lost from Render.'))return;busy=true;button.disabled=true;try{render(await request('/backup',{initialize:!state.initialized}));}catch(e){status.textContent=e.message;}finally{busy=false;}};
 load();const timer=setInterval(()=>{if(!document.hidden)load();},15000);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
