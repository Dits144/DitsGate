import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';
const sample='00020101021126610016ID.CO.SHOPEE.WWW01189360091800228031910208228031910303UMI51440014ID.CO.QRIS.WWW0215ID10264912544900303UMI5204581753033605802ID5909DitsStore6005BOGOR61051632062070703A0163046787';

test('local API: auth, ownership, default bank/QRIS, transaction, and invalid CRC',async()=>{
 const db=openDatabase(':memory:');const {server}=createApp({db});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 let token='',other='';const request=async(path,method='GET',payload,auth=token)=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{})},body:payload?JSON.stringify(payload):undefined});return [response.status,await response.json()]};
 try{
  assert.equal((await request('/api/health'))[1].mode,'production');
  assert.equal((await request('/api/v1/bank-accounts'))[0],401);
  assert.equal((await request('/api/auth/register','POST',{email:'a@test.example',password:'12-character-password',name:'Merchant A'}))[0],201);
  assert.equal((await request('/api/auth/register','POST',{email:'b@test.example',password:'12-character-password',name:'Merchant B'}))[0],201);
  token=(await request('/api/auth/login','POST',{email:'a@test.example',password:'12-character-password'}))[1].token;
  other=(await request('/api/auth/login','POST',{email:'b@test.example',password:'12-character-password'}))[1].token;
  assert.equal((await request('/api/v1/balance'))[1].balance,3000);
  const bank=(await request('/api/v1/bank-accounts','POST',{bank:'BCA',holder:'Demo',number:'123456789'}))[1].data;
  assert.equal(bank.numberMasked,'•••• 6789');assert.equal(bank.isDefault,true);
  assert.equal((await request('/api/v1/bank-accounts/'+bank.id,'PATCH',{holder:'Hacker'},other))[0],404);
  assert.equal((await request('/api/v1/bank-accounts','GET',undefined,other))[1].data.length,0);
  const invalid=await request('/api/v1/qris','POST',{payload:sample.slice(0,-1)+'0',mode:'dynamic',name:'X',city:'BOGOR'});assert.equal(invalid[0],400);
  const asset=(await request('/api/v1/qris','POST',{payload:sample,mode:'dynamic',name:'DitsStore',city:'BOGOR'}))[1].data;assert.equal(asset.isDefault,true);
  const transaction=await request('/api/v1/transactions','POST',{order_id:'order-1',amount:50000});assert.equal(transaction[0],201);assert.equal(transaction[1].data.qrisId,asset.id);assert.equal(transaction[1].data.status,'pending');assert.equal(transaction[1].data.uniqueCode,0);assert.equal(transaction[1].balance,2900);assert.equal(transaction[1].heldBalance,100);
  const cancelled=await request('/api/v1/transactions/'+transaction[1].data.id,'PATCH',{status:'cancelled'});assert.equal(cancelled[0],200);assert.equal(cancelled[1].data.status,'cancelled');assert.equal(cancelled[1].balance,3000);assert.equal(cancelled[1].heldBalance,0);
  assert.equal((await request('/api/v1/transactions/'+transaction[1].data.id,'PATCH',{status:'cancelled'}))[0],409);
  assert.equal((await request('/api/v1/transactions','POST',{order_id:'order-1',amount:50000}))[0],409);
  assert.equal((await request('/api/v1/transactions','POST',{order_id:'other-1',amount:50000,qris_id:asset.id},other))[0],400);
  assert.equal((await request('/api/v1/qris/'+asset.id,'DELETE'))[0],409);
  assert.equal((await request('/api/v1/transactions','GET',undefined,other))[1].data.length,0);
  assert.equal((await request('/api/v1/bank-accounts/'+bank.id,'DELETE'))[0],200);
  assert.equal((await request('/api/v1/bank-accounts'))[1].data.length,0);
  assert.equal((await request('/api/auth/logout','POST'))[0],200);
  assert.equal((await request('/api/v1/qris'))[0],401);
 }finally{await new Promise(resolve=>server.close(resolve));db.close()}
});
