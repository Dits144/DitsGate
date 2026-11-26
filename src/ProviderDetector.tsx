import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BellRing, CheckCircle2, Copy, KeyRound, Radio, RefreshCw, ShieldAlert, Smartphone, Unplug } from 'lucide-react';
import { API_ORIGIN, sandboxRequest } from './developer-api';
import { ProviderIcon } from './ProviderIcon';
import {
  getMerchantSession,
  registerMerchant as createMerchant,
  signInMerchant,
  useMerchantSession,
} from './merchant-session';
import './shopee-partner.css';

export type DetectorProviderId = 'gopay' | 'bca' | 'linkaja' | 'bri' | 'mandiri' | 'listener';

type ConnectorState = {
  provider: string;
  accountLabel: string;
  status: 'unconfigured' | 'awaiting_otp' | 'connected' | 'session_broken';
  lastCheckedAt: string | null;
  lastError: string | null;
};

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
  kicker: string;
  apiTitle: string;
  apiDesc: string;
  steps: string[];
  accountLabelText: string;
  accountPlaceholder: string;
  secretLabelText: string;
  secretPlaceholder: string;
  packageHint: string;
  keywords: string[];
  desc: string;
  portalNote: string;
};

const PROVIDER_META: Record<DetectorProviderId, ProviderMeta> = {
  gopay: {
    name: 'GoPay Merchant',
    eyebrow: 'DETEKTOR PEMBAYARAN · GOPAY MERCHANT',
    kicker: 'API GOBIZ · OTP NOMOR GOBIZ',
    apiTitle: 'API GoBiz',
    apiDesc:
      'Hubungkan akun GoPay Merchant lewat OTP ke nomor GoBiz terdaftar. Setelah tersambung, server kami membaca transaksi QRIS langsung dari akun Anda — tidak perlu aplikasi di HP, dan pembayaran tetap tercatat walau HP kasir sedang mati.',
    steps: [
      'Masukkan nomor GoBiz terdaftar, lalu klik "Kirim OTP".',
      'Salin kode dari SMS atau WhatsApp GoBiz ke kolom OTP.',
      'Klik "Simpan koneksi" — pemeriksaan pertama berjalan di bawah satu menit.',
      'Chip status berubah menjadi "Terhubung" saat transaksi QRIS mulai dibaca server.',
    ],
    accountLabelText: 'Nomor HP GoBiz',
    accountPlaceholder: '081234567890',
    secretLabelText: 'Kode OTP',
    secretPlaceholder: 'Masukkan 4–6 digit kode OTP',
    packageHint: 'com.gojek.gopaymerchant',
    keywords: ['gopay', 'gojek', 'gobiz'],
    desc: 'OTP nomor GoBiz untuk membaca transaksi QRIS langsung dari akun GoPay Merchant Anda.',
    portalNote: 'Pengecekan berjalan otomatis saat ada pesanan yang belum dibayar dan halaman checkout atau dasbor terbuka.',
  },
  bca: {
    name: 'BCA Merchant',
    eyebrow: 'DETEKTOR PEMBAYARAN · BCA MERCHANT',
    kicker: 'API / PORTAL BCA MERCHANT',
    apiTitle: 'Portal BCA Merchant',
    apiDesc:
      'Hubungkan akun BCA Merchant Anda agar server dapat membaca mutasi QRIS secara berkala tanpa bergantung pada perangkat kasir.',
    steps: [
      'Masukkan Merchant ID / Username BCA Merchant terdaftar.',
      'Tempel token sesi / kredensial portal BCA Merchant.',
      'Klik "Simpan koneksi" untuk mengaktifkan sinkronisasi mutasi.',
    ],
    accountLabelText: 'Merchant ID / Username BCA',
    accountPlaceholder: 'Contoh: MID12345678',
    secretLabelText: 'Password / Token Sesi BCA Merchant',
    secretPlaceholder: 'Masukkan kredensial atau token sesi',
    packageHint: 'com.bca.merchant',
    keywords: ['bca'],
    desc: 'Hubungkan BCA Merchant untuk membaca transaksi QRIS dan notifikasi pembayaran toko Anda.',
    portalNote: 'Pengecekan berjalan otomatis saat ada pesanan yang belum dibayar.',
  },
  linkaja: {
    name: 'LinkAja Merchant',
    eyebrow: 'DETEKTOR PEMBAYARAN · LINKAJA MERCHANT',
    kicker: 'API LINKAJA MERCHANT',
    apiTitle: 'API LinkAja Merchant',
    apiDesc:
      'Hubungkan akun LinkAja Merchant Anda untuk menerima pencatatan transaksi QRIS langsung di server.',
    steps: [
      'Masukkan Nomor HP atau ID Merchant LinkAja terdaftar.',
      'Masukkan PIN / Token Sesi akun LinkAja Merchant.',
      'Klik "Simpan koneksi" hingga status berubah menjadi "Terhubung".',
    ],
    accountLabelText: 'Nomor HP / ID Merchant LinkAja',
    accountPlaceholder: '081234567890',
    secretLabelText: 'PIN / Token Sesi LinkAja',
    secretPlaceholder: 'Masukkan PIN atau token sesi',
    packageHint: 'com.telkom.mwallet',
    keywords: ['linkaja', 'mwallet'],
    desc: 'Hubungkan LinkAja Merchant untuk membaca pembayaran QRIS masuk secara otomatis.',
    portalNote: 'Pengecekan berjalan otomatis saat ada pesanan yang belum dibayar.',
  },
  bri: {
    name: 'BRI Merchant',
    eyebrow: 'DETEKTOR PEMBAYARAN · BRI MERCHANT',
    kicker: 'PORTAL BRI MERCHANT (BRIMERCHANT.BRI.CO.ID)',
    apiTitle: 'Portal BRI Merchant',
    apiDesc:
      'Hubungkan akun BRI Merchant (brimerchant.bri.co.id) untuk membaca mutasi QRIS secara langsung dari server.',
    steps: [
      'Masukkan Username / Email BRI Merchant terdaftar.',
      'Masukkan Password / Token Sesi portal BRI Merchant.',
      'Klik "Simpan koneksi" untuk mulai membaca transaksi QRIS.',
    ],
    accountLabelText: 'Username / Email BRI Merchant',
    accountPlaceholder: 'merchant@toko.com',
    secretLabelText: 'Password / Token Sesi BRI Merchant',
    secretPlaceholder: 'Masukkan password atau token sesi',
    packageHint: 'id.co.bri.brimola',
    keywords: ['bri', 'brimola', 'brimo'],
    desc: 'Hubungkan BRI Merchant untuk membaca transaksi QRIS toko Anda.',
    portalNote: 'Pengecekan berjalan otomatis saat ada pesanan yang belum dibayar.',
  },
  mandiri: {
    name: 'Mandiri',
    eyebrow: "DETEKTOR PEMBAYARAN · LIVIN' USAHA (MANDIRI)",
    kicker: "API LIVIN' USAHA · BANK MANDIRI",
    apiTitle: "Portal Livin' Usaha (Mandiri)",
    apiDesc:
      "Hubungkan akun Livin' Usaha / QRIS Bank Mandiri agar server dapat membaca mutasi pembayaran masuk secara otomatis.",
    steps: [
      "Masukkan Username / ID Merchant Livin' Usaha.",
      "Masukkan Password / Token Sesi Livin' Usaha.",
      'Klik "Simpan koneksi" untuk mengaktifkan detektor.',
    ],
    accountLabelText: "Username / ID Livin' Usaha",
    accountPlaceholder: 'Contoh: LIVIN12345',
    secretLabelText: "Password / Token Sesi Livin' Usaha",
    secretPlaceholder: 'Masukkan password atau token sesi',
    packageHint: 'id.co.bankmandiri.livinmerchant',
    keywords: ['mandiri', 'livin'],
    desc: "Hubungkan Livin' Usaha (Mandiri) untuk membaca mutasi pembayaran QRIS Anda.",
    portalNote: 'Pengecekan berjalan otomatis saat ada pesanan yang belum dibayar.',
  },
  listener: {
    name: 'Aplikasi Listener',
    eyebrow: 'DANA, BRI, BNI, MANDIRI · ANDROID LISTENER',
    kicker: 'ANDROID NOTIFICATION LISTENER',
    apiTitle: 'Aplikasi Listener Android',
    apiDesc:
      'Pasang aplikasi listener di HP Android toko untuk meneruskan notifikasi pembayaran masuk dari DANA Bisnis, GoBiz, BCA, BRImo, atau Livin’ Usaha.',
    steps: [
      'Klik "Pasangkan listener" untuk membuat token perangkat (dt_...).',
      'Salin token dan masukkan ke aplikasi Android Listener di HP toko.',
      'Aktifkan izin Notification Access di pengaturan Android.',
    ],
    accountLabelText: '',
    accountPlaceholder: '',
    secretLabelText: '',
    secretPlaceholder: '',
    packageHint: 'com.gojek.gopaymerchant',
    keywords: [],
    desc: 'Panduan Setup Notifikasi HP Android (Otomatis) — pasang aplikasi listener di HP toko untuk mendeteksi pembayaran masuk secara real-time.',
    portalNote: 'Endpoint ingest: POST /api/v1/mutations/ingest dengan header X-Device-Token: dt_...',
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

  const [connector, setConnector] = useState<ConnectorState | null>(null);
  const [accountInput, setAccountInput] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [connBusy, setConnBusy] = useState(false);
  const [connMsg, setConnMsg] = useState('');
  const [connError, setConnError] = useState('');

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

  const loadAll = useCallback(async () => {
    if (!token) {
      setListener(null);
      setSignals([]);
      setConnector(null);
      return;
    }
    try {
      const reqs: Promise<unknown>[] = [
        sandboxRequest<{ data: ListenerState }>(API_ORIGIN, '/api/v1/shopee-listener', 'GET', token),
        sandboxRequest<{ data: ListenerEvent[] }>(API_ORIGIN, '/api/v1/shopee-listener/events', 'GET', token),
      ];
      if (id !== 'listener') {
        reqs.push(sandboxRequest<{ data: ConnectorState }>(API_ORIGIN, `/api/v1/connectors/${id}`, 'GET', token));
      }
      const [lState, lHistory, cState] = await Promise.all(reqs);
      if (!active.current || getMerchantSession()?.token !== token) return;
      setListener((lState as { data: ListenerState }).data);
      setSignals((lHistory as { data: ListenerEvent[] }).data);
      if (cState) {
        const c = (cState as { data: ConnectorState }).data;
        setConnector(c);
        if (c.accountLabel && !accountInput) setAccountInput(c.accountLabel);
        if (c.status === 'awaiting_otp') setOtpSent(true);
      }
    } catch (cause) {
      if (active.current && getMerchantSession()?.token === token) setError(formatError(cause));
    }
  }, [token, id]);

  useEffect(() => {
    setOtpSent(false);
    setSecretInput('');
    setConnError('');
    setConnMsg('');
    void loadAll();
  }, [loadAll]);

  async function sendGopayOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setConnBusy(true);
    setConnError('');
    setConnMsg('');
    try {
      const res = await sandboxRequest<{ data: ConnectorState & { message?: string } }>(
        API_ORIGIN,
        '/api/v1/connectors/gopay/otp',
        'POST',
        token,
        { phone: accountInput.trim() },
      );
      if (!active.current) return;
      setConnector(res.data);
      setOtpSent(true);
      setConnMsg(res.data.message || 'Kode OTP telah dikirim ke SMS/WhatsApp GoBiz Anda.');
    } catch (cause) {
      if (active.current) setConnError(formatError(cause));
    } finally {
      if (active.current) setConnBusy(false);
    }
  }

  async function verifyGopayOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setConnBusy(true);
    setConnError('');
    setConnMsg('');
    try {
      const res = await sandboxRequest<{ data: ConnectorState }>(
        API_ORIGIN,
        '/api/v1/connectors/gopay/verify',
        'POST',
        token,
        { otp: secretInput.trim() },
      );
      if (!active.current) return;
      setConnector(res.data);
      setSecretInput('');
      setOtpSent(false);
      setConnMsg('GoPay Merchant berhasil terhubung.');
    } catch (cause) {
      if (active.current) setConnError(formatError(cause));
    } finally {
      if (active.current) setConnBusy(false);
    }
  }

  async function saveProviderConnector(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || id === 'listener' || id === 'gopay') return;
    setConnBusy(true);
    setConnError('');
    setConnMsg('');
    try {
      const res = await sandboxRequest<{ data: ConnectorState }>(
        API_ORIGIN,
        `/api/v1/connectors/${id}`,
        'POST',
        token,
        { accountLabel: accountInput.trim(), secret: secretInput.trim() },
      );
      if (!active.current) return;
      setConnector(res.data);
      setSecretInput('');
      setConnMsg(`${meta.name} berhasil terhubung.`);
    } catch (cause) {
      if (active.current) setConnError(formatError(cause));
    } finally {
      if (active.current) setConnBusy(false);
    }
  }

  async function disconnectConnector() {
    if (!token || id === 'listener' || !window.confirm(`Putuskan koneksi ${meta.name}?`)) return;
    setConnBusy(true);
    setConnError('');
    setConnMsg('');
    try {
      await sandboxRequest(API_ORIGIN, `/api/v1/connectors/${id}`, 'DELETE', token);
      if (!active.current) return;
      setConnector({ provider: id, accountLabel: '', status: 'unconfigured', lastCheckedAt: null, lastError: null });
      setOtpSent(false);
      setSecretInput('');
      setConnMsg('Koneksi diputuskan.');
    } catch (cause) {
      if (active.current) setConnError(formatError(cause));
    } finally {
      if (active.current) setConnBusy(false);
    }
  }

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      if (registerMerchant) await createMerchant(merchantName, email, password);
      else await signInMerchant(email, password);
    } catch (cause) {
      setAuthError(formatError(cause));
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
    ) {
      return;
    }
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
      setError('Clipboard tidak tersedia. Salin token secara manual.');
    }
  }

  const filteredSignals = showAllSignals ? signals : signals.filter((s) => matchesProvider(s, meta.keywords));
  const isConnected = connector?.status === 'connected';

  return (
    <div className="shopee-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <Link to="/dashboard/detectors" className="back-link">
          <ArrowLeft size={16} /> Semua detektor
        </Link>
        <button className="button secondary" type="button" onClick={() => void loadAll()} disabled={connBusy || busy}>
          <RefreshCw size={15} /> Segarkan
        </button>
      </div>

      <header className="shopee-heading" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.9rem' }}>
        <ProviderIcon id={id} size={40} />
        <div>
          <span className="shopee-eyebrow">
            <Radio size={15} /> {meta.eyebrow}
          </span>
          <h1>{meta.name}</h1>
          <p>{meta.desc}</p>
        </div>
      </header>

      {id !== 'listener' && (
        <div
          className="shopee-status"
          role="status"
          style={{
            borderColor: isConnected ? '#86efac' : undefined,
            background: isConnected ? '#f0fdf4' : undefined,
          }}
        >
          {isConnected ? (
            <CheckCircle2 size={20} color="#16a34a" aria-hidden="true" />
          ) : (
            <ShieldAlert size={20} aria-hidden="true" />
          )}
          <div>
            <strong>
              {!token
                ? 'Masuk dahulu untuk melihat status'
                : isConnected
                  ? `Terhubung · ${connector?.accountLabel || meta.name}`
                  : connector?.status === 'awaiting_otp'
                    ? 'Menunggu verifikasi OTP GoBiz'
                    : 'Belum aktif'}
            </strong>
            <span>{meta.portalNote}</span>
          </div>
        </div>
      )}

      <div className="shopee-layout">
        <main className="shopee-main">
          {id !== 'listener' && (
            <section className="card shopee-portal-option" aria-labelledby="connector-title">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <span className="shopee-kicker">{meta.kicker}</span>
                  <h2 id="connector-title" style={{ marginBottom: 0 }}>{meta.apiTitle}</h2>
                </div>
                <span
                  style={{
                    padding: '0.25rem 0.7rem',
                    borderRadius: '999px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    background: isConnected ? '#16a34a' : connector?.status === 'awaiting_otp' ? '#d97706' : '#64748b',
                    color: '#fff',
                  }}
                >
                  {isConnected ? 'Terhubung' : connector?.status === 'awaiting_otp' ? 'Menunggu OTP' : 'Belum aktif'}
                </span>
              </div>

              <p style={{ marginTop: '0.75rem' }}>{meta.apiDesc}</p>

              <div style={{ margin: '0.75rem 0' }}>
                <strong style={{ fontSize: '0.85rem' }}>Panduan singkat</strong>
                <ol className="shopee-portal-steps" style={{ marginTop: '0.4rem' }}>
                  {meta.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>

              {id === 'gopay' ? (
                isConnected ? (
                  <div className="shopee-portal-actions">
                    <button className="button secondary" type="button" onClick={() => void loadAll()} disabled={connBusy}>
                      <RefreshCw size={15} /> Segarkan
                    </button>
                    <button className="button secondary" type="button" onClick={() => void disconnectConnector()} disabled={connBusy}>
                      <Unplug size={15} /> Putuskan koneksi
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    <form className="shopee-portal-form" onSubmit={sendGopayOtp}>
                      <label htmlFor="gobiz-phone">{meta.accountLabelText}</label>
                      <input
                        id="gobiz-phone"
                        type="tel"
                        value={accountInput}
                        onChange={(e) => setAccountInput(e.target.value)}
                        placeholder={meta.accountPlaceholder}
                        required
                      />
                      <div className="shopee-portal-actions">
                        <button className="button primary" type="submit" disabled={!token || connBusy}>
                          {connBusy ? 'Mengirim OTP…' : otpSent ? 'Kirim ulang OTP' : 'Kirim OTP'}
                        </button>
                      </div>
                    </form>

                    {otpSent && (
                      <form className="shopee-portal-form" onSubmit={verifyGopayOtp}>
                        <label htmlFor="gobiz-otp">{meta.secretLabelText}</label>
                        <input
                          id="gobiz-otp"
                          type="text"
                          inputMode="numeric"
                          maxLength={8}
                          value={secretInput}
                          onChange={(e) => setSecretInput(e.target.value)}
                          placeholder={meta.secretPlaceholder}
                          required
                        />
                        <div className="shopee-portal-actions">
                          <button className="button primary" type="submit" disabled={!token || connBusy}>
                            {connBusy ? 'Memverifikasi…' : 'Simpan koneksi'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              ) : isConnected ? (
                <div className="shopee-portal-actions">
                  <button className="button secondary" type="button" onClick={() => void loadAll()} disabled={connBusy}>
                    <RefreshCw size={15} /> Segarkan
                  </button>
                  <button className="button secondary" type="button" onClick={() => void disconnectConnector()} disabled={connBusy}>
                    <Unplug size={15} /> Putuskan koneksi
                  </button>
                </div>
              ) : (
                <form className="shopee-portal-form" autoComplete="off" onSubmit={saveProviderConnector}>
                  <label htmlFor="conn-account">{meta.accountLabelText}</label>
                  <input
                    id="conn-account"
                    value={accountInput}
                    onChange={(e) => setAccountInput(e.target.value)}
                    placeholder={meta.accountPlaceholder}
                    required
                  />
                  <label htmlFor="conn-secret">{meta.secretLabelText}</label>
                  <input
                    id="conn-secret"
                    type="password"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder={meta.secretPlaceholder}
                    required
                  />
                  <div className="shopee-portal-actions">
                    <button className="button primary" type="submit" disabled={!token || connBusy}>
                      {connBusy ? 'Menyimpan…' : 'Simpan koneksi'}
                    </button>
                  </div>
                </form>
              )}

              {connMsg && <p className="qris-inline-success" style={{ marginTop: '0.65rem' }}>{connMsg}</p>}
              {connError && (
                <p className="shopee-error" role="alert" style={{ marginTop: '0.65rem' }}>
                  {connError}
                </p>
              )}

              <p className="shopee-help" style={{ marginTop: '0.85rem' }}>
                {meta.portalNote}{' '}
                <Link to="/dashboard/detectors" style={{ textDecoration: 'underline', fontWeight: 600 }}>
                  Lihat semua akun merchant
                </Link>
              </p>
            </section>
          )}

          <section className="card shopee-portal-option" aria-labelledby="provider-listener-title">
            <span className="shopee-kicker">
              {id === 'listener' ? 'DETEKSI REAL-TIME · ANDROID LISTENER' : 'JALUR ALTERNATIF · ANDROID LISTENER'}
            </span>
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
        </main>

        <aside className="shopee-aside">
          <section className="card shopee-diagnostics" aria-labelledby="provider-diagnostics-title">
            <span className="shopee-kicker">STATUS SESI</span>
            <h2 id="provider-diagnostics-title">Diagnostik koneksi</h2>
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{meta.name}</dd>
              </div>
              {id !== 'listener' && (
                <div>
                  <dt>Koneksi API</dt>
                  <dd>{isConnected ? 'Terhubung' : 'Belum aktif'}</dd>
                </div>
              )}
              <div>
                <dt>Android Listener</dt>
                <dd>
                  {!token
                    ? 'Belum masuk'
                    : listener?.status === 'receiving'
                      ? 'Sinyal diterima'
                      : listener?.status === 'awaiting_event'
                        ? 'Menunggu sinyal'
                        : 'Belum dipasangkan'}
                </dd>
              </div>
              <div>
                <dt>Package App</dt>
                <dd>
                  <code>{meta.packageHint}</code>
                </dd>
              </div>
            </dl>
          </section>

          {!token && (
            <section className="card shopee-setup" aria-labelledby="provider-auth-title">
              <div className="shopee-section-head">
                <span className="shopee-section-icon">
                  <KeyRound size={20} />
                </span>
                <div>
                  <span className="shopee-kicker">AKSES AKUN</span>
                  <h2 id="provider-auth-title">Masuk ke DitsGate</h2>
                  <p>Gunakan akun DitsGate Anda untuk menghubungkan detektor.</p>
                </div>
              </div>
              <form className="shopee-login-form" onSubmit={login}>
                {registerMerchant && (
                  <>
                    <label htmlFor="provider-merchant-name">Nama toko</label>
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
                <label htmlFor="provider-email">Email</label>
                <input
                  id="provider-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="provider-password">Kata sandi</label>
                <input
                  id="provider-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button className="button primary" type="submit" disabled={authBusy}>
                  {authBusy ? 'Menghubungkan…' : registerMerchant ? 'Daftar dan masuk' : 'Masuk'}
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
                  {registerMerchant ? 'Sudah punya akun? Masuk' : 'Buat akun baru'}
                </button>
                {authError && (
                  <p className="shopee-error" role="alert">
                    {authError}
                  </p>
                )}
              </form>
            </section>
          )}

          <section className="card shopee-fallback">
            <span className="shopee-fallback-icon">
              <Smartphone size={21} />
              <BellRing size={13} />
            </span>
            <span className="shopee-kicker">CATATAN</span>
            <h2>Tentang detektor</h2>
            <p>
              Saat transaksi QRIS baru dibuat, server otomatis memeriksa mutasi dari konektor yang terhubung maupun sinyal
              Android Listener.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
