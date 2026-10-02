// Pure template renderer. No sending, order lookup or customer storage.
export function renderOrderMessage(template,values){
 if(!template||typeof template.subject!=='string'||typeof template.body!=='string')throw Error('Invalid order message template');
 const fill=text=>text.replace(/\{\{([A-Za-z]+)\}\}/g,(_,key)=>{if(!Object.hasOwn(values,key)||typeof values[key]!=='string'||!values[key].trim())throw Error('Missing message field: '+key);return values[key]});
 const subject=fill(template.subject);if(/[\r\n]/.test(subject))throw Error('Invalid message subject');
 return {subject,body:fill(template.body)};
}
