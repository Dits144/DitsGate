import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, bootstrapAdmin } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';

const QR = '00020101021126610016ID.CO.SHOPEE.WWW01189360091800228031910208228031910303UMI51440014ID.CO.QRIS.WWW0215ID10264912544900303UMI5204581753033605802ID5909DitsStore6005BOGOR61051632062070703A0163046787';

test('merchant keys and webhook settings are isolated, one-time secrets; keys only access transactions', async () => {
 const db = openDatabase(':memory:'); const {server} = createApp({db});
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(path,method='GET',payload,token)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});return [r.status,await r.json()]};
 try {
  const a=(await req('/api/auth/register','POST',{email:'keya@example.test',password:'12-character-password',name:'Key A'}))[1].id;
  await req('/api/auth/register','POST',{email:'keyb@example.test',password:'12-character-password',name:'Key B'});
  const token=(await req('/api/auth/login','POST',{email:'keya@example.test',password:'12-character-password'}))[1].token;
  const other=(await req('/api/auth/login','POST',{email:'keyb@example.test',password:'12-character-password'}))[1].token;
  assert.equal((await req('/api/v1/api-keys','POST',{name:'x'},undefined))[0],401);
  const asset=(await req('/api/v1/qris','POST',{payload:QR,mode:'dynamic',name:'A',city:'BOGOR'},token))[1].data.id;
  assert.equal((await req('/api/v1/api-keys','POST',{name:'bad',webhookUrl:'https://127.0.0.1/a'},token))[0],400);
  assert.equal((await req('/api/v1/api-keys','POST',{name:'bad',webhookUrl:'https://localhost/a'},token))[0],400);
  assert.equal((await req('/api/v1/api-keys','POST',{name:'bad',webhookUrl:'http://example.com/a'},token))[0],400);
  assert.equal((await req('/api/v1/api-keys','POST',{name:'bad',qrisId:crypto.randomUUID()},token))[0],400);
  const [createdStatus,created]=await req('/api/v1/api-keys','POST',{name:'POS',webhookUrl:'https://merchant.example.com/hook',qrisId:asset},token);
  assert.equal(createdStatus,201); assert.match(created.key,/^dg_test_[A-Za-z0-9_-]+$/); assert.equal(created.data.ownerId,undefined);
  assert.equal(created.data.webhookUrl,'https://merchant.example.com/hook');
  const key=created.key,id=created.data.id;
  assert.equal(db.prepare('SELECT key_hash FROM merchant_api_keys WHERE id=?').get(id).key_hash.includes(key),false);
  const another=(await req('/api/v1/api-keys','POST',{name:'Other'},token))[1];
  assert.notEqual(another.key,key);assert.notEqual(another.data.id,id);
  const list=await req('/api/v1/api-keys','GET',undefined,token);
  assert.equal(list[1].data.length,2); assert.equal(JSON.stringify(list).includes(key),false);
  assert.equal(list[1].data.find(x=>x.id===id).prefix,key.slice(0,16));
  assert.equal((await req('/api/v1/api-keys','GET',undefined,other))[1].data.length,0);
  assert.equal((await req('/api/v1/api-keys/'+id,'DELETE',undefined,other))[0],404);
  const previous=process.env.DITSGATE_ADMIN_EMAIL;
  try {
   process.env.DITSGATE_ADMIN_EMAIL='keys-admin@example.com';
   await bootstrapAdmin(db,{email:'keys-admin@example.com',password:'admin-password-very-long'});
   const admin=(await req('/api/auth/login','POST',{email:'keys-admin@example.com',password:'admin-password-very-long'}))[1].token;
   assert.equal((await req('/api/v1/api-keys','POST',{name:'admin-key'},admin))[0],201);
   assert.equal((await req('/api/v1/api-keys','GET',undefined,admin))[0],200);
   assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{name:'Admin override'},admin))[0],404);
   assert.equal((await req('/api/v1/webhook-settings/rotate-secret','POST',{},admin))[0],200);
  } finally {if(previous===undefined)delete process.env.DITSGATE_ADMIN_EMAIL;else process.env.DITSGATE_ADMIN_EMAIL=previous}
  assert.equal((await req('/api/v1/webhook-settings','GET',undefined,key))[0],401);
  assert.equal((await req('/api/v1/balance','GET',undefined,key))[0],401);
  const second=(await req('/api/v1/qris','POST',{payload:QR,mode:'dynamic',name:'B',city:'BOGOR'},token))[1].data.id;
  const otherAsset=(await req('/api/v1/qris','POST',{payload:QR,mode:'dynamic',name:'Other',city:'BOGOR'},other))[1].data.id;
  assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{name:'Stolen'},other))[0],404);
  assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{name:'Stolen'},key))[0],401);
  assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{name:'Stolen'}))[0],401);
  for(const invalid of [
   {name:''},{name:null},{webhookUrl:'http://merchant.example.com/hook'},
   {webhookUrl:'https://127.0.0.1/hook'},{webhookUrl:'https://localhost/hook'},
   {webhookUrl:'https://user:pass@merchant.example.com/hook'},
   {webhookUrl:42},{qrisId:otherAsset},{qrisId:crypto.randomUUID()},
   {qrisId:42},{scope:'admin'},{}
  ])assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',invalid,token))[0],400);
  const updated=await req('/api/v1/api-keys/'+id,'PATCH',{name:' Updated POS ',webhookUrl:'https://merchant.example.com/new',qrisId:second},token);
  assert.equal(updated[0],200);
  assert.equal(updated[1].data.name,'Updated POS');
  assert.equal(updated[1].data.webhookUrl,'https://merchant.example.com/new');
  assert.equal(updated[1].data.qrisId,second);
  assert.equal(JSON.stringify(updated).includes(key),false);
  assert.deepEqual({...db.prepare('SELECT name,webhook_url,qris_id FROM merchant_api_keys WHERE id=?').get(id)},{name:'Updated POS',webhook_url:'https://merchant.example.com/new',qris_id:second});
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'wrong-after-patch',amount:1000,qris_id:asset},key))[0],403);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'selected-after-patch',amount:1000},key))[1].data.qrisId,second);
  assert.deepEqual((await req('/api/v1/transactions','GET',undefined,key))[1].data.map(x=>x.qrisId),[second]);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'session-other-asset',amount:1000,qris_id:asset},token))[0],201);
  assert.deepEqual(new Set((await req('/api/v1/transactions','GET',undefined,token))[1].data.map(x=>x.qrisId)),new Set([asset,second]));
  assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{qrisId:asset},token))[0],200);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'wrong-asset',amount:1000,qris_id:second},key))[0],403);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'key-order',amount:1000,qris_id:asset},key))[0],201);
  assert.equal((await req('/api/v1/transactions','GET',undefined,key))[1].data.length,2);
  assert.ok((await req('/api/v1/api-keys','GET',undefined,token))[1].data.find(x=>x.id===id).lastUsedAt);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'other-default',amount:1000},other))[1].data.qrisId,otherAsset);
  assert.equal((await req('/api/v1/webhook-settings','PATCH',{url:'https://user:pass@example.com/hook'},token))[0],400);
  assert.equal((await req('/api/v1/webhook-settings','PATCH',{url:'https://merchant.example.com/notify'},token))[0],200);
  const secret=(await req('/api/v1/webhook-settings/rotate-secret','POST',{},token))[1].secret;
  assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  const get=await req('/api/v1/webhook-settings','GET',undefined,token);
  assert.equal(get[1].data.url,'https://merchant.example.com/notify');assert.equal(get[1].data.secretConfigured,true);
  assert.equal(JSON.stringify(get).includes(secret),false);
  const rotated=(await req('/api/v1/webhook-settings/rotate-secret','POST',{},token))[1].secret;
  assert.notEqual(rotated,secret);
  assert.equal(JSON.stringify(await req('/api/v1/webhook-settings','GET',undefined,token)).includes(rotated),false);
  assert.equal(JSON.stringify(await req('/api/v1/webhook-settings','GET',undefined,other)).includes(secret),false);
  assert.equal(db.prepare('SELECT secret_hash FROM merchant_webhook_settings WHERE user_id=?').get(a).secret_hash.includes(rotated),false);
  assert.equal((await req('/api/v1/webhook-settings/ping','POST',{},token))[0],404);
  const cleared=await req('/api/v1/api-keys/'+id,'PATCH',{webhookUrl:null,qrisId:null},token);
  assert.equal(cleared[0],200);
  assert.equal(cleared[1].data.webhookUrl,null);
  assert.equal(cleared[1].data.qrisId,null);
  assert.equal((await req('/api/v1/api-keys','GET',undefined,token))[1].data.find(x=>x.id===id).qrisId,null);
  assert.equal((await req('/api/v1/transactions','POST',{order_id:'key-default',amount:1000},key))[1].data.qrisId,asset);
  assert.equal((await req('/api/v1/api-keys/'+id,'DELETE',undefined,token))[0],200);
  assert.equal((await req('/api/v1/api-keys/'+id,'PATCH',{name:'Nope'},token))[0],409);
  assert.equal(db.prepare('SELECT name FROM merchant_api_keys WHERE id=?').get(id).name,'Updated POS');
  assert.equal((await req('/api/v1/transactions','GET',undefined,key))[0],401);
  assert.ok((await req('/api/v1/api-keys','GET',undefined,token))[1].data.find(x=>x.id===id).revokedAt);
  assert.equal((await req('/api/v1/transactions','GET',undefined,token))[1].data[0].status,'pending');
  assert.equal(db.prepare('SELECT user_id FROM merchant_api_keys WHERE id=?').get(id).user_id,a);
 } finally {await new Promise(resolve=>server.close(resolve));db.close()}
});
