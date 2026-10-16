'use strict';
if(document.body.dataset.factoryPublic==='true'){
 for(const button of document.querySelectorAll('#logout,#factoryLogout'))button.remove();
 for(const element of document.querySelectorAll('.eyebrow'))if(element.textContent.startsWith('Private '))element.textContent=element.textContent.slice(8);
}
