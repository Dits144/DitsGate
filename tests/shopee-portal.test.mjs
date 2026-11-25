import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('legacy portal status constraint upgrades without losing encrypted rows',()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'ditsgate-portal-migrate-'));
 const file=join(dir,'legacy.sqlite');
 try {
  const old=openDatabase(file);
  old.prepare("INSERT INTO users (id,email,password_hash,name,created_at) VALUES ('u1','legacy@sample.test','hash','Legacy','2026-01-01')").run();
  old.exec("DROP TABLE shopee_portal_connections; CREATE TABLE shopee_portal_connections (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,store_id TEXT NOT NULL,merchant_id TEXT NOT NULL,token_enc TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('connected','disconnected')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
  old.prepare("INSERT INTO shopee_portal_connections VALUES ('u1','12345','67890','encrypted-fixture','disconnected','2026-01-01','2026-01-01')").run();
  old.close();
  const upgraded=openDatabase(file);
  const row=upgraded.prepare('SELECT status,token_enc FROM shopee_portal_connections WHERE user_id=?').get('u1');
  assert.equal(row.status,'session_broken');assert.equal(row.token_enc,'encrypted-fixture');
  upgraded.prepare("UPDATE shopee_portal_connections SET status='connected' WHERE user_id='u1'").run();
  upgraded.prepare("UPDATE shopee_portal_connections SET status='session_broken' WHERE user_id='u1'").run();
  upgraded.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});


const secret='B:fixture-portal-token-not-real';
const envKey=Buffer.alloc(32,7).toString('base64');
const store={code:0,data:{list:[{storeId:12345,storeName:'Fixture Store',status:1}],storeCount:1}};
const feed={code:0,data:{list:[{transactionId:'tx-1',storeId:12345,merchantId:67890,amount:'409.662',createTime:1700000000,status:3}],next_position:''}};
async function setup(fetchImpl){
 const db=openDatabase(':memory:');
 const calls=[];
 const providerFetch=async(url,opts)=>{calls.push({url,opts});return (fetchImpl??(async()=>({ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?store:feed)})))(url,opts)};
 const {server}=createApp({db,shopeePortalFetch:providerFetch,shopeePortalKey:envKey});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',payload,token)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});return [r.status,await r.json()]}
 const register=async(email)=>{assert.equal((await request('/api/auth/register','POST',{email,password:'test-password-at-least-12',name:'Test'}))[0],201);return (await request('/api/auth/login','POST',{email,password:'test-password-at-least-12'}))[1].token};
 return {db,calls,request,register,close:async()=>{await new Promise(resolve=>server.close(resolve));db.close()}};
}
const config={token:secret};

test('token-only connection discovers one unambiguous merchant/store scope and rejects empty or mixed feeds',async()=>{
 const cases=[
  {feed:{code:0,data:{list:[{transactionId:'one',storeId:12345,merchantId:67890,amount:'12.000',createTime:1700000000,status:3}],next_position:0}},expected:201},
  {feed:{code:0,data:{list:[]}},expected:422},
  {feed:{code:0,data:{list:null,next_position:0}},expected:422},
  {feed:{code:0,data:{total:0,totalNetSales:0,totalCompletedCount:0,last_position:''}},expected:422},
  {feed:{code:0,data:{list:[{transactionId:'one',storeId:12345,merchantId:67890},{transactionId:'two',storeId:22222,merchantId:67890}]}},expected:422},
 ];
 for(const [index,entry] of cases.entries()){
  const x=await setup(async(url)=>({ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?store:entry.feed)}));
  try{
   const a=await x.register(`token-only-${index}@sample.test`);
   const [status,result]=await x.request('/api/v1/shopee-portal','POST',config,a);
   assert.equal(status,entry.expected);
   assert.ok(!JSON.stringify(result).includes(secret));
   if(status===201){assert.equal(result.data.storeId,'12345');assert.equal(result.data.merchantId,'67890')}
   else assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM shopee_portal_connections').get().n,0);
  }finally{await x.close()}
 }
});

