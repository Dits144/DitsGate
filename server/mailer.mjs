/**
 * mailer.mjs — DitsGate email notification helper (Nodemailer)
 *
 * Configure via environment variables:
 *   DITSGATE_SMTP_HOST     e.g. smtp.gmail.com
 *   DITSGATE_SMTP_PORT     e.g. 465 (SSL) or 587 (TLS)
 *   DITSGATE_SMTP_SECURE   "true" for port 465, "false" for STARTTLS
 *   DITSGATE_SMTP_USER     sender email address
 *   DITSGATE_SMTP_PASS     app password / SMTP password
 *   DITSGATE_SMTP_FROM     optional "Name <addr>" override
 *
 * Falls back to no-op (logs warning) when not configured.
 */

import nodemailer from 'nodemailer';

const {
  DITSGATE_SMTP_HOST,
  DITSGATE_SMTP_PORT,
  DITSGATE_SMTP_SECURE,
  DITSGATE_SMTP_USER,
  DITSGATE_SMTP_PASS,
  DITSGATE_SMTP_FROM,
  DITSGATE_SITE_URL = 'https://www.prefixxx.web.id',
} = process.env;

function createTransport() {
  if (!DITSGATE_SMTP_HOST || !DITSGATE_SMTP_USER || !DITSGATE_SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: DITSGATE_SMTP_HOST,
    port: Number(DITSGATE_SMTP_PORT ?? 587),
    secure: DITSGATE_SMTP_SECURE === 'true',
    auth: { user: DITSGATE_SMTP_USER, pass: DITSGATE_SMTP_PASS },
  });
}

let _transport = null;
function transport() {
  if (!_transport) _transport = createTransport();
  return _transport;
}

const FROM = DITSGATE_SMTP_FROM || (DITSGATE_SMTP_USER ? `DitsGate <${DITSGATE_SMTP_USER}>` : 'DitsGate <noreply@ditsgate.id>');

/**
 * Send email. Returns true on success, false if not configured / failed.
 */
export async function sendMail({ to, subject, html, text }) {
  const t = transport();
  if (!t) {
    console.warn(`[mailer] SMTP tidak dikonfigurasi — email tidak dikirim ke ${to}: ${subject}`);
    return false;
  }
  try {
    await t.sendMail({ from: FROM, to, subject, html, text });
    console.log(`[mailer] Email terkirim ke ${to}: ${subject}`);
    return true;
  } catch (e) {
    console.error(`[mailer] Gagal kirim email ke ${to}:`, e.message);
    return false;
  }
}

/**
 * Notify merchant that their Shopee portal connection is broken and they must reconnect.
 */
