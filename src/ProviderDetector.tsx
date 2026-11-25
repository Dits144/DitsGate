import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BellRing, Copy, KeyRound, Radio, ShieldAlert, Smartphone } from 'lucide-react';
import { API_ORIGIN, sandboxRequest } from './developer-api';
import {
  getMerchantSession,
  registerMerchant as createMerchant,
  signInMerchant,
  useMerchantSession,
} from './merchant-session';
import './shopee-partner.css';

export type DetectorProviderId = 'gopay' | 'bca' | 'linkaja' | 'bri' | 'mandiri' | 'listener';

type ListenerState = {
  status: 'unconfigured' | 'awaiting_event' | 'receiving';
  providerConnected: false;
  source: 'android_listener';
  lastSeenAt: string | null;
  createdAt: string | null;
};

type ListenerEvent = {
  id: string;
  eventId: string | null;
  sourceApp?: string;
  title?: string;
  amount: number | null;
  receivedAt: string;
  verification: 'unverified_listener_signal';
};

type ProviderMeta = {
  name: string;
  eyebrow: string;
  packageHint: string;
  keywords: string[];
  desc: string;
  portalNote: string;
};

const PROVIDER_META: Record<DetectorProviderId, ProviderMeta> = {
  gopay: {
    name: 'GoPay Merchant',
    eyebrow: 'DETEKTOR QRIS · GOPAY MERCHANT',
    packageHint: 'com.gojek.gopaymerchant',
    keywords: ['gopay', 'gojek'],
    desc: 'Deteksi sinyal pembayaran QRIS dari aplikasi GoPay Merchant melalui Android Notification Listener ke backend lokal DitsGate.',
    portalNote:
      'Portal web GoPay Merchant (GoBiz) tidak memiliki endpoint token baca-saja publik di sandbox ini. Gunakan Android Listener dengan package com.gojek.gopaymerchant untuk meneruskan sinyal mutasi.',
  },
  bca: {
    name: 'BCA Merchant',
    eyebrow: 'DETEKTOR QRIS · BCA MERCHANT',
    packageHint: 'com.bca.merchant',
    keywords: ['bca'],
    desc: 'Deteksi sinyal pembayaran QRIS dari aplikasi BCA Merchant melalui Android Notification Listener ke backend lokal DitsGate.',
    portalNote:
      'API/portal web BCA Merchant belum terhubung langsung di sandbox ini. Gunakan Android Listener pada perangkat kasir untuk meneruskan notifikasi transaksi masuk.',
  },
  linkaja: {
    name: 'LinkAja Merchant',
    eyebrow: 'DETEKTOR QRIS · LINKAJA MERCHANT',
    packageHint: 'com.telkom.mwallet',
    keywords: ['linkaja', 'mwallet'],
    desc: 'Deteksi sinyal pembayaran QRIS dari aplikasi LinkAja Merchant melalui Android Notification Listener ke backend lokal DitsGate.',
    portalNote:
      'Portal web LinkAja Merchant belum terhubung langsung di sandbox ini. Gunakan Android Listener untuk meneruskan notifikasi pembayaran masuk ke backend lokal.',
  },
  bri: {
    name: 'BRI Merchant',
    eyebrow: 'DETEKTOR QRIS · PORTAL BRI MERCHANT',
    packageHint: 'id.co.bri.brimola',
    keywords: ['bri', 'brimola', 'brimo'],
    desc: 'Deteksi sinyal pembayaran QRIS dari aplikasi BRI Merchant / BRImo melalui Android Notification Listener ke backend lokal DitsGate.',
    portalNote:
      'Portal brimerchant.bri.co.id belum terhubung langsung di sandbox ini. Gunakan Android Listener untuk meneruskan notifikasi pembayaran masuk ke backend lokal.',
  },
  mandiri: {
    name: 'Mandiri',
    eyebrow: "DETEKTOR QRIS · LIVIN' USAHA (MANDIRI)",
    packageHint: 'id.co.bankmandiri.livinmerchant',
    keywords: ['mandiri', 'livin'],
    desc: "Deteksi sinyal pembayaran QRIS dari aplikasi Livin' Usaha (Mandiri) melalui Android Notification Listener ke backend lokal DitsGate.",
    portalNote:
      'Portal qris.bankmandiri.co.id belum terhubung langsung di sandbox ini. Gunakan Android Listener untuk meneruskan notifikasi pembayaran masuk ke backend lokal.',
  },
  listener: {
    name: 'Aplikasi Listener',
    eyebrow: 'DANA, BRI, BNI, MANDIRI · ANDROID LISTENER',
    packageHint: 'com.gojek.gopaymerchant',
    keywords: [],
    desc: 'Panduan Setup Notifikasi HP Android (Otomatis) — pasang aplikasi listener di HP toko untuk mendeteksi pembayaran masuk secara real-time.',
    portalNote:
      'Endpoint ingest: POST /api/v1/mutations/ingest dengan header X-Device-Token: dt_... (token hanya ditampilkan sekali saat pemasangan).',
  },
};

