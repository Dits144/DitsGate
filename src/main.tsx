import React,{useState,useEffect,useRef} from 'react';
import{createRoot}from'react-dom/client';
import{BrowserRouter,Link,NavLink,Navigate,Route,Routes,useLocation,useNavigate,useParams}from'react-router-dom';
import{LayoutDashboard,QrCode,BookOpen,Radio,ArrowLeftRight,ReceiptText,Code2,CreditCard,Settings,Building2,Menu,X,Plus,RefreshCw,Copy,Download,ChevronDown,ChevronRight,LogOut,Sun,Moon,Bell,Search,Check,Clock,ShieldCheck,ArrowUpRight,Wallet,PanelLeftClose,PanelLeftOpen,ExternalLink,Eye,CheckCircle2,AlertCircle,MessageSquare}from'lucide-react';
import{ResponsiveContainer,AreaChart,Area,CartesianGrid,XAxis,YAxis,Tooltip}from'recharts';
import{useDemo,initial,providers,idr,date,statusText,createPayment,changeStatus,csv,type DemoState,type PaymentTransaction,type BankAccount}from'./store';
import'./style.css';
import Landing from './Landing';
import GuidePage from './Guide';
import QrisPage from './QrisPage';
import CheckoutQr from './CheckoutQr';
import ShopeePartner from './ShopeePartner';
import AdminOperations from './AdminOperations';
import DeveloperSettings from './DeveloperSettings';
import SubscriptionPage from './SubscriptionPage';
import {TicketList,NewTicket,TicketDetail} from './SupportTickets';
import {useMerchantSession,signInMerchant,registerMerchant,signOutMerchant,restoreMerchantSession} from './merchant-session';
import {API_ORIGIN} from './developer-api';
import {useParams as useDetectorParams} from 'react-router-dom';
import ProviderDetector, {type DetectorProviderId} from './ProviderDetector';
import {ProviderIcon} from './ProviderIcon';
import {motion} from 'framer-motion';
import gsap from 'gsap';
import Lenis from 'lenis';

function DetectorRoute(){
 const {id}=useDetectorParams();
 if(id==='shopee')return <ShopeePartner/>;
 if(id==='gopay'||id==='bca'||id==='linkaja'||id==='bri'||id==='mandiri'||id==='listener')return <ProviderDetector id={id as DetectorProviderId}/>;
 return <Empty title="Provider tidak ditemukan" desc="Kembali ke daftar detektor."/>;
}

type Setter=React.Dispatch<React.SetStateAction<DemoState>>;
type Props={s:DemoState;set:Setter;notify:(m:string)=>void};
const copy=async(text:string,notify:(m:string)=>void)=>{try{await navigator.clipboard.writeText(text);notify('Disalin ke clipboard')}catch{notify('Clipboard tidak tersedia di konteks ini')}};
const download=(name:string,content:string,type='text/plain')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
const Badge=({children,tone='muted'}:{children:React.ReactNode;tone?:string})=><span className={'badge '+tone}>{children}</span>;
const Head=({title,desc,actions}:{title:string;desc:string;actions?:React.ReactNode})=><div className="page-head"><div><h1>{title}</h1><p>{desc}</p></div>{actions&&<div className="head-actions">{actions}</div>}</div>;
const Empty=({title,desc,action}:{title:string;desc:string;action?:React.ReactNode})=><div className="empty"><div className="empty-icon"><ReceiptText size={22}/></div><h3>{title}</h3><p>{desc}</p>{action}</div>;

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement;
  ref.current?.querySelector<HTMLElement>('input,button,select')?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape')close();
   if(e.key==='Tab'){
    const nodes=[...ref.current!.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter(n=>!n.hasAttribute('disabled'));
    if(!nodes.length)return;
    const i=nodes.indexOf(document.activeElement as HTMLElement);
    if(e.shiftKey&&i===0){e.preventDefault();nodes.at(-1)?.focus()}
    else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0].focus()}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);previous?.focus()};
 },[close]);
 return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="Tutup" onClick={close}><X size={18}/></button></div>{children}</div></div>;
}

function CreatePayment({s,set,notify,close,onRefreshBalance}:{s:DemoState;set:Setter;notify:(m:string)=>void;close:()=>void;onRefreshBalance?:()=>void}){
 const merchant=useMerchantSession();
 const nav=useNavigate();
 const[orderId,order]=useState(''),[amount,amt]=useState(''),[method,met]=useState('QRIS'),[description,desc]=useState(''),[expiration,exp]=useState(30),[customer,cust]=useState(''),[busy,setBusy]=useState(false),[error,err]=useState('');
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();err('');
  if(merchant?.token){
   setBusy(true);
   try{
    const headers:Record<string,string>={'Content-Type':'application/json',...(merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{})};
    const r=await fetch(API_ORIGIN+'/api/v1/transactions',{method:'POST',credentials:'include',headers,body:JSON.stringify({order_id:orderId.trim(),amount:Number(amount),expirationMinutes:expiration})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'Gagal membuat order');
    onRefreshBalance?.();
    notify('Order dibuat · Rp 100 biaya ditahan');
    close();nav('/dashboard/transactions');
   }catch(ex){err((ex as Error).message)}finally{setBusy(false)}
   return;
  }
  try{const next=createPayment(s,{orderId,amount:Number(amount),method,description,expiration,customer});set(next);notify('Order pembayaran dibuat');close();nav('/dashboard/transactions')}catch(ex){err((ex as Error).message)}
 };
 return <Modal title="Buat Pembayaran" close={close}><form onSubmit={submit}><div className="form-grid"><label>Order ID eksternal <input required value={orderId} onChange={e=>order(e.target.value)} placeholder="ORDER-001"/></label><label>Nominal (minimal Rp 1.000) <input required type="number" min="1000" step="1" value={amount} onChange={e=>amt(e.target.value)} placeholder="50000"/></label><label>Metode <select value={method} onChange={e=>met(e.target.value)}><option>QRIS</option><option>Transfer Bank</option></select></label><label>Berlaku selama <select value={expiration} onChange={e=>exp(Number(e.target.value))}><option value={15}>15 menit</option><option value={30}>30 menit</option><option value={60}>60 menit</option><option value={1440}>24 jam</option></select></label><label className="full">Deskripsi (opsional)<input value={description} onChange={e=>desc(e.target.value)} placeholder="Pembelian produk"/></label><label className="full">Referensi pelanggan (opsional)<input value={customer} onChange={e=>cust(e.target.value)} placeholder="CUST-001"/></label></div>{error&&<p className="error" role="alert">{error}</p>}<div className="info-line">Biaya platform Rp 100 ditahan saat transaksi dibuat; dikembalikan otomatis jika gagal/batal/kedaluwarsa.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Batal</button><button className="button primary" type="submit" disabled={busy}>{busy?'Memproses...':'Buat Order'}</button></div></form></Modal>;
}

type NavItem=[string,string,typeof LayoutDashboard,string?];
const sections:{label:string;items:NavItem[]}[]=[
 {label:'UTAMA',items:[['/dashboard','Dashboard',LayoutDashboard],['/dashboard/qris','QRIS Saya',QrCode],['/dashboard/integration-guide','Panduan Integrasi',BookOpen],['/dashboard/detectors','Detektor Pembayaran',Radio]]},
 {label:'PROVIDER DETECTION',items:providers.map(p=>['/dashboard/detectors/'+p.id,p.name,Radio,p.id])},
 {label:'TRANSAKSI',items:[['/dashboard/transactions','Transaksi',ReceiptText],['/dashboard/mutations','Mutasi Masuk',ArrowLeftRight],['/dashboard/support','Tiket Pengaduan',MessageSquare]]},
 {label:'AKUN',items:[['/dashboard/developers','API & Webhook',Code2],['/dashboard/subscription','Langganan',CreditCard],['/dashboard/settings','Pengaturan',Settings],['/dashboard/banks','Rekening Bank',Building2],['/dashboard/admin','Panel Admin',ShieldCheck]]}
];

