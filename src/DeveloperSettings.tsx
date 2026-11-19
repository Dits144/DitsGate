import { useEffect, useRef, useState } from 'react';
import { API_ORIGIN, safeSandboxOrigin, sandboxRequest, type SandboxKey, type SandboxWebhook, type SandboxQris } from './developer-api';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, CircleAlert, Code2, Copy, Globe2, KeyRound, LockKeyhole, Radio, ShieldCheck, Webhook } from 'lucide-react';
import type { DemoState } from './store';
import './developer-settings.css';

type Props = { s: DemoState; set: React.Dispatch<React.SetStateAction<DemoState>>; notify: (message:string)=>void };
const events = ['payment.paid', 'payment.expired', 'payment.failed'];
const snippets = {
  'Node.js': `// Contoh VERIFIKASI webhook masuk QRISGate; bukan kontrak outbound DitsGate.
// Jalankan di server. Pastikan rawBody adalah Buffer persis dari HTTP request.
import { createHmac, timingSafeEqual } from 'node:crypto';
const rawBody = req.rawBody;
const timestamp = req.headers['x-qrisgate-timestamp'];
const signature = req.headers['x-qrisgate-signature'];
const secret = process.env.QRISGATE_WEBHOOK_SECRET;
if (!secret || !/^\\d{10}$/.test(String(timestamp)) ||
    Math.abs(Date.now()/1000 - Number(timestamp)) > 300) {
  return res.status(401).end();
}
const received = String(signature || '').replace(/^sha256=/, '');
if (!/^[a-f0-9]{64}$/i.test(received)) return res.status(401).end();
const expected = createHmac('sha256', secret)
  .update(String(timestamp)).update('.').update(rawBody).digest();
if (!timingSafeEqual(expected, Buffer.from(received, 'hex'))) {
  return res.status(401).end();
}
// Baru parse JSON. Cocokkan order, nominal, dan delivery ID secara idempoten.`,
  Python: `# Contoh VERIFIKASI webhook masuk QRISGate; bukan kontrak outbound DitsGate.
import hmac, hashlib, os, time, re
raw_body = request.get_data()  # bytes asli
stamp = request.headers.get('X-Qrisgate-Timestamp', '')
received = request.headers.get('X-Qrisgate-Signature', '').removeprefix('sha256=')
secret = os.environ.get('QRISGATE_WEBHOOK_SECRET')
if not secret or not re.fullmatch(r'\\d{10}', stamp) or abs(time.time()-int(stamp)) > 300:
    abort(401)
if not re.fullmatch(r'[a-fA-F0-9]{64}', received):
    abort(401)
expected = hmac.new(secret.encode(), stamp.encode()+b'.'+raw_body, hashlib.sha256).hexdigest()
if not hmac.compare_digest(received.lower(), expected):
    abort(401)
# Baru parse JSON, cocokkan order dan nominal, deduplikasi delivery ID.`
} as const;
type Language = keyof typeof snippets;

function validHttps(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.hash; }
  catch { return false; }
}

