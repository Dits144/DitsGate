import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

const secret='whsec_test_local_not_a_real_key';
const signed=(raw,timestamp)=>createHmac('sha256',secret).update(String(timestamp)).update('.').update(raw).digest('hex');
test('webhook rejects bad signatures and only settles an exact persisted provider order once',async()=>{
 const db=openDatabase(':memory:');const {server}=createApp({db,webhookSecret:secret});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/webhooks/qrisgate`;
 const owner=randomUUID(),order='external-100',provider='trx_test_100';
 db.prepare('INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(owner,'owner@test.example','not-used','Owner',new Date().toISOString());
 db.prepare('INSERT INTO provider_orders (id,user_id,external_order_id,provider_transaction_id,base_amount,unique_code,total_amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),owner,order,provider,50000,3,50003,'pending',new Date().toISOString());
 db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),owner,200,'admin_topup','fixture-credit',new Date().toISOString());
 const raw=Buffer.from(JSON.stringify({event:'payment.paid',transaction_id:provider,external_order_id:order,base_amount:50000,unique_code:3,total_amount:50003}));
 let timestamp=Math.floor(Date.now()/1000);
 const deliver=async({bytes=raw,sig=signed(bytes,timestamp),time=timestamp,id='delivery-1',event='payment.paid'}={})=>{const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-qrisgate-event':event,'x-qrisgate-timestamp':String(time),'x-qrisgate-signature':sig,'x-qrisgate-delivery-id':id},body:bytes});return [res.status,await res.json()]};
 const state=()=>db.prepare('SELECT status FROM provider_orders WHERE external_order_id=?').get(order).status;
 try{
  assert.equal((await deliver({sig:'0'.repeat(64)}))[0],401);assert.equal(state(),'pending');
  assert.equal((await deliver({time:timestamp-301,sig:signed(raw,timestamp-301)}))[0],401);
  assert.equal((await deliver({time:timestamp+360,sig:signed(raw,timestamp+360)}))[0],401);
  assert.equal((await deliver({id:''}))[0],400);
  assert.equal((await deliver({sig:'zz'.repeat(32)}))[0],401);
  assert.equal((await deliver({sig:'sha256='+signed(raw,timestamp),id:'prefixed-sig'}))[0],200);
  assert.equal(state(),'paid');
  db.prepare("UPDATE provider_orders SET status='pending',paid_at=NULL WHERE external_order_id=?").run(order);
  db.prepare("DELETE FROM ledger_entries WHERE kind='paid_order_fee' AND source_id=(SELECT id FROM provider_orders WHERE external_order_id=?)").run(order);
  db.prepare('DELETE FROM webhook_deliveries WHERE delivery_id=?').run('prefixed-sig');
  assert.equal((await deliver({bytes:Buffer.from(raw.toString()+' '),sig:signed(raw,timestamp)}))[0],401);
  assert.equal((await deliver({id:'wrong-event',event:'payment.expired'}))[0],400);
  const mismatch=Buffer.from(JSON.stringify({...JSON.parse(raw),unique_code:4,total_amount:50004}));assert.equal((await deliver({bytes:mismatch,sig:signed(mismatch,timestamp),id:'wrong-amount'}))[0],409);assert.equal(state(),'pending');
  const unknown=Buffer.from(JSON.stringify({...JSON.parse(raw),external_order_id:'not-registered'}));assert.equal((await deliver({bytes:unknown,sig:signed(unknown,timestamp),id:'unknown'}))[0],404);
  const wrongTx=Buffer.from(JSON.stringify({...JSON.parse(raw),transaction_id:'trx_other'}));assert.equal((await deliver({bytes:wrongTx,sig:signed(wrongTx,timestamp),id:'wrong-transaction'}))[0],409);
  assert.equal((await deliver())[0],200);assert.equal(state(),'paid');
  assert.equal((await deliver())[1].duplicate,true);
  assert.equal((await deliver({bytes:unknown,sig:signed(unknown,timestamp)}))[0],409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM webhook_deliveries').get().n,1);
  assert.equal((await deliver({id:'different-delivery'}))[0],409);
 }finally{await new Promise(resolve=>server.close(resolve));db.close()}
});

test('webhook is unavailable without server secret',async()=>{
 const db=openDatabase(':memory:');const {server}=createApp({db,webhookSecret:''});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/qrisgate`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(res.status,503)}
 finally{await new Promise(resolve=>server.close(resolve));db.close()}
});
