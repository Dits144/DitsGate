import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { API_ORIGIN, sandboxRequest } from './developer-api';
import {useMerchantSession,getMerchantSession,signInMerchant,registerMerchant as createMerchant,signOutMerchant} from './merchant-session';

async function merchantResources(session:string){
 const [config,listener,signals]=await Promise.all([
  sandboxRequest<{data:Config}>(API_ORIGIN,'/api/v1/shopeepay/config','GET',session),
  sandboxRequest<{data:Listener}>(API_ORIGIN,'/api/v1/shopee-listener','GET',session),
  sandboxRequest<{data:ListenerEvent[]}>(API_ORIGIN,'/api/v1/shopee-listener/events','GET',session),
 ]);
 return {config:config.data,listener:listener.data,signals:signals.data};
}
import { ArrowLeft, ArrowRight, BellRing, CircleHelp, ExternalLink, Info, KeyRound, LockKeyhole, Radio, ShieldAlert, ShieldCheck, Smartphone, Store, Unplug } from 'lucide-react';
import './shopee-partner.css';

type Config = { configured: boolean; environment: 'uat' | 'production' | null; status: 'not_verified'; checkAvailable?: boolean };
type Listener = {status:'unconfigured'|'awaiting_event'|'receiving';providerConnected:false;source:'android_listener';lastSeenAt:string|null;createdAt:string|null};
type ListenerEvent = {id:string;eventId:string|null;sourceApp?:string;title?:string;amount:number|null;receivedAt:string;verification:'unverified_listener_signal'};
type PortalTransaction = {id:string;orderId:string|null;amountIdr:number|null;status:number|null;createdAt:string|null;storeId:string;merchantId:string;paymentVerified:false};
type PortalState = {status:'unconfigured'|'connected'|'session_broken';storeId:string|null;merchantId:string|null;providerConnected:boolean;lastCheckedAt:string|null;lastError:string|null;transactionCount:number};
type Verdict = { verified?: boolean; merchantMatch?: boolean; status?: string; referenceId?: string; amount?: number; data?: Verdict };
const message = (e: unknown) => e instanceof TypeError ? 'Server tidak tersedia atau CORS menolak permintaan. Periksa URL API.' : e instanceof Error ? e.message : 'Permintaan gagal.';