export default function DeveloperSettings({s,set,notify}:Props) {
  const [url,setUrl] = useState(s.webhook.url);
  const [selectedEvents,setEvents] = useState<string[]>(s.webhook.events);
  const [selectedQris,setQris] = useState('');
  const [language,setLanguage] = useState<Language>('Node.js');
  const [tab,setTab] = useState<'overview'|'webhook'|'security'>('overview');
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [token,setToken] = useState('');
  const [busy,setBusy] = useState(false);
  const [apiError,setApiError] = useState('');
  const [keys,setKeys] = useState<SandboxKey[]>([]);
  const [webhook,setWebhook] = useState<SandboxWebhook | null>(null);
  const [qris,setServerQris] = useState<SandboxQris[]>([]);
  const [serverUrl,setServerUrl] = useState('');
  const [keyName,setKeyName] = useState('');
  const [editing,setEditing] = useState<Record<string,{name:string;webhookUrl:string;qrisId:string}>>({});
  const [reveal,setReveal] = useState<{kind:string;value:string}|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const mounted = useRef(true);
  useEffect(()=>()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);setReveal(null)},[]);
  const originError = (()=>{try{safeSandboxOrigin(API_ORIGIN);return ''}catch(e){return (e as Error).message}})();
  function hideReveal(){if(timer.current)clearTimeout(timer.current);timer.current=null;setReveal(null)}
  function showOnce(kind:string,value:string){hideReveal();setReveal({kind,value});timer.current=setTimeout(()=>{if(mounted.current)setReveal(null)},60000)}
  function disconnect(){if(token)void sandboxRequest(API_ORIGIN,'/api/auth/logout','POST',token,{}).catch(()=>{});hideReveal();setToken('');setPassword('');setKeys([]);setWebhook(null);setServerUrl('');setServerQris([]);setEditing({});setApiError('')}
  async function run(action:()=>Promise<void>){setBusy(true);setApiError('');try{await action()}catch(e){setApiError(e instanceof TypeError?'Server sandbox tidak tersedia atau CORS menolak origin ini. Pastikan API lokal berjalan di origin yang dikonfigurasi.':(e as Error).message)}finally{if(mounted.current)setBusy(false)}}
  async function load(session:string){
    const [k,w,q] = await Promise.all([
      sandboxRequest<{data:SandboxKey[]}>(API_ORIGIN,'/api/v1/api-keys','GET',session),
      sandboxRequest<{data:SandboxWebhook}>(API_ORIGIN,'/api/v1/webhook-settings','GET',session),
      sandboxRequest<{data:SandboxQris[]}>(API_ORIGIN,'/api/v1/qris','GET',session),
    ]);
    if(!mounted.current)return;
    setKeys(k.data);setWebhook(w.data);setServerUrl(w.data.url||'');setServerQris(q.data);
    setEditing(Object.fromEntries(k.data.map(row=>[row.id,{name:row.name,webhookUrl:row.webhookUrl||'',qrisId:row.qrisId||''}])));
  }
  function login(e:React.FormEvent){e.preventDefault();run(async()=>{let result:{token:string};try{result=await sandboxRequest<{token:string}>(API_ORIGIN,'/api/auth/login','POST',undefined,{email,password})}finally{setPassword('')}try{await load(result.token);setToken(result.token)}catch(e){disconnect();throw e}})}
  function generate(e:React.FormEvent){e.preventDefault();run(async()=>{const result=await sandboxRequest<{data:SandboxKey;key:string}>(API_ORIGIN,'/api/v1/api-keys','POST',token,{name:keyName.trim()});setKeyName('');setKeys(v=>[result.data,...v]);setEditing(v=>({...v,[result.data.id]:{name:result.data.name,webhookUrl:'',qrisId:''}}));showOnce('API key local-test',result.key)})}
  function saveKey(row:SandboxKey){const fields=editing[row.id];if(!fields)return;run(async()=>{if(fields.webhookUrl.trim()&&!validHttps(fields.webhookUrl.trim()))throw new Error('Gunakan URL HTTPS valid tanpa kredensial atau fragment (#).');const result=await sandboxRequest<{data:SandboxKey}>(API_ORIGIN,`/api/v1/api-keys/${encodeURIComponent(row.id)}`,'PATCH',token,{name:fields.name.trim(),webhookUrl:fields.webhookUrl.trim()||null,qrisId:fields.qrisId||null});setKeys(v=>v.map(k=>k.id===row.id?result.data:k));notify('Pemetaan key tersimpan di sandbox; pengiriman webhook belum diimplementasikan.')})}
  function revoke(row:SandboxKey){if(!window.confirm(`Cabut API key ${row.name}? Tindakan ini tidak dapat dibatalkan.`))return;run(async()=>{await sandboxRequest(API_ORIGIN,`/api/v1/api-keys/${encodeURIComponent(row.id)}`,'DELETE',token);setKeys(v=>v.map(k=>k.id===row.id?{...k,revokedAt:new Date().toISOString()}:k));notify('API key dicabut.')})}
  function saveServer(e:React.FormEvent){e.preventDefault();run(async()=>{if(serverUrl.trim()&&!validHttps(serverUrl.trim()))throw new Error('Gunakan URL HTTPS valid tanpa kredensial atau fragment (#).');const result=await sandboxRequest<{data:SandboxWebhook}>(API_ORIGIN,'/api/v1/webhook-settings','PATCH',token,{url:serverUrl.trim()||null});setWebhook(result.data);setServerUrl(result.data.url||'');notify('URL akun tersimpan di sandbox; pengiriman webhook belum tersedia.')})}
  function rotate(){if(!window.confirm('Rotasi secret local-test? Secret lama tidak dapat dilihat lagi.'))return;run(async()=>{const result=await sandboxRequest<{data:SandboxWebhook;secret:string}>(API_ORIGIN,'/api/v1/webhook-settings/rotate-secret','POST',token,{});setWebhook(result.data);showOnce('Secret local-test',result.secret)})}
  const assets = s.qrisAssets?.length ? s.qrisAssets : s.qris ? [s.qris] : [];
  const cleanUrl = url.trim();
  function saveDraft(e:React.FormEvent) {
    e.preventDefault();
    if (cleanUrl && !validHttps(cleanUrl)) { setError('Gunakan URL HTTPS valid tanpa kredensial atau fragment (#).'); setSaved(false); return; }
    if (!selectedEvents.length) { setError('Pilih setidaknya satu event.'); setSaved(false); return; }
    set(v=>({...v,webhook:{url:cleanUrl,events:selectedEvents,enabled:false}}));
    setError(''); setSaved(true);
    notify('Draf URL dan event tersimpan di browser ini saja; webhook belum aktif.');
  }
  async function copySnippet() {
    try { await navigator.clipboard.writeText(snippets[language]); notify('Contoh kode disalin; cocokkan kontrak backend sebelum digunakan.'); }
    catch { notify('Clipboard tidak tersedia. Pilih teks kode untuk menyalin manual.'); }
  }
  return <div className="dev-page">
    <div className="dev-header"><div><div className="dev-eyebrow"><Code2 size={14}/> DEVELOPER WORKSPACE <span>·</span> {token?'SANDBOX LOKAL':'MODE DEMO'}</div><h1>API & Webhook</h1><p>Konfigurasi sandbox lokal untuk pengujian. Tidak ada pengiriman webhook atau pembayaran nyata.</p></div><div className="dev-status"><span className="dev-status-dot"/> {token?'Sandbox terhubung':'Server belum terhubung'}</div></div>
    <div className="dev-alert" role="status"><CircleAlert size={19}/><div><strong>Ini bukan koneksi produksi.</strong><span>HTTP hanya untuk loopback lokal ({API_ORIGIN}); token sesi, password, key dan secret tidak disimpan di browser storage. Origin API remote hanya diterima melalui HTTPS (dan tetap memerlukan izin CORS dari server). Pengiriman webhook dan ping belum diimplementasikan; draf browser terpisah dari konfigurasi server.</span></div></div>
    <section className="dev-panel dev-connect" aria-label="Koneksi sandbox lokal"><h2>Hubungkan merchant sandbox</h2><p>Masuk hanya dengan akun uji lokal. Password dihapus setelah respons; sesi hilang saat refresh atau halaman ditutup.</p>{originError&&<p role="alert" className="dev-error">{originError}</p>}{apiError&&<p role="alert" className="dev-error">{apiError}</p>}{token?<div className="dev-actions"><strong>Sandbox terhubung · {API_ORIGIN}</strong><button type="button" className="dev-secondary" onClick={disconnect}>Putuskan koneksi</button></div>:<form className="dev-connect-form" onSubmit={login}><label>Email merchant sandbox<input aria-label="Email merchant sandbox" type="email" autoComplete="off" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Kata sandi merchant sandbox<input aria-label="Kata sandi merchant sandbox" type="password" autoComplete="off" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="dev-primary" type="submit" disabled={busy||!!originError}>Hubungkan sandbox</button></form>}</section>
    <div className="dev-tabs" role="tablist" aria-label="Bagian API dan Webhook">{([['overview','Ringkasan'],['webhook','Webhook & QRIS'],['security','Keamanan & kode']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {tab==='overview' && <div className="dev-grid">
      <section className="dev-panel dev-key-panel" aria-label="Kredensial API"><div className="dev-panel-top"><span className="dev-icon"><KeyRound size={20}/></span><span className="dev-tag">{token?'LOCAL TEST':'BELUM TERSEDIA'}</span></div><h2>Kredensial API</h2><p>Key hanya untuk sandbox lokal. Nilai mentah tampil sekali selama maksimal 60 detik; prefix bukan kredensial.</p>{token?<><form onSubmit={generate} className="dev-connect-form"><label>Nama API key baru<input required maxLength={100} value={keyName} onChange={e=>setKeyName(e.target.value)}/></label><button type="submit" className="dev-primary" disabled={busy}>+ Generate API key</button></form>{!keys.length&&<p>Belum ada API key server.</p>}{keys.map(row=><div key={row.id} className="dev-key-row"><b>{row.name} · {row.revokedAt?'Dicabut':'Aktif local-test'}</b><small>Prefix: <code>{row.prefix}</code> · pengiriman webhook tidak aktif</small>{!row.revokedAt&&<><label>Nama key {row.name}<input value={editing[row.id]?.name??''} onChange={e=>setEditing(v=>({...v,[row.id]:{...v[row.id],name:e.target.value}}))}/></label><label>URL webhook key {row.name}<input type="url" value={editing[row.id]?.webhookUrl??''} onChange={e=>setEditing(v=>({...v,[row.id]:{...v[row.id],webhookUrl:e.target.value}}))} placeholder="https://merchant.example/hook"/></label><label>QRIS key {row.name}<select value={editing[row.id]?.qrisId??''} onChange={e=>setEditing(v=>({...v,[row.id]:{...v[row.id],qrisId:e.target.value}}))}><option value="">Tidak dipetakan</option>{qris.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><div className="dev-actions"><button className="dev-secondary" disabled={busy} onClick={()=>saveKey(row)}>Simpan key {row.name}</button><button className="dev-secondary" disabled={busy} onClick={()=>revoke(row)}>Cabut key {row.name}</button></div></>}{row.webhookUrl&&<small>URL tersimpan: {row.webhookUrl}</small>}</div>)}</>:<div className="dev-empty-key"><LockKeyhole size={21}/><div><b>Belum ada API key server</b><small>Format ilustrasi: <code>dg_test_••••••••••••</code> — bukan kunci yang bisa dipakai.</small></div></div>}{!token&&<div className="dev-actions"><button type="button" className="dev-primary" disabled>+ Generate API key</button><button type="button" className="dev-secondary" disabled>Salin / cabut</button></div>}<p className="dev-fine">Bearer key hanya dipakai dari backend merchant, bukan JavaScript browser atau Git.</p></section>
      <section className="dev-panel dev-route-panel"><div className="dev-panel-top"><span className="dev-icon mint"><Webhook size={20}/></span><span className="dev-tag">DRAF LOKAL</span></div><h2>Tujuan webhook</h2><p>Rancang URL dan event di sini; penyimpanan lokal bukan konfigurasi server dan tidak mengirim notifikasi.</p><div className="dev-route-row"><span>Endpoint draf browser</span><b>{s.webhook.url || 'Belum diatur'}</b></div>{token&&<div className="dev-route-row"><span>URL akun server · pengiriman belum aktif</span><b>{webhook?.url||'Belum diatur'}</b></div>}<div className="dev-route-row"><span>Event dalam draf</span><b>{s.webhook.events.join(', ') || 'Belum dipilih'}</b></div><button type="button" className="dev-link" onClick={()=>setTab('webhook')}>Atur draf webhook <ArrowRight size={15}/></button></section>
      <section className="dev-panel dev-wide dev-steps"><div><span className="dev-kicker">LANGKAH BERIKUTNYA</span><h2>Hubungkan backend sebelum menerima pembayaran</h2><p>Aktifkan login merchant di server, buat kredensial server-side, simpan tujuan webhook per key dan sumber QRIS, lalu verifikasi signature dan log pengiriman. Halaman demo ini belum melakukan langkah-langkah tersebut.</p><Link to="/dashboard/integration-guide" className="dev-outline">Buka panduan integrasi <ArrowRight size={15}/></Link></div><div className="dev-step-list"><span><i>01</i> Autentikasi merchant di server</span><span><i>02</i> Buat kunci & secret di server</span><span><i>03</i> Hubungkan QRIS dan webhook</span></div></section>
    </div>}
    {tab==='webhook' && <div className="dev-grid"><section className="dev-panel dev-wide"><div className="dev-panel-top"><span className="dev-icon mint"><Globe2 size={20}/></span><span className="dev-tag">DRAF BROWSER · TIDAK AKTIF</span></div><h2>Rancang tujuan webhook</h2><p>URL dan event disimpan di browser ini saja. Pilihan QRIS di bawah adalah pratinjau sesi, bukan pemetaan per-kunci server.</p><form onSubmit={saveDraft} noValidate className="dev-form"><label htmlFor="dev-webhook-url">URL tujuan HTTPS</label><input id="dev-webhook-url" type="url" inputMode="url" value={url} aria-invalid={!!error && !validHttps(cleanUrl)} onChange={e=>{setUrl(e.target.value);setError('');setSaved(false)}} placeholder="https://merchant.example/webhook"/><small>Alamat hanya untuk draf lokal. Endpoint tidak dipanggil dari browser.</small><fieldset><legend>Event yang akan diterima (rencana)</legend><div className="dev-checks">{events.map(ev=><label key={ev}><input type="checkbox" checked={selectedEvents.includes(ev)} onChange={e=>{setEvents(v=>e.target.checked?[...v,ev]:v.filter(x=>x!==ev));setSaved(false);setError('')}}/>{ev}</label>)}</div></fieldset><label htmlFor="dev-qris">Sumber QRIS untuk pratinjau</label><select id="dev-qris" value={selectedQris} onChange={e=>setQris(e.target.value)}><option value="">Belum dipilih</option>{assets.map((asset,i)=><option key={asset.id || i} value={asset.id || String(i)}>{asset.name || asset.fileName || `QRIS ${i+1}`} · {asset.provider}</option>)}</select><small>{assets.length ? 'Pilihan ini hanya berlaku sampai halaman ditutup; tidak tersimpan di server.' : <>Belum ada aset QRIS lokal. <Link to="/dashboard/qris">Kelola QRIS demo</Link> untuk melihat opsi.</>}</small>{error&&<p role="alert" className="dev-error">{error}</p>}{saved&&<p role="status" className="dev-success"><Check size={15}/> Draf browser tersimpan. Webhook tetap tidak aktif.</p>}<div className="dev-actions"><button className="dev-primary" type="submit">Simpan draf di browser</button><button className="dev-secondary" type="button" disabled title="Butuh server pengirim webhook">Ping endpoint</button></div></form><form onSubmit={saveServer} className="dev-form dev-server-form"><h2>URL webhook akun server · sandbox</h2><p>Terpisah dari draf browser. Disimpan di server, tetapi pengiriman webhook belum tersedia.</p><label htmlFor="dev-server-url">URL webhook server</label><input id="dev-server-url" type="url" value={serverUrl} onChange={e=>setServerUrl(e.target.value)} disabled={!token} placeholder="https://merchant.example/webhook"/><p>URL tersimpan: {webhook?.url||'Belum diatur'} · pengiriman tidak aktif</p><button type="submit" className="dev-secondary" disabled={!token||busy}>Simpan ke server</button></form></section></div>}
    {tab==='security' && <div className="dev-grid"><section className="dev-panel"><div className="dev-panel-top"><span className="dev-icon"><ShieldCheck size={20}/></span><span className="dev-tag">PANDUAN</span></div><h2>Verifikasi signature</h2><p>Signing secret dibuat dan disimpan di server; jika backend menampilkannya sekali, tampilkan maksimal 60 detik di sesi terautentikasi. Jangan simpan secret di browser ini.</p><div className="dev-empty-key"><LockKeyhole size={20}/><div><b>{webhook?.secretConfigured?'Secret dikonfigurasi (nilai mentah tidak tersedia)':'Signing secret tidak tersedia'}</b><small>GET hanya mengembalikan status, bukan secret. Rotasi menghasilkan secret baru sekali; secret_hash belum digunakan untuk outbound DitsGate.</small></div></div><div className="dev-actions"><button className="dev-secondary" disabled>Lihat secret</button><button className="dev-secondary" disabled>Salin secret</button><button className="dev-secondary" disabled={!token||busy} onClick={rotate}>Rotasi secret</button></div></section><section className="dev-panel"><div className="dev-panel-top"><span className="dev-icon mint"><Radio size={20}/></span><span className="dev-tag">CHECKLIST</span></div><h2>Praktik penerimaan aman</h2><ul className="dev-list"><li>Bandingkan HMAC-SHA256 dari <strong>raw request body</strong>, bukan JSON hasil parse.</li><li>Gunakan perbandingan konstan waktu dan tolak signature tidak valid.</li><li>Catat ID event untuk idempotensi; jawab 2xx setelah diproses.</li><li>Pastikan nama header, encoding, dan payload final sesuai kontrak backend yang benar-benar dipasang.</li></ul></section><section className="dev-panel dev-wide"><div className="dev-code-head"><div><span className="dev-kicker">CONTOH INBOUND QRISGATE · BUKAN OUTBOUND DITSGATE</span><h2>Verifikasi HMAC</h2></div><div className="dev-actions"><label className="dev-code-select">Bahasa <select aria-label="Bahasa contoh HMAC" value={language} onChange={e=>setLanguage(e.target.value as Language)}>{Object.keys(snippets).map(v=><option key={v}>{v}</option>)}</select><ChevronDown size={14}/></label><button className="dev-secondary" onClick={copySnippet}><Copy size={14}/> Salin kode</button></div></div><p>Potongan ini tidak berisi secret. Header dan format signature masih ilustratif sampai kontrak backend diverifikasi.</p><pre className="dev-code"><code>{snippets[language]}</code></pre></section></div>}
    {reveal&&<div className="dev-secret-overlay"><div className="dev-secret-modal" role="dialog" aria-modal="true" aria-label={`${reveal.kind} sekali tampil`}><h2>{reveal.kind} · sekali tampil</h2><p>Salin sekarang ke penyimpanan aman di luar browser. Tampilan hilang dalam 60 detik atau saat keluar; tidak dapat ditampilkan ulang.</p><code>{reveal.value}</code><div className="dev-actions"><button type="button" className="dev-secondary" onClick={hideReveal}>Tutup</button></div></div></div>}
  </div>;
}
