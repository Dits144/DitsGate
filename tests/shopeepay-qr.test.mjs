import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createShopeePayQrFixture } from '../server/shopeepay.mjs';

const env = { SHOPEEPAY_ENV:'uat', SHOPEEPAY_CLIENT_ID:'fixture-client', SHOPEEPAY_SECRET:'fixture-secret', SHOPEEPAY_MERCHANT_EXT_ID:'fixture-merchant', SHOPEEPAY_STORE_EXT_ID:'fixture-store' };
const sign = raw => createHmac('sha256',env.SHOPEEPAY_SECRET).update(raw).digest('base64');
const args = {paymentReferenceId:'merchant-order-1',amount:100,env};
const fixture = (mutate=x=>x, signed=true, expectedReference=args.paymentReferenceId) => async (url, options) => {
  assert.equal(url,'https://api.uat.wallet.airpay.co.id/v3/merchant-host/qr/create');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers['X-Airpay-ClientId'],env.SHOPEEPAY_CLIENT_ID);
  assert.equal(options.headers['X-Airpay-Req-H'],sign(options.body));
  const request=JSON.parse(options.body);
  assert.deepEqual(Object.keys(request),['request_id','amount','currency','merchant_ext_id','store_ext_id','payment_reference_id']);
  assert.equal(request.amount,10000);
  assert.equal(request.currency,'IDR');
  assert.equal(request.payment_reference_id,expectedReference);
  const raw=JSON.stringify(mutate({request_id:request.request_id,errcode:0,qr_content:'000201010212',qr_url:'https://api.uat.wallet.airpay.co.id/v3/merchant-host/qr/download?qr=fixture'}));
  return {ok:true,headers:new Headers(signed?{'X-Airpay-Resp-H':sign(raw)}:{}),text:async()=>raw};
};

test('MPM fixture request and signed response never claim payment',async()=>{
  assert.deepEqual(await createShopeePayQrFixture({...args,fetchImpl:fixture()}),{paymentReferenceId:args.paymentReferenceId,amount:100,qrContent:'000201010212',verification:'signed_fixture_only',paymentVerified:false});
});
test('MPM fixture refuses missing transport/credentials and invalid amount or reference',async()=>{
  await assert.rejects(createShopeePayQrFixture(args),/probe_unavailable/);
  await assert.rejects(createShopeePayQrFixture({...args,env:{},fetchImpl:fixture()}),/probe_unavailable/);
  await assert.rejects(createShopeePayQrFixture({...args,amount:1.5,fetchImpl:fixture()}),/invalid_input/);
  await assert.rejects(createShopeePayQrFixture({...args,paymentReferenceId:'x'.repeat(65),fetchImpl:fixture()}),/invalid_input/);
  await assert.rejects(createShopeePayQrFixture({...args,paymentReferenceId:'bad reference',fetchImpl:fixture()}),/invalid_input/);
  const longestReference='x'.repeat(64);
  assert.equal((await createShopeePayQrFixture({...args,paymentReferenceId:longestReference,fetchImpl:fixture(x=>x,true,longestReference)})).paymentVerified,false);
});
test('MPM fixture fails closed on absent signature and mismatched response',async()=>{
  for(const fetchImpl of [fixture(x=>x,false),fixture(x=>({...x,request_id:'replayed'})),fixture(x=>({...x,errcode:5})),fixture(x=>({...x,qr_content:''})),fixture(x=>({...x,qr_url:'https://evil.test/qr'}))]) {
    await assert.rejects(createShopeePayQrFixture({...args,fetchImpl}),/probe_failed/);
  }
});
