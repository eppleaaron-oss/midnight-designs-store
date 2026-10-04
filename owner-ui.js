'use strict';
(()=>{
 const nav=document.querySelector('.master-tabs');if(!nav)return;
 const button=document.createElement('button');button.type='button';button.className='btn outline owner-menu-toggle';button.textContent='Owner menu';button.setAttribute('aria-controls','ownerMenu');button.setAttribute('aria-expanded','false');
 nav.id='ownerMenu';nav.before(button);document.body.classList.add('owner-dashboard');
 const set=open=>{document.body.classList.toggle('owner-menu-open',open);button.setAttribute('aria-expanded',String(open));};
 button.onclick=()=>set(!document.body.classList.contains('owner-menu-open'));
 nav.addEventListener('click',e=>{if(e.target.closest('a'))set(false);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('owner-menu-open')){set(false);button.focus();}});
 nav.querySelectorAll('a').forEach(a=>{a.addEventListener('click',()=>{nav.querySelectorAll('a').forEach(x=>x.removeAttribute('aria-current'));a.setAttribute('aria-current','location');});});
})();
