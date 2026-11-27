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
export async function notifyPortalBroken({ to, name, lastError, lastCheckedAt }) {
  const reconnectUrl = `${DITSGATE_SITE_URL}/dashboard/detectors/shopee`;
  const lastTimeStr = lastCheckedAt
    ? `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(lastCheckedAt))} WIB`
    : 'Baru saja';
  const subject = 'Sesi Shopee Partner berakhir — DitsGate';
  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f6f9;margin:0;padding:24px 12px;color:#18243a}
  .wrap{max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(15,23,42,.06)}
  .header{padding:24px 32px;border-bottom:1px solid #eef2f6}
  .brand{font-size:20px;font-weight:800;color:#2457ce;letter-spacing:-0.02em;margin:0}
  .tagline{font-size:12px;color:#64748b;margin:4px 0 0}
  .body{padding:28px 32px;line-height:1.65;font-size:14px;color:#334155}
  .body h1{font-size:20px;color:#0f172a;margin:0 0 16px;letter-spacing:-0.015em}
  .body p{margin:0 0 14px}
  .meta-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin:18px 0}
  .meta-row{padding:6px 0;border-bottom:1px solid #eef2f6}
  .meta-row:last-child{border-bottom:0}
  .meta-label{display:block;font-size:12px;color:#64748b}
  .meta-val{display:block;font-size:14px;font-weight:600;color:#0f172a;margin-top:2px}
  .meta-val.warn{color:#b91c1c}
  .steps{padding-left:18px;margin:8px 0 20px}
  .steps li{margin-bottom:6px}
  .btn-wrap{margin:22px 0}
  .btn{display:inline-block;background:#2457ce;color:#ffffff!important;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px}
  .note{font-size:13px;color:#475569;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin:18px 0}
  .privacy{font-size:12px;color:#64748b;margin-top:16px}
  .footer{background:#f8fafc;padding:18px 32px;font-size:12px;color:#64748b;border-top:1px solid #eef2f6}
  .footer a{color:#2457ce;text-decoration:none;font-weight:600}
</style></head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">DitsGate</div>
      <div class="tagline">QRIS Payment Gateway untuk Bisnis Indonesia</div>
    </div>
    <div class="body">
      <h1>Sesi Shopee Partner berakhir</h1>
      <p>Halo <strong>${name || 'Merchant'}</strong>,</p>
      <p>Server kami tidak lagi bisa membaca transaksi QRIS dari akun Shopee Partner Anda. Provider menolak sesi yang tersimpan, jadi pembayaran yang masuk ke akun itu belum dikenali otomatis sampai akun dihubungkan ulang.</p>
      <div class="meta-box">
        <div class="meta-row"><span class="meta-label">Akun</span><span class="meta-val">Shopee Partner</span></div>
        <div class="meta-row"><span class="meta-label">Status koneksi</span><span class="meta-val warn">berakhir, perlu dihubungkan ulang</span></div>
        <div class="meta-row"><span class="meta-label">Pembacaan berhasil terakhir</span><span class="meta-val">${lastTimeStr}</span></div>
        ${lastError ? `<div class="meta-row"><span class="meta-label">Diagnostik</span><span class="meta-val">${lastError}</span></div>` : ''}
      </div>
      <p><strong>Cara menyambungkan ulang:</strong></p>
      <ol class="steps">
        <li>Buka dashboard, lalu tab <strong>Detektor Pembayaran</strong> dan pilih <strong>Shopee Partner</strong>.</li>
        <li>Klik <strong>Hubungkan &amp; verifikasi</strong> dengan token / JSON <code>get-transaction-list</code> terbaru.</li>
        <li>Chip status berubah menjadi <strong>Terhubung</strong> setelah server berhasil membaca transaksi lagi.</li>
      </ol>
      <div class="btn-wrap">
        <a class="btn" href="${reconnectUrl}">Hubungkan Ulang</a>
      </div>
      <div class="note">
        Selama akun belum tersambung, aplikasi <strong>DitsGate Listener</strong> di HP kasir tetap mendeteksi pembayaran dari notifikasi bank atau e-wallet. Tanpa salah satunya, pembayaran ke QRIS statis tidak tercatat otomatis.
      </div>
      <p class="privacy">Password dan OTP Anda tidak pernah kami simpan. Sesi hanya dipakai untuk membaca daftar transaksi akun Anda sendiri.</p>
    </div>
    <div class="footer">
      E-mail ini dikirim otomatis oleh DitsGate. Jangan balas e-mail ini.<br/>
      <a href="${DITSGATE_SITE_URL}">${DITSGATE_SITE_URL.replace(/^https?:\/\//, '')}</a>
    </div>
  </div>
</body>
</html>`;

  const text = `DitsGate — QRIS Payment Gateway untuk Bisnis Indonesia\n\nSesi Shopee Partner berakhir\n\nHalo ${name || 'Merchant'},\nServer kami tidak lagi bisa membaca transaksi QRIS dari akun Shopee Partner Anda. Provider menolak sesi yang tersimpan, jadi pembayaran yang masuk ke akun itu belum dikenali otomatis sampai akun dihubungkan ulang.\n\nAkun: Shopee Partner\nStatus koneksi: berakhir, perlu dihubungkan ulang\nPembacaan berhasil terakhir: ${lastTimeStr}${lastError ? `\nDiagnostik: ${lastError}` : ''}\n\nCara menyambungkan ulang:\n1. Buka dashboard, lalu tab Detektor Pembayaran dan pilih Shopee Partner.\n2. Klik Hubungkan & verifikasi dengan token / JSON get-transaction-list terbaru.\n3. Chip status berubah menjadi Terhubung setelah server berhasil membaca transaksi lagi.\n\nHubungkan Ulang: ${reconnectUrl}\n\nSelama akun belum tersambung, aplikasi DitsGate Listener di HP kasir tetap mendeteksi pembayaran dari notifikasi bank atau e-wallet.\nPassword dan OTP Anda tidak pernah kami simpan.\n\nE-mail ini dikirim otomatis oleh DitsGate.`;

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