function Shell({p,authChecked}:{p:Props;authChecked:boolean}){
 const merchant=useMerchantSession();
 const[portalBroken,setPortalBroken]=useState(false);
 const[serverBalance,setServerBalance]=useState<number|null>(null);
 const[heldBalance,setHeldBalance]=useState<number>(0);
 const refreshBalance=React.useCallback(()=>{
  if(!merchant?.token){setServerBalance(null);setHeldBalance(0);return;}
  const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
  fetch(API_ORIGIN+'/api/v1/balance',{credentials:'include',headers}).then(r=>r.ok?r.json():null).then(d=>{if(typeof d?.balance==='number')setServerBalance(d.balance);if(typeof d?.heldBalance==='number')setHeldBalance(d.heldBalance)}).catch(()=>{});
 },[merchant?.token]);
 useEffect(()=>{
  if(!merchant?.token){setPortalBroken(false);setServerBalance(null);setHeldBalance(0);return;}
  let cancelled=false;
  const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
  fetch(API_ORIGIN+'/api/v1/shopee-portal',{credentials:'include',headers}).then(r=>r.ok?r.json():null).then(d=>{if(!cancelled)setPortalBroken(d?.data?.status==='session_broken')}).catch(()=>{});
  fetch(API_ORIGIN+'/api/v1/balance',{credentials:'include',headers}).then(r=>r.ok?r.json():null).then(d=>{if(!cancelled&&typeof d?.balance==='number'){setServerBalance(d.balance);if(typeof d?.heldBalance==='number')setHeldBalance(d.heldBalance)}}).catch(()=>{});
  return()=>{cancelled=true};
 },[merchant?.token]);

 const[mobile,setMobile]=useState(false),[collapsed,setCollapsed]=useState(false),[create,setCreate]=useState(false),[account,setAccount]=useState(false),[alert,setAlert]=useState(false);
 const loc=useLocation();
 useEffect(()=>{setMobile(false);setAccount(false)},[loc.pathname]);
 useEffect(()=>{document.documentElement.dataset.theme=p.s.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p.s.theme},[p.s.theme]);
 useEffect(()=>{
  if(typeof window==='undefined'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const lenis=new Lenis({
   duration:0.85,
   smoothWheel:true,
   prevent:(node)=>Boolean(node instanceof Element&&node.closest('.sidebar, .modal, .popover, textarea, select'))
  });
  let raf=0;
  const tick=(time:number)=>{lenis.raf(time);raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);lenis.destroy();};
 },[]);
 useEffect(()=>{
  if(typeof window==='undefined'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const ctx=gsap.context(()=>{
   gsap.fromTo('.page-head',{opacity:0,y:8},{opacity:1,y:0,duration:0.35,ease:'power2.out',clearProps:'transform'});
  });
  return()=>ctx.revert();
 },[loc.pathname]);

 if(!authChecked)return <div className="empty" style={{minHeight:'100vh',justifyContent:'center'}}><p>Memeriksa sesi...</p></div>;
 if(!merchant)return <Navigate to="/login" replace state={{from:loc.pathname}}/>;

 const isAdmin=merchant.user.role==='admin';
 const visibleSections=sections.map(g=>g.label==='AKUN'?{...g,items:g.items.filter(([path])=>path!=='/dashboard/admin'||isAdmin)}:g);
 const title=visibleSections.flatMap(g=>g.items).find(i=>i[0]===loc.pathname)?.[1]||'Dashboard';
 const balanceShown=serverBalance??p.s.balance;

 return <div className={'shell '+(collapsed?'collapsed':'')}>
  <div className={'sidebar-backdrop '+(mobile?'open':'')} onClick={()=>setMobile(false)}/>
  <aside className={'sidebar '+(mobile?'mobile-open':'')}>
   <div className="brand"><Link to="/dashboard" className="brand-mark">D</Link><div className="brand-text"><strong>DitsGate</strong><small>Payment infrastructure</small></div><button aria-label="Tutup menu" className="icon-btn mobile-close" onClick={()=>setMobile(false)}><X size={18}/></button></div>
   <div className="sidebar-scroll" data-lenis-prevent>
    <div className="balance"><div className="balance-title">Saldo biaya <Wallet size={15}/></div><strong>{idr(balanceShown)}</strong>{heldBalance>0&&<small style={{display:'block',color:'var(--muted)',marginBottom:6}}>Ditahan: {idr(heldBalance)}</small>}<Link to="/dashboard/topup" className="button secondary balance-btn"><Plus size={14}/> Top Up</Link></div>
    {visibleSections.map(group=><nav key={group.label} aria-label={group.label} className="nav-group"><div className="nav-title">{group.label}</div>{group.items.map(([path,label,Icon,providerId])=><NavLink key={path} to={path} end={path==='/dashboard'} className={({isActive})=>'nav-link '+(isActive?'active':'')} title={label}>{providerId?<ProviderIcon id={providerId} size={18}/>:<Icon size={17}/>}<span>{label}</span></NavLink>)}</nav>)}
   </div>
   <div className="sidebar-foot"><Link to="/" className="nav-link" title="Beranda publik"><ExternalLink size={17}/><span>Beranda publik</span></Link><button className="nav-link collapse-btn" onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed?'Perluas sidebar':'Ciutkan sidebar'}>{collapsed?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}<span>Ciutkan sidebar</span></button></div>
  </aside>
  <div className="main-area">
   <header className="topbar">
    <div className="top-left"><button className="icon-btn menu-trigger" aria-label="Buka menu" onClick={()=>setMobile(true)}><Menu size={20}/></button><span className="breadcrumb">Workspace <ChevronRight size={14}/> <b>{title}</b></span></div>
    <div className="top-right">
     <Badge tone="blue">{merchant.user.role==='admin'?'ADMIN':'MERCHANT'}</Badge>
     <button className="icon-btn" aria-label="Ubah tema" title="Ubah tema" onClick={()=>p.set(v=>({...v,theme:v.theme==='light'?'dark':'light'}))}>{p.s.theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button>
     <div className="relative"><button className="icon-btn" aria-label="Notifikasi" onClick={()=>setAlert(v=>!v)}><Bell size={18}/></button>{alert&&<div className="popover"><b>Notifikasi</b><p>{portalBroken?'Sesi Shopee Partner berakhir. Hubungkan ulang di Detektor.':'Belum ada notifikasi baru.'}</p></div>}</div>
     <div className="relative"><button className="account-btn" aria-label="Menu akun" onClick={()=>setAccount(v=>!v)}><span className="avatar">{merchant?.user.name.slice(0,2).toUpperCase()||'DG'}</span><span>{merchant?.user.name||'Masuk Akun'}</span><ChevronDown size={14}/></button>
      {account&&<div className="popover account-pop">
       <b>{merchant?.user.name||'Belum Masuk'}</b><small>{merchant?.user.email||'Silakan masuk untuk sinkronisasi server'}</small>
       {!merchant&&<Link to="/login">Masuk / Daftar</Link>}
       <Link to="/dashboard/settings">Profil merchant</Link><Link to="/dashboard/banks">Rekening bank</Link><Link to="/dashboard/developers">Integrasi</Link><Link to="/dashboard/integration-guide">Dokumentasi</Link>
       <button onClick={()=>p.set(v=>({...v,theme:v.theme==='dark'?'light':'dark'}))}>Mode terang/gelap</button>
       {merchant&&<button onClick={()=>{signOutMerchant();setAccount(false);p.notify('Berhasil keluar dari akun.')}}><LogOut size={14}/> Keluar</button>}
      </div>}
     </div>
    </div>
   </header>
   <main className="content">
    {!merchant&&<div className="notice"><ShieldCheck size={16}/><span><strong>Belum masuk akun merchant.</strong> <Link to="/login" style={{textDecoration:'underline',fontWeight:600}}>Masuk</Link> atau <Link to="/register" style={{textDecoration:'underline',fontWeight:600}}>daftar</Link> untuk mengelola QRIS, API key, detektor pembayaran, dan transaksi nyata.</span></div>}
    {portalBroken&&<div className="notice" role="status"><AlertCircle size={16}/><span><strong>Sesi Shopee Partner berakhir.</strong> Shopee Partner tidak bisa dibaca server lagi. Hubungkan ulang akunnya; selama belum, aplikasi listener Android tetap mendeteksi pembayaran.</span><Link to="/dashboard/detectors/shopee" className="button secondary" style={{marginLeft:'auto'}}>Buka detektor</Link></div>}
    <Routes>
     <Route index element={<Overview {...p} serverBalance={serverBalance} open={()=>setCreate(true)}/>}/>
     <Route path="qris" element={<QrisPage {...p}/>}/>
     <Route path="integration-guide" element={<GuidePage notify={p.notify}/>}/>
     <Route path="detectors" element={<Detectors {...p}/>}/>
     <Route path="detectors/:id" element={<DetectorRoute/>}/>
     <Route path="transactions" element={<Transactions {...p} onRefreshBalance={refreshBalance} open={()=>setCreate(true)}/>}/>
     <Route path="mutations" element={<Mutations {...p}/>}/>
     <Route path="support" element={<TicketList notify={p.notify}/>}/>
     <Route path="support/new" element={<NewTicket notify={p.notify}/>}/>
     <Route path="support/:id" element={<TicketDetail notify={p.notify}/>}/>
     <Route path="developers" element={<DeveloperSettings {...p}/>}/>
     <Route path="subscription" element={<SubscriptionPage balance={balanceShown} notify={p.notify}/>}/>
     <Route path="topup" element={<Topup {...p} serverBalance={serverBalance} onRefreshBalance={refreshBalance}/>}/>
     <Route path="settings" element={<SettingsPage {...p}/>}/>
     <Route path="banks" element={<Banks {...p}/>}/>
     <Route path="admin" element={isAdmin?<AdminOperations notify={p.notify}/>:<Empty title="Akses ditolak" desc="Halaman ini hanya tersedia untuk administrator."/>}/>
     <Route path="*" element={<Empty title="Halaman tidak ditemukan" desc="Pilih halaman dari menu di samping."/>}/>
    </Routes>
   </main>
  </div>
  <nav className="bottom-nav" aria-label="Navigasi cepat">
   <NavLink to="/dashboard" end><LayoutDashboard size={19}/>Beranda</NavLink>
   <NavLink to="/dashboard/qris"><QrCode size={19}/>QRIS</NavLink>
   <NavLink to="/dashboard/transactions"><ReceiptText size={19}/>Transaksi</NavLink>
   <button onClick={()=>setMobile(true)}><Menu size={19}/>Menu</button>
  </nav>
  {create&&<CreatePayment {...p} onRefreshBalance={refreshBalance} close={()=>setCreate(false)}/>}
 </div>;
}

function Overview(p:Props&{open:()=>void;serverBalance:number|null}){
 const merchant=useMerchantSession();
 const[period,setPeriod]=useState(7);
 const[serverTx,setServerTx]=useState<PaymentTransaction[]|null>(null);
 const[serverLedger,setServerLedger]=useState<Array<{id:string;kind:string;amount:number;note?:string|null;createdAt:string;sourceId:string}>|null>(null);
 const[hasQris,setHasQris]=useState(false);
 const[hasDetector,setHasDetector]=useState(false);
 const[hasKey,setHasKey]=useState(false);
 const[hasWebhook,setHasWebhook]=useState(false);

 const refresh=async()=>{
  if(!merchant?.token){setServerTx(null);setServerLedger(null);return;}
  const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
  const opts={credentials:'include' as const,headers};
  try{
   const[txR,ledR,qR,pR,lR,kR,wR]=await Promise.all([
    fetch(API_ORIGIN+'/api/v1/transactions',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/ledger',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/qris',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/shopee-portal',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/shopee-listener',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/api-keys',opts).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(API_ORIGIN+'/api/v1/webhook-settings',opts).then(r=>r.ok?r.json():null).catch(()=>null),
   ]);
   if(Array.isArray(txR?.data))setServerTx(txR.data.map((r:any)=>({id:r.id,orderId:r.orderId,amount:r.amount,uniqueCode:r.uniqueCode,method:'QRIS',status:r.status,createdAt:r.createdAt,expiresAt:r.expiresAt,description:'',customer:''})));
   if(Array.isArray(ledR?.data))setServerLedger(ledR.data);
   if(qR)setHasQris(Array.isArray(qR.data)&&qR.data.length>0);
   if(pR||lR)setHasDetector(pR?.data?.status==='connected'||lR?.data?.status==='receiving'||lR?.data?.status==='awaiting_event');
   if(kR)setHasKey(Array.isArray(kR.data)&&kR.data.some((k:any)=>!k.revokedAt));
   if(wR)setHasWebhook(Boolean(wR.data?.url));
  }catch{}
 };
 useEffect(()=>{void refresh();},[merchant?.token]);

 const t=serverTx??p.s.transactions;
 const paid=t.filter(x=>x.status==='paid');
 const pending=t.filter(x=>x.status==='pending');
 const done=t.filter(x=>x.status!=='pending');
 const today=new Date().toDateString();
 const stats=[
  ['Volume Hari Ini',idr(paid.filter(x=>new Date(x.createdAt).toDateString()===today).reduce((a,x)=>a+x.amount,0)),`${paid.filter(x=>new Date(x.createdAt).toDateString()===today).length} transaksi lunas`,Wallet],
  ['Volume Keseluruhan',idr(paid.reduce((a,x)=>a+x.amount,0)),`${paid.length} transaksi lunas`,ArrowUpRight],
  ['Menunggu Pembayaran',String(pending.length),`${idr(pending.reduce((a,x)=>a+x.amount+x.uniqueCode,0))} menunggu`,Clock],
  ['Tingkat Keberhasilan',done.length?Math.round(paid.length/done.length*100)+'%':'0%','Dari transaksi selesai',CheckCircle2]
 ] as const;
 const steps=[
  ['Unggah QRIS Statis',merchant?hasQris:!!p.s.qris,'/dashboard/qris'],
  ['Siapkan Sumber Notifikasi Pembayaran',hasDetector,'/dashboard/detectors'],
  ['Generate API Key',hasKey,'/dashboard/developers'],
  ['Hubungkan Webhook',hasWebhook,'/dashboard/developers']
 ] as const;
 const chart=Array.from({length:period},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(period-1-i));return {day:new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short'}).format(d),amount:paid.filter(x=>new Date(x.createdAt).toDateString()===d.toDateString()).reduce((n,x)=>n+x.amount,0)}});

 return <>
  <Head title="Dashboard" desc="Pantau aktivitas pembayaran dan integrasi merchant Anda." actions={<><button className="button secondary" onClick={()=>{void refresh();p.notify('Dashboard diperbarui')}}><RefreshCw size={15}/> Segarkan</button><select aria-label="Periode dashboard" value={period} onChange={e=>setPeriod(+e.target.value)}><option value={7}>7 hari</option><option value={30}>30 hari</option><option value={90}>90 hari</option></select></>}/>
  <div className="kpi-grid">{stats.map(([label,value,sub,Icon],idx)=><motion.div className="card kpi" key={label} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.28,delay:idx*0.05}} whileHover={{y:-2}}><div className="kpi-label">{label}<Icon size={17}/></div><strong>{value}</strong><small>{sub}</small></motion.div>)}</div>
  <div className="two-col">
   <section className="card chart-card">
    <div className="section-head"><div><h2>Volume pembayaran</h2><p>Transaksi lunas dalam {period} hari</p></div></div>
    {paid.length?<div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)"/><XAxis dataKey="day" tick={{fontSize:11}} interval={Math.max(0,Math.floor(period/6))}/><YAxis tick={{fontSize:11}} tickFormatter={v=>v>=1000?v/1000+'k':v}/><Tooltip formatter={(v)=>idr(Number(v))}/><Area type="monotone" dataKey="amount" stroke="#2563eb" fill="#dbeafe" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>:<Empty title="Belum ada volume pembayaran" desc="Grafik akan terisi otomatis saat ada transaksi lunas."/>}
   </section>
   <section className="card checklist">
    <div className="section-head"><div><h2>Langkah integrasi Anda</h2><p>Selesaikan langkah berikut untuk mulai menerima pembayaran.</p></div><strong>{Math.round(steps.filter(x=>x[1]).length/4*100)}%</strong></div>
    <div className="progress"><motion.span initial={false} animate={{width:(steps.filter(x=>x[1]).length/4*100)+'%'}} transition={{duration:0.45,ease:'easeOut'}}/></div>
    {steps.map(([name,done,path],i)=><Link to={path||'/dashboard/developers'} className="step" key={name}><span className={'step-dot '+(done?'done':'')}>{done?<Check size={14}/>:i+1}</span><span><b>{name}</b><small>{done?'Selesai':'Perlu tindakan'}</small></span><ChevronRight size={16}/></Link>)}
   </section>
  </div>
  <section className="card">
   <div className="section-head"><div><h2>Riwayat saldo biaya</h2><p>Saldo awal pendaftar baru Rp 3.000 · biaya Rp 100 ditahan saat transaksi dibuat &amp; dikembalikan jika gagal</p></div></div>
   {(serverLedger??p.s.ledger).length?<div className="table-wrap"><table><thead><tr><th>Peristiwa</th><th>Deskripsi</th><th>Waktu</th><th>Perubahan</th></tr></thead><tbody>
    {serverLedger?serverLedger.map(x=>{const label=({signup_bonus:'Bonus Pendaftaran',admin_topup:'Topup Admin',admin_adjustment:'Penyesuaian Admin',tx_hold:'Biaya Ditahan',tx_refund:'Pengembalian Biaya',paid_order_fee:'Biaya Order Lunas'}[x.kind]??x.kind.replaceAll('_',' '));return <tr key={x.id}><td>{label}</td><td>{x.note||`Ref: ${x.sourceId.slice(0,12)}`}</td><td>{date(x.createdAt)}</td><td className={x.amount>0?'positive':''}>{x.amount>0?'+':''}{idr(x.amount)}</td></tr>}):p.s.ledger.map(x=><tr key={x.id}><td>{x.type.replaceAll('_',' ')}</td><td>{x.description}</td><td>{date(x.timestamp)}</td><td className={x.amount>0?'positive':''}>{x.amount>0?'+':''}{idr(x.amount)}</td></tr>)}
   </tbody></table></div>:<Empty title="Belum ada mutasi saldo biaya" desc="Riwayat topup dan pemotongan biaya transaksi akan muncul di sini."/>}
  </section>
 </>;
}

function Transactions(p:Props&{open?:()=>void;onRefreshBalance?:()=>void}){
 const merchant=useMerchantSession();
 const[serverRows,setServerRows]=useState<PaymentTransaction[]|null>(null);
 const[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[method,setMethod]=useState('all'),[range,setRange]=useState('all'),[sort,setSort]=useState('new'),[page,setPage]=useState(1),[selected,setSelected]=useState<PaymentTransaction|null>(null);
 const loadServer=async()=>{
  if(!merchant?.token){setServerRows(null);return;}
  try{
   const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
   const res=await fetch(API_ORIGIN+'/api/v1/transactions',{credentials:'include',headers});
   if(!res.ok)return;
   const json=await res.json() as {data?:Array<{id:string;orderId:string;amount:number;uniqueCode:number;status:string;createdAt:string;expiresAt:string}>};
   if(Array.isArray(json.data)){
    setServerRows(json.data.map(r=>({id:r.id,orderId:r.orderId,amount:r.amount,uniqueCode:r.uniqueCode,method:'QRIS',status:(r.status==='paid'||r.status==='pending'||r.status==='expired'||r.status==='failed'||r.status==='cancelled'?r.status:'pending'),createdAt:r.createdAt,expiresAt:r.expiresAt,description:'',customer:''})));
    p.onRefreshBalance?.();
   }
  }catch{}
 };
 const cancelTx=async(id:string)=>{
  if(!merchant?.token)return;
  try{
   const headers:Record<string,string>={'Content-Type':'application/json',...(merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{})};
   const res=await fetch(API_ORIGIN+'/api/v1/transactions/'+id,{method:'PATCH',credentials:'include',headers,body:JSON.stringify({status:'cancelled'})});
   if(res.ok){p.notify('Transaksi dibatalkan · Rp 100 dikembalikan ke saldo');await loadServer();p.onRefreshBalance?.();}
   else{const j=await res.json().catch(()=>({}));p.notify(j.error||'Gagal membatalkan transaksi');}
  }catch{p.notify('Kesalahan jaringan');}
 };
 useEffect(()=>{void loadServer();},[merchant?.token]);
 const sourceRows=serverRows??p.s.transactions;
 const rows=sourceRows.filter(t=>(t.id+' '+t.orderId).toLowerCase().includes(search.toLowerCase())&&(status==='all'||t.status===status)&&(method==='all'||t.method===method)&&(range==='all'||Date.now()-new Date(t.createdAt).getTime()<Number(range)*86400000)).sort((a,b)=>sort==='amount'?b.amount-a.amount:sort==='old'?new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime():new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
 const sumOf=(st:string)=>sourceRows.filter(t=>t.status===st);
 const totalAmount=(list:PaymentTransaction[])=>list.reduce((n,t)=>n+t.amount+t.uniqueCode,0);
 const pages=Math.max(1,Math.ceil(rows.length/8));
 useEffect(()=>setPage(1),[search,status,method,range,sort]);
 return <><Head title="Transaksi" desc="Status order & log webhook" actions={<><button className="button secondary" onClick={()=>{void loadServer();p.notify('Daftar transaksi diperbarui')}}><RefreshCw size={15}/> Segarkan</button><button className="button secondary" onClick={()=>{download('ditsgate-transaksi.csv','\uFEFF'+csv(rows),'text/csv;charset=utf-8');p.notify('CSV transaksi diunduh')}}><Download size={15}/> Ekspor CSV</button></>}/>
 <div className="summary-strip">
  <button type="button" className={'button '+(status==='all'?'primary':'secondary')} onClick={()=>setStatus('all')}><small>ALL</small><b>{sourceRows.length} transaksi</b></button>
  {(['pending','paid','expired'] as const).map(st=>{const list=sumOf(st);return <button type="button" key={st} className={'button '+(status===st?'primary':'secondary')} onClick={()=>setStatus(st)}><small>{st.toUpperCase()}</small><b>{list.length} · {idr(totalAmount(list))}</b></button>})}
 </div>
 <section className="card table-card"><div className="filters"><label className="search-field"><Search size={16}/><input aria-label="Cari ID transaksi atau order" placeholder="Cari ID transaksi / order..." value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Filter metode" value={method} onChange={e=>setMethod(e.target.value)}><option value="all">Semua metode</option><option>QRIS</option><option>Transfer Bank</option></select><select aria-label="Filter tanggal" value={range} onChange={e=>setRange(e.target.value)}><option value="all">Semua tanggal</option><option value="7">7 hari</option><option value="30">30 hari</option><option value="90">90 hari</option></select><select aria-label="Urutkan" value={sort} onChange={e=>setSort(e.target.value)}><option value="new">Terbaru</option><option value="old">Terlama</option><option value="amount">Nominal tertinggi</option></select></div>{rows.length?<><div className="table-wrap"><table><thead><tr><th>ID Transaksi / Order ID</th><th>Nominal Pokok</th><th>Kode Unik</th><th>Total Bayar</th><th>Status</th><th>Waktu</th><th>Detail &amp; notifikasi</th></tr></thead><tbody>{rows.slice((page-1)*8,page*8).map(t=><tr key={t.id}><td><b>{t.id}</b><small>Order: {t.orderId}</small></td><td>{idr(t.amount)}</td><td>+{t.uniqueCode}</td><td><b>{idr(t.amount+t.uniqueCode)}</b></td><td><Badge tone={t.status==='paid'?'green':t.status==='pending'?'amber':'muted'}>{t.status.toUpperCase()}</Badge></td><td>{date(t.createdAt)}</td><td className="table-actions"><button className="button secondary" onClick={()=>setSelected(t)}>Inspeksi</button>{merchant?.token&&t.status==='pending'&&<button className="button secondary" onClick={()=>void cancelTx(t.id)}>Batalkan</button>}<button className="icon-btn" aria-label={'Salin '+t.id} title="Salin ID" onClick={()=>copy(t.id,p.notify)}><Copy size={16}/></button></td></tr>)}</tbody></table></div><div className="pagination"><span>{rows.length} hasil · Halaman {page} dari {pages}</span><button className="button secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Sebelumnya</button><button className="button secondary" disabled={page>=pages} onClick={()=>setPage(page+1)}>Berikutnya</button></div></>:<Empty title="Tidak ada transaksi" desc={sourceRows.length?'Coba ubah filter pencarian.':'Transaksi akan muncul saat order dibuat melalui API merchant.'}/>}</section>{selected&&<Modal title="Inspeksi transaksi" close={()=>setSelected(null)}><div className="detail-grid">{[['ID transaksi',selected.id],['Order ID',selected.orderId],['Merchant',merchant?.user.name||p.s.merchant.name],['Nominal pokok',idr(selected.amount)],['Kode unik','+'+String(selected.uniqueCode)],['Total bayar',idr(selected.amount+selected.uniqueCode)],['Metode',selected.method],['Status',statusText[selected.status]],['Saldo DitsGate',selected.status==='paid'?'Berkurang -Rp 100':selected.status==='pending'?'Ditahan -Rp 100':'Dikembalikan +Rp 100'],['Dibuat',date(selected.createdAt)],['Kedaluwarsa',date(selected.expiresAt)],['Deskripsi',selected.description||'—'],['Referensi pelanggan',selected.customer||'—']].map(([a,b])=><div key={a}><small>{a}</small><b>{b}</b></div>)}</div><div className="row-actions"><Link className="button primary" to={'/pay/'+selected.id}>Buka checkout <ExternalLink size={14}/></Link><button className="button secondary" onClick={()=>copy(location.origin+'/pay/'+selected.id,p.notify)}><Copy size={14}/> Salin URL</button><Link className="button secondary" to="/dashboard/support/new">Laporkan Kendala</Link></div></Modal>}</>;
}

function Detectors(p:Props){
 const merchant=useMerchantSession();
 const[portal,setPortal]=useState<{status:string;lastCheckedAt:string|null}|null>(null);
 const[listener,setListener]=useState<{status:string;lastSeenAt:string|null}|null>(null);
 useEffect(()=>{
  if(!merchant?.token){setPortal(null);setListener(null);return;}
  let cancelled=false;
  const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
  void Promise.all([
   fetch(API_ORIGIN+'/api/v1/shopee-portal',{credentials:'include',headers}).then(r=>r.ok?r.json():null).catch(()=>null),
   fetch(API_ORIGIN+'/api/v1/shopee-listener',{credentials:'include',headers}).then(r=>r.ok?r.json():null).catch(()=>null),
  ]).then(([pRes,lRes])=>{
   if(cancelled)return;
   if(pRes?.data)setPortal(pRes.data);
   if(lRes?.data)setListener(lRes.data);
  });
  return()=>{cancelled=true};
 },[merchant?.token]);
 const cardStatus=(id:string)=>{
  if(!merchant)return{label:'Belum terhubung',tone:'muted',detail:'Masuk akun merchant untuk cek status'};
  if(id==='shopee'){
   if(portal?.status==='connected')return{label:'Terhubung',tone:'green',detail:portal.lastCheckedAt?`Cek terakhir: ${date(portal.lastCheckedAt)}`:'Portal aktif'};
   if(portal?.status==='session_broken')return{label:'Sesi berakhir',tone:'amber',detail:'Hubungkan ulang token portal'};
   return{label:'Belum terhubung',tone:'muted',detail:'Token portal belum terpasang'};
  }
  if(listener?.status==='receiving')return{label:'Sinyal diterima',tone:'green',detail:listener.lastSeenAt?`Sinyal terakhir: ${date(listener.lastSeenAt)}`:'Listener aktif'};
  if(listener?.status==='awaiting_event')return{label:'Menunggu sinyal',tone:'blue',detail:'Perangkat listener terpasang'};
  return{label:'Belum terhubung',tone:'muted',detail:'Pasangkan Android listener'};
 };
 return <><Head title="Detektor Pembayaran" desc="Sumber notifikasi dan pembacaan mutasi pembayaran merchant."/><div className="provider-grid">{providers.map((v,idx)=>{const st=cardStatus(v.id);return <motion.div key={v.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.25,delay:idx*0.04}} whileHover={{y:-2}}><Link className="card provider-card" to={'/dashboard/detectors/'+v.id}><span className="provider-icon" style={{background:'transparent',padding:0}}><ProviderIcon id={v.id} size={34}/></span><div><h2>{v.name}</h2><p>{st.detail}</p><Badge tone={st.tone}>{st.label}</Badge></div><ChevronRight size={17}/></Link></motion.div>})}</div><div className="info-line">Shopee Partner membaca mutasi langsung dari portal; GoPay, BCA, LinkAja, BRI, Mandiri, dan Aplikasi Listener menerima sinyal notifikasi dari Android Listener.</div></>;
}

function Mutations(p:Props){
 const merchant=useMerchantSession();
 type LiveMutation={id:string;time:string;app:string;amount:number|null;text:string;matchStatus:string};
 const[liveRows,setLiveRows]=useState<LiveMutation[]>([]);
 const[filter,setFilter]=useState('all'),[provider,setProvider]=useState('all'),[day,setDay]=useState('all'),[selected,setSelected]=useState<string|null>(null);
 const refreshLive=async()=>{
  if(!merchant?.token){setLiveRows([]);return;}
  const items:LiveMutation[]=[];
  const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
  try{
   const sigRes=await fetch(API_ORIGIN+'/api/v1/shopee-listener/events',{credentials:'include',headers});
   if(sigRes.ok){
    const sigJson=await sigRes.json() as {data?:Array<{id:string;receivedAt:string;sourceApp?:string;title?:string;amount:number|null}>};
    for(const r of sigJson.data??[])items.push({id:r.id,time:r.receivedAt,app:r.sourceApp||'Android Listener',amount:r.amount,text:r.title||'Notifikasi perangkat',matchStatus:'Listener'});
   }
  }catch{}
  try{
   const pRes=await fetch(API_ORIGIN+'/api/v1/shopee-portal/transactions',{credentials:'include',headers});
   if(pRes.ok){
    const pJson=await pRes.json() as {data?:Array<{id:string;createdAt:string|null;orderId:string|null;amountIdr:number|null}>};
    for(const r of pJson.data??[])items.push({id:r.id,time:r.createdAt||new Date().toISOString(),app:'Shopee Partner',amount:r.amountIdr,text:r.orderId||r.id,matchStatus:'Portal Shopee'});
   }
  }catch{}
  items.sort((a,b)=>b.time.localeCompare(a.time));
  setLiveRows(items);
 };
 useEffect(()=>{void refreshLive();},[merchant?.token]);
 const rows=liveRows.length?liveRows:p.s.mutations.map(x=>({id:x.id,time:x.timestamp,app:x.source,amount:x.amount,text:x.reference,matchStatus:x.status}));
 const filtered=rows.filter(x=>(filter==='all'||x.matchStatus===filter)&&(provider==='all'||x.app===provider)&&(day==='all'||Date.now()-new Date(x.time).getTime()<Number(day)*86400000));
 return <><Head title="Mutasi Masuk" desc="Log Mutasi Notifikasi & Portal" actions={<button className="button secondary" onClick={()=>{void refreshLive();p.notify('Mutasi masuk diperbarui')}}><RefreshCw size={15}/> Segarkan</button>}/>
 <section className="card"><div className="filters"><select aria-label="Status mutasi" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Semua sumber</option><option value="Listener">Listener</option><option value="Portal Shopee">Portal Shopee</option></select><select aria-label="Provider mutasi" value={provider} onChange={e=>setProvider(e.target.value)}><option value="all">Semua aplikasi</option>{providers.map(v=><option key={v.id}>{v.name}</option>)}</select><select aria-label="Tanggal mutasi" value={day} onChange={e=>setDay(e.target.value)}><option value="all">Semua tanggal</option><option value="7">7 hari</option><option value="30">30 hari</option></select></div>{filtered.length?<div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Aplikasi Sumber</th><th>Nominal</th><th>Referensi / Teks</th><th>Sumber</th></tr></thead><tbody>{filtered.map(x=><tr key={x.id}><td>{date(x.time)}</td><td>{x.app}</td><td>{x.amount==null?'—':idr(x.amount)}</td><td>{x.text}</td><td><Badge tone="muted">{x.matchStatus}</Badge></td></tr>)}</tbody></table></div>:<Empty title="Belum ada mutasi masuk" desc="Pasangkan Android Listener atau hubungkan Shopee Partner untuk melihat log mutasi masuk."/>}</section>{selected&&<Modal title="Detail mutasi" close={()=>setSelected(null)}><p>Detail notifikasi masuk.</p></Modal>}</>;
}

const snippets:Record<string,string>={'cURL':`curl -X POST ${API_ORIGIN}/api/v1/transactions \\\n  -H 'Authorization: Bearer <API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"order_id":"ORDER-001","amount":50000}'`,'JavaScript / TypeScript':`const response = await fetch('${API_ORIGIN}/api/v1/transactions', {\n  method: 'POST',\n  headers: { Authorization: 'Bearer <API_KEY>', 'Content-Type': 'application/json' },\n  body: JSON.stringify({ order_id: 'ORDER-001', amount: 50000 })\n});`,PHP:`<?php\n$ch = curl_init('${API_ORIGIN}/api/v1/transactions');\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer <API_KEY>', 'Content-Type: application/json']);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['order_id' => 'ORDER-001', 'amount' => 50000]));\n$res = curl_exec($ch);`,Python:`import requests\nrequests.post('${API_ORIGIN}/api/v1/transactions', json={'order_id': 'ORDER-001', 'amount': 50000}, headers={'Authorization': 'Bearer <API_KEY>'})`};
function CodeTabs({notify}:{notify:(m:string)=>void}){const[lang,setLang]=useState('cURL');return <><div className="tabs">{Object.keys(snippets).map(k=><button key={k} className={lang===k?'active':''} onClick={()=>setLang(k)}>{k}</button>)}</div><div className="code-wrap"><button className="code-copy" onClick={()=>copy(snippets[lang],notify)} aria-label="Salin contoh kode"><Copy size={15}/> Salin</button><pre><code>{snippets[lang]}</code></pre></div></>}

function Topup(p:Props&{serverBalance?:number|null;onRefreshBalance?:()=>void}){
 const merchant=useMerchantSession();
 const[amount,setAmount]=useState(5000);
 const[serverTopups,setServerTopups]=useState<Array<{id:string;amount:number;uniqueCode?:number;totalAmount?:number;status:string;note?:string|null;createdAt:string;confirmedAt?:string|null}>|null>(null);
 const[qrisPayload,setQrisPayload]=useState('');
 const[mode,setMode]=useState<'auto'|'manual'>('manual');
 const[listenerOnline,setListenerOnline]=useState(false);
 const[adminWa,setAdminWa]=useState('6282120196167');
 const[activeOrder,setActiveOrder]=useState<{id:string;amount:number;uniqueCode:number;totalAmount:number}|null>(null);
 const[busy,setBusy]=useState(false);
 const[syncing,setSyncing]=useState(false);

 const authHeaders=React.useCallback(():Record<string,string>=>merchant?.token&&merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{},[merchant?.token]);

 const loadTopups=React.useCallback(async()=>{
  if(!merchant?.token){setServerTopups(null);return;}
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/topups',{credentials:'include',headers:authHeaders()});
   if(r.ok){
    const j=await r.json();
    setServerTopups(j.data??[]);
    if(typeof j.qrisPayload==='string')setQrisPayload(j.qrisPayload);
    if(j.mode==='auto'||j.mode==='manual')setMode(j.mode);
    if(typeof j.listenerOnline==='boolean')setListenerOnline(j.listenerOnline);
    if(typeof j.adminWhatsapp==='string'&&j.adminWhatsapp)setAdminWa(j.adminWhatsapp);
   }
  }catch{}
 },[merchant?.token,authHeaders]);

 useEffect(()=>{void loadTopups();},[loadTopups]);

 const syncNow=React.useCallback(async(silent=false)=>{
  if(!merchant?.token)return;
  if(!silent)setSyncing(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/topups/sync',{method:'POST',credentials:'include',headers:authHeaders()});
   const j=await r.json().catch(()=>({}));
   if(r.ok){
    if(Array.isArray(j.data))setServerTopups(j.data);
    if(j.sync?.matched>0){
     p.onRefreshBalance?.();
     p.notify('Pembayaran terdeteksi otomatis! Saldo Anda sudah bertambah.');
     setActiveOrder(null);
    }else if(!silent){
     p.notify(j.sync?.error?`Listener ShopeePay bermasalah: ${j.sync.error}`:'Belum ada mutasi masuk yang cocok. Jika sudah transfer, hubungi Admin via WhatsApp.');
    }
   }
  }catch{if(!silent)p.notify('Gagal mengecek mutasi otomatis')}finally{if(!silent)setSyncing(false);}
 },[merchant?.token,authHeaders,p]);

 const hasPending=Boolean(serverTopups?.some(t=>t.status==='pending'));
 useEffect(()=>{
  if(!merchant?.token||mode!=='auto'||!listenerOnline||!hasPending)return;
  const timer=setInterval(()=>{void syncNow(true);},10000);
  return()=>clearInterval(timer);
 },[merchant?.token,mode,listenerOnline,hasPending,syncNow]);

 const submitTopup=async()=>{
  const amt=Math.trunc(Number(amount));
  if(!Number.isSafeInteger(amt)||amt<5000)return p.notify('Minimal top up Rp 5.000');
  if(merchant?.token){
   setBusy(true);
   try{
    const r=await fetch(API_ORIGIN+'/api/v1/topups',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({amount:amt})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){p.notify(j.error||'Gagal mengajukan top up');return;}
    if(typeof j.qrisPayload==='string')setQrisPayload(j.qrisPayload);
    if(j.mode==='auto'||j.mode==='manual')setMode(j.mode);
    if(typeof j.listenerOnline==='boolean')setListenerOnline(j.listenerOnline);
    if(typeof j.adminWhatsapp==='string'&&j.adminWhatsapp)setAdminWa(j.adminWhatsapp);
    if(j.data?.id)setActiveOrder({id:j.data.id,amount:j.data.amount,uniqueCode:j.data.uniqueCode??0,totalAmount:j.data.totalAmount??amt});
    await loadTopups();
    p.onRefreshBalance?.();
    p.notify(j.mode==='auto'&&j.listenerOnline?'Permintaan top up dibuat · Transfer sesuai total nominal agar otomatis masuk':'Permintaan top up diajukan · Hubungi admin via WhatsApp agar cepat diproses');
   }catch{p.notify('Kesalahan jaringan')}finally{setBusy(false);}
   return;
  }
  p.set(s=>({...s,topups:[{id:crypto.randomUUID(),amount:amt,createdAt:new Date().toISOString()},...s.topups]}));
  p.notify('Permintaan top up dicatat. Hubungi admin untuk verifikasi.');
 };

 const waLinkFor=(id:string,amt:number,total:number)=>{
  const email=merchant?.user.email||'';
  const text=`Halo Admin DitsGate, saya sudah mengajukan Top Up sebesar ${idr(amt)} (Total transfer: ${idr(total)}, ID: ${id.slice(0,8)}${email?`, Akun: ${email}`:''}). Mohon bantuannya untuk diproses.`;
  return `https://wa.me/${adminWa}?text=${encodeURIComponent(text)}`;
 };

 const bal=p.serverBalance??p.s.balance;
 const list=serverTopups??p.s.topups.map(t=>({...t,uniqueCode:0,totalAmount:t.amount,status:'pending',note:null,confirmedAt:null}));
 const statusLabel=(st:string)=>st==='admin_confirmed'?<Badge tone="green">Disetujui</Badge>:st==='rejected'?<Badge tone="muted">Ditolak</Badge>:<Badge tone="amber">Menunggu</Badge>;
 const autoActive=mode==='auto'&&listenerOnline;

 return <><Head title="Top Up Saldo Biaya" desc="Saldo platform untuk biaya transaksi; terpisah dari dana pembayaran pelanggan." actions={<>{merchant?.token&&<button className="button secondary" onClick={()=>{void loadTopups();p.onRefreshBalance?.();p.notify('Riwayat top up diperbarui')}}><RefreshCw size={15}/> Segarkan</button>}<a className="button secondary" href={`https://wa.me/${adminWa}`} target="_blank" rel="noopener noreferrer"><MessageSquare size={15}/> Chat Admin WA</a></>}/>
 <div className="two-col">
  <section className="card">
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
    <div className="eyebrow">SALDO BIAYA</div>
    <Badge tone={autoActive?'green':'amber'}>{autoActive?'Otomatis (ShopeePay)':'Manual (Konfirmasi Admin)'}</Badge>
   </div>
   <div className="big-number">{idr(bal)}</div>
   <p>Isi saldo biaya untuk memproses transaksi API (minimal Rp 5.000).</p>
   <label>Nominal top up (Rp)<input type="number" min={5000} step={1000} value={amount} onChange={e=>setAmount(+e.target.value)}/></label>
   <div className="row-actions">{[5000,10000,25000,50000,100000,250000].map(n=><button type="button" className="button secondary" key={n} onClick={()=>setAmount(n)}>{idr(n)}</button>)}</div>
   <div className="info-line">{autoActive?'Nominal permintaan: '+idr(amount||0)+' · Kode unik akan ditambahkan agar saldo terisi otomatis setelah transfer.':'Nominal permintaan: '+idr(amount||0)+' · Konfirmasi manual oleh admin (hubungi WhatsApp admin setelah transfer agar cepat diproses).'}</div>
   <button type="button" className="button primary" disabled={busy} onClick={()=>void submitTopup()}>{busy?'Mengajukan...':'Ajukan Top Up'}</button>
   {activeOrder&&<div style={{marginTop:18,paddingTop:16,borderTop:'1px solid var(--border)'}}>
    <h3 style={{margin:'0 0 6px'}}>Instruksi Pembayaran Top Up</h3>
    <p style={{margin:'0 0 10px'}}>
     Total Transfer: <strong>{idr(activeOrder.totalAmount)}</strong>
     {activeOrder.uniqueCode>0&&<span> (Nominal {idr(activeOrder.amount)} + kode unik <b>{activeOrder.uniqueCode}</b>)</span>}
    </p>
    {qrisPayload&&<CheckoutQr qris={{image:'',fileName:'qris-topup.png',provider:'DitsGate',payload:qrisPayload,updatedAt:'',mode:'dynamic'}} total={activeOrder.totalAmount}/>}
    <div className="row-actions" style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
     {autoActive&&<button type="button" className="button primary" disabled={syncing} onClick={()=>void syncNow(false)}>{syncing?'Mengecek mutasi...':'Saya Sudah Bayar — Cek Otomatis'}</button>}
     <a className="button secondary" href={waLinkFor(activeOrder.id,activeOrder.amount,activeOrder.totalAmount)} target="_blank" rel="noopener noreferrer"><MessageSquare size={15}/> Hubungi Admin WA (+62 821-2019-6167)</a>
    </div>
    <small className="muted" style={{display:'block',marginTop:8}}>ID Permintaan: <code>{activeOrder.id.slice(0,8)}</code> · Masih menunggu? Hubungi WhatsApp admin agar segera diproses.</small>
   </div>}
  </section>
  <section className="card">
   <h2>Riwayat Top Up</h2>
   {hasPending&&<div className="notice" style={{marginBottom:12}}>
    <AlertCircle size={16}/>
    <span>Ada top up berstatus <b>Menunggu</b>. Agar cepat diproses, hubungi admin via <a href={`https://wa.me/${adminWa}`} target="_blank" rel="noopener noreferrer" style={{textDecoration:'underline',fontWeight:600}}>WhatsApp (+62 821-2019-6167)</a>.</span>
   </div>}
   {list.length?list.map(t=>{const tot=t.totalAmount&&t.totalAmount>0?t.totalAmount:t.amount;return <div className="list-row" key={t.id}>
    <div>
     <b>{idr(t.amount)}</b>{tot!==t.amount&&<small> · Transfer {idr(tot)}</small>}
     <small>{date(t.createdAt)}{t.note?` · ${t.note}`:''}</small>
    </div>
    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
     {t.status==='pending'&&<a className="button secondary" style={{fontSize:12,padding:'4px 8px'}} href={waLinkFor(t.id,t.amount,tot)} target="_blank" rel="noopener noreferrer">Hubungi Admin WA</a>}
     {statusLabel(t.status)}
    </div>
   </div>}):<Empty title="Belum ada riwayat top up" desc="Permintaan top up akan muncul di sini."/>}
  </section>
 </div></>;
}

