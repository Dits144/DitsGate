import { test, expect } from '@playwright/test';
import { safeSandboxOrigin } from '../../src/developer-api';

test('sandbox API origin rejects insecure remote and permits HTTPS remote', () => {
  expect(() => safeSandboxOrigin('http://example.com')).toThrow();
  expect(safeSandboxOrigin('https://example.com')).toBe('https://example.com');
  expect(safeSandboxOrigin('http://127.0.0.1:5180')).toBe('http://127.0.0.1:5180');
});

const paths = ['/', '/login', '/register', '/forgot-password', '/docs', '/integrations', '/dashboard', '/dashboard/qris', '/dashboard/integration-guide', '/dashboard/detectors', '/dashboard/detectors/gopay', '/dashboard/detectors/shopee', '/dashboard/detectors/listener', '/dashboard/transactions', '/dashboard/mutations', '/dashboard/developers', '/dashboard/subscription', '/dashboard/topup', '/dashboard/banks', '/dashboard/settings', '/dashboard/admin'];

test('all main routes render without horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator('h1').first(), path).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('ShopeePay unconfigured state and mobile layout do not imply verified payments', async ({ page }) => {
  await page.route('http://127.0.0.1:5180/api/v1/shopeepay/config', route => route.fulfill({ json: { data: { configured: false, environment: null, status: 'not_verified' } } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/dashboard/detectors/shopee');
    await expect(page.getByRole('heading', { name: 'Shopee Partner', exact: true })).toBeVisible();
    await expect(page.locator('.shopee-status')).toContainText('Belum terverifikasi');
    await expect(page.getByRole('button', { name: 'Hubungkan & verifikasi' })).toBeDisabled();
    await expect(page.getByText(/ShopeePay Client ID/)).toBeVisible();
    await expect(page.getByText(/QRIS statis/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Listener notifikasi Android' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Atau login dengan akun Shopee (opsional)' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Login di Shopee Partner resmi/ })).toHaveAttribute('href', 'https://partner.shopee.co.id/');
    await expect(page.getByLabel('No. HP atau email Shopee')).toBeVisible();
    await expect(page.getByLabel('Password Shopee', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sesi portal Shopee (opsional)')).toBeVisible();
    await expect(page.getByLabel('Token get-transaction-list (opsional)')).toBeVisible();
    await page.getByLabel('No. HP atau email Shopee').fill('dummy@example.invalid');
    await page.getByLabel('Password Shopee', { exact: true }).fill('not-a-real-password');
    await page.getByLabel('Sesi portal Shopee (opsional)').fill('dummy-cookie');
    await page.getByLabel('Token get-transaction-list (opsional)').fill('dummy-token');
    await expect(page.locator('.shopee-status')).toContainText('Belum terverifikasi');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('dummy-token');
    await page.getByRole('button', { name: 'Kosongkan semua kolom' }).click();
    await expect(page.getByLabel('Password Shopee', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Sesi portal Shopee (opsional)')).toHaveValue('');
    await expect(page.getByLabel('Token get-transaction-list (opsional)')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Hubungkan & verifikasi' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px`).toBe(true);
  }
});

test('ShopeePay configured credentials alone cannot enable a payment check', async ({ page }) => {
  const requests: string[] = [];
  await page.route('http://127.0.0.1:5180/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/api/auth/login') return route.fulfill({ json: { token: 'test-session', user: { name: 'Merchant Test' } } });
    if (path === '/api/v1/shopeepay/config') return route.fulfill({ json: { data: { configured: true, environment: 'uat', status: 'not_verified', checkAvailable: false } } });
    if (path === '/api/v1/shopee-listener') return route.fulfill({ json: { data: null } });
    if (path === '/api/v1/shopee-listener/events') return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404, json: { error: 'Unknown path' } });
  });
  await page.goto('/dashboard/detectors/shopee');
  await page.getByLabel('Email akun merchant').fill('merchant@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('only-in-memory');
  await page.getByRole('button', { name: 'Masuk ke akun merchant' }).click();
  await expect(page.getByText('Sesi merchant aktif dalam memori halaman ini.')).toBeVisible();
  await expect(page.getByLabel('Kata sandi akun merchant')).toHaveCount(0);
  await page.getByLabel('Reference ID order ShopeePay').fill('ORDER-SHOPEE-001');
  await page.getByLabel('Nominal order (Rp)').fill('50000');
  await expect(page.getByRole('button', { name: 'Hubungkan & verifikasi' })).toBeDisabled();
  await expect(page.locator('.shopee-status')).toContainText('Belum terverifikasi');
  expect(requests).not.toContain('POST /api/v1/shopeepay/check');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-session');
  await page.getByRole('button', { name: 'Putuskan' }).click();
  await expect(page.locator('.shopee-status')).toContainText('Belum terverifikasi');
});

test('ShopeePay status-check failure keeps unverified state and clears failed login password', async ({ page }) => {
  await page.route('http://127.0.0.1:5180/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') return route.fulfill({ status: 401, json: { error: 'Email atau password salah.' } });
    if (path === '/api/v1/shopeepay/config') return route.fulfill({ json: { configured: true, environment: 'uat', status: 'not_verified' } });
    return route.fulfill({ status: 404, json: { error: 'Unknown path' } });
  });
  await page.goto('/dashboard/detectors/shopee');
  await page.getByLabel('Email akun merchant').fill('merchant@example.test');
  await page.getByLabel('Kata sandi akun merchant').fill('wrong-password');
  await page.getByRole('button', { name: 'Masuk ke akun merchant' }).click();
  await expect(page.getByRole('alert')).toContainText('Email atau password salah.');
  await expect(page.getByLabel('Kata sandi akun merchant')).toHaveValue('');
  await expect(page.locator('.shopee-status')).toContainText('Belum terverifikasi');
});

