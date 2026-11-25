import React,{useState,useEffect,useRef}from'react';
import{Link}from'react-router-dom';
import{RefreshCw,Check,Clock,Copy,X,QrCode,AlertCircle,ArrowDown,ArrowRight,Sparkles}from'lucide-react';
import{useMerchantSession}from'./merchant-session';
import{API_ORIGIN}from'./developer-api';
import CheckoutQr from'./CheckoutQr';

const idr=(v:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
const date=(s:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const Badge=({children,tone='muted'}:{children:React.ReactNode;tone?:string})=><span className={'badge '+tone}>{children}</span>;

type SubOrder={id:string;months:number;baseAmount:number;uniqueCode:number;totalAmount:number;qrisPayload:string;status:'pending'|'paid'|'expired';createdAt:string;expiresAt:string;paidAt:string|null};
type SubData={active:boolean;expiresAt:string|null;qrisConfigured:boolean;orders:SubOrder[]};

const PLANS=[
 {months:1,baseAmount:10000,perMonth:10000,title:'1 bulan',desc:'Satu periode penuh tanpa biaya per transaksi.',highlight:'Mulai untung di atas 100 transaksi /bulan',badge:null,saving:null},
 {months:2,baseAmount:20000,perMonth:10000,title:'2 bulan',desc:'Tanpa biaya per transaksi selama 2 bulan.',highlight:'Mulai untung di atas 100 transaksi /bulan',badge:null,saving:null},
 {months:3,baseAmount:30000,perMonth:10000,title:'3 bulan',desc:'Tanpa biaya per transaksi selama 3 bulan.',highlight:'Mulai untung di atas 100 transaksi /bulan',badge:null,saving:null},
 {months:5,baseAmount:40000,perMonth:8000,title:'5 bulan',desc:'Tanpa biaya per transaksi selama 5 bulan.',highlight:'Mulai untung di atas 80 transaksi /bulan',badge:'Paling hemat',saving:'Hemat Rp 10.000 vs 1 bulan'},
] as const;

export default function SubscriptionPage({balance,notify}:{balance:number;notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const[data,setData]=useState<SubData|null>(null);
 const[loading,setLoading]=useState(false);
 const[buying,setBuying]=useState<number|null>(null);
 const[checkout,setCheckout]=useState<SubOrder|null>(null);
 const[tick,setTick]=useState(Date.now());
 const historyRef=useRef<HTMLElement>(null);

 const headers=():Record<string,string>=>merchant?.token&&merchant.token!=='cookie_session'?{Authorization:`Bearer ${merchant.token}`}:{};

 const load=async()=>{
  if(!merchant)return;
  setLoading(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/subscription',{credentials:'include',headers:headers()});
   if(r.ok){const j=await r.json();setData(j.data);}
  }catch{}finally{setLoading(false);}
 };

 useEffect(()=>{void load();},[merchant?.token]);
 useEffect(()=>{if(!checkout)return;const t=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(t);},[checkout]);

 const buy=async(months:number)=>{
  if(!merchant)return;
  setBuying(months);
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/subscription/checkout',{
    method:'POST',
    credentials:'include',
    headers:{'Content-Type':'application/json',...headers()},
    body:JSON.stringify({months}),
   });
   const j=await r.json();
   if(!r.ok){notify(j.error||'Gagal membuat checkout langganan.');return;}
   setCheckout(j.data);
   void load();
  }catch{notify('Kesalahan jaringan.');}finally{setBuying(null);}
 };

 const copyText=async(text:string)=>{try{await navigator.clipboard.writeText(text);notify('Nominal disalin');}catch{notify('Gagal menyalin');}};

 const active=data?.active??false;
 const expiresAt=data?.expiresAt??null;
 const orders=data?.orders??[];
 const seconds=checkout?Math.max(0,Math.ceil((new Date(checkout.expiresAt).getTime()-tick)/1000)):0;

 return <>
  <div className="page-head">
   <div><h1>Langganan</h1><p>Bebas biaya per transaksi</p></div>
   <div className="head-actions"><button className="button secondary" onClick={()=>{void load();notify('Status langganan diperbarui')}} disabled={loading}><RefreshCw size={15}/> Segarkan</button></div>
  </div>

  <section className="card" style={{marginBottom:20}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:16}}>
    <div style={{flex:'1 1 380px'}}>
     <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:8}}>
      <h2 style={{margin:0}}>Status langganan</h2>
      <Badge tone={active?'green':'amber'}>{active?'Aktif':'Belum aktif'}</Badge>
      <span className="muted" style={{fontSize:13}}>{active&&expiresAt?`Aktif hingga ${date(expiresAt)}`:'Mode tanpa langganan'}</span>
     </div>
     <p style={{margin:'0 0 8px'}}>
      {active
       ?'Biaya per transaksi Rp 0 selama masa aktif langganan.'
       :'Setiap order masih dipotong biaya Rp 100 dari saldo kredit. Dashboard dan integrasi tetap berjalan seperti biasa.'}
     </p>
     <p className="muted" style={{margin:'0 0 12px',fontSize:13}}>Langganan hanya menghapus biaya per transaksi selama masa aktif — tidak ada fitur yang dikunci di baliknya.</p>
     <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',fontSize:14}}>
      <span>Saldo kredit: <strong>{idr(balance)}</strong></span>
      <button type="button" className="text-action" onClick={()=>historyRef.current?.scrollIntoView({behavior:'smooth'})}>Riwayat pembayaran <ArrowDown size={14}/></button>
      <Link className="text-action" to="/dashboard/developers">Coba payment tools <ArrowRight size={14}/></Link>
     </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(120px,auto))',gap:16,background:'var(--surface)',padding:'14px 18px',borderRadius:10}}>
     <div><small className="muted">Paket mulai dari</small><div style={{fontWeight:700,marginTop:2}}>Rp 10.000</div></div>
     <div><small className="muted">Pembayaran</small><div style={{fontWeight:700,marginTop:2}}>QRIS · sekali bayar</div></div>
     <div><small className="muted">Perpanjangan</small><div style={{fontWeight:700,marginTop:2}}>Tidak otomatis</div></div>
    </div>
   </div>
  </section>

  <section style={{marginBottom:24}}>
   <div style={{marginBottom:14}}>
    <h2 style={{margin:'0 0 4px'}}>Pilih periode yang sesuai</h2>
    <p className="muted" style={{margin:0}}>Semakin panjang periodenya, semakin kecil biaya per bulan. Semua paket menurunkan biaya transaksi menjadi Rp 0 selama masa aktif.</p>
   </div>
   {data&&!data.qrisConfigured&&(
    <div className="info-line" style={{marginBottom:14}}><AlertCircle size={16}/> QRIS pembayaran DitsGate belum dikonfigurasi oleh admin. Silakan hubungi admin untuk mengaktifkan QRIS langganan.</div>
   )}
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:16}}>
    {PLANS.map(plan=>(
     <div key={plan.months} className="card" style={{display:'flex',flexDirection:'column',justifyContent:'space-between',border:plan.badge?'1.5px solid var(--accent,#2563eb)':undefined}}>
      <div>
       <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h3 style={{margin:0}}>{plan.title}</h3>
        {plan.badge&&<Badge tone="blue"><Sparkles size={12}/> {plan.badge}</Badge>}
       </div>
       <div className="big-number" style={{fontSize:26,margin:'4px 0'}}>{idr(plan.baseAmount)}</div>
       <div className="muted" style={{fontSize:13,marginBottom:plan.saving?4:12}}>≈ {idr(plan.perMonth)} /bulan</div>
       {plan.saving&&<div style={{fontSize:12,fontWeight:600,color:'var(--green,#16a34a)',marginBottom:10}}>{plan.saving}</div>}
       <p style={{fontSize:13,margin:'0 0 12px'}}>{plan.desc}</p>
       <ul style={{listStyle:'none',padding:0,margin:'0 0 16px',display:'flex',flexDirection:'column',gap:6,fontSize:13}}>
        <li style={{display:'flex',gap:6,alignItems:'center'}}><Check size={14}/> Biaya transaksi Rp 0 selama aktif</li>
        <li style={{display:'flex',gap:6,alignItems:'center'}}><Check size={14}/> {plan.highlight}</li>
        <li style={{display:'flex',gap:6,alignItems:'center'}}><Check size={14}/> Masa aktif {plan.months} bulan</li>
        <li style={{display:'flex',gap:6,alignItems:'center'}}><Check size={14}/> Pembayaran satu kali, tanpa auto-debit</li>
        <li style={{display:'flex',gap:6,alignItems:'center'}}><Check size={14}/> Ditambahkan ke masa aktif berjalan</li>
       </ul>
      </div>
      <div>
       <button className="button primary full-width" disabled={buying===plan.months} onClick={()=>void buy(plan.months)}>
        <QrCode size={15}/> {buying===plan.months?'Menyiapkan QRIS...':'Beli sekarang'}
       </button>
       <div className="muted" style={{fontSize:11,textAlign:'center',marginTop:6}}>Bayar QRIS · aktif otomatis setelah terverifikasi</div>
      </div>
     </div>
    ))}
   </div>
  </section>

  <section className="card" style={{marginBottom:20}}>
   <h2 style={{marginTop:0}}>Setiap paket memberikan</h2>
   <p className="muted" style={{marginTop:0}}>Beda paket hanya panjang periodenya — manfaatnya sama.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
    <div><strong>Tanpa perpanjangan otomatis</strong><p className="muted" style={{fontSize:13}}>Tidak ada auto-debit. Periode berikutnya hanya aktif bila Anda membelinya lagi dari halaman ini.</p></div>
    <div><strong>Periode bertumpuk</strong><p className="muted" style={{fontSize:13}}>Membeli sebelum periode habis menambah waktunya ke tanggal akhir yang berlaku, jadi hari yang sudah dibayar tidak hangus.</p></div>
    <div><strong>Order tetap tanpa biaya</strong><p className="muted" style={{fontSize:13}}>Order yang dibuat selama periode aktif tercatat tanpa biaya, dan biaya tidak dikenakan surut bila pembeli membayar setelah periodenya berakhir.</p></div>
    <div><strong>Kode unik bukan biaya</strong><p className="muted" style={{fontSize:13}}>Kode unik Rp 1–20 pada total checkout hanya penanda agar pembayaran terdeteksi otomatis.</p></div>
   </div>
  </section>

  <section className="card" ref={historyRef}>
   <h2 style={{marginTop:0}}>Riwayat pembayaran</h2>
   {orders.length===0
    ?<p className="muted">Belum ada pembelian paket langganan.</p>
    :<div className="table-wrap"><table><thead><tr><th>Paket</th><th>Nominal</th><th>Kode Unik</th><th>Total Bayar</th><th>Status</th><th>Waktu</th><th>Aksi</th></tr></thead><tbody>
     {orders.map(o=><tr key={o.id}>
      <td><b>{o.months} bulan</b></td>
      <td>{idr(o.baseAmount)}</td>
      <td>+{o.uniqueCode}</td>
      <td><b>{idr(o.totalAmount)}</b></td>
      <td><Badge tone={o.status==='paid'?'green':o.status==='pending'?'amber':'muted'}>{o.status==='paid'?'LUNAS':o.status==='pending'?'MENUNGGU':'KEDALUWARSA'}</Badge></td>
      <td>{date(o.createdAt)}</td>
      <td>{o.status==='pending'&&<button className="button secondary" onClick={()=>setCheckout(o)}><QrCode size={14}/> Tampilkan QRIS</button>}</td>
     </tr>)}
    </tbody></table></div>}
  </section>

  {checkout&&(
   <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setCheckout(null)}}>
    <div className="modal" role="dialog" aria-modal="true" aria-label="Pembayaran Langganan QRIS">
     <div className="modal-head">
      <h2>Bayar Langganan {checkout.months} Bulan</h2>
      <button className="icon-btn" aria-label="Tutup" onClick={()=>setCheckout(null)}><X size={18}/></button>
     </div>
     <div className="checkout-center" style={{padding:'8px 0'}}>
      <Badge tone={checkout.status==='paid'?'green':'amber'}>{checkout.status==='paid'?'LUNAS':'MENUNGGU PEMBAYARAN'}</Badge>
      <h1 style={{margin:'8px 0 4px'}}>{idr(checkout.totalAmount)}</h1>
      <p className="muted" style={{margin:'0 0 8px'}}>Nominal {idr(checkout.baseAmount)} + Kode unik +{checkout.uniqueCode}</p>
      <button type="button" className="text-action" onClick={()=>void copyText(String(checkout.totalAmount))}><Copy size={14}/> Salin nominal tepat</button>
     </div>
     <CheckoutQr qris={{id:'ditsgate-sub',payload:checkout.qrisPayload,provider:'DitsGate',name:'DitsGate',city:'Indonesia',mode:'dynamic',isDefault:true,image:'',fileName:'qris-ditsgate.png',updatedAt:checkout.createdAt}} total={checkout.totalAmount}/>
     <div className="countdown" style={{justifyContent:'center',marginTop:12}}>
      <Clock size={16}/> Berlaku: {Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}
     </div>
     <div className="info-line" style={{marginTop:12}}>Pindai QRIS DitsGate di atas dengan nominal tepat <strong>{idr(checkout.totalAmount)}</strong>. Setelah pembayaran diverifikasi, masa aktif langganan akan bertambah otomatis.</div>
     <div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setCheckout(null)}>Tutup</button></div>
    </div>
   </div>
  )}
 </>;
}