test('connect probes fixed Shopee HTTPS endpoints and stores encrypted token only after scoped success',async()=>{
 const x=await setup();try{
  const a=await x.register('a@sample.test'),b=await x.register('b@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config))[0],401);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,b))[1].data.status,'unconfigured');
  const [status,created]=await x.request('/api/v1/shopee-portal','POST',config,a);
  assert.equal(status,201);assert.equal(created.data.status,'connected');assert.equal(created.data.providerConnected,true);assert.equal(created.data.paymentVerified,false);assert.equal(created.data.transactions.length,1);assert.equal(created.data.transactions[0].paymentVerified,false);
  assert.deepEqual(x.calls.map(c=>c.url),['https://shopeepay.shopee.co.id/merchant/v1/partner-web/get-store-list','https://shopeepay.shopee.co.id/merchant/v1/partner-web/get-transaction-list']);
  assert.equal(x.calls[0].opts.redirect,'error');assert.equal(x.calls[0].opts.method,'POST');
  assert.equal(JSON.parse(x.calls[0].opts.body).data.metadata.token,secret);
  assert.equal(JSON.parse(x.calls[1].opts.body).data.filter.serviceList.join(','),'1,3');
  assert.equal(JSON.parse(x.calls[1].opts.body).data.pageSize,10);
  const row=x.db.prepare('SELECT * FROM shopee_portal_connections').get();
  assert.ok(row);assert.ok(!JSON.stringify(row).includes(secret));assert.equal(row.store_id,'12345');
  const [feedStatus,result]=await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  assert.equal(feedStatus,200);assert.equal(result.data.length,1);assert.equal(result.data[0].id,'tx-1');assert.equal(result.data[0].amountIdr,409662);assert.equal(result.data[0].paymentVerified,false);
  assert.equal((await x.request('/api/v1/shopee-portal/transactions','GET',undefined,b))[0],404);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.token,undefined);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind != 'signup_bonus'").get().n,0);
  assert.equal((await x.request('/api/v1/shopee-portal','DELETE',undefined,b))[0],404);
  assert.equal((await x.request('/api/v1/shopee-portal','DELETE',undefined,a))[0],200);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM shopee_portal_connections').get().n,0);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'unconfigured');
 }finally{await x.close()}
});

test('rejects arbitrary URL, missing scope, nonmatching store, expired code and malformed provider envelopes without persisting',async()=>{
 for(const [payload,provider,status] of [
  [{...config,url:'https://example.test/steal'},undefined,400],
  [{...config,merchantId:null},undefined,400],
  [{...config,storeId:'not-a-number'},undefined,400],
  [config,async()=>({ok:true,text:async()=>JSON.stringify({code:200020,data:{list:[]}})}),502],
  [config,async()=>({ok:true,text:async()=>JSON.stringify({code:0,data:{list:[],storeCount:0}})}),422],
  [config,async()=>({ok:true,text:async()=>JSON.stringify({code:0,data:{}})}),502],
 ]){
  const x=await setup(provider);try{const a=await x.register('invalid@sample.test');const [actual,result]=await x.request('/api/v1/shopee-portal','POST',payload,a);assert.equal(actual,status);assert.ok(!JSON.stringify(result).includes(secret));assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM shopee_portal_connections').get().n,0)}finally{await x.close()}
 }
});

test('reconnect requires successful probe and retains previous encrypted token on failure',async()=>{
 let reject=false;
 const x=await setup(async(url)=>({ok:true,text:async()=>JSON.stringify(reject?{code:200020,data:{}}:url.endsWith('get-store-list')?store:feed)}));
 try{
  const a=await x.register('reconnect@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  const before=x.db.prepare('SELECT token_enc FROM shopee_portal_connections').get().token_enc;
  reject=true;
  assert.equal((await x.request('/api/v1/shopee-portal','POST',{...config,token:'B:replacement-token'},a))[0],502);
  assert.equal(x.db.prepare('SELECT token_enc FROM shopee_portal_connections').get().token_enc,before);
  reject=false;
  assert.equal((await x.request('/api/v1/shopee-portal','POST',{...config,token:'B:replacement-token'},a))[0],201);
  const after=x.db.prepare('SELECT token_enc FROM shopee_portal_connections').get().token_enc;
  assert.notEqual(after,before);assert.ok(!after.includes('replacement-token'));
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'connected');
 }finally{await x.close()}
});

test('feed refuses cross-scope rows and does not write ledger',async()=>{
 const crossStore={code:0,data:{list:[{storeId:12345,merchantId:67890}]}};
 const crossFeed={code:0,data:{list:[{transactionId:'unrelated',storeId:12345,merchantId:99999,amount:'10',createTime:1700000000,status:3}]}};
 let cross=false;
 const x=await setup(async(url)=>({ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?crossStore:cross?crossFeed:feed)}));
 try{
  const a=await x.register('scope@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  cross=true;
  const [status,result]=await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  assert.equal(status,200);assert.deepEqual(result.data,[]);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind != 'signup_bonus'").get().n,0);
 }finally{await x.close()}
});

test('damaged encrypted token fails closed and requires reconnect',async()=>{
 const x=await setup();
 try{
  const a=await x.register('damaged@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  x.db.prepare("UPDATE shopee_portal_connections SET token_enc='v1.invalid.invalid.invalid'").run();
  const [status,body]=await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  assert.equal(status,500);
  assert.ok(!JSON.stringify(body).includes(secret));
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'session_broken');
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind != 'signup_bonus'").get().n,0);
 }finally{await x.close()}
});

test('feed follows transaction cursor and rejects a cursor cycle',async()=>{
 let cursorLoop=false;
 const x=await setup(async(url,opts)=>{
  if(url.endsWith('get-store-list'))return {ok:true,text:async()=>JSON.stringify(store)};
  const cursor=JSON.parse(opts.body).data.next_position;
  const data=cursor?{code:0,data:{list:[{transactionId:'tx-2',storeId:12345,merchantId:67890,amount:'12.000',createTime:1700000001,status:3}],next_position:cursorLoop?'page-2':''}}:{code:0,data:{list:feed.data.list,next_position:'page-2'}};
  return {ok:true,text:async()=>JSON.stringify(data)};
 });
 try{
  const a=await x.register('pages@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  const [,result]=await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  assert.deepEqual(result.data.map(r=>r.id),['tx-2','tx-1']);
  cursorLoop=true;
  assert.equal((await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a))[0],502);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'session_broken');
 }finally{await x.close()}
});