test('developer settings stay unconnected and persist only a validated browser draft', async ({ page }) => {
  await page.goto('/dashboard/developers');
  await expect(page.getByRole('heading', { name: 'API & Webhook', exact: true })).toBeVisible();
  await expect(page.getByText('Server belum terhubung')).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate API key/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salin / cabut' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Webhook & QRIS' }).click();
  const url = page.getByLabel('URL tujuan HTTPS');
  await url.fill('http://merchant.example/hook');
  await page.getByRole('button', { name: 'Simpan draf di browser' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTPS valid');
  await url.fill('https://merchant.example/hook');
  await page.getByRole('button', { name: 'Simpan draf di browser' }).click();
  await expect(page.getByText('Draf browser tersimpan. Webhook tetap tidak aktif.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simpan ke server' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ping endpoint' })).toBeDisabled();
  await page.reload();
  await page.getByRole('tab', { name: 'Webhook & QRIS' }).click();
  await expect(url).toHaveValue('https://merchant.example/hook');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ditsgate_demo_v1') || '{}'));
  expect(saved.webhook).toEqual({ url: 'https://merchant.example/hook', events: ['payment.paid'], enabled: false });
  expect(saved.keys).toEqual([]);
  await page.getByRole('tab', { name: 'Keamanan & kode' }).click();
  await expect(page.getByRole('button', { name: 'Lihat secret' })).toBeDisabled();
  await expect(page.locator('.dev-code')).toContainText('rawBody');
  await page.getByLabel('Bahasa contoh HMAC').selectOption('Python');
  await expect(page.locator('.dev-code')).toContainText('compare_digest');
});

test('merchant sandbox login, key lifecycle and secret remain ephemeral', async ({ page }) => {
  const origin = 'http://127.0.0.1:5180';
  const id = '11111111-1111-4111-8111-111111111111';
  const requests: string[] = [];
  let keys: Array<Record<string, unknown>> = [];
  let url: string | null = null;
  let configured = false;
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    requests.push(`${req.method()} ${path}`);
    if (req.method() !== 'POST' || path !== '/api/auth/login') expect(req.headers().authorization).toBe('Bearer fake-session-token');
    const ok = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/login') return ok({ token: 'fake-session-token', user: { name: 'Merchant Test' } });
    if (path === '/api/v1/api-keys' && req.method() === 'GET') return ok({ data: keys });
    if (path === '/api/v1/api-keys' && req.method() === 'POST') {
      keys = [{ id, name: req.postDataJSON().name, prefix: 'dg_test_masked', webhookUrl: null, qrisId: null, revokedAt: null, deliveryEnabled: false }];
      return ok({ data: keys[0], key: 'dg_test_one_time_secret', notice: 'Local test only' }, 201);
    }
    if (path === `/api/v1/api-keys/${id}` && req.method() === 'PATCH') {
      keys[0] = { ...keys[0], ...req.postDataJSON() }; return ok({ data: keys[0] });
    }
    if (path === `/api/v1/api-keys/${id}` && req.method() === 'DELETE') {
      keys[0] = { ...keys[0], revokedAt: new Date().toISOString() }; return ok({ ok: true });
    }
    if (path === '/api/v1/webhook-settings' && req.method() === 'GET') return ok({ data: { url, secretConfigured: configured, deliveryEnabled: false } });
    if (path === '/api/v1/webhook-settings' && req.method() === 'PATCH') { url = req.postDataJSON().url; return ok({ data: { url, secretConfigured: configured, deliveryEnabled: false } }); }
    if (path === '/api/v1/webhook-settings/rotate-secret') { configured = true; return ok({ data: { url, secretConfigured: true, deliveryEnabled: false }, secret: 'rotated_one_time_secret' }); }
    if (path === '/api/v1/qris') return ok({ data: [{ id: 'qris-1', name: 'QRIS Server' }] });
    return ok({ error: 'Unknown path' }, 404);
  });
  await page.goto('/dashboard/developers');
  await page.getByLabel('Email merchant sandbox').fill('merchant@example.test');
  await page.getByLabel('Kata sandi merchant sandbox').fill('local-password');
  await page.getByRole('button', { name: 'Hubungkan sandbox' }).click();
  await expect(page.getByText('Sandbox terhubung', { exact: true })).toBeVisible();
  await page.getByLabel('Nama API key baru').fill('QA key');
  await page.getByRole('button', { name: /Generate API key/ }).click();
  await expect(page.getByRole('dialog')).toContainText('dg_test_one_time_secret');
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain('dg_test_one_time_secret');
  await page.getByRole('dialog').getByRole('button', { name: 'Tutup' }).click();
  await expect(page.getByText('dg_test_one_time_secret')).toHaveCount(0);
  await page.getByLabel('URL webhook key QA key').fill('https://merchant.example/key');
  await page.getByLabel('QRIS key QA key').selectOption('qris-1');
  await page.getByRole('button', { name: 'Simpan key QA key' }).click();
  await expect(page.getByText('https://merchant.example/key')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cabut key QA key' }).click();
  await expect(page.getByText('QA key · Dicabut')).toBeVisible();
  await page.getByRole('tab', { name: 'Webhook & QRIS' }).click();
  await page.getByLabel('URL webhook server').fill('https://merchant.example/account');
  await page.getByRole('button', { name: 'Simpan ke server' }).click();
  await expect(page.getByText('https://merchant.example/account')).toBeVisible();
  await page.getByRole('tab', { name: 'Keamanan & kode' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Rotasi secret' }).click();
  await expect(page.getByRole('dialog')).toContainText('rotated_one_time_secret');
  await page.getByRole('button', { name: 'Putuskan koneksi' }).click();
  await expect(page.getByText('rotated_one_time_secret')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Webhook & QRIS' }).click();
  await expect(page.getByLabel('URL webhook server')).toHaveValue('');
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain('rotated_one_time_secret');
  expect(requests).toContain(`PATCH /api/v1/api-keys/${id}`);
});

test('sandbox connection errors stay honest and never persist credentials', async ({ page }) => {
  await page.route('http://127.0.0.1:5180/api/auth/login', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Email atau password salah.' }) }));
  await page.goto('/dashboard/developers');
  await page.getByLabel('Email merchant sandbox').fill('merchant@example.test');
  await page.getByLabel('Kata sandi merchant sandbox').fill('wrong-password');
  await page.getByRole('button', { name: 'Hubungkan sandbox' }).click();
  await expect(page.getByRole('alert')).toContainText('Email atau password salah.');
  await expect(page.getByLabel('Kata sandi merchant sandbox')).toBeEmpty();
  await expect(page.getByText('Server belum terhubung')).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('wrong-password');
  await page.reload();
  await expect(page.getByText('Server belum terhubung')).toBeVisible();
});

test('developer settings fit a narrow screen without activating credentials', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/developers');
  for (const name of ['Ringkasan', 'Webhook & QRIS', 'Keamanan & kode']) {
    await page.getByRole('tab', { name }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('heading', { name: 'Verifikasi HMAC' })).toBeVisible();
});

test('landing product imagery loads and FAQ responds', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Setiap pembayaran');
  for (const image of await page.locator('.landing-v2 img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  const faq = page.getByRole('button', { name: 'Apakah webhook akan terkirim?' });
  await faq.click();
  await expect(faq).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Tidak. Konfigurasi webhook hanya disimpan lokal.')).toBeVisible();
  await page.getByRole('link', { name: /Jelajahi workspace/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('saved QRIS payload renders a scannable demo checkout QR with the order amount', async ({ page }) => {
  await page.goto('/dashboard/qris');
  await page.getByRole('button', { name: 'Isi contoh' }).click();
  const sample = await page.locator('.qris-tester textarea').first().inputValue();
  await page.locator('.qris-input-label textarea').fill(sample);
  await page.getByRole('button', { name: 'Simpan Konfigurasi QRIS' }).click();
  await expect(page.locator('.qris-card-list')).toContainText('Daftar QRIS (1)');
  await page.goto('/dashboard/transactions');
  await page.getByRole('button', { name: 'Buat Pembayaran' }).first().click();
  await page.getByRole('dialog').getByLabel('Order ID eksternal').fill('ORDER-QR-E2E');
  await page.getByRole('dialog').getByLabel('Nominal (minimal Rp 1.000)').fill('50000');
  await page.getByRole('button', { name: 'Buat sesi simulasi' }).click();
  await page.getByRole('button', { name: /Lihat DG-/ }).first().click();
  const href = await page.getByRole('link', { name: /Checkout/i }).first().getAttribute('href');
  await page.goto(href!);
  const img = page.locator('.qr-display img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.qr-display')).toContainText('Simulasi QRIS');
});

test('admin merchant drill-down and topup request stay local without crediting balance', async ({ page }) => {
  await page.goto('/dashboard/admin');
  const management = page.getByRole('region', { name: 'Manajemen merchant dan pengguna demo' });
  await expect(management.getByRole('button', { name: /Kopi Contoh/ })).toContainText('Contoh fiksi');
  await management.getByRole('button', { name: /Kopi Contoh/ }).click();
  await expect(management.getByLabel('Detail merchant demo')).toContainText('Data fiksi statis');
  await management.getByLabel('Cari merchant atau pengguna demo').fill('tidak-ada');
  await expect(management).toContainText('Tidak ada profil demo yang cocok');
  await management.getByLabel('Cari merchant atau pengguna demo').fill('DitsStore');
  await management.getByRole('button', { name: /DitsStore/ }).click();
  await expect(management.getByLabel('Detail merchant demo')).toContainText('SIGNUP_BONUS');
  const topup = page.getByRole('region', { name: 'Permintaan top up QRIS admin demo' });
  await expect(topup).toContainText('Setup required · QRIS admin tidak tersedia');
  await expect(topup.locator('img, canvas, svg.qr-code')).toHaveCount(0);
  await topup.getByLabel('Nominal permintaan (Rp)').fill('70000');
  await topup.getByRole('button', { name: 'Catat permintaan lokal' }).click();
  await expect(topup).toContainText('menunggu verifikasi bank; belum dibayar');
  await expect(page.locator('.balance')).toContainText('3.000');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Permintaan top up QRIS admin demo' })).toContainText('70.000');
  await expect(page.locator('.balance')).toContainText('3.000');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ditsgate_demo_v1') || '{}'));
  expect(saved.adminTopupRequests).toHaveLength(1);
  expect(saved.adminTopupRequests[0].status).toBe('setup_required');
  expect(saved.balance).toBe(3000);
  expect(saved.ledger).toHaveLength(1);
});

test('admin management and topup work on narrow mobile without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/admin');
  const management = page.getByRole('region', { name: 'Manajemen merchant dan pengguna demo' });
  await management.getByLabel('Cari merchant atau pengguna demo').fill('buku');
  await management.getByRole('button', { name: /Toko Buku Fiksi/ }).click();
  await expect(management.getByLabel('Detail merchant demo')).toContainText('Belum ada entri ledger contoh');
  const topup = page.getByRole('region', { name: 'Permintaan top up QRIS admin demo' });
  await topup.getByLabel('Nominal permintaan (Rp)').fill('25000');
  await topup.getByRole('button', { name: 'Catat permintaan lokal' }).click();
  await expect(topup).toContainText('25.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('heading', { name: 'Audit operasional' })).toBeVisible();
});

test('returning browser retains edits; simulated success finalizes only reserved fee', async ({ page }) => {
  await page.goto('/dashboard/admin');
  await page.evaluate(() => {
    const key = 'ditsgate_demo_v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved.merchant = { ...saved.merchant, name: 'Merchant Lokal Diubah' };
    saved.topups = [{ id: 'old-request', amount: 25000, createdAt: new Date().toISOString() }];
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  const management = page.getByRole('region', { name: 'Manajemen merchant dan pengguna demo' });
  await expect(management.getByRole('button', { name: /Merchant Lokal Diubah/ })).toBeVisible();
  await page.goto('/dashboard/transactions');
  await page.getByRole('button', { name: 'Buat Pembayaran' }).first().click();
  await page.getByRole('dialog').getByLabel('Order ID eksternal').fill('ORDER-FEE-FINAL');
  await page.getByRole('dialog').getByLabel('Nominal (minimal Rp 1.000)').fill('50000');
  await page.getByRole('button', { name: 'Buat sesi simulasi' }).click();
  await expect(page.locator('.balance')).toContainText('2.900');
  await page.goto('/dashboard/admin');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Simulasikan berhasil' }).click();
  await expect(page.locator('.balance')).toContainText('2.900');
  await expect(management.getByLabel('Detail merchant demo')).toContainText('BIAYA_FINAL');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ditsgate_demo_v1') || '{}'));
  expect(saved.topups).toHaveLength(1);
  expect(saved.topups[0].id).toBe('old-request');
  expect(saved.ledger.filter((e: { type: string }) => e.type === 'BIAYA_FINAL')).toHaveLength(1);
});

test('payment simulation reserves and refunds fee, checkout is labeled demo', async ({ page }) => {
  await page.goto('/dashboard/transactions');
  await page.getByRole('button', { name: 'Buat Pembayaran' }).first().click();
  await page.getByRole('dialog').getByLabel('Order ID eksternal').fill('ORDER-E2E-001');
  await page.getByRole('dialog').getByLabel('Nominal (minimal Rp 1.000)').fill('50000');
  await page.getByRole('button', { name: 'Buat sesi simulasi' }).click();
  await expect(page.getByText('ORDER-E2E-001')).toBeVisible();
  await expect(page.locator('.balance')).toContainText('2.900');
  await page.reload();
  await expect(page.getByText('ORDER-E2E-001')).toBeVisible();
  await page.getByRole('button', { name: /Lihat DG-/ }).first().click();
  const payLink = page.getByRole('link', { name: /Checkout/i }).first();
  await expect(payLink).toBeVisible();
  const href = await payLink.getAttribute('href');
  await page.goto(href!);
  await expect(page.getByText('CHECKOUT DEMO')).toBeVisible();
  await page.goto('/dashboard/admin');
  await page.getByRole('textbox', { name: 'Cari antrean admin' }).fill('ORDER-E2E-001');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Kedaluwarsa' }).click();
  await expect(page.locator('.balance')).toContainText('3.000');
  await expect(page.getByRole('row', { name: /ORDER-E2E-001/ })).toContainText('Kedaluwarsa');
  await page.goto(href!);
  await expect(page.getByText('Kedaluwarsa').first()).toBeVisible();
});
