import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer as createViteServer} from 'vite';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

test('merchant can pair, inspect and revoke Android listener without claiming Shopee Partner connection', async()=>{
 const db=openDatabase(':memory:');
 const {server:api}=createApp({db});
 await new Promise(resolve=>api.listen(5180,'127.0.0.1',resolve));
 const vite=await createViteServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5179,strictPort:true}});
 let browser;
 try{
  await vite.listen();
  const base='http://127.0.0.1:5180';
  const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'ui-listener@example.test',name:'Merchant',password:'password-12345678'})});
  assert.equal(register.status,201);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:5179/dashboard/detectors/shopee');
  await page.getByLabel('Email akun merchant').fill('ui-listener@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('password-12345678');
  await page.getByRole('button',{name:'Masuk ke akun merchant'}).click();
  await page.getByRole('button',{name:'Pasangkan listener'}).click();
  const token=await page.getByTestId('listener-token').textContent();
  assert.match(token,/^dt_[A-Za-z0-9_-]{32,}$/);
  assert.match(await page.getByTestId('listener-state').textContent(),/Menunggu notifikasi/);
  const received=await fetch(base+'/api/v1/mutations/ingest',{method:'POST',headers:{'content-type':'application/json','x-device-token':token,'x-event-id':'ui-001'},body:JSON.stringify({source_app:'com.gojek.gopaymerchant',title:'Pembayaran diterima',text:'Kamu menerima pembayaran QRIS sebesar Rp 125.008 dari pelanggan.'})});
  assert.equal(received.status,202);
  await page.getByRole('button',{name:'Segarkan sinyal'}).click();
  await page.getByText('Rp 125.008').waitFor();
  assert.match(await page.getByTestId('listener-state').textContent(),/Sinyal diterima/);
  assert.match(await page.getByText(/Belum terverifikasi/).first().textContent(),/Belum terverifikasi/);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Cabut token perangkat'}).click();
  await page.getByText('Perangkat belum dipasangkan').waitFor();
  assert.equal((await fetch(base+'/api/v1/mutations/ingest',{method:'POST',headers:{'content-type':'application/json','x-device-token':token},body:JSON.stringify({source_app:'com.gojek.gopaymerchant',title:'Pembayaran diterima',text:'Rp 100'})})).status,401);
 }finally{await browser?.close();await vite.close();await new Promise(resolve=>api.close(resolve));db.close()}
});
