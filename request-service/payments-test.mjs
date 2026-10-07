import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,scryptSync} from 'node:crypto';
import {createService} from './server.mjs';
import {verifySignature} from './payments.mjs';
test('Payment integrity: server prices, shipping, capabilities, signed verification and owner isolation',async()=>{
 const origin='http://localhost:3000',secret='whsec_test',salt='ab'.repeat(16),passwordHash=salt+':'+scryptSync('owner-test',salt,64).toString('hex');
 const product={id:'shirt',name:'Moon',variants:[{id:123,price:25,currency:'USD',catalogVariantId:401,size:'M',color:'Black',availability:'active'}]};let session,requests=[],shippingFailure=false;
 const remote=async(url,options={})=>{requests.push({url,options});if(url.includes('printful'))return Response.json({result:[{id:'STANDARD',name:'Standard',rate:'4.99',currency:'USD'}]},{status:shippingFailure?500:200});if(url.endsWith('/customers'))return Response.json({id:'cus_test'});if(url.endsWith('/checkout/sessions?limit=100'))return Response.json({data:[session]});if(url.includes('/line_items'))return Response.json({data:[{description:'Moon / M / Black',quantity:2,price:{unit_amount:2500}}],has_more:false});if(options.method==='POST'&&!session){session={id:'cs_test',url:'https://checkout.stripe.com/c/pay/test',metadata:Object.fromEntries([...new URLSearchParams(options.body)].filter(([k])=>k.startsWith('metadata[')).map(([k,v])=>[k.slice(9,-1),v])),created:Math.floor(Date.now()/1000),customer:{email:'customer@example.test',shipping:{name:'Customer',address:{line1:'1 Main St',city:'Boston',state:'MA',postal_code:'02101',country:'US'}}},livemode:false,payment_status:'unpaid',status:'open',currency:'usd',amount_subtotal:5000,amount_total:5499,total_details:{amount_shipping:499,amount_tax:0,amount_discount:0}};}return Response.json(session);};
 const serviceOptions={dbPath:':memory:',origin,passwordHash,secure:false,paymentSettings:{enabled:true,key:'sk_test_fake',webhook:secret,printful:'test',countries:['US'],live:false,quoteSecret:'test-quote-signing-secret-32-bytes-long'},paymentFetch:remote,paymentCatalogLoader:async()=>({products:[product]})};let service=createService(serviceOptions);await new Promise(r=>service.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+service.server.address().port;
 const call=async(path,data,headers={})=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 const reboot=async()=>{await new Promise(r=>service.server.close(r));service=createService(serviceOptions);await new Promise(r=>service.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+service.server.address().port;};
 const bag={recipient:{name:'Customer',email:'customer@example.test',address1:'1 Main St',city:'Boston',state_code:'MA',zip:'02101',country_code:'US'},items:[{productId:'shirt',variantId:'123',qty:2,price:0.01}]};
 const webhook=async(id,signature=true)=>{const raw=JSON.stringify({id,type:'checkout.session.completed',data:{object:{id:session.id,metadata:session.metadata}}}),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',secret).update(t+'.'+raw).digest('hex');const r=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${signature?sig:'0'.repeat(64)}`},body:raw});return r.status;};
 try{
 assert.equal((await call('/api/checkout/config')).data.enabled,true);
 assert.equal((await call('/api/checkout/quote',{...bag,items:[{...bag.items[0],qty:-1}]})).status,400);
 assert.equal((await call('/api/checkout/quote',{...bag,recipient:{...bag.recipient,country_code:'ZZ'}})).status,400);
 shippingFailure=true;assert.equal((await call('/api/checkout/quote',bag)).status,502);shippingFailure=false;
 const quote=(await call('/api/checkout/quote',bag)).data;assert.equal(quote.subtotal,5000);assert.equal(quote.shipping[0].amount,499);
 await reboot();
 const checkout={quoteId:quote.quoteId,receiptToken:quote.receiptToken,shippingId:'STANDARD'};
 assert.equal((await call('/api/checkout/session',{...checkout,receiptToken:'bad'})).status,404);assert.equal((await call('/api/checkout/session',{...checkout,quoteId:checkout.quoteId.slice(0,-8)+'AAAAAAAA'})).status,404);
 assert.equal((await call('/api/checkout/session',{...checkout,shippingId:'FREE'})).status,400);
 product.variants[0].price=26;assert.equal((await call('/api/checkout/session',checkout)).status,409);product.variants[0].price=25;
 assert.equal((await call('/api/checkout/session',checkout)).status,200);assert.equal((await call('/api/checkout/session',checkout)).status,200);
 const creates=requests.filter(x=>x.url.endsWith('/checkout/sessions')&&x.options.method==='POST');assert.equal(String(creates[0].options.body),String(creates[1].options.body));assert.equal(new URLSearchParams(creates[0].options.body).get('line_items[0][price_data][unit_amount]'),'2500');
 const receipt={orderId:session.id,receiptToken:quote.receiptToken};assert.equal((await call('/api/checkout/status',{...receipt,receiptToken:'0'.repeat(48)})).status,404);
 assert.equal(await webhook('evt_forged',false),400);assert.equal(await webhook('evt_unpaid'),200);assert.equal((await call('/api/checkout/status',receipt)).data.status,'pending');
 session.payment_status='paid';session.amount_total=1;assert.equal(await webhook('evt_wrong_amount'),400);session.amount_total=5499;session.livemode=true;assert.equal(await webhook('evt_wrong_mode'),400);session.livemode=false;
 assert.equal(await webhook('evt_paid'),200);assert.equal(await webhook('evt_paid'),200);const paid=(await call('/api/checkout/status',receipt)).data;assert.equal(paid.status,'paid');assert.equal(paid.total,5499);assert.equal('delivery' in paid,false);assert.equal(JSON.stringify(paid).includes(bag.recipient.email),false);
 await reboot();assert.equal((await call('/api/checkout/status',receipt)).data.status,'paid');session.payment_intent={latest_charge:{amount_refunded:5499,refunded:true}};assert.equal((await call('/api/checkout/status',receipt)).data.status,'refunded');session.payment_intent=null;
 assert.equal((await call('/api/owner/payment-orders')).status,401);assert.equal((await call('/api/checkout/session',checkout)).status,409);
 const login=await call('/api/owner/catalog-login',{email:'midnightdesign107@gmail.com',password:'owner-test'});assert.equal(login.status,200);const orders=await call('/api/owner/payment-orders',undefined,{Authorization:'Bearer '+login.data.token});assert.equal(orders.status,200);assert.equal(orders.data[0].delivery.email,bag.recipient.email);
 }finally{await new Promise(r=>service.server.close(r));}
});
test('Stripe signatures reject stale, modified and missing payload authentication',()=>{const raw=Buffer.from('{}'),t=Math.floor(Date.now()/1000)-600,sig=createHmac('sha256','test').update(t+'.').update(raw).digest('hex');assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test'),false);assert.equal(verifySignature(raw,undefined,'test'),false);});