/** Status is scoped to a signed, merchant-matched payment order only. */
export default function ShopeePartner() {
 const sharedSession=useMerchantSession();
 const [email,setEmail]=useState('');
 // Always derive token directly from sharedSession so we never get stuck on stale initial state
 const token=sharedSession?.token||'';
 const [password,setPassword]=useState('');
 const [config,setConfig]=useState<Config|null>(null);
 const [referenceId,setReferenceId]=useState('');
 const [amount,setAmount]=useState('');
 const [verifiedOrder,setVerifiedOrder]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [listener,setListener]=useState<Listener|null>(null);
 const [signals,setSignals]=useState<ListenerEvent[]>([]);
 const [deviceToken,setDeviceToken]=useState('');
 const [listenerBusy,setListenerBusy]=useState(false);
 const [listenerError,setListenerError]=useState('');
 const active=useRef(true);
 const merchantEmailInput=useRef<HTMLInputElement>(null);
 const sequence=useRef(0);
 const [portalStatus,setPortalStatus]=useState<'unconfigured'|'connected'|'session_broken'|null>(null);

 const [registerMerchant,setRegisterMerchant]=useState(false);
 const [merchantName,setMerchantName]=useState('');
 const [portalTokenInput,setPortalTokenInput]=useState('');
 const [portalTransactions,setPortalTransactions]=useState<PortalTransaction[]>([]);
 const [portalBusy,setPortalBusy]=useState(false);
 const [portalError,setPortalError]=useState('');
 const [portalCheckCount,setPortalCheckCount]=useState(0);
 const [portalLastCheck,setPortalLastCheck]=useState<string|null>(null);
 const [portalLastError,setPortalLastError]=useState<string|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current++}},[]);
 useEffect(()=>{if(token)void fetchPortalStatus();},[token]);
 // Reset local state when session changes (login/logout)
 const prevTokenRef=useRef(token);
 useEffect(()=>{
  const prev=prevTokenRef.current;
  prevTokenRef.current=token;
  if(prev===token)return;
  sequence.current++;setConfig(null);setListener(null);setSignals([]);setPortalStatus(null);setPortalTransactions([]);setDeviceToken('');setPortalTokenInput('');
 },[token]);
 useEffect(()=>{if(!token)return;let cancelled=false;void merchantResources(token).then(resources=>{if(cancelled||getMerchantSession()?.token!==token)return;setConfig(resources.config);setListener(resources.listener);setSignals(resources.signals)}).catch(cause=>{if(!cancelled&&getMerchantSession()?.token===token)setError(message(cause))});return()=>{cancelled=true}},[token]);
 async function login(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');setVerifiedOrder('');
  try{if(registerMerchant)await createMerchant(merchantName,email,password);else await signInMerchant(email,password);}
  catch(cause){setError(!registerMerchant&&cause instanceof Error&&cause.message==='Email atau password salah.'?'Akun merchant belum terdaftar di API lokal atau kata sandi salah. Daftar lewat tombol di bawah. Jangan gunakan kata sandi Shopee.':message(cause))}
  finally{setPassword('');setBusy(false)}
 }
 async function check(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const ref=referenceId.trim(),value=Number(amount);
  if(!token||!config?.checkAvailable||!ref||!Number.isSafeInteger(value)||value<=0)return;
  const id=++sequence.current;setBusy(true);setError('');setVerifiedOrder('');
  try{
   const response=await sandboxRequest<Verdict>(API_ORIGIN,'/api/v1/shopeepay/check','POST',token,{referenceId:ref,amount:value});
   if(!active.current||id!==sequence.current)return;
   const result=response?.data??response;
   if(result?.verified===true&&result.merchantMatch===true&&result.status==='paid'&&result.referenceId===ref&&result.amount===value)setVerifiedOrder(ref);
   else setError('Pembayaran order ini belum dapat diverifikasi. Periksa reference ID, nominal, dan kecocokan merchant di server.');
  }catch(cause){if(active.current&&id===sequence.current)setError(message(cause))}
  finally{if(active.current&&id===sequence.current)setBusy(false)}
 }
 async function refreshListener(){
  if(!token)return;
  setListenerBusy(true);setListenerError('');
  try{
   const [state,history]=await Promise.all([
    sandboxRequest<{data:Listener}>(API_ORIGIN,'/api/v1/shopee-listener','GET',token),
    sandboxRequest<{data:ListenerEvent[]}>(API_ORIGIN,'/api/v1/shopee-listener/events','GET',token),
   ]);
   if(active.current){setListener(state.data);setSignals(history.data)}
  }catch(cause){if(active.current)setListenerError(message(cause))}
  finally{if(active.current)setListenerBusy(false)}
 }
 async function pairListener(){
  if(!token||listener?.status!=='unconfigured')return;
  setListenerBusy(true);setListenerError('');
  try{
   const result=await sandboxRequest<{data:Listener;token:string}>(API_ORIGIN,'/api/v1/shopee-listener','POST',token,{});
   if(active.current){setListener(result.data);setDeviceToken(result.token)}
  }catch(cause){if(active.current)setListenerError(message(cause))}
  finally{if(active.current)setListenerBusy(false)}
 }
 async function revokeListener(){
   if(!token||!window.confirm('Cabut token perangkat ini? Aplikasi Android harus dipasangkan ulang agar bisa mengirim notifikasi.'))return;
   setListenerBusy(true);setListenerError('');
   try{
    await sandboxRequest(API_ORIGIN,'/api/v1/shopee-listener','DELETE',token);
    if(active.current){setListener({status:'unconfigured',providerConnected:false,source:'android_listener',lastSeenAt:null,createdAt:null});setDeviceToken('')}
   }catch(cause){if(active.current)setListenerError(message(cause))}
   finally{if(active.current)setListenerBusy(false)}
 }

 async function fetchPortalStatus(){
  if(!token)return;
  const id=sequence.current;
  try{
   const {data}=await sandboxRequest<{data:PortalState}>(API_ORIGIN,'/api/v1/shopee-portal','GET',token);
   if(!active.current||id!==sequence.current)return;
   setPortalStatus(data.status);
   setPortalCheckCount(data.transactionCount);setPortalLastCheck(data.lastCheckedAt);setPortalLastError(data.lastError);
  }catch(cause){if(active.current&&id===sequence.current)setPortalError(message(cause))}
 }
 async function connectPortal(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!token){merchantEmailInput.current?.scrollIntoView({behavior:'smooth',block:'center'});merchantEmailInput.current?.focus();return;}
  const id=sequence.current,t=portalTokenInput.trim();
    if(!t){setPortalError('Token portal wajib diisi.');return}
  setPortalBusy(true);setPortalError('');
  try{
   const {data}=await sandboxRequest<{data:{status:'connected';providerConnected:boolean;transactions:PortalTransaction[]}}>(API_ORIGIN,'/api/v1/shopee-portal','POST',token,{token:t});
   if(!active.current||id!==sequence.current)return;
   if(data.status!=='connected'||!data.providerConnected)throw new Error('Probe provider belum mengonfirmasi koneksi.');
   setPortalStatus('connected');setPortalTokenInput('');setPortalTransactions(data.transactions);setPortalLastError(null);
   await fetchPortalStatus();
  }catch(cause){if(active.current&&id===sequence.current)setPortalError(message(cause))}
  finally{if(active.current&&id===sequence.current)setPortalBusy(false)}
 }
 async function refreshPortalTransactions(){
  if(!token||portalStatus==='unconfigured')return;
  const id=sequence.current;setPortalBusy(true);setPortalError('');
  try{
   const {data}=await sandboxRequest<{data:PortalTransaction[]}>(API_ORIGIN,'/api/v1/shopee-portal/transactions','GET',token);
   if(!active.current||id!==sequence.current)return;
   setPortalTransactions(data);await fetchPortalStatus();
  }catch(cause){if(active.current&&id===sequence.current){setPortalTransactions([]);setPortalError(message(cause));await fetchPortalStatus()}}
  finally{if(active.current&&id===sequence.current)setPortalBusy(false)}
 }
 async function disconnectPortal(){
  if(!token||!window.confirm('Putuskan koneksi Shopee Partner? Token tersimpan akan dihapus.'))return;
  const id=sequence.current;setPortalBusy(true);setPortalError('');
  try{
   await sandboxRequest(API_ORIGIN,'/api/v1/shopee-portal','DELETE',token);
   if(active.current&&id===sequence.current){setPortalStatus('unconfigured');setPortalTokenInput('');setPortalTransactions([]);setPortalCheckCount(0);setPortalLastCheck(null);setPortalLastError(null)}
  }catch(cause){if(active.current&&id===sequence.current)setPortalError(message(cause))}
  finally{if(active.current&&id===sequence.current)setPortalBusy(false)}
 }
 function disconnect(){signOutMerchant();sequence.current++;setPassword('');setEmail('');setConfig(null);setReferenceId('');setAmount('');setVerifiedOrder('');setListener(null);setSignals([]);setDeviceToken('');setListenerError('');setError('');setBusy(false);setPortalStatus(null);setPortalTokenInput('');setPortalTransactions([]);setPortalError('');setPortalLastError(null);setPortalCheckCount(0);setPortalLastCheck(null)}
 const validOrder=referenceId.trim().length>0&&Number.isSafeInteger(Number(amount))&&Number(amount)>0;
 return <div className="shopee-page">
  <Link to="/dashboard/detectors" className="back-link"><ArrowLeft size={16}/> Semua detektor</Link>
  <header className="shopee-heading"><span className="shopee-eyebrow"><Radio size={15}/> DETEKTOR PEMBAYARAN <span>/</span> SHOPEEPAY</span><h1>Shopee Partner</h1><p>Detektor token portal untuk membaca mutasi toko, terpisah dari pemeriksaan order ShopeePay resmi. Pembacaan mutasi belum memverifikasi settlement.</p></header>
  <div className="shopee-status" role="status">{verifiedOrder?<ShieldCheck size={20} aria-hidden="true"/>:<ShieldAlert size={20} aria-hidden="true"/>}<div><strong>{verifiedOrder?`Terverifikasi untuk order ${verifiedOrder}`:'Belum terverifikasi'}</strong><span>{verifiedOrder?'Backend mengonfirmasi pembayaran dan kecocokan order merchant. Hasil ini hanya berlaku untuk order tersebut, bukan monitoring QRIS otomatis.':'Belum ada hasil pemeriksaan bertanda tangan yang cocok dengan order merchant. Tidak ada pembayaran yang ditandai berhasil.'}</span></div></div>
  <div className="shopee-layout"><main className="shopee-main">
   <section className="card shopee-portal-option" aria-labelledby="shopee-portal-option-title" data-testid="portal-connection">
    <span className="shopee-kicker">DETEKTOR QRIS · TOKEN PORTAL</span><h2 id="shopee-portal-option-title">Shopee Partner</h2>
    <p>Hubungkan token <code>data.metadata.token</code> dari portal partner.shopee.co.id. Server hanya menandai terhubung setelah berhasil membaca cakupan merchant dan toko. Feed mutasi bersifat baca-saja dan <strong>bukan bukti pembayaran terverifikasi</strong>.</p>
    <p role="status" data-testid="portal-state"><strong>{!token?'Masuk ke akun merchant dahulu':portalStatus==='connected'?'Terhubung':portalStatus==='session_broken'?'Perlu dihubungkan ulang (SESSION_BROKEN)':portalStatus==='unconfigured'?'Belum terhubung':'Memuat status…'}</strong>{portalLastCheck?` · cek terakhir ${new Date(portalLastCheck).toLocaleString('id-ID')}`:''}{portalCheckCount?` · ${portalCheckCount} transaksi pada cek terakhir`:''}</p>
    {portalStatus==='session_broken'&&<p className="shopee-error">Sesi Shopee Partner berakhir. Ambil token baru; listener Android tetap dapat menerima sinyal notifikasi sebagai cadangan, bukan verifikasi settlement.</p>}
    {portalLastError&&<p className="shopee-help">Diagnostik: {portalLastError}</p>}
    <ol className="shopee-portal-steps"><li>Pasang QRIS statis toko di tab QRIS Saya (sekali saja).</li><li>Buka <a href="https://partner.shopee.co.id/" target="_blank" rel="noopener noreferrer">partner.shopee.co.id <ExternalLink size={14}/></a> → F12 → Network → filter <code>get-transaction-list</code> → Request Payload → salin <code>data.metadata.token</code>.</li><li>Tempel token, lalu klik Hubungkan &amp; verifikasi. Server membaca transaksi dan memastikan hanya satu cakupan toko/merchant; bila feed kosong atau bercampur, koneksi tidak akan diklaim berhasil. Jangan anggap feed sebagai settlement.</li></ol>
    <form className="shopee-portal-form" autoComplete="off" onSubmit={connectPortal}>
      <label htmlFor="portal-transaction-token">Token dari portal Shopee (wajib)</label><textarea id="portal-transaction-token" rows={3} value={portalTokenInput} onChange={e=>setPortalTokenInput(e.target.value)} placeholder="Tempel data.metadata.token, biasanya diawali B:" autoComplete="off" spellCheck={false} required/>
      <small>Cookie portal saja tidak cukup. Token hanya dikirim ke server DitsGate untuk probe, lalu disimpan terenkripsi jika terbukti dapat membaca cakupan toko.</small>

      <div className="shopee-portal-actions"><button className="button primary" type={token?'submit':'button'} onClick={!token?()=>{merchantEmailInput.current?.scrollIntoView({behavior:'smooth',block:'center'});merchantEmailInput.current?.focus()}:undefined} disabled={portalBusy}>{!token?'Masuk untuk menghubungkan':portalBusy?'Memeriksa portal…':'Hubungkan & verifikasi'}</button><button className="button secondary" type="button" onClick={()=>void refreshPortalTransactions()} disabled={!token||portalBusy||portalStatus==='unconfigured'||portalStatus===null}>Segarkan mutasi</button><button className="button secondary" type="button" onClick={()=>void disconnectPortal()} disabled={!token||portalBusy||portalStatus==='unconfigured'||portalStatus===null}>Putuskan</button></div>
    </form>
    {portalError&&<p className="shopee-error" role="alert">{portalError}</p>}
    {portalTransactions.length>0&&<div className="shopee-signals"><h3>Mutasi terbaru · belum diverifikasi untuk settlement</h3><ul>{portalTransactions.map(row=><li key={row.id}><span>{row.orderId||row.id}</span><strong>{row.amountIdr==null?'Nominal tidak terbaca':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(row.amountIdr)}</strong><small>{row.createdAt?new Date(row.createdAt).toLocaleString('id-ID'):'Waktu tidak tersedia'} · belum terverifikasi</small></li>)}</ul></div>}
    <p className="shopee-help">Login akun Shopee dilakukan hanya di situs resmi Shopee, bukan di DitsGate. API ShopeePay resmi untuk order merupakan jalur berbeda dari token sesi portal ini.</p>
   </section>
   <section className="card shopee-hero" aria-labelledby="shopee-api-title"><div className="shopee-hero-top"><span className="shopee-brand"><Store size={24}/></span><span className="shopee-pill"><span className="shopee-dot"/> {config?.configured?`API ${config.environment?.toUpperCase()??'BELUM DIPILIH'} dikonfigurasi`:'Konfigurasi belum tersedia'}</span></div><span className="shopee-kicker">SUMBER PEMBAYARAN · API RESMI</span><h2 id="shopee-api-title">Pemeriksaan status ShopeePay</h2><p>Gunakan reference ID dan nominal order ShopeePay milik merchant Anda. Server memverifikasi respons resmi dan kecocokan merchant; halaman ini tidak menerima kredensial provider.</p><div className="shopee-hero-meta"><span><Radio size={16}/> Mode <b>{config?(config.environment?.toUpperCase()??'BELUM DIPILIH'):'Belum diketahui'}</b></span><span><ShieldCheck size={16}/> Verifikasi order <b>{verifiedOrder?'Satu order cocok':'Belum terverifikasi'}</b></span></div><form className="shopee-order-form" onSubmit={check}><label htmlFor="shopee-reference">Reference ID order ShopeePay</label><input id="shopee-reference" value={referenceId} onChange={e=>{setReferenceId(e.target.value);setVerifiedOrder('')}} required maxLength={120} autoComplete="off" placeholder="Reference ID dari order merchant"/><label htmlFor="shopee-amount">Nominal order (Rp)</label><input id="shopee-amount" type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e=>{setAmount(e.target.value);setVerifiedOrder('')}} required placeholder="Contoh: 50000"/><div className="shopee-actions"><button className="button primary" type="submit" disabled={!token||!config?.checkAvailable||!validOrder||busy}><LockKeyhole size={16}/> {busy&&token?'Memeriksa order…':'Hubungkan & verifikasi'}</button><button className="button secondary" type="button" onClick={disconnect} disabled={!token||busy}><Unplug size={16}/> Putuskan</button></div></form>{config?.configured&&!config.checkAvailable&&<p className="shopee-help">Kredensial onboarding terdeteksi di server, tetapi pemeriksaan live belum aktif. Backend belum memiliki order ShopeePay yang dibuat dan terikat pada merchant, serta nama header tanda tangan respons masih perlu dikonfirmasi dari ShopeePay. Tombol sengaja nonaktif; QRIS statis dan order demo tidak dapat dipakai untuk verifikasi ini.</p>}{!config?.configured&&<p className="shopee-help">{token?'API belum dikonfigurasi di server. ':'Masuk ke akun merchant, lalu periksa konfigurasi API. '}Atur ShopeePay Client ID dan Secret Key dari onboarding sebagai environment variable <strong>di backend saja</strong>, pilih UAT atau production, jalankan ulang server, kemudian periksa order ShopeePay yang sudah dibuat.</p>}</section>
   <section className="card shopee-setup" aria-labelledby="shopee-setup-title"><div className="shopee-section-head"><span className="shopee-section-icon"><KeyRound size={20}/></span><div><span className="shopee-kicker">AKSES MERCHANT</span><h2 id="shopee-setup-title">Masuk ke akun merchant</h2><p>Gunakan sesi merchant DitsGate yang sama dengan dashboard. Mode demo browser tidak membuka koneksi portal; jangan gunakan kata sandi Shopee di sini.</p></div></div>{token?<div className="shopee-session-info"><p className="shopee-session">✅ Masuk sebagai <strong>{sharedSession?.user?.name||sharedSession?.user?.email||'Merchant'}</strong> ({sharedSession?.user?.email||'—'}). {config?.configured?'Kredensial API ada, tetapi pemeriksaan live belum tersedia sampai order provider tersimpan.':'API ShopeePay belum dikonfigurasi di server.'}</p><button className="button secondary" type="button" onClick={disconnect} style={{marginTop:'0.5rem'}}><Unplug size={14}/> Keluar dari sesi ini</button></div>:<form className="shopee-login-form" onSubmit={login}>{registerMerchant&&<><label htmlFor="shopee-merchant-name">Nama akun merchant</label><input id="shopee-merchant-name" value={merchantName} onChange={e=>setMerchantName(e.target.value)} minLength={2} maxLength={100} required/></>}<label htmlFor="shopee-email">Email akun merchant</label><input ref={merchantEmailInput} id="shopee-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/><label htmlFor="shopee-password">Kata sandi akun merchant</label><input id="shopee-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/><button className="button secondary" type="submit" disabled={busy}>{busy?'Menghubungkan…':registerMerchant?'Daftar dan masuk':'Masuk ke akun merchant'}</button><button className="button secondary" type="button" onClick={()=>{setRegisterMerchant(value=>!value);setError('')}} disabled={busy}>{registerMerchant?'Sudah punya akun? Masuk':'Buat akun merchant lokal'}</button>{registerMerchant&&<p className="shopee-help">Akun ini hanya untuk backend sandbox DitsGate lokal, bukan akun Shopee. Kata sandi minimal 12 karakter.</p>}</form>}{error&&<p className="shopee-error" role="alert">{error}</p>}<div className="shopee-notice"><Info size={18} aria-hidden="true"/><p>Login merchant hanya untuk backend DitsGate. Jangan tempel ShopeePay Secret Key di browser. Sesi merchant hanya berada dalam memori halaman. Token portal hanya dikirim ke backend DitsGate saat Anda menekan Hubungkan & verifikasi.</p></div></section>
   <section className="card shopee-guide" aria-labelledby="shopee-guide-title"><div className="shopee-guide-intro"><span className="shopee-kicker">PANDUAN</span><h2 id="shopee-guide-title">Batas integrasi</h2><p>API resmi memeriksa satu payment order yang dibuat melalui ShopeePay.</p></div><ol><li><b>Konfigurasi di backend</b><span>Simpan Client ID dan Secret Key resmi sebagai environment variable server sesuai panduan backend, bukan di halaman ini.</span></li><li><b>Siapkan order merchant</b><span>Masukkan reference ID dan nominal order ShopeePay yang dikenal oleh backend merchant.</span></li><li><b>Periksa hasil bertanda tangan</b><span>Status dibayar hanya ditampilkan jika backend memverifikasi respons resmi dan mencocokkan transaksi ke merchant dan order.</span></li></ol><p>Order ShopeePay ini berbeda dari transaksi portal Shopee Partner maupun QRIS statis. Pemeriksaan ini <strong>tidak memonitor QRIS statis secara otomatis</strong>.</p><Link to="/dashboard/qris" className="shopee-text-link">Buka QRIS Saya <ArrowRight size={16}/></Link></section>
  </main><aside className="shopee-aside">
   <section className="card shopee-diagnostics" aria-labelledby="shopee-diagnostics-title"><span className="shopee-kicker">STATUS SESI</span><h2 id="shopee-diagnostics-title">Diagnostik koneksi</h2><dl><div><dt>Provider</dt><dd>ShopeePay API</dd></div><div><dt>Akun merchant</dt><dd>{token?'Masuk':'Belum masuk'}</dd></div><div><dt>Akses API</dt><dd>{config?.configured?'Dikonfigurasi':'Belum dikonfirmasi'}</dd></div><div><dt>Lingkungan</dt><dd>{config?.environment?.toUpperCase()??'Belum diketahui'}</dd></div><div><dt>Verifikasi order</dt><dd>{verifiedOrder?'Satu order cocok':'Belum terverifikasi'}</dd></div></dl><p><CircleHelp size={15}/> Konfigurasi API saja tidak membuktikan pembayaran. Hanya hasil order cocok dari server yang dapat diverifikasi.</p></section>
   <section className="card shopee-fallback" aria-labelledby="shopee-fallback-title">
    <span className="shopee-fallback-icon"><Smartphone size={21}/><BellRing size={13}/></span><span className="shopee-kicker">JALUR ALTERNATIF · LOKAL</span>
    <h2 id="shopee-fallback-title">Listener notifikasi Android</h2>
    <p>Pasangkan aplikasi listener milik Anda untuk menerima sinyal notifikasi. Ini tidak menghubungkan Shopee Partner dan tidak membuktikan pembayaran.</p>
    <p data-testid="listener-state" role="status"><strong>{!token?'Masuk untuk melihat listener':listener?.status==='receiving'?'Sinyal diterima':listener?.status==='awaiting_event'?'Menunggu notifikasi':'Perangkat belum dipasangkan'}</strong>{listener?.lastSeenAt?` · terakhir ${new Date(listener.lastSeenAt).toLocaleString('id-ID')}`:''}</p>
    {token&&<div className="shopee-listener-controls">
      {listener?.status==='unconfigured'&&<button className="button primary" type="button" onClick={()=>void pairListener()} disabled={listenerBusy}>Pasangkan listener</button>}
      <button className="button secondary" type="button" onClick={()=>void refreshListener()} disabled={listenerBusy}>Segarkan sinyal</button>
      {listener?.status!=='unconfigured'&&<button className="button secondary" type="button" onClick={()=>void revokeListener()} disabled={listenerBusy}>Cabut token perangkat</button>}
    </div>}
    {deviceToken&&<div className="shopee-token-reveal"><strong>Token perangkat — hanya ditampilkan sekali</strong><code data-testid="listener-token">{deviceToken}</code><button className="button secondary" type="button" onClick={()=>setDeviceToken('')}>Sembunyikan token</button><small>Gunakan hanya di aplikasi listener milik Anda. Jangan bagikan atau simpan di browser publik.</small></div>}
    {listenerError&&<p className="shopee-error" role="alert">{listenerError}</p>}
    {signals.length>0&&<div className="shopee-signals"><h3>Sinyal terbaru</h3><ul>{signals.slice(0,10).map(signal=><li key={signal.id}><span>{signal.title||signal.sourceApp||'ShopeePay listener'}</span><strong>{signal.amount==null?'Nominal tidak terbaca':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(signal.amount)}</strong><small>Belum terverifikasi · {new Date(signal.receivedAt).toLocaleString('id-ID')}</small></li>)}</ul></div>}
    <p>Notifikasi hanya sinyal untuk rekonsiliasi dengan mutasi dan order, <strong>bukan bukti settlement</strong>.</p>
   </section>
   <a className="shopee-external" href="https://qrisgate.web.id/docs" target="_blank" rel="noopener noreferrer">Dokumentasi publik QRISGate <ExternalLink size={14}/></a>
  </aside></div>
 </div>;
}