function Subscription(p:Props){
 const plans=[{name:'Pay as you go',price:'Rp 100 / transaksi',desc:'Biaya dipotong dari saldo biaya hanya saat transaksi berhasil dibayar.'},{name:'Bisnis',price:'Hubungi tim',desc:'Paket volume tinggi dengan dukungan prioritas.'}];
 return <><Head title="Langganan" desc="Pilih paket yang sesuai dengan volume transaksi bisnis Anda."/><div className="two-col">{plans.map(plan=><section className="card" key={plan.name}><div className="section-head"><h2>{plan.name}</h2>{p.s.plan===plan.name&&<Badge tone="blue">Paket Aktif</Badge>}</div><div className="big-number">{plan.price}</div><p>{plan.desc}</p><button className="button secondary" disabled={p.s.plan===plan.name} onClick={()=>{p.set(s=>({...s,plan:plan.name}));p.notify('Paket dipilih')}}>{p.s.plan===plan.name?'Aktif':'Pilih Paket'}</button></section>)}</div><section className="card"><h2>Riwayat Tagihan</h2><Empty title="Tidak ada tagihan" desc="Paket Pay as you go memotong biaya langsung dari saldo biaya per transaksi."/></section></>;
}

function Banks(p:Props){
 const merchant=useMerchantSession();
 const[serverBanks,setServerBanks]=useState<Array<{id:string;bank:string;holder:string;numberMasked:string;isDefault:boolean;status:string}>|null>(null);
 const[editing,setEditing]=useState<string|null>(null),[bank,setBank]=useState('BCA'),[holder,setHolder]=useState(''),[number,setNumber]=useState(''),[def,setDef]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState('');
 const load=async()=>{
  if(!merchant?.token)return;
  try{
   const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
   const r=await fetch(API_ORIGIN+'/api/v1/bank-accounts',{credentials:'include',headers});
   if(r.ok){const j=await r.json();setServerBanks(j.data??[]);}
  }catch{}
 };
 useEffect(()=>{void load();},[merchant?.token]);
 const begin=(b?:BankAccount)=>{setEditing(b?.id||null);setBank(b?.bank||'BCA');setHolder(b?.holder||'');setNumber(b?.number||'');setDef(b?.isDefault||false);setError('');setOpen(true)};
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(!/^[0-9]{6,20}$/.test(number)||!holder.trim()){setError('Nama wajib diisi dan nomor harus 6–20 digit.');return}
  if(merchant?.token){
   try{
    const headers:Record<string,string>={'Content-Type':'application/json',...(merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{})};
    const r=await fetch(API_ORIGIN+(editing?`/api/v1/bank-accounts/${editing}`:'/api/v1/bank-accounts'),{method:editing?'PATCH':'POST',credentials:'include',headers,body:JSON.stringify({bank,holder:holder.trim(),number,isDefault:def})});
    if(r.ok){setOpen(false);await load();p.notify('Rekening disimpan');return;}
    const j=await r.json();setError(j.error||'Gagal menyimpan.');return;
   }catch{setError('Kesalahan jaringan.');return;}
  }
  const b:BankAccount={id:editing||crypto.randomUUID(),bank,holder:holder.trim(),number,isDefault:def||!p.s.banks.length,status:'unverified'};
  p.set(v=>({...v,banks:(editing?v.banks.map(x=>x.id===editing?b:{...x,isDefault:b.isDefault?false:x.isDefault}):[...v.banks.map(x=>({...x,isDefault:b.isDefault?false:x.isDefault})),b])}));
  setOpen(false);p.notify('Rekening disimpan');
 };
 const del=async(id:string)=>{
  if(!confirm('Hapus rekening ini?'))return;
  if(merchant?.token){
   const headers:Record<string,string>=merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};
   await fetch(API_ORIGIN+'/api/v1/bank-accounts/'+id,{method:'DELETE',credentials:'include',headers});
   await load();p.notify('Rekening dihapus');return;
  }
  p.set(v=>({...v,banks:v.banks.filter(x=>x.id!==id)}));
 };
 const list=serverBanks??p.s.banks.map(b=>({...b,numberMasked:'•••• '+b.number.slice(-4)}));
 return <><Head title="Rekening Bank" desc="Kelola rekening bank merchant." actions={<button className="button primary" onClick={()=>begin()}><Plus size={16}/> Tambah Rekening</button>}/>
 <div className="provider-grid">{list.map(b=><div className="card bank-card" key={b.id}><div className="section-head"><span className="provider-icon"><Building2 size={20}/></span><div>{b.isDefault&&<Badge tone="blue">Utama</Badge>}</div></div><h2>{b.bank}</h2><p>{b.holder}</p><b>{b.numberMasked}</b><div className="row-actions"><button className="button danger" onClick={()=>del(b.id)}>Hapus</button></div></div>)}</div>
 {!list.length&&<section className="card"><Empty title="Belum ada rekening" desc="Tambahkan rekening bank merchant Anda." action={<button className="button primary" onClick={()=>begin()}>Tambah rekening</button>}/></section>}
 {open&&<Modal title={editing?'Edit Rekening':'Tambah Rekening'} close={()=>setOpen(false)}><form onSubmit={submit}><div className="stack"><label>Bank<select value={bank} onChange={e=>setBank(e.target.value)}>{['BCA','BRI','BNI','Mandiri','CIMB Niaga','Bank lainnya'].map(x=><option key={x}>{x}</option>)}</select></label><label>Nama pemilik<input required value={holder} onChange={e=>setHolder(e.target.value)}/></label><label>Nomor rekening<input required inputMode="numeric" value={number} onChange={e=>setNumber(e.target.value)}/></label><label className="check-label"><input type="checkbox" checked={def} onChange={e=>setDef(e.target.checked)}/> Rekening utama</label>{error&&<p className="error">{error}</p>}<button className="button primary">Simpan Rekening</button></div></form></Modal>}</>;
}

