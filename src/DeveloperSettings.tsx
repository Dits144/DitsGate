import { useEffect, useRef, useState } from 'react';
import {
  API_ORIGIN,
  safeSandboxOrigin,
  sandboxRequest,
  type SandboxKey,
  type SandboxQris,
  type SandboxWebhook,
} from './developer-api';
import { getMerchantSession, useMerchantSession } from './merchant-session';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, RefreshCw } from 'lucide-react';
import type { DemoState } from './store';
import './developer-settings.css';

type Props = { s: DemoState; set: React.Dispatch<React.SetStateAction<DemoState>>; notify: (message: string) => void };
type ListenerInfo = { status: 'unconfigured' | 'awaiting_event' | 'receiving'; lastSeenAt: string | null };

const NODE_SNIPPET = `const crypto = require('crypto');
const express = require('express');
const app = express();

// express.raw() gives you the EXACT bytes signed. Any JSON body
// parser (express.json(), body-parser) destroys that serialisation.
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-qrisgate-signature'];
  const timestamp = req.headers['x-qrisgate-timestamp'];
  const secret = process.env.DITSGATE_WEBHOOK_SECRET;

  // 1. Replay window — reject anything signed more than 5 minutes ago.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return res.status(401).send('Stale timestamp');
  }

  // 2. HMAC over the RAW body — never over a re-serialised object.
  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + req.body)
    .digest('hex');

  // 3. Constant-time comparison, after a length check.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signature).replace(/^sha256=/, ''), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('Invalid signature');
  }

  // 4. The payload is FLAT. There is no \`data\` wrapper.
  const { event, external_order_id, total_amount } = JSON.parse(req.body.toString('utf8'));
  if (event === 'payment.paid') {
    // ... mark order external_order_id as paid for total_amount
  }
  res.json({ received: true });
});`;

const PHP_SNIPPET = `<?php
// php://input is the raw byte stream — do NOT read $_POST or json_decode
// before verifying, or the signature will not match.
$rawBody   = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_QRISGATE_TIMESTAMP'] ?? '';
$signature = $_SERVER['HTTP_X_QRISGATE_SIGNATURE'] ?? '';
$secret    = getenv('DITSGATE_WEBHOOK_SECRET');

// 1. Replay window — reject anything signed more than 5 minutes ago.
if (abs(time() - (int) $timestamp) > 300) {
    http_response_code(401);
    exit('Stale timestamp');
}

// 2. HMAC over the RAW body. 3. hash_equals() is constant-time.
$expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
if (!hash_equals($expected, (string) $signature)) {
    http_response_code(401);
    exit('Invalid signature');
}

// 4. The payload is FLAT. There is no \`data\` wrapper.
$payload = json_decode($rawBody, true);
if (($payload['event'] ?? '') === 'payment.paid') {
    $externalOrderId = $payload['external_order_id'];
    $totalAmount     = $payload['total_amount'];
    // ... mark your order as paid here
}
echo json_encode(['received' => true]);`;

function validHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export default function DeveloperSettings({ notify }: Props) {
  const nav = useNavigate();
  const session = useMerchantSession();
  const token = session?.token || '';
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');
  const [keys, setKeys] = useState<SandboxKey[]>([]);
  const [webhook, setWebhook] = useState<SandboxWebhook | null>(null);
  const [qris, setServerQris] = useState<SandboxQris[]>([]);
  const [listener, setListener] = useState<ListenerInfo | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [editing, setEditing] = useState<Record<string, { name: string; webhookUrl: string; qrisId: string }>>({});
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showSecretText, setShowSecretText] = useState(false);
  const [revealKeyModal, setRevealKeyModal] = useState<{ kind: string; value: string } | null>(null);
  const secretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (secretTimer.current) clearTimeout(secretTimer.current);
      if (keyTimer.current) clearTimeout(keyTimer.current);
    },
    [],
  );

  const originError = (() => {
    try {
      safeSandboxOrigin(API_ORIGIN);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  })();

  function showSecretOnce(secret: string) {
    if (secretTimer.current) clearTimeout(secretTimer.current);
    setRevealedSecret(secret);
    setShowSecretText(true);
    secretTimer.current = setTimeout(() => {
      if (mounted.current) {
        setShowSecretText(false);
        setRevealedSecret(null);
      }
    }, 60000);
  }

  function showKeyOnce(kind: string, value: string) {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    setRevealKeyModal({ kind, value });
    keyTimer.current = setTimeout(() => {
      if (mounted.current) setRevealKeyModal(null);
    }, 60000);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setApiError('');
    try {
      await action();
    } catch (e) {
      setApiError(
        e instanceof TypeError ? 'Server API tidak tersedia atau CORS menolak origin ini.' : (e as Error).message,
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function load(activeSession: string) {
    const [k, w, q, l] = await Promise.all([
      sandboxRequest<{ data: SandboxKey[] }>(API_ORIGIN, '/api/v1/api-keys', 'GET', activeSession),
      sandboxRequest<{ data: SandboxWebhook }>(API_ORIGIN, '/api/v1/webhook-settings', 'GET', activeSession),
      sandboxRequest<{ data: SandboxQris[] }>(API_ORIGIN, '/api/v1/qris', 'GET', activeSession),
      sandboxRequest<{ data: ListenerInfo }>(API_ORIGIN, '/api/v1/shopee-listener', 'GET', activeSession).catch(() => ({
        data: { status: 'unconfigured' as const, lastSeenAt: null },
      })),
    ]);
    if (!mounted.current || getMerchantSession()?.token !== activeSession) return;
    setKeys(k.data);
    setWebhook(w.data);
    setServerUrl(w.data.url || '');
    setServerQris(q.data);
    setListener(l.data);
    setEditing(
      Object.fromEntries(
        k.data.map((row) => [row.id, { name: row.name, webhookUrl: row.webhookUrl || '', qrisId: row.qrisId || '' }]),
      ),
    );
  }

  useEffect(() => {
    if (!token) {
      setKeys([]);
      setWebhook(null);
      setServerQris([]);
      setListener(null);
      setRevealedSecret(null);
      setShowSecretText(false);
      setRevealKeyModal(null);
      return;
    }
    let cancelled = false;
    void load(token).catch((e) => {
      if (!cancelled) setApiError((e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    void run(async () => {
      const result = await sandboxRequest<{ data: SandboxKey; key: string }>(
        API_ORIGIN,
        '/api/v1/api-keys',
        'POST',
        token,
        { name: keyName.trim() },
      );
      setKeyName('');
      setShowNewKeyForm(false);
      setKeys((v) => [result.data, ...v]);
      setEditing((v) => ({ ...v, [result.data.id]: { name: result.data.name, webhookUrl: '', qrisId: '' } }));
      showKeyOnce('API Key Baru', result.key);
    });
  }

  function saveKey(row: SandboxKey) {
    const fields = editing[row.id];
    if (!fields) return;
    void run(async () => {
      if (fields.webhookUrl.trim() && !validHttps(fields.webhookUrl.trim())) {
        throw new Error('Gunakan URL HTTPS valid tanpa kredensial atau fragment (#).');
      }
      const result = await sandboxRequest<{ data: SandboxKey }>(
        API_ORIGIN,
        `/api/v1/api-keys/${encodeURIComponent(row.id)}`,
        'PATCH',
        token,
        {
          name: fields.name.trim() || row.name,
          webhookUrl: fields.webhookUrl.trim() || null,
          qrisId: fields.qrisId || null,
        },
      );
      setKeys((v) => v.map((k) => (k.id === row.id ? result.data : k)));
      notify('Pengaturan key tersimpan.');
    });
  }

  function revoke(row: SandboxKey) {
    if (!window.confirm(`Cabut API key ${row.name}? Tindakan ini tidak dapat dibatalkan.`)) return;
    void run(async () => {
      await sandboxRequest(API_ORIGIN, `/api/v1/api-keys/${encodeURIComponent(row.id)}`, 'DELETE', token);
      setKeys((v) => v.map((k) => (k.id === row.id ? { ...k, revokedAt: new Date().toISOString() } : k)));
      notify('API key dicabut.');
    });
  }

  function saveServer(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (serverUrl.trim() && !validHttps(serverUrl.trim())) {
        throw new Error('Gunakan URL HTTPS valid tanpa kredensial atau fragment (#).');
      }
      const result = await sandboxRequest<{ data: SandboxWebhook }>(
        API_ORIGIN,
        '/api/v1/webhook-settings',
        'PATCH',
        token,
        { url: serverUrl.trim() || null },
      );
      setWebhook(result.data);
      setServerUrl(result.data.url || '');
      notify('Webhook Destination URL tersimpan.');
    });
  }

  function rotate() {
    if (!window.confirm('Roll secret baru? Secret lama tidak dapat digunakan atau dilihat lagi.')) return;
    void run(async () => {
      const result = await sandboxRequest<{ data: SandboxWebhook; secret: string }>(
        API_ORIGIN,
        '/api/v1/webhook-settings/rotate-secret',
        'POST',
        token,
        {},
      );
      setWebhook(result.data);
      showSecretOnce(result.secret);
      notify('Secret baru dibuat dan tampil selama 60 detik.');
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} disalin.`);
    } catch {
      notify('Clipboard tidak tersedia.');
    }
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);

  return (
    <div className="dev-page">
      <div className="dev-header">
        <div>
          <h1>API &amp; Webhook</h1>
          <p>Kunci server &amp; endpoint</p>
        </div>
        <button
          type="button"
          className="dev-secondary"
          disabled={busy}
          onClick={() => {
            if (!token) {
              nav('/login');
              return;
            }
            void run(() => load(token).then(() => notify('Data diperbarui')));
          }}
        >
          <RefreshCw size={14} /> Segarkan
        </button>
      </div>

      {originError && (
        <p role="alert" className="dev-error">
          {originError}
        </p>
      )}
      {apiError && (
        <p role="alert" className="dev-error">
          {apiError}
        </p>
      )}

      <div className="dev-grid">
        {/* Section 1: API Keys (REST API) */}
        <section className="dev-panel dev-wide" aria-label="API Keys (REST API)">
          <div className="dev-panel-top">
            <div>
              <h2>API Keys (REST API)</h2>
              <p>
                Gunakan kunci ini untuk otentikasi di header <code>Authorization: Bearer dg_test_...</code>
              </p>
            </div>
            <button
              type="button"
              className="dev-primary"
              disabled={busy}
              onClick={() => {
                if (!token) {
                  notify('Silakan masuk ke akun merchant terlebih dahulu.');
                  nav('/login');
                  return;
                }
                setShowNewKeyForm((v) => !v);
              }}
            >
              Generate API Key Baru
            </button>
          </div>

          {token && showNewKeyForm && (
            <form onSubmit={generate} className="dev-connect-form">
              <label>
                Nama Key
                <input
                  required
                  maxLength={100}
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Contoh: Live Key 1"
                />
              </label>
              <button type="submit" className="dev-primary" disabled={busy}>
                Buat Key
              </button>
              <button type="button" className="dev-secondary" onClick={() => setShowNewKeyForm(false)}>
                Batal
              </button>
            </form>
          )}

          <div className="table-wrap" style={{ marginTop: '14px' }}>
            <table>
              <thead>
                <tr>
                  <th>Nama Key</th>
                  <th>Key Prefix</th>
                  <th>Device Token (Listener App)</th>
                  <th>Terakhir Dipakai</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!token ? (
                  <tr>
                    <td colSpan={5}>Masuk ke akun merchant untuk melihat atau membuat API key.</td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Belum ada API key. Klik Generate API Key Baru untuk membuat.</td>
                  </tr>
                ) : (
                  keys.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <b>{row.name}</b>
                      </td>
                      <td>
                        <code>{row.prefix}...</code>
                      </td>
                      <td>
                        {listener?.status === 'receiving' || listener?.status === 'awaiting_event' ? (
                          <span>
                            <code>dt_••••••</code> · <strong>Terhubung</strong>
                          </span>
                        ) : (
                          <Link to="/dashboard/detectors/listener">Belum dipasangkan</Link>
                        )}
                      </td>
                      <td>{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString('id-ID') : 'Belum pernah'}</td>
                      <td>
                        {row.revokedAt ? (
                          <span className="dev-tag">Dicabut</span>
                        ) : (
                          <button type="button" className="dev-secondary" disabled={busy} onClick={() => revoke(row)}>
                            Cabut
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 2: Webhook & QRIS per Situs (API Key) */}
        <section className="dev-panel dev-wide" aria-label="Webhook & QRIS per Situs (API Key)">
          <h2>Webhook &amp; QRIS per Situs (API Key)</h2>
          <p>
            Setiap key bisa punya endpoint dan kartu QRIS sendiri. Order yang dibuat dengan key ini dikirim ke URL-nya
            dan dibayar ke QRIS pilihannya; jika dikosongkan, keduanya mengikuti pengaturan akun. Signature dan secret
            webhook tetap satu.
          </p>

          {!token ? (
            <p>Masuk ke akun merchant untuk mengatur webhook &amp; QRIS per API key.</p>
          ) : activeKeys.length === 0 ? (
            <p>Belum ada API key aktif.</p>
          ) : (
            activeKeys.map((row) => (
              <div key={row.id} className="dev-key-row">
                <div className="dev-panel-top">
                  <div>
                    <b>{row.name}</b> · <code>{row.prefix}...</code>
                  </div>
                  <small>30 hari: 0 order · 0 lunas · Rp 0</small>
                </div>
                <div className="dev-connect-form" style={{ margin: '6px 0' }}>
                  <label>
                    Webhook URL untuk {row.name}
                    <input
                      type="url"
                      value={editing[row.id]?.webhookUrl ?? ''}
                      onChange={(e) =>
                        setEditing((v) => ({
                          ...v,
                          [row.id]: { ...v[row.id], webhookUrl: e.target.value },
                        }))
                      }
                      placeholder="https://situs-anda.com/api/webhooks/qrisgate"
                    />
                  </label>
                  <button type="button" className="dev-primary" disabled={busy} onClick={() => saveKey(row)}>
                    Simpan
                  </button>
                </div>
                <small>{row.webhookUrl ? `URL khusus: ${row.webhookUrl}` : 'Memakai Webhook URL akun.'}</small>
                <label style={{ marginTop: '6px', maxWidth: '420px' }}>
                  QRIS untuk situs ini
                  <select
                    value={editing[row.id]?.qrisId ?? ''}
                    onChange={(e) =>
                      setEditing((v) => ({
                        ...v,
                        [row.id]: { ...v[row.id], qrisId: e.target.value },
                      }))
                    }
                  >
                    <option value="">Ikuti QRIS utama akun</option>
                    {qris.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  {row.qrisId ? 'Memakai QRIS khusus key ini.' : 'Order tanpa qris_id dari situs ini memakai QRIS utama akun.'}
                </small>
              </div>
            ))
          )}
        </section>

        {/* Section 3: Konfigurasi Webhook URL & Signature Secret */}
        <section className="dev-panel dev-wide" aria-label="Konfigurasi Webhook URL & Signature Secret">
          <h2>Konfigurasi Webhook URL &amp; Signature Secret</h2>
          <p>
            DitsGate akan mengirimkan HTTP POST event <code>payment.paid</code> yang ditandatangani menggunakan
            HMAC-SHA256 ke endpoint merchant.
          </p>

          <form onSubmit={saveServer} className="dev-form">
            <label htmlFor="dev-server-url">Webhook Destination URL:</label>
            <div className="dev-connect-form" style={{ margin: '4px 0 8px' }}>
              <input
                id="dev-server-url"
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={!token}
                placeholder="https://tokoanda.com/api/webhooks/qrisgate"
              />
              <button type="submit" className="dev-primary" disabled={!token || busy}>
                Simpan URL
              </button>
              <button
                type="button"
                className="dev-secondary"
                disabled={!token || !webhook?.url}
                onClick={() => notify('Ping endpoint membutuhkan pengiriman webhook aktif di server.')}
              >
                Tes Webhook Ping
              </button>
            </div>
          </form>

          <div className="dev-server-form" style={{ marginTop: '14px' }}>
            <label htmlFor="dev-webhook-secret-display" style={{ fontSize: '11px', fontWeight: 700 }}>
              Webhook Secret (HMAC-SHA256):
            </label>
            <div className="dev-connect-form" style={{ margin: '8px 0' }}>
              <input
                id="dev-webhook-secret-display"
                aria-label="Webhook secret"
                readOnly
                value={
                  showSecretText && revealedSecret
                    ? revealedSecret
                    : webhook?.secretConfigured
                      ? 'whsec_••••••••'
                      : 'Belum dikonfigurasi'
                }
                style={{ maxWidth: '340px' }}
              />
              <button
                type="button"
                className="dev-secondary"
                disabled={!revealedSecret}
                onClick={() => setShowSecretText((v) => !v)}
              >
                {showSecretText ? 'Sembunyikan' : 'Tampilkan'}
              </button>
              <button
                type="button"
                className="dev-secondary"
                disabled={!revealedSecret}
                onClick={() => revealedSecret && void copyText(revealedSecret, 'Webhook secret')}
              >
                Salin
              </button>
              <button type="button" className="dev-secondary" disabled={!token || busy} onClick={rotate}>
                Roll Secret Baru
              </button>
            </div>
            <small style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Secret tidak dikirim ke browser sampai Anda menekan Tampilkan (atau Roll Secret Baru), dan hilang sendiri
              60 detik setelah ditampilkan.
            </small>
          </div>

          <div className="dev-server-form" style={{ marginTop: '22px' }}>
            <h2>Contoh Kode Verifikasi Signature (Node.js &amp; PHP)</h2>
            <p>
              DitsGate menandatangani byte mentah body (<code>timestamp + "." + rawBody</code>). Gunakan raw body, bukan
              hasil <code>JSON.stringify(req.body)</code> — serialisasi ulang mengubah urutan key dan signature tidak
              akan cocok.
            </p>

            <div style={{ marginTop: '14px' }}>
              <div className="dev-code-head">
                <strong>Node.js (Express)</strong>
                <button type="button" className="dev-secondary" onClick={() => void copyText(NODE_SNIPPET, 'Kode Node.js')}>
                  <Copy size={14} /> Salin
                </button>
              </div>
              <pre className="dev-code" style={{ marginTop: '8px' }}>
                <code>{NODE_SNIPPET}</code>
              </pre>
            </div>

            <div style={{ marginTop: '16px' }}>
              <div className="dev-code-head">
                <strong>PHP (Native / Laravel)</strong>
                <button type="button" className="dev-secondary" onClick={() => void copyText(PHP_SNIPPET, 'Kode PHP')}>
                  <Copy size={14} /> Salin
                </button>
              </div>
              <pre className="dev-code" style={{ marginTop: '8px' }}>
                <code>{PHP_SNIPPET}</code>
              </pre>
            </div>
          </div>
        </section>
      </div>

      {revealKeyModal && (
        <div className="dev-secret-overlay">
          <div className="dev-secret-modal" role="dialog" aria-modal="true" aria-label={`${revealKeyModal.kind} sekali tampil`}>
            <h2>{revealKeyModal.kind} · sekali tampil</h2>
            <p>
              Salin sekarang ke penyimpanan aman di luar browser. Tampilan hilang dalam 60 detik atau saat keluar; tidak
              dapat ditampilkan ulang.
            </p>
            <code>{revealKeyModal.value}</code>
            <div className="dev-actions">
              <button
                type="button"
                className="dev-primary"
                onClick={() => void copyText(revealKeyModal.value, revealKeyModal.kind)}
              >
                <Copy size={14} /> Salin
              </button>
              <button type="button" className="dev-secondary" onClick={() => setRevealKeyModal(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