export async function notifyPortalBroken({ to, name, lastError }) {
  const reconnectUrl = `${DITSGATE_SITE_URL}/dashboard/detectors/shopee`;
  const subject = '⚠️ Koneksi Shopee Portal DitsGate Terputus';
  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:#ee4d2d;padding:28px 32px;color:#fff}
  .header h1{margin:0;font-size:22px}
  .body{padding:28px 32px;color:#333;line-height:1.6}
  .body p{margin:0 0 16px}
  .alert{background:#fff4f2;border:1px solid #ee4d2d33;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:13px;color:#c0392b}
  .btn{display:inline-block;background:#ee4d2d;color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;margin:8px 0}
  .footer{background:#f5f5f5;padding:16px 32px;font-size:12px;color:#888;text-align:center}
  code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>⚠️ Koneksi Shopee Partner Terputus</h1>
    </div>
    <div class="body">
      <p>Halo <strong>${name || 'Merchant'}</strong>,</p>
      <p>Koneksi portal Shopee Partner kamu di DitsGate sudah <strong>tidak aktif</strong>. Listener tidak dapat membaca mutasi toko sampai kamu memperbarui token portal.</p>
      ${lastError ? `<div class="alert"><strong>Detail error:</strong> ${lastError}</div>` : ''}
      <p><strong>Langkah memperbarui token:</strong></p>
      <ol>
        <li>Buka <a href="https://partner.shopee.co.id" target="_blank">partner.shopee.co.id</a> dan login.</li>
        <li>Tekan <code>F12</code> → tab <strong>Network</strong> → filter <code>get-transaction-list</code>.</li>
        <li>Klik request → <strong>Payload</strong> → salin seluruh isi JSON response (atau salin nilai <code>data.metadata.token</code>).</li>
        <li>Tempel di halaman Shopee Partner DitsGate dan klik <strong>Hubungkan &amp; verifikasi</strong>.</li>
      </ol>
      <p style="text-align:center;margin-top:24px">
        <a class="btn" href="${reconnectUrl}">Perbarui Token Sekarang</a>
      </p>
      <p style="font-size:13px;color:#888">Butuh bantuan? Hubungi admin DitsGate di <a href="https://wa.me/6282120196167">WhatsApp</a>.</p>
    </div>
    <div class="footer">
      Email ini dikirim otomatis oleh DitsGate &bull; <a href="${DITSGATE_SITE_URL}">ditsgate.id</a>
    </div>
  </div>
</body>
</html>`;

  const text = `Halo ${name || 'Merchant'},\n\nKoneksi Shopee Partner DitsGate kamu terputus${lastError ? ` (${lastError})` : ''}.\n\nPerbarui token di: ${reconnectUrl}\n\nLangkah:\n1. Buka partner.shopee.co.id → F12 → Network → get-transaction-list → salin JSON\n2. Tempel di halaman Shopee Partner DitsGate → Hubungkan & verifikasi\n\nBantuan: https://wa.me/6282120196167\n\n— DitsGate`;

  return sendMail({ to, subject, html, text });
}

const lowBalanceCooldown = new Map();
const LOW_BALANCE_COOLDOWN_MS = 30 * 60_000;

/**
 * Notify user when a transaction request fails because Saldo Biaya is insufficient (< TX_FEE).
 * Rate-limited to once per 30 minutes per recipient email.
 */
export async function notifyLowBalance({ to, name, balance = 0, required = 100, orderId = '' }) {
  if (!to) return false;
  const lastSent = lowBalanceCooldown.get(to) || 0;
  if (Date.now() - lastSent < LOW_BALANCE_COOLDOWN_MS) return false;
  lowBalanceCooldown.set(to, Date.now());

  const topupUrl = `${DITSGATE_SITE_URL}/dashboard/topup`;
  const fmt = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
  const subject = '⚠️ Saldo Biaya DitsGate Habis — Transaksi Gagal Diproses';
  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:#dc2626;padding:26px 32px;color:#fff}
  .header h1{margin:0;font-size:20px}
  .body{padding:28px 32px;color:#333;line-height:1.6}
  .body p{margin:0 0 14px}
  .box{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin:16px 0;font-size:14px;color:#991b1b}
  .btn{display:inline-block;background:#2563eb;color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;margin:8px 0}
  .footer{background:#f5f5f5;padding:16px 32px;font-size:12px;color:#888;text-align:center}
</style></head>
<body>
  <div class="wrap">
    <div class="header"><h1>⚠️ Saldo Biaya DitsGate Tidak Mencukupi</h1></div>
    <div class="body">
      <p>Halo <strong>${name || 'Merchant'}</strong>,</p>
      <p>Permintaan pembuatan transaksi baru${orderId ? ` (Order ID: <code>${orderId}</code>)` : ''} <strong>gagal diproses</strong> karena saldo biaya Anda tidak mencukupi.</p>
      <div class="box">
        <div>Saldo saat ini: <strong>${fmt(balance)}</strong></div>
        <div>Minimal biaya per transaksi: <strong>${fmt(required)}</strong></div>
      </div>
      <p>Silakan lakukan Top Up saldo biaya agar API transaksi dapat kembali berjalan normal.</p>
      <p style="text-align:center;margin-top:22px"><a class="btn" href="${topupUrl}">Top Up Saldo Sekarang</a></p>
      <p style="font-size:13px;color:#888">Butuh bantuan? Hubungi admin di <a href="https://wa.me/6282120196167">WhatsApp</a>.</p>
    </div>
    <div class="footer">Email ini dikirim otomatis oleh DitsGate &bull; <a href="${DITSGATE_SITE_URL}">ditsgate.id</a></div>
  </div>
</body>
</html>`;
  const text = `Halo ${name || 'Merchant'},\n\nPermintaan transaksi baru${orderId ? ` (${orderId})` : ''} gagal karena Saldo Biaya DitsGate habis.\nSaldo saat ini: ${fmt(balance)} (minimal ${fmt(required)}).\n\nSilakan Top Up di: ${topupUrl}\n\n— DitsGate`;
  return sendMail({ to, subject, html, text });
}
