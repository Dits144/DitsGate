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
  assert.equal(balanceOf(db,merchant.body.id),3000);
  const adminId=await bootstrapAdmin(db,{email:'admin@local.example',password:'admin-password-very-long'});
  await assert.rejects(bootstrapAdmin(db,{email:'merchant@local.example',password:'admin-password-very-long'}));
  const adminLogin=await request('/api/auth/login','POST',{email:'admin@local.example',password:'admin-password-very-long'});
  const token=adminLogin.body.token;
  const listed=await request('/api/admin/merchants','GET',null,token);
  assert.equal(listed.body.data.length,1);assert.equal(listed.body.data[0].balance,3000);
  assert.equal(JSON.stringify(listed.body).includes('password'),false);
  const intent=await request('/api/admin/topups','POST',{merchantId:merchant.body.id,amount:200},token);
  assert.equal(intent.status,201);assert.equal(intent.body.data.status,'pending');assert.equal(intent.body.instructions.qrisPayload,'configured-test-payload');
  assert.equal(balanceOf(db,merchant.body.id),3000);
  const id=intent.body.data.id;
  assert.equal((await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},merchantToken)).status,403);
  const confirm=await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token);
  assert.equal(confirm.status,200);assert.equal(confirm.body.verification,'admin_confirmed_only');assert.equal(confirm.body.balance,3200);
  assert.equal(confirm.body.data.confirmedBy,adminId);
  assert.equal((await request(`/api/admin/topups/${id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token)).status,409);
  const second=await request('/api/admin/topups','POST',{merchantId:merchant.body.id,amount:100},token);
  assert.equal((await request(`/api/admin/topups/${second.body.data.id}/confirm`,'POST',{proofReference:'BANK-123456',note:'Checked bank statement'},token)).status,409);
  assert.equal(balanceOf(db,merchant.body.id),3200);
  const detail=await request(`/api/admin/merchants/${merchant.body.id}`,'GET',null,token);
  assert.equal(detail.body.data.topups.length,2);assert.equal(detail.body.data.ledger.length,2);
  const orderId=randomUUID(),external='external-admin-test',provider='provider-admin-test';
  db.prepare('INSERT INTO provider_orders (id,user_id,external_order_id,provider_transaction_id,base_amount,unique_code,total_amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,merchant.body.id,external,provider,500,0,500,'pending',new Date().toISOString());
  const raw=JSON.stringify({event:'payment.paid',external_order_id:external,transaction_id:provider,base_amount:500,unique_code:0,total_amount:500});
  const deliver=async(id)=>{const timestamp=String(Math.floor(Date.now()/1000));const sig=createHmac('sha256',secret).update(timestamp).update('.').update(raw).digest('hex');const res=await fetch(base+'/api/webhooks/qrisgate',{method:'POST',headers:{'content-type':'application/json','x-qrisgate-timestamp':timestamp,'x-qrisgate-event':'payment.paid','x-qrisgate-delivery-id':id,'x-qrisgate-signature':sig},body:raw});return {status:res.status,body:await res.json()}};
  assert.equal((await deliver('one')).status,200);
  assert.equal((await deliver('one')).body.duplicate,true);
  assert.equal((await deliver('two')).status,409);
  assert.equal(balanceOf(db,merchant.body.id),3100);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind='paid_order_fee' AND source_id=?").get(orderId).n,1);
  const own=await request('/api/v1/ledger','GET',null,merchantToken);
  assert.deepEqual(own.body.data.map(x=>x.amount).sort((a,b)=>a-b),[-100,200,3000]);

  // Direct admin balance add & deduct, plus suspend/reactivate and hold/refund transaction flow
  const directAdd=await request(`/api/admin/merchants/${merchant.body.id}/balance`,'POST',{amount:5000,note:'Bonus topup manual'},token);
  assert.equal(directAdd.status,200);assert.equal(directAdd.body.balance,8100);
  assert.equal((await request(`/api/admin/merchants/${merchant.body.id}/balance`,'POST',{amount:-999999,note:'Overdraw'},token)).status,409);
  const qrisSample='00020101021126610016ID.CO.SHOPEE.WWW01189360091800228031910208228031910303UMI51440014ID.CO.QRIS.WWW0215ID10264912544900303UMI5204581753033605802ID5909DitsStore6005BOGOR61051632062070703A0163046787';
  await request('/api/v1/qris','POST',{payload:qrisSample,mode:'dynamic',name:'Main',city:'BOGOR'},merchantToken);
  const txPaid=await request('/api/v1/transactions','POST',{order_id:'adm-paid-1',amount:15000},merchantToken);
  assert.equal(txPaid.status,201);assert.equal(txPaid.body.balance,8000);assert.equal(txPaid.body.heldBalance,100);
  const settledPaid=await request(`/api/admin/transactions/${txPaid.body.data.id}`,'PATCH',{status:'paid'},token);
  assert.equal(settledPaid.status,200);assert.equal(settledPaid.body.balance,8000);assert.equal(settledPaid.body.heldBalance,0);
  const txFail=await request('/api/v1/transactions','POST',{order_id:'adm-fail-1',amount:15000},merchantToken);
  assert.equal(txFail.body.balance,7900);
  const settledFail=await request(`/api/admin/transactions/${txFail.body.data.id}`,'PATCH',{status:'failed'},token);
  assert.equal(settledFail.status,200);assert.equal(settledFail.body.balance,8000);assert.equal(settledFail.body.heldBalance,0);
  const ov=await request('/api/admin/overview','GET',null,token);
  assert.equal(ov.status,200);assert.equal(ov.body.data.totalUsers,1);assert.equal(ov.body.data.paidTransactions,1);
  const susp=await request(`/api/admin/merchants/${merchant.body.id}`,'PATCH',{isActive:false,addSubscriptionDays:30},token);
  assert.equal(susp.status,200);assert.equal(susp.body.data.isActive,false);
  assert.equal((await request('/api/v1/balance','GET',null,merchantToken)).status,401);
  assert.equal((await request('/api/auth/login','POST',{email:'merchant@local.example',password:'merchant-password-long'})).status,403);
  await request(`/api/admin/merchants/${merchant.body.id}`,'PATCH',{isActive:true},token);
  assert.equal((await request('/api/auth/login','POST',{email:'merchant@local.example',password:'merchant-password-long'})).status,200);
  const freshLogin=await request('/api/auth/login','POST',{email:'merchant@local.example',password:'merchant-password-long'});
  const mTok=freshLogin.body.token;
  assert.equal((await request('/api/v1/topups','POST',{amount:4999},mTok)).status,400);
  const mTopup=await request('/api/v1/topups','POST',{amount:5000},mTok);
  assert.equal(mTopup.status,201);assert.equal(mTopup.body.data.amount,5000);
  const mTopup2=await request('/api/v1/topups','POST',{amount:10000},mTok);
  assert.equal(mTopup2.status,201);
  const adminQueue=await request('/api/admin/topups?status=pending','GET',null,token);
  assert.equal(adminQueue.status,200);assert.ok(adminQueue.body.data.length>=2);
  const approved=await request(`/api/admin/topups/${mTopup.body.data.id}/confirm`,'POST',{proofReference:'QRIS-5000-OK',note:'Diterima via QRIS'},token);
  assert.equal(approved.status,200);assert.equal(approved.body.balance,13000);
  const rejected=await request(`/api/admin/topups/${mTopup2.body.data.id}/reject`,'POST',{note:'Transfer belum masuk'},token);
  assert.equal(rejected.status,200);assert.equal(rejected.body.data.status,'rejected');
  assert.equal(balanceOf(db,merchant.body.id),13000);
  const modeRes=await request('/api/admin/settings','PUT',{topupMode:'auto',adminWhatsapp:'6282120196167'},token);
  assert.equal(modeRes.status,200);assert.equal(modeRes.body.data.topupMode,'auto');
  assert.equal(modeRes.body.data.adminWhatsapp,'6282120196167');
  process.env.DITSGATE_ADMIN_EMAIL='other@local.example';
  assert.equal((await request('/api/admin/merchants','GET',null,token)).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();if(oldEmail===undefined)delete process.env.DITSGATE_ADMIN_EMAIL;else process.env.DITSGATE_ADMIN_EMAIL=oldEmail;if(oldQris===undefined)delete process.env.DITSGATE_ADMIN_TOPUP_QRIS;else process.env.DITSGATE_ADMIN_TOPUP_QRIS=oldQris}
});

test('admin ShopeePay listener auto-credits matching unique-code topup via get-transaction-list',async()=>{
 const oldEmail=process.env.DITSGATE_ADMIN_EMAIL;
 process.env.DITSGATE_ADMIN_EMAIL='auto-admin@local.example';
 let mockTxAmount=0;
 const mockFetch=async(url)=>{
  if(url.endsWith('get-store-list'))return {ok:true,url,redirected:false,text:async()=>JSON.stringify({code:0,data:{list:[{storeId:999,merchantId:888}],storeCount:1}})};
  if(url.endsWith('get-transaction-list'))return {ok:true,url,redirected:false,text:async()=>JSON.stringify({code:0,data:{list:mockTxAmount?[{transactionId:'sp-tx-1001',storeId:999,merchantId:888,amount:mockTxAmount,createTime:Math.floor(Date.now()/1000),status:3}]:[{transactionId:'sp-init',storeId:999,merchantId:888,amount:100,createTime:Math.floor((Date.now()-86400_000)/1000),status:3}],last_position:''}})};
  throw new Error('unexpected url '+url);
 };
 const db=openDatabase(':memory:');
 const {server}=createApp({db,shopeePortalKey:Buffer.alloc(32,9).toString('base64url'),shopeePortalFetch:mockFetch});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(p,m='GET',d,tok)=>{const r=await fetch(base+p,{method:m,headers:{...(tok?{authorization:`Bearer ${tok}`}:{}),...(d?{'content-type':'application/json'}:{})},body:d?JSON.stringify(d):undefined});return {status:r.status,body:await r.json()}};
 try{
  await bootstrapAdmin(db,{email:'auto-admin@local.example',password:'admin-password-very-long'});
  const adminTok=(await req('/api/auth/login','POST',{email:'auto-admin@local.example',password:'admin-password-very-long'})).body.token;
  await req('/api/auth/register','POST',{email:'buyer@local.example',password:'buyer-password-long',name:'Buyer'});
  const buyerLogin=await req('/api/auth/login','POST',{email:'buyer@local.example',password:'buyer-password-long'});
  const buyerTok=buyerLogin.body.token,buyerId=buyerLogin.body.user.id;
  await req('/api/admin/settings','PUT',{topupMode:'auto'},adminTok);
  const conn=await req('/api/admin/shopee-portal','POST',{token:'shopee-admin-portal-token-1234'},adminTok);
  assert.equal(conn.status,201);assert.equal(conn.body.data.status,'connected');
  const topup=await req('/api/v1/topups','POST',{amount:5000},buyerTok);
  assert.equal(topup.status,201);assert.equal(topup.body.mode,'auto');assert.equal(topup.body.listenerOnline,true);
  assert.ok(topup.body.data.uniqueCode>=1);
  assert.equal(topup.body.data.totalAmount,5000+topup.body.data.uniqueCode);
  mockTxAmount=topup.body.data.totalAmount;
  const synced=await req('/api/v1/topups/sync','POST',{},buyerTok);
  assert.equal(synced.status,200);assert.equal(synced.body.sync.matched,1);assert.equal(synced.body.balance,8000);
  const again=await req('/api/admin/shopee-portal/sync','POST',{},adminTok);
  assert.equal(again.status,200);assert.equal(again.body.data.matched,0);
  assert.equal(balanceOf(db,buyerId),8000);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();if(oldEmail===undefined)delete process.env.DITSGATE_ADMIN_EMAIL;else process.env.DITSGATE_ADMIN_EMAIL=oldEmail}
});

test('unfunded paid webhook leaves order pending and ledger untouched',async()=>{
 const db=openDatabase(':memory:');const {server}=createApp({db,webhookSecret:secret});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const user=randomUUID(),id=randomUUID();db.prepare('INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(user,'empty@local.example','unused','Empty',new Date().toISOString());db.prepare('INSERT INTO provider_orders (id,user_id,external_order_id,provider_transaction_id,base_amount,unique_code,total_amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,user,'unfunded','provider-unfunded',1000,0,1000,'pending',new Date().toISOString());const raw=JSON.stringify({event:'payment.paid',external_order_id:'unfunded',transaction_id:'provider-unfunded',base_amount:1000,unique_code:0,total_amount:1000});const timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',secret).update(timestamp).update('.').update(raw).digest('hex');const res=await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/qrisgate`,{method:'POST',headers:{'content-type':'application/json','x-qrisgate-event':'payment.paid','x-qrisgate-timestamp':timestamp,'x-qrisgate-signature':signature,'x-qrisgate-delivery-id':'unfunded-delivery'},body:raw});assert.equal(res.status,409);assert.equal(db.prepare('SELECT status FROM provider_orders WHERE id=?').get(id).status,'pending');assert.equal(db.prepare('SELECT count(*) AS n FROM webhook_deliveries').get().n,0);assert.equal(balanceOf(db,user),0)}finally{await new Promise(resolve=>server.close(resolve));db.close()}
});
