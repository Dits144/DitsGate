import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer as createViteServer} from 'vite';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

test('guest connect button directs to merchant login without submitting portal token',async()=>{
 const db=openDatabase(':memory:');
 let providerCalls=0;
 const {server:api}=createApp({db,allowOrigin:'http://127.0.0.1:5190',shopeePortalKey:Buffer.alloc(32,7).toString('base64url'),shopeePortalFetch:async()=>{providerCalls++;throw Error('unexpected provider call')}});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const previous=process.env.VITE_DITSGATE_API_URL;
 process.env.VITE_DITSGATE_API_URL=`http://127.0.0.1:${api.address().port}`;
 const vite=await createViteServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5190,strictPort:true}});
 let browser;
 try{
  await vite.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5190/dashboard/detectors/shopee');
  const button=page.getByTestId('portal-connection').getByRole('button',{name:'Masuk untuk menghubungkan'});
  assert.equal(await button.isEnabled(),true);
  await button.click();
  await page.getByLabel('Email akun merchant').waitFor({state:'visible'});
  assert.equal(await page.getByLabel('Email akun merchant').evaluate(el=>el===document.activeElement),true);
  assert.equal(providerCalls,0);
 }finally{await browser?.close();await vite.close();await new Promise(resolve=>api.close(resolve));db.close();if(previous===undefined)delete process.env.VITE_DITSGATE_API_URL;else process.env.VITE_DITSGATE_API_URL=previous}
});

test('guest can create local merchant account and log in before connecting',async()=>{
 const db=openDatabase(':memory:');
 const {server:api}=createApp({db,allowOrigin:'http://127.0.0.1:5190'});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const previous=process.env.VITE_DITSGATE_API_URL;
 process.env.VITE_DITSGATE_API_URL=`http://127.0.0.1:${api.address().port}`;
 const vite=await createViteServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5190,strictPort:true}});
 let browser;
 try{
  await vite.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5190/dashboard/detectors/shopee',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByLabel('Email akun merchant').fill('new-portal@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('password-12345678');
  await page.getByRole('button',{name:'Masuk ke akun merchant'}).click();
  await page.getByRole('alert').getByText(/Akun merchant belum terdaftar di API lokal/).waitFor();
  await page.getByRole('button',{name:'Buat akun merchant lokal'}).click();
  await page.getByLabel('Nama akun merchant').fill('Toko Lokal');
  await page.getByLabel('Email akun merchant').fill('new-portal@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('password-12345678');
  await page.getByRole('button',{name:'Daftar dan masuk'}).click();
  await page.getByTestId('portal-state').getByText('Belum terhubung').waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('new-portal@example.test').n,1);
 }finally{await browser?.close();await vite.close();await new Promise(resolve=>api.close(resolve));db.close();if(previous===undefined)delete process.env.VITE_DITSGATE_API_URL;else process.env.VITE_DITSGATE_API_URL=previous}
});

test('merchant portal UI connects, reads scoped feed, handles expired session and reconnects',async()=>{
 const db=openDatabase(':memory:');
 let expired=false;
 const store={code:0,data:{list:[{storeId:12345,merchantId:67890}]}};
 const feed={code:0,data:{list:[{transactionId:'portal-1',storeId:12345,merchantId:67890,amount:'15.009',createTime:1700000000,status:3}]}};
 const provider=async(url)=>({ok:true,text:async()=>JSON.stringify(expired?{code:200020,data:{}}:url.endsWith('get-store-list')?store:feed)});
 const {server:api}=createApp({db,allowOrigin:'http://127.0.0.1:5190',shopeePortalKey:Buffer.alloc(32,7).toString('base64url'),shopeePortalFetch:provider});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${api.address().port}`;
 const previous=process.env.VITE_DITSGATE_API_URL;
 process.env.VITE_DITSGATE_API_URL=base;
 const vite=await createViteServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5190,strictPort:true}});
 let browser;
 try{
  await vite.listen();
  assert.equal((await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'portal-ui@example.test',name:'Merchant',password:'password-12345678'})})).status,201);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const runtimeErrors=[];
  page.on('pageerror',error=>runtimeErrors.push(error.message));
  await page.goto('http://127.0.0.1:5190/dashboard/detectors/shopee');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page must not overflow horizontally');
  await page.getByLabel('Email akun merchant').fill('portal-ui@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('password-12345678');
  await page.getByRole('button',{name:'Masuk ke akun merchant'}).click();
  await page.getByTestId('portal-state').getByText('Belum terhubung').waitFor();
  await page.getByLabel('Token dari portal Shopee (wajib)').fill('B:test-portal-token');
  assert.equal(await page.getByTestId('portal-connection').getByLabel('Store ID').count(),0);
  assert.equal(await page.getByTestId('portal-connection').getByLabel('Merchant ID').count(),0);
  await page.getByTestId('portal-connection').getByRole('button',{name:'Hubungkan & verifikasi'}).click();
  await page.getByTestId('portal-state').getByText('Terhubung').waitFor();
  await page.getByText('Rp 15.009').waitFor();
  assert.equal(await page.getByLabel('Token dari portal Shopee (wajib)').inputValue(),'');
  await page.getByRole('button',{name:'Segarkan mutasi'}).click();
  await page.getByText('Rp 15.009').waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n,0);
  expired=true;
  await page.getByRole('button',{name:'Segarkan mutasi'}).click();
  await page.getByTestId('portal-state').getByText(/SESSION_BROKEN/).waitFor();
  expired=false;
  await page.getByLabel('Token dari portal Shopee (wajib)').fill('B:renewed-portal-token');
  await page.getByTestId('portal-connection').getByRole('button',{name:'Hubungkan & verifikasi'}).click();
  await page.getByTestId('portal-state').getByText('Terhubung').waitFor();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByTestId('portal-connection').getByRole('button',{name:'Putuskan'}).click();
  await page.getByTestId('portal-state').getByText('Belum terhubung').waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shopee_portal_connections').get().n,0);
  for(const width of [768,1024,1440]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no horizontal overflow at ${width}px`);
  }
  assert.deepEqual(runtimeErrors,[]);
 }finally{await browser?.close();await vite.close();await new Promise(resolve=>api.close(resolve));db.close();if(previous===undefined)delete process.env.VITE_DITSGATE_API_URL;else process.env.VITE_DITSGATE_API_URL=previous}
});