const formatError = (e: unknown) =>
  e instanceof TypeError
    ? 'Server tidak tersedia atau CORS menolak permintaan. Periksa URL API.'
    : e instanceof Error
      ? e.message
      : 'Permintaan gagal.';

function matchesProvider(signal: ListenerEvent, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = `${signal.sourceApp ?? ''} ${signal.title ?? ''}`.toLowerCase();
  return keywords.some((kw) => hay.includes(kw));
}

export default function ProviderDetector({ id }: { id: DetectorProviderId }) {
  const meta = PROVIDER_META[id];
  const sharedSession = useMerchantSession();
  const token = sharedSession?.token || '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMerchant, setRegisterMerchant] = useState(false);
  const [merchantName, setMerchantName] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const [listener, setListener] = useState<ListenerState | null>(null);
  const [signals, setSignals] = useState<ListenerEvent[]>([]);
  const [deviceToken, setDeviceToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAllSignals, setShowAllSignals] = useState(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setListener(null);
      setSignals([]);
      setDeviceToken('');
      setError('');
      return;
    }
    let cancelled = false;
    void Promise.all([
      sandboxRequest<{ data: ListenerState }>(API_ORIGIN, '/api/v1/shopee-listener', 'GET', token),
      sandboxRequest<{ data: ListenerEvent[] }>(API_ORIGIN, '/api/v1/shopee-listener/events', 'GET', token),
    ])
      .then(([state, history]) => {
        if (cancelled || getMerchantSession()?.token !== token) return;
        setListener(state.data);
        setSignals(history.data);
      })
      .catch((cause) => {
        if (!cancelled && getMerchantSession()?.token === token) setError(formatError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      if (registerMerchant) await createMerchant(merchantName, email, password);
      else await signInMerchant(email, password);
    } catch (cause) {
      setAuthError(
        !registerMerchant && cause instanceof Error && cause.message === 'Email atau password salah.'
          ? 'Akun merchant belum terdaftar di API lokal atau kata sandi salah. Daftar lewat tombol di bawah.'
          : formatError(cause),
      );
    } finally {
      setPassword('');
      setAuthBusy(false);
    }
  }

  async function refreshListener() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const [state, history] = await Promise.all([
        sandboxRequest<{ data: ListenerState }>(API_ORIGIN, '/api/v1/shopee-listener', 'GET', token),
        sandboxRequest<{ data: ListenerEvent[] }>(API_ORIGIN, '/api/v1/shopee-listener/events', 'GET', token),
      ]);
      if (active.current) {
        setListener(state.data);
        setSignals(history.data);
      }
    } catch (cause) {
      if (active.current) setError(formatError(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function pairListener() {
    if (!token || listener?.status !== 'unconfigured') return;
    setBusy(true);
    setError('');
    try {
      const result = await sandboxRequest<{ data: ListenerState; token: string }>(
        API_ORIGIN,
        '/api/v1/shopee-listener',
        'POST',
        token,
        {},
      );
      if (active.current) {
        setListener(result.data);
        setDeviceToken(result.token);
      }
    } catch (cause) {
      if (active.current) setError(formatError(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function revokeListener() {
    if (
      !token ||
      !window.confirm('Cabut token perangkat ini? Aplikasi Android harus dipasangkan ulang agar bisa mengirim notifikasi.')
    )
      return;
    setBusy(true);
    setError('');
    try {
      await sandboxRequest(API_ORIGIN, '/api/v1/shopee-listener', 'DELETE', token);
      if (active.current) {
        setListener({
          status: 'unconfigured',
          providerConnected: false,
          source: 'android_listener',
          lastSeenAt: null,
          createdAt: null,
        });
        setDeviceToken('');
      }
    } catch (cause) {
      if (active.current) setError(formatError(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function copyToken() {
    if (!deviceToken) return;
    try {
      await navigator.clipboard.writeText(deviceToken);
    } catch {
      // Clipboard may be unavailable in non-HTTPS contexts.
    }
  }

  const filteredSignals = showAllSignals ? signals : signals.filter((s) => matchesProvider(s, meta.keywords));

  return (
    <div className="shopee-page">
      <Link to="/dashboard/detectors" className="back-link">
        <ArrowLeft size={16} /> Semua detektor
      </Link>
      <header className="shopee-heading">
        <span className="shopee-eyebrow">
          <Radio size={15} /> {meta.eyebrow}
        </span>
        <h1>{meta.name}</h1>
        <p>{meta.desc}</p>
      </header>

      <div className="shopee-status" role="status">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <strong>
            {!token
              ? 'Masuk ke akun merchant dahulu'
              : listener?.status === 'receiving'
                ? 'Listener aktif · sinyal diterima'
                : listener?.status === 'awaiting_event'
                  ? 'Listener terpasang · menunggu notifikasi'
                  : 'Listener belum dipasangkan'}
          </strong>
          <span>
            {listener?.lastSeenAt
              ? `Terakhir menerima sinyal: ${new Date(listener.lastSeenAt).toLocaleString('id-ID')}. Sinyal notifikasi bukan bukti settlement.`
              : meta.portalNote}
          </span>
        </div>
      </div>

      <div className="shopee-layout">
        <main className="shopee-main">
          <section className="card shopee-portal-option" aria-labelledby="provider-listener-title">
            <span className="shopee-kicker">DETEKSI REAL-TIME · ANDROID LISTENER</span>
            <h2 id="provider-listener-title">Pasangkan perangkat untuk {meta.name}</h2>
            <p>
              Satu token perangkat (<code>dt_…</code>) digunakan bersama oleh aplikasi <code>android-listener</code> pada
              perangkat Android Anda untuk meneruskan notifikasi ke <code>POST /api/v1/mutations/ingest</code>.
            </p>
            <p data-testid="listener-state" role="status">
              <strong>
                {!token
                  ? 'Masuk untuk melihat status listener'
                  : listener?.status === 'receiving'
                    ? 'Sinyal diterima'
                    : listener?.status === 'awaiting_event'
                      ? 'Menunggu notifikasi'
                      : 'Perangkat belum dipasangkan'}
              </strong>
              {listener?.lastSeenAt ? ` · terakhir ${new Date(listener.lastSeenAt).toLocaleString('id-ID')}` : ''}
            </p>

            {token && (
              <div className="shopee-portal-actions">
                {listener?.status === 'unconfigured' && (
                  <button className="button primary" type="button" onClick={() => void pairListener()} disabled={busy}>
                    Pasangkan listener
                  </button>
                )}
                <button className="button secondary" type="button" onClick={() => void refreshListener()} disabled={busy}>
                  Segarkan sinyal
                </button>
                {listener?.status !== 'unconfigured' && (
                  <button className="button secondary" type="button" onClick={() => void revokeListener()} disabled={busy}>
                    Cabut token perangkat
                  </button>
                )}
              </div>
            )}

            {deviceToken && (
              <div className="shopee-token-reveal">
                <strong>Token perangkat — hanya ditampilkan sekali</strong>
                <code data-testid="listener-token">{deviceToken}</code>
                <div className="shopee-portal-actions">
                  <button className="button secondary" type="button" onClick={() => void copyToken()}>
                    <Copy size={14} /> Salin token
                  </button>
                  <button className="button secondary" type="button" onClick={() => setDeviceToken('')}>
                    Sembunyikan token
                  </button>
                </div>
                <small>Simpan token ini di aplikasi Android Listener. Token tidak dapat ditampilkan ulang setelah ditutup.</small>
              </div>
            )}

            {error && (
              <p className="shopee-error" role="alert">
                {error}
              </p>
            )}

            {filteredSignals.length > 0 ? (
              <div className="shopee-signals">
                <h3>
                  Sinyal terbaru {meta.keywords.length > 0 && !showAllSignals ? `(${meta.name})` : '(Semua aplikasi)'}
                </h3>
                <ul>
                  {filteredSignals.slice(0, 20).map((signal) => (
                    <li key={signal.id}>
                      <span>
                        {signal.title || signal.sourceApp || meta.name}
                        {signal.sourceApp ? ` · ${signal.sourceApp}` : ''}
                      </span>
                      <strong>
                        {signal.amount == null
                          ? 'Nominal tidak terbaca'
                          : new Intl.NumberFormat('id-ID', {
                              style: 'currency',
                              currency: 'IDR',
                              maximumFractionDigits: 0,
                            }).format(signal.amount)}
                      </strong>
                      <small>Belum terverifikasi · {new Date(signal.receivedAt).toLocaleString('id-ID')}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              token && (
                <p className="shopee-help">
                  Belum ada sinyal {meta.keywords.length > 0 && !showAllSignals ? `untuk ${meta.name}` : 'yang diterima'}.
                </p>
              )
            )}

            {meta.keywords.length > 0 && signals.length > filteredSignals.length && (
              <button
                className="button secondary"
                type="button"
                onClick={() => setShowAllSignals((v) => !v)}
              >
                {showAllSignals ? `Filter khusus ${meta.name}` : `Tampilkan semua sinyal (${signals.length})`}
              </button>
            )}
          </section>

          <section className="card shopee-guide" aria-labelledby="listener-guide-title">
            <div className="shopee-guide-intro">
              <span className="shopee-kicker">
                {id === 'listener' ? 'APLIKASI RESMI · DITSGATE LISTENER (.APK)' : 'PANDUAN PENYIAPAN'}
              </span>
              <h2 id="listener-guide-title">
                {id === 'listener'
                  ? 'Panduan Setup Notifikasi HP Android (Otomatis)'
                  : `Cara menghubungkan ${meta.name}`}
              </h2>
              <p>
                {id === 'listener'
                  ? 'Pasang aplikasi DitsGate Listener di HP toko (folder android-listener/app/build/outputs/apk/debug/app-debug.apk) untuk mengonfirmasi notifikasi pembayaran masuk dari DANA Bisnis, GoBiz, BCA, BRImo, atau Livin’ Usaha.'
                  : 'Gunakan aplikasi Android Listener di folder android-listener.'}
              </p>
            </div>

            {id === 'listener' && (
              <div className="shopee-notice" style={{ marginBottom: '16px' }}>
                <div style={{ width: '100%' }}>
                  <strong>1. Referensi Teknis</strong>
                  <p style={{ margin: '6px 0' }}>
                    Method: <code>POST</code> · Endpoint:{' '}
                    <code>{API_ORIGIN}/api/v1/mutations/ingest</code>{' '}
                    <button
                      type="button"
                      className="button secondary"
                      style={{ padding: '2px 8px', fontSize: '12px', marginLeft: '6px' }}
                      onClick={() => void navigator.clipboard?.writeText(`${API_ORIGIN}/api/v1/mutations/ingest`)}
                    >
                      <Copy size={12} /> Salin URL
                    </button>
                  </p>
                  <p style={{ margin: '6px 0' }}>
                    Headers: <code>Content-Type: application/json</code>,{' '}
                    <code>X-Device-Token: dt_••••••</code>
                  </p>
                  <p style={{ margin: '6px 0 0' }}>
                    JSON Body:{' '}
                    <code>{`{"source_app": "{notif_package_name}", "title": "{notif_title}", "text": "{notif_body}"}`}</code>
                  </p>
                </div>
              </div>
            )}

            <ol>
              <li>
                <b>Download &amp; install APK Android</b>
                <span>
                  Pasang <code>app-debug.apk</code> di perangkat Android 8+ (izinkan pemasangan dari sumber tidak dikenal).
                </span>
              </li>
              <li>
                <b>Pasangkan token perangkat</b>
                <span>
                  Klik <b>Pasangkan listener</b> di atas untuk mendapatkan token <code>dt_…</code>, lalu tempel di aplikasi bersama URL{' '}
                  <code>{API_ORIGIN}/api/v1/mutations/ingest</code> (untuk USB jalankan{' '}
                  <code>adb reverse tcp:5180 tcp:5180</code>) dan package <code>{meta.packageHint}</code>.
                </span>
              </li>
              <li>
                <b>Aktifkan izin Notification Access</b>
                <span>Berikan izin Notification Access pada Android agar listener dapat membaca notifikasi aplikasi merchant.</span>
              </li>
              <li>
                <b>Matikan Battery Optimization</b>
                <span>
                  Wajib di Samsung/Xiaomi agar sistem tidak mematikan layanan background; pastikan HP tetap menyala dan terhubung internet.
                </span>
              </li>
              <li>
                <b>Verifikasi sinyal masuk</b>
                <span>Setelah transaksi masuk, klik <b>Segarkan sinyal</b> untuk memastikan status berubah menjadi <b>Sinyal diterima</b>.</span>
              </li>
            </ol>
          </section>

          {!token && (
            <section className="card shopee-setup" aria-labelledby="provider-auth-title">
              <div className="shopee-section-head">
                <span className="shopee-section-icon">
                  <KeyRound size={20} />
                </span>
                <div>
                  <span className="shopee-kicker">AKSES MERCHANT</span>
                  <h2 id="provider-auth-title">Masuk ke akun merchant</h2>
                  <p>Gunakan akun merchant DitsGate lokal yang sama dengan dashboard.</p>
                </div>
              </div>
              <form className="shopee-login-form" onSubmit={login}>
                {registerMerchant && (
                  <>
                    <label htmlFor="provider-merchant-name">Nama akun merchant</label>
                    <input
                      id="provider-merchant-name"
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      minLength={2}
                      maxLength={100}
                      required
                    />
                  </>
                )}
                <label htmlFor="provider-email">Email akun merchant</label>
                <input
                  id="provider-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="provider-password">Kata sandi akun merchant</label>
                <input
                  id="provider-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button className="button primary" type="submit" disabled={authBusy}>
                  {authBusy ? 'Menghubungkan…' : registerMerchant ? 'Daftar dan masuk' : 'Masuk ke akun merchant'}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setRegisterMerchant((v) => !v);
                    setAuthError('');
                  }}
                  disabled={authBusy}
                >
                  {registerMerchant ? 'Sudah punya akun? Masuk' : 'Buat akun merchant lokal'}
                </button>
              </form>
              {authError && (
                <p className="shopee-error" role="alert">
                  {authError}
                </p>
              )}
            </section>
          )}
        </main>

        <aside className="shopee-aside">
          <section className="card shopee-diagnostics" aria-labelledby="provider-diag-title">
            <span className="shopee-kicker">STATUS SESI</span>
            <h2 id="provider-diag-title">Diagnostik detektor</h2>
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{meta.name}</dd>
              </div>
              <div>
                <dt>Akun merchant</dt>
                <dd>{token ? 'Masuk' : 'Belum masuk'}</dd>
              </div>
              <div>
                <dt>Jalur deteksi</dt>
                <dd>Android Listener</dd>
              </div>
              <div>
                <dt>Package target</dt>
                <dd><code>{meta.packageHint}</code></dd>
              </div>
              <div>
                <dt>Total sinyal</dt>
                <dd>{filteredSignals.length}</dd>
              </div>
            </dl>
          </section>

          <section className="card shopee-fallback">
            <span className="shopee-fallback-icon">
              <Smartphone size={21} />
              <BellRing size={13} />
            </span>
            <span className="shopee-kicker">CATATAN VERIFIKASI</span>
            <h2>Bukan bukti settlement</h2>
            <p>
              Sinyal dari listener Android hanya menandakan notifikasi perangkat diterima oleh server lokal,{' '}
              <strong>bukan bukti pembayaran terverifikasi</strong>.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
