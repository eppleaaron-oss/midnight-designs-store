'use strict';
(()=>{
const feedback=['Question / comment','Design idea','Product request','Clothing request','Site problem','Feature suggestion','Complaint','General comment'];
function matches(r,f={}){const status=r.status||'',type=r.type||'',bucket=f.bucket||'',date=(r.createdAt||r.created||'').slice(0,10),product=r.product||'';
const buckets={'New':status==='New','Custom Design':type==='Custom design request','Uploaded Design':type==='Customer-uploaded design','Create Your Own':type==='Create Your Own submission','Custom Clothing':type==='Custom clothing request','Revision':type==='Revision request'||status==='Revision Requested','Feedback':feedback.includes(type),'Problem':['Site problem','Complaint'].includes(type),'High Priority':r.priority==='High','Awaiting Customer':status==='Customer Review','Approved':status==='Approved','Completed':status==='Completed'};
return (!bucket||buckets[bucket]===true)&&(!f.type||type===f.type)&&(!f.status||status===f.status)&&(!f.customer||[r.name,r.email].join(' ').toLowerCase().includes(f.customer.toLowerCase()))&&(!f.product||product.toLowerCase().includes(f.product.toLowerCase()))&&(!f.from||date>=f.from)&&(!f.to||date<=f.to)&&(!f.q||[r.id,r.title,r.name,r.email,type,status,product,r.details].join(' ').toLowerCase().includes(f.q.toLowerCase()));}
globalThis.MidnightRequestFilters={matches};
})();
