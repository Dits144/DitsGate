import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer as createViteServer} from 'vite';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

test('one merchant login opens portal and developer API; logout revokes access',async()=>{
 const db=openDatabase(':memory:');
 const {server:api}=createApp({db,allowOrigin:'http://127.0.0.1:5191'});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const previous=process.env.VITE_DITSGATE_API_URL;
 process.env.VITE_DITSGATE_API_URL=`http://127.0.0.1:${api.address().port}`;
 const vite=await createViteServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5191,strictPort:true}});
 let browser;
 try{
  await vite.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5191/register');
  await page.getByLabel('Nama bisnis').fill('Toko Integrasi');
  await page.getByLabel('Email',{exact:true}).fill('integrasi@example.test');
  await page.getByLabel('Kata sandi',{exact:true}).fill('merchant-password-12345');
  await page.getByRole('button',{name:'Daftar dan masuk'}).click();
  await page.getByTestId('portal-state').getByText('Belum terhubung').waitFor();
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);
  await page.getByRole('link',{name:'API & Webhook'}).click();
  await page.getByText(/Sandbox terhubung ·/).waitFor();
  await page.getByRole('button',{name:'Menu akun'}).click();
  await page.getByRole('button',{name:'Keluar dari akun'}).click();
  await page.getByText('Hubungkan merchant sandbox').waitFor();
  for(let attempt=0;attempt<30&&db.prepare('SELECT count(*) n FROM sessions').get().n;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  await page.getByRole('button',{name:'Menu akun'}).click();
  await page.getByText('Mode demo browser').waitFor();
  await page.goto('http://127.0.0.1:5191/dashboard/detectors/shopee');
  await page.getByTestId('portal-state').getByText('Masuk ke akun merchant dahulu').waitFor();
  await page.goto('http://127.0.0.1:5191/login');
  await page.getByLabel('Email',{exact:true}).fill('integrasi@example.test');
  await page.getByLabel('Kata sandi',{exact:true}).fill('merchant-password-12345');
  await page.getByRole('button',{name:'Masuk',exact:true}).click();
  await page.getByTestId('portal-state').getByText('Belum terhubung').waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await vite.close();await new Promise(resolve=>api.close(resolve));db.close();if(previous===undefined)delete process.env.VITE_DITSGATE_API_URL;else process.env.VITE_DITSGATE_API_URL=previous}
});
