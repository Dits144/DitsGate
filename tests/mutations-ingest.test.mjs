import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

async function setup(){
 const db=openDatabase(':memory:');const {server}=createApp({db});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,method='GET',payload,headers={}){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},body:payload===undefined?undefined:JSON.stringify(payload)});
  return [response.status,await response.json()];
 }
 async function register(email){
  assert.equal((await request('/api/auth/register','POST',{email,name:'Merchant',password:'test-password-123456'}))[0],201);
  return (await request('/api/auth/login','POST',{email,password:'test-password-123456'}))[1].token;
 }
 return {db,request,register,close:async()=>{await new Promise(resolve=>server.close(resolve));db.close()}};
}
const notification={source_app:'com.gojek.gopaymerchant',title:'Pembayaran diterima',text:'Kamu menerima pembayaran QRIS sebesar Rp 125.008 dari pelanggan.'};
test('public Android ingest contract: token-scoped signal, no settlement',async()=>{
 const x=await setup();try{
  const a=await x.register('mutation-a@example.test');const b=await x.register('mutation-b@example.test');
  const [created,device]=await x.request('/api/v1/shopee-listener','POST',{}, {authorization:`Bearer ${a}`});
  assert.equal(created,201);assert.match(device.token,/^dt_[A-Za-z0-9_-]{32,}$/);
  assert.equal((await x.request('/api/v1/mutations/ingest','POST',notification))[0],401);
  assert.equal((await x.request('/api/v1/mutations/ingest','POST',notification,{'x-device-token':a}))[0],401);
  const [status,result]=await x.request('/api/v1/mutations/ingest','POST',notification,{'x-device-token':device.token,'x-event-id':'push-001'});
  assert.equal(status,202);assert.equal(result.data.sourceApp,notification.source_app);
  assert.equal(result.data.verification,'unverified_listener_signal');assert.equal(result.data.providerConnected,false);
  assert.equal((await x.request('/api/v1/mutations/ingest','POST',notification,{'x-device-token':device.token,'x-event-id':'push-001'}))[1].duplicate,true);
  assert.equal((await x.request('/api/v1/mutations/ingest','POST',{...notification,text:'Other amount'},{'x-device-token':device.token,'x-event-id':'push-001'}))[0],409);
  assert.equal((await x.request('/api/v1/shopee-listener/events','GET',undefined,{authorization:`Bearer ${a}`}))[1].data.length,1);
  assert.equal((await x.request('/api/v1/shopee-listener/events','GET',undefined,{authorization:`Bearer ${b}`}))[1].data.length,0);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS count FROM provider_orders WHERE status=?').get('paid').count,0);
  assert.equal((await x.request('/api/v1/shopee-listener','DELETE',undefined,{authorization:`Bearer ${a}`}))[0],200);
  assert.equal((await x.request('/api/v1/mutations/ingest','POST',notification,{'x-device-token':device.token}))[0],401);
 }finally{await x.close()}
});
test('reject malformed and oversized notification fields',async()=>{
 const x=await setup();try{
  const a=await x.register('mutation-c@example.test');const token=(await x.request('/api/v1/shopee-listener','POST',{}, {authorization:`Bearer ${a}`}))[1].token;
  for(const invalid of [{...notification,title:''},{...notification,text:'x'.repeat(4097)},{...notification,source_app:'fake app'},{...notification,amount:123}]){
   assert.equal((await x.request('/api/v1/mutations/ingest','POST',invalid,{'x-device-token':token}))[0],400);
  }
 }finally{await x.close()}
});
