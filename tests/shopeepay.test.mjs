import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';
import { checkShopeePay, shopeepayConfig } from '../server/shopeepay.mjs';

const env = { SHOPEEPAY_ENV:'uat', SHOPEEPAY_CLIENT_ID:'fixture-client', SHOPEEPAY_SECRET:'fixture-secret', SHOPEEPAY_MERCHANT_EXT_ID:'fixture-merchant', SHOPEEPAY_STORE_EXT_ID:'fixture-store' };
const hmac = raw => createHmac('sha256', env.SHOPEEPAY_SECRET).update(raw).digest('base64');
const fixture = (mutate = x => x, signature = true) => async (url, options) => {
  assert.equal(url, 'https://api.uat.wallet.airpay.co.id/v3/merchant-host/transaction/check');
  assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['X-Airpay-ClientId'], env.SHOPEEPAY_CLIENT_ID);
  assert.equal(options.headers['X-Airpay-Req-H'], hmac(options.body));
  const sent = JSON.parse(options.body);
  assert.equal(sent.transaction_type,13);
  assert.equal(sent.amount,10000);
  const response = mutate({ request_id:sent.request_id, errcode:0, transaction:{reference_id:sent.reference_id,merchant_ext_id:sent.merchant_ext_id,store_ext_id:sent.store_ext_id,amount:sent.amount,transaction_type:13,status:3} });
  const raw = JSON.stringify(response);
  return {ok:true,headers:new Headers(signature ? {'X-Airpay-Resp-H':hmac(raw)} : {}),text:async()=>raw};
};
const input = {referenceId:'ref-123',amount:100,env};

test('config is redacted and incomplete credentials disable probe', async () => {
  assert.deepEqual(shopeepayConfig({}),{configured:false,environment:null,status:'not_verified',checkAvailable:false});
  assert.equal(shopeepayConfig(env).configured,true);
  assert.equal(shopeepayConfig({...env,SHOPEEPAY_ENV:'https://evil.test'}).configured,false);
  assert.equal(JSON.stringify(shopeepayConfig(env)).includes(env.SHOPEEPAY_SECRET),false);
  await assert.rejects(checkShopeePay({...input,env:{},fetchImpl:()=>{throw Error('network called')}}),/probe_unavailable/);
});
test('signed response is not payment verification without a provider-created order', async () => {
  assert.deepEqual(await checkShopeePay({...input,fetchImpl:fixture()}),{verification:'signed_response_received',paymentVerified:false,providerStatus:3});
});
test('missing/bad signature, replay and mismatched transaction are rejected', async () => {
  const bad = [fixture(x=>x,false),async (...args)=>{const r=await fixture()(...args);r.headers.set('X-Airpay-Resp-H',hmac('different'));return r},fixture(x=>({...x,request_id:'old-request'})),fixture(x=>({...x,transaction:{...x.transaction,reference_id:'other'}})),fixture(x=>({...x,transaction:{...x.transaction,merchant_ext_id:'other'}})),fixture(x=>({...x,transaction:{...x.transaction,store_ext_id:'other'}})),fixture(x=>({...x,transaction:{...x.transaction,amount:10100}})),fixture(x=>({...x,transaction:null})),fixture(x=>({...x,errcode:5}))];
  for(const fetchImpl of bad)await assert.rejects(checkShopeePay({...input,fetchImpl}),/probe_failed/);
});
test('HTTP check rejects unbound references, including demo-only orders; no tenant/ledger mutation', async () => {
  const db=openDatabase(':memory:');const {server}=createApp({db});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const req=async(path,method='GET',payload,token)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});return [r.status,await r.json()]};
  try{
    const users=[];for(const email of ['one@example.test','two@example.test']){assert.equal((await req('/api/auth/register','POST',{email,password:'long-password-for-test',name:'Merchant'}))[0],201);users.push((await req('/api/auth/login','POST',{email,password:'long-password-for-test'}))[1].token)}
    assert.equal((await req('/api/v1/shopeepay/config'))[0],401);
    assert.deepEqual((await req('/api/v1/shopeepay/config','GET',undefined,users[0]))[1].data,{configured:false,environment:null,status:'not_verified',checkAvailable:false});
    const payload={referenceId:'demo-order',amount:100};
    assert.equal((await req('/api/v1/shopeepay/check','POST',payload))[0],401);
    assert.equal((await req('/api/v1/shopeepay/check','POST',payload,users[0]))[0],503);
    // Persist a demo-only transaction for merchant one; neither owner nor another tenant may probe it.
    const userId=db.prepare('SELECT user_id FROM sessions LIMIT 1').get().user_id;
    db.prepare('INSERT INTO qris_assets VALUES (?,?,?,?,?,?,?,?,?)').run('fixture-qris',userId,'payload','fixture','name','city','static',1,new Date().toISOString());
    db.prepare('INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?)').run('fixture-tx',userId,'demo-order',100,0,'fixture-qris','demo_only',new Date().toISOString(),new Date().toISOString());
    const original={};for(const [key,value] of Object.entries(env)){original[key]=process.env[key];process.env[key]=value}
    try{
      for(const token of users)assert.equal((await req('/api/v1/shopeepay/check','POST',payload,token))[0],409);
      assert.equal((await req('/api/v1/shopeepay/check','POST',{...payload,amount:1.5},users[0]))[0],400);
    } finally {for(const key of Object.keys(env)){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key]}}
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM provider_orders').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions WHERE status=?').get('demo_only').n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close()}
});
