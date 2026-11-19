import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import {createApp,bootstrapAdmin} from '../server/app.mjs';
import {openDatabase,balanceOf} from '../server/db.mjs';

const secret='local-test-secret';
test('offline admin bootstrap, pending topup, audited exact-once credit and funded paid fee', async()=>{
 const oldEmail=process.env.DITSGATE_ADMIN_EMAIL,oldQris=process.env.DITSGATE_ADMIN_TOPUP_QRIS;
 process.env.DITSGATE_ADMIN_EMAIL='admin@local.example';
 process.env.DITSGATE_ADMIN_TOPUP_QRIS='configured-test-payload';
 const db=openDatabase(':memory:');const {server}=createApp({db,webhookSecret:secret});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',data,token)=>{const res=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,body:await res.json()}};
 try{
  assert.equal((await request('/api/auth/register','POST',{email:'admin@local.example',name:'Impostor',password:'long-password-of-impostor'})).status,403);
  const merchant=await request('/api/auth/register','POST',{email:'merchant@local.example',name:'Merchant',password:'merchant-password-long',role:'admin'});
  assert.equal(merchant.status,201);
  const login=await request('/api/auth/login','POST',{email:'merchant@local.example',password:'merchant-password-long'});
  const merchantToken=login.body.token;
  assert.equal((await request('/api/admin/merchants','GET',null,merchantToken)).status,403);
  assert.equal((await request('/api/admin/merchants')).status,401);
  assert.equal(balanceOf(db,merchant.body.id),0);
  const adminId=await bootstrapAdmin(db,{email:'admin@local.example',password:'admin-password-very-long'});
  await assert.rejects(bootstrapAdmin(db,{email:'merchant@local.example',password:'admin-password-very-long'}));
  const adminLogin=await request('/api/auth/login','POST',{email:'admin@local.example',password:'admin-password-very-long'});
  const token=adminLogin.body.token;
  const listed=await request('/api/admin/merchants','GET',null,token);
  assert.equal(listed.body.data.length,1);assert.equal(listed.body.data[0].balance,0);
  assert.equal(JSON.stringify(listed.body).includes('password'),false);
  const intent=await request('/api/admin/topups','POST',{merchantId:merchant.body.id,amount:200},token);
  assert.equal(intent.status,201);assert.equal(intent.body.data.status,'pending');assert.equal(intent.body.instructions.qrisPayload,'configured-test-payload');
  assert.equal(balanceOf(db,merchant.body.id),0);
  const id=intent.body.data.id;
  assert.equal((await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},merchantToken)).status,403);
  const confirm=await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token);
  assert.equal(confirm.status,200);assert.equal(confirm.body.verification,'admin_confirmed_only');assert.equal(confirm.body.balance,200);
  assert.equal(confirm.body.data.confirmedBy,adminId);
  assert.equal((await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token)).status,409);
  const second=await request('/api/admin/topups','POST',{merchantId:merchant.body.id,amount:100},token);
  assert.equal((await request(`/api/admin/topups/${second.body.data.id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token)).status,409);
  assert.equal(balanceOf(db,merchant.body.id),200);
  const detail=await request(`/api/admin/merchants/${merchant.body.id}`,'GET',null,token);
  assert.equal(detail.body.data.topups.length,2);assert.equal(detail.body.data.ledger.length,1);
  const orderId=randomUUID(),external='external-admin-test',provider='provider-admin-test';
  db.prepare('INSERT INTO provider_orders (id,user_id,external_order_id,provider_transaction_id,base_amount,unique_code,total_amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,merchant.body.id,external,provider,500,0,500,'pending',new Date().toISOString());
  const raw=JSON.stringify({event:'payment.paid',external_order_id:external,transaction_id:provider,base_amount:500,unique_code:0,total_amount:500});
  const deliver=async(id)=>{const timestamp=String(Math.floor(Date.now()/1000));const sig=createHmac('sha256',secret).update(timestamp).update('.').update(raw).digest('hex');const res=await fetch(base+'/api/webhooks/qrisgate',{method:'POST',headers:{'content-type':'application/json','x-qrisgate-timestamp':timestamp,'x-qrisgate-event':'payment.paid','x-qrisgate-delivery-id':id,'x-qrisgate-signature':sig},body:raw});return {status:res.status,body:await res.json()}};
  assert.equal((await deliver('one')).status,200);
  assert.equal((await deliver('one')).body.duplicate,true);
  assert.equal((await deliver('two')).status,409);
  assert.equal(balanceOf(db,merchant.body.id),100);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind='paid_order_fee' AND source_id=?").get(orderId).n,1);
  const own=await request('/api/v1/ledger','GET',null,merchantToken);
  assert.deepEqual(own.body.data.map(x=>x.amount).sort((a,b)=>a-b),[-100,200]);
  process.env.DITSGATE_ADMIN_EMAIL='other@local.example';
  assert.equal((await request('/api/admin/merchants','GET',null,token)).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();if(oldEmail===undefined)delete process.env.DITSGATE_ADMIN_EMAIL;else process.env.DITSGATE_ADMIN_EMAIL=oldEmail;if(oldQris===undefined)delete process.env.DITSGATE_ADMIN_TOPUP_QRIS;else process.env.DITSGATE_ADMIN_TOPUP_QRIS=oldQris}
});

test('unfunded paid webhook leaves order pending and ledger untouched',async()=>{
 const db=openDatabase(':memory:');const {server}=createApp({db,webhookSecret:secret});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const user=randomUUID(),id=randomUUID();db.prepare('INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(user,'empty@local.example','unused','Empty',new Date().toISOString());db.prepare('INSERT INTO provider_orders (id,user_id,external_order_id,provider_transaction_id,base_amount,unique_code,total_amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,user,'unfunded','provider-unfunded',1000,0,1000,'pending',new Date().toISOString());const raw=JSON.stringify({event:'payment.paid',external_order_id:'unfunded',transaction_id:'provider-unfunded',base_amount:1000,unique_code:0,total_amount:1000});const timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',secret).update(timestamp).update('.').update(raw).digest('hex');const res=await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/qrisgate`,{method:'POST',headers:{'content-type':'application/json','x-qrisgate-event':'payment.paid','x-qrisgate-timestamp':timestamp,'x-qrisgate-signature':signature,'x-qrisgate-delivery-id':'unfunded-delivery'},body:raw});assert.equal(res.status,409);assert.equal(db.prepare('SELECT status FROM provider_orders WHERE id=?').get(id).status,'pending');assert.equal(db.prepare('SELECT count(*) AS n FROM webhook_deliveries').get().n,0);assert.equal(balanceOf(db,user),0)}finally{await new Promise(resolve=>server.close(resolve));db.close()}
});