function SettingsPage(p:Props){
 const merchant=useMerchantSession();
 const[tab,setTab]=useState('Profil Merchant'),[name,setName]=useState(merchant?.user.name||p.s.merchant.name),[email,setEmail]=useState(merchant?.user.email||p.s.merchant.email),[city,setCity]=useState(p.s.merchant.city);
 const tabs=['Profil Merchant','Keamanan','Tampilan','Preferensi'];
 return <><Head title="Pengaturan" desc="Kelola profil merchant dan preferensi tampilan workspace."/><div className="settings-grid"><nav className="settings-tabs" aria-label="Bagian pengaturan">{tabs.map(x=><button className={x===tab?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav><section className="card settings-card"><h2>{tab}</h2>{tab==='Profil Merchant'?<div className="stack"><label>Nama merchant<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Kota<input value={city} onChange={e=>setCity(e.target.value)}/></label><label>Email merchant<input type="email" value={email} readOnly={!!merchant} onChange={e=>setEmail(e.target.value)}/></label><button className="button primary" onClick={()=>{if(!name.trim())return p.notify('Nama wajib diisi');p.set(v=>({...v,merchant:{...v.merchant,name,city,email}}));p.notify('Profil disimpan')}}>Simpan perubahan</button></div>:tab==='Keamanan'?<div className="stack"><div className="info-line">Sesi akun merchant diamankan dengan cookie HttpOnly dan enkripsi server.</div><h3>Sesi aktif</h3><p>{merchant?`Masuk sebagai ${merchant.user.email}`:'Belum masuk akun'}</p></div>:tab==='Tampilan'?<div className="stack"><label>Tema<select value={p.s.theme} onChange={e=>p.set(v=>({...v,theme:e.target.value as DemoState['theme']}))}><option value="light">Terang</option><option value="dark">Gelap</option><option value="system">Ikuti sistem</option></select></label></div>:<div className="stack"><label>Zona waktu<input value="Asia/Jakarta" readOnly/></label><label>Mata uang<input value="IDR — Rupiah Indonesia" readOnly/></label></div>}</section></div></>;
}

function Checkout(p:Props){
 const{id}=useParams();
 const t=p.s.transactions.find(x=>x.id===id);
 const[tick,setTick]=useState(Date.now());
 useEffect(()=>{const a=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(a)},[]);
 if(!t)return <div className="checkout"><div className="checkout-card"><Empty title="Sesi tidak ditemukan" desc="Order pembayaran tidak ditemukan atau sudah kedaluwarsa." action={<Link className="button secondary" to="/dashboard">Ke dashboard</Link>}/></div></div>;
 const seconds=Math.max(0,Math.ceil((new Date(t.expiresAt).getTime()-tick)/1000));
 const expired=t.status==='pending'&&seconds<=0;
 const shown=expired?'expired':t.status;
 return <div className="checkout"><div className="checkout-top"><Link to="/" className="brand-small"><span className="brand-mark">D</span> DitsGate</Link><Badge tone="blue">CHECKOUT QRIS</Badge></div><div className="checkout-card"><div className="checkout-merchant">{p.s.merchant.logo?<img src={p.s.merchant.logo} alt="Logo merchant"/>:<span className="avatar">DG</span>}<div><b>{p.s.merchant.name}</b><small>Pembayaran QRIS</small></div></div><div className="checkout-center"><Badge tone={shown==='paid'?'green':shown==='pending'?'amber':'muted'}>{statusText[shown]}</Badge><h1>{idr(t.amount+t.uniqueCode)}</h1><p>Jumlah total untuk order <strong>{t.orderId}</strong></p><button className="text-action" onClick={()=>copy(String(t.amount+t.uniqueCode),p.notify)}><Copy size={14}/> Salin nominal</button></div><div className="checkout-breakdown"><div><span>Nominal dasar</span><b>{idr(t.amount)}</b></div><div><span>Kode unik</span><b>{idr(t.uniqueCode)}</b></div><div><span>Metode</span><b>{t.method}</b></div><div><span>Deskripsi</span><b>{t.description||'—'}</b></div></div>{shown==='pending'?<><CheckoutQr qris={p.s.qris} total={t.amount+t.uniqueCode}/><div className="countdown"><Clock size={16}/> Waktu tersisa: {Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</div></>:<div className="status-panel"><AlertCircle size={20}/>{shown==='paid'?'Pembayaran telah diterima dan dikonfirmasi.':shown==='expired'?'Sesi pembayaran telah kedaluwarsa.':'Sesi pembayaran tidak aktif.'}</div>}<div className="checkout-steps"><h3>Petunjuk pembayaran</h3><ol><li>Periksa identitas merchant dan nominal total (termasuk kode unik).</li><li>Pindai kode QRIS di atas melalui aplikasi e-wallet atau mobile banking Anda.</li><li>Pembayaran akan terkonfirmasi secara otomatis dalam beberapa detik.</li></ol></div></div><div className="checkout-footer">DitsGate · Infrastruktur Pembayaran QRIS</div></div>;
}

function Auth({mode,notify}:{mode:'login'|'register'|'forgot';notify:(m:string)=>void}){
 const nav=useNavigate();const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');
  if(mode==='forgot'){setError('Hubungi tim dukungan untuk reset kata sandi.');return}
  setBusy(true);
  try{
   if(mode==='register')await registerMerchant(name,email,password);
   else await signInMerchant(email,password);
   setPassword('');notify('Berhasil masuk ke akun merchant.');nav('/dashboard');
  }catch(cause){setError(cause instanceof Error?cause.message:'Autentikasi gagal.')}finally{setPassword('');setBusy(false)}
 }
 return <div className="auth-page"><Link className="back-link" to="/">← Kembali ke Beranda</Link><div className="auth-layout"><div className="auth-form"><div className="brand auth-brand"><span className="brand-mark">D</span><div className="brand-text"><strong>DitsGate</strong><small>Payment infrastructure</small></div></div><Badge tone="blue">AKUN MERCHANT</Badge><h1>{mode==='login'?'Masuk ke Dashboard':mode==='register'?'Buat Akun Merchant':'Atur Ulang Kata Sandi'}</h1><p>{mode==='forgot'?'Hubungi dukungan untuk pemulihan akses akun.':mode==='register'?'Buat akun merchant dan langsung dapatkan saldo awal Rp 3.000 gratis.':'Masuk ke dashboard merchant DitsGate Anda.'}</p><form onSubmit={submit} className="stack">{mode==='register'&&<label>Nama bisnis<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Nama bisnis"/></label>}<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="nama@bisnis.com" autoComplete="email"/></label>{mode!=='forgot'&&<label>Kata sandi<div className="password-wrap"><input type={show?'text':'password'} minLength={mode==='register'?12:1} required value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='register'?'Minimal 12 karakter':'Kata sandi'} autoComplete={mode==='register'?'new-password':'current-password'}/><button type="button" aria-label={show?'Sembunyikan kata sandi':'Tampilkan kata sandi'} onClick={()=>setShow(v=>!v)}><Eye size={17}/></button></div></label>}{mode==='login'&&<Link className="small-link" to="/forgot-password">Lupa kata sandi?</Link>}{error&&<p role="alert" className="error">{error}</p>}<button className="button primary full-width" disabled={busy||mode==='forgot'}>{busy?'Memproses...':mode==='register'?'Daftar dan Masuk':'Masuk'}</button></form><p className="auth-switch">{mode==='login'?<>Belum punya akun? <Link to="/register">Daftar</Link></>:<>Sudah punya akun? <Link to="/login">Masuk</Link></>}</p></div><div className="auth-aside"><span className="eyebrow">DITSGATE PAYMENT INFRASTRUCTURE</span><h2>Kelola pembayaran QRIS secara otomatis.</h2><p>Hubungkan QRIS toko Anda, aktifkan detektor mutasi, dan terima notifikasi webhook real-time ke sistem Anda.</p><div className="aside-preview"><div className="fake-row"><span>Status Layanan</span><Badge tone="green">AKTIF</Badge></div><div className="fake-grid"><div>REST API<strong>v1</strong></div><div>Webhook<strong>HMAC-SHA256</strong></div></div></div></div></div></div>;
}

function PublicDocs({kind,notify}:{kind:'docs'|'integrations';notify:(m:string)=>void}){
 return <div className="landing"><header className="site-header"><Link className="brand-small" to="/"><span className="brand-mark">D</span> DitsGate</Link><nav><Link to="/">Beranda</Link><Link to="/docs">Dokumentasi</Link><Link to="/integrations">Integrasi</Link></nav><div><Link className="button secondary" to="/login">Masuk</Link><Link className="button primary" to="/dashboard">Dashboard</Link></div></header><main className="public-section" style={{maxWidth:1160,margin:'auto'}}><Link className="back-link" to="/">← Kembali ke Beranda</Link><div className="section-intro"><span className="eyebrow">DOKUMENTASI TEKNIS</span><h1>{kind==='docs'?'Dokumentasi API':'Panduan Integrasi'}</h1><p>Integrasikan DitsGate REST API dan webhook HMAC-SHA256 ke backend aplikasi Anda.</p></div><div className="two-col wide-left"><section className="card"><h2>{kind==='docs'?'Membuat Transaksi via API':'Alur Integrasi'}</h2>{kind==='integrations'&&<ol className="instructions"><li>Unggah QRIS statis merchant pada menu QRIS Saya.</li><li>Hubungkan detektor Shopee Partner atau Android Listener.</li><li>Generate API Key dan atur Webhook URL pada menu API &amp; Webhook.</li><li>Verifikasi signature HMAC-SHA256 pada endpoint webhook Anda sebelum memproses order.</li></ol>}<CodeTabs notify={notify}/></section><section className="card"><h2>Mulai Integrasi</h2><p>Gunakan header <code>Authorization: Bearer &lt;API_KEY&gt;</code> untuk mengakses endpoint REST API dari server Anda.</p><Link className="button primary" to="/dashboard/developers">Buka API &amp; Webhook <ArrowUpRight size={14}/></Link><div className="row-actions"><Link className="button secondary" to={kind==='docs'?'/integrations':'/docs'}>{kind==='docs'?'Lihat integrasi':'Lihat dokumentasi'}</Link></div></section></div></main><footer className="site-footer"><span>DitsGate · Infrastruktur Pembayaran QRIS</span><Link to="/">Beranda</Link></footer></div>;
}

function App(){
 const[s,set]=useDemo();
 const[toast,setToast]=useState('');
 const[authChecked,setAuthChecked]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>>();
 const notify=(m:string)=>{setToast(m);clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(''),4500)};
 useEffect(()=>{void restoreMerchantSession().finally(()=>setAuthChecked(true));},[]);
 const p={s,set,notify};
 return <BrowserRouter><Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<Auth mode="login" notify={notify}/>}/><Route path="/register" element={<Auth mode="register" notify={notify}/>}/><Route path="/forgot-password" element={<Auth mode="forgot" notify={notify}/>}/><Route path="/docs" element={<PublicDocs kind="docs" notify={notify}/>}/><Route path="/integrations" element={<PublicDocs kind="integrations" notify={notify}/>}/><Route path="/dashboard/*" element={<Shell p={p} authChecked={authChecked}/>}/><Route path="/pay/:id" element={<Checkout {...p}/>}/><Route path="*" element={<Landing/>}/></Routes>{toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}<button aria-label="Tutup notifikasi" onClick={()=>setToast('')}><X size={15}/></button></div>}</BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<App/>);