test('late feed response cannot overwrite a reconnected portal session',async()=>{
 let armed=false;
 let signalStarted;
 const started=new Promise(resolve=>{signalStarted=resolve});
 let releaseOldRead;
 const release=new Promise(resolve=>{releaseOldRead=resolve});
 const x=await setup(async(url,opts)=>{
  const sent=JSON.parse(opts.body).data.metadata.token;
  if(armed&&url.endsWith('get-store-list')&&sent===secret){
   signalStarted();await release;
  }
  return {ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?store:feed)};
 });
 try{
  const a=await x.register('race@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  armed=true;
  const late=x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  await started;
  assert.equal((await x.request('/api/v1/shopee-portal','POST',{...config,token:'B:new-token-for-race'},a))[0],201);
  const current=x.db.prepare('SELECT token_enc FROM shopee_portal_connections').get().token_enc;
  releaseOldRead();
  const [code]=await late;
  assert.equal(code,409);
  assert.equal(x.db.prepare('SELECT token_enc FROM shopee_portal_connections').get().token_enc,current);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'connected');
 }finally{releaseOldRead();await x.close()}
});

test('late provider error cannot break a replacement connection',async()=>{
 let armed=false;
 let signalStarted;
 const started=new Promise(resolve=>{signalStarted=resolve});
 let releaseOldRead;
 const release=new Promise(resolve=>{releaseOldRead=resolve});
 const x=await setup(async(url,opts)=>{
  const sent=JSON.parse(opts.body).data.metadata.token;
  if(armed&&url.endsWith('get-store-list')&&sent===secret){signalStarted();await release;return {ok:true,text:async()=>JSON.stringify({code:200020,data:{}})}}
  return {ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?store:feed)};
 });
 try{
  const a=await x.register('race-error@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  armed=true;
  const late=x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  await started;
  assert.equal((await x.request('/api/v1/shopee-portal','POST',{...config,token:'B:new-token-for-error-race'},a))[0],201);
  releaseOldRead();
  assert.equal((await late)[0],409);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'connected');
 }finally{releaseOldRead();await x.close()}
});

test('late feed response cannot resurrect a disconnected portal',async()=>{
 let armed=false;
 let signalStarted;
 const started=new Promise(resolve=>{signalStarted=resolve});
 let releaseOldRead;
 const release=new Promise(resolve=>{releaseOldRead=resolve});
 const x=await setup(async(url,opts)=>{
  if(armed&&url.endsWith('get-store-list')){signalStarted();await release}
  return {ok:true,text:async()=>JSON.stringify(url.endsWith('get-store-list')?store:feed)};
 });
 try{
  const a=await x.register('race-delete@sample.test');
  assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);
  armed=true;
  const late=x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);
  await started;
  assert.equal((await x.request('/api/v1/shopee-portal','DELETE',undefined,a))[0],200);
  releaseOldRead();
  assert.equal((await late)[0],409);
  assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'unconfigured');
 }finally{releaseOldRead();await x.close()}
});

test('feed cannot mark connected on provider error',async()=>{
 let fail=false;
 const x=await setup(async(url)=>({ok:true,text:async()=>JSON.stringify(fail?{code:200020,data:{}}:url.endsWith('get-store-list')?store:feed)}));
 try{const a=await x.register('feed@sample.test');assert.equal((await x.request('/api/v1/shopee-portal','POST',config,a))[0],201);fail=true;const [status,result]=await x.request('/api/v1/shopee-portal/transactions','GET',undefined,a);assert.equal(status,502);assert.ok(!JSON.stringify(result).includes(secret));assert.equal((await x.request('/api/v1/shopee-portal','GET',undefined,a))[1].data.status,'session_broken')}finally{await x.close()}
});
