import React,{useState,useEffect}from'react';
import{Link}from'react-router-dom';
import{Activity,ArrowRight,Database,Radio,Wallet,RefreshCw,TicketCheck,CheckCircle2,XCircle,QrCode}from'lucide-react';
import{useMerchantSession}from'./merchant-session';
import{API_ORIGIN}from'./developer-api';

const idr=(v:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
const date=(s:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const Badge=({children,tone='muted'}:{children:React.ReactNode;tone?:string})=><span className={'badge '+tone}>{children}</span>;

type MerchantRow={id:string;email:string;name:string;balance:number;createdAt:string};
type Ticket={id:string;merchantName:string;merchantEmail:string;subject:string;status:string;createdAt:string;updatedAt:string};
type Topup={id:string;merchantId:string;amount:number;status:string;createdAt:string;confirmedAt?:string|null};
type SubOrder={id:string;merchantName:string;merchantEmail:string;months:number;totalAmount:number;status:string;createdAt:string};

function QrisPlatformSettings({token,notify}:{token:string;notify:(m:string)=>void}){
 const[qrisPayload,setQrisPayload]=useState('');
 const[updatedAt,setUpdatedAt]=useState<string|null>(null);
 const[saving,setSaving]=useState(false);
 const[subs,setSubs]=useState<SubOrder[]|null>(null);

 const load=async()=>{
  try{
   const[sRes,subRes]=await Promise.all([
    fetch(API_ORIGIN+'/api/admin/settings',{credentials:'include',headers:{Authorization:`Bearer ${token}`}}),
    fetch(API_ORIGIN+'/api/admin/subscriptions',{credentials:'include',headers:{Authorization:`Bearer ${token}`}}),
   ]);
   if(sRes.ok){const j=await sRes.json();setQrisPayload(j.data?.qrisPayload||'');setUpdatedAt(j.data?.updatedAt||null);}
   if(subRes.ok){const j=await subRes.json();setSubs(j.data??[]);}
  }catch{}
 };
 useEffect(()=>{void load();},[token]);

 const saveQris=async(e:React.FormEvent)=>{
  e.preventDefault();setSaving(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/settings',{method:'PUT',credentials:'include',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({qrisPayload})});
   const j=await r.json();
   if(r.ok){setUpdatedAt(j.data?.updatedAt||null);notify('QRIS DitsGate berhasil disimpan');}
   else notify(j.error||'Payload QRIS tidak valid');
  }catch{notify('Kesalahan jaringan');}finally{setSaving(false);}
 };

 const confirmSub=async(id:string)=>{
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/subscriptions/'+id+'/confirm',{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
   if(r.ok){notify('Langganan diaktifkan');await load();}
   else{const j=await r.json();notify(j.error||'Gagal konfirmasi');}
  }catch{notify('Kesalahan jaringan');}
 };

 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading">
   <div><h2><QrCode size={18} style={{verticalAlign:'text-bottom',marginRight:6}}/>Pengaturan QRIS DitsGate &amp; Langganan</h2><p>Payload QRIS statis EMVCo milik DitsGate untuk pembayaran paket langganan merchant.</p></div>
   {updatedAt&&<small className="muted">Diperbarui: {date(updatedAt)}</small>}
  </div>
  <form onSubmit={saveQris} className="stack" style={{marginBottom:16}}>
   <label>Payload String QRIS EMVCo (dimulai dengan 000201...)
    <textarea rows={3} value={qrisPayload} onChange={e=>setQrisPayload(e.target.value)} placeholder="000201010211..." style={{fontFamily:'monospace',fontSize:12}}/>
   </label>
   <div className="row-actions"><button className="button primary" type="submit" disabled={saving}>{saving?'Menyimpan...':'Simpan QRIS DitsGate'}</button></div>
  </form>
  <h3>Order Langganan Merchant</h3>
  {subs===null?<p>Memuat…</p>:subs.length===0?<p className="admin-ops-empty">Belum ada order langganan.</p>:
  <div className="table-wrap"><table><thead><tr><th>Merchant</th><th>Paket</th><th>Total Bayar</th><th>Status</th><th>Waktu</th><th>Aksi</th></tr></thead><tbody>
   {subs.map(s=><tr key={s.id}><td><b>{s.merchantName}</b><br/><small>{s.merchantEmail}</small></td><td>{s.months} bulan</td><td><b>{idr(s.totalAmount)}</b></td><td><Badge tone={s.status==='paid'?'green':'amber'}>{s.status==='paid'?'Lunas':'Pending'}</Badge></td><td>{date(s.createdAt)}</td><td>{s.status==='pending'&&<button className="button primary" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>void confirmSub(s.id)}><CheckCircle2 size={13}/> Aktifkan</button>}</td></tr>)}
  </tbody></table></div>}
 </section>;
}

function MerchantList({token,notify}:{token:string;notify:(m:string)=>void}){
 const[merchants,setMerchants]=useState<MerchantRow[]|null>(null);
 const[selected,setSelected]=useState<string|null>(null);
 const[topupAmount,setTopupAmount]=useState(50000);
 const[proof,setProof]=useState('');
 const[note,setNote]=useState('');
 const[topups,setTopups]=useState<Topup[]|null>(null);
 const[busy,setBusy]=useState(false);

 const load=async()=>{
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/merchants',{headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setMerchants(j.data??[]);}
   else setMerchants([]);
  }catch{setMerchants([]);}
 };
 const loadDetail=async(id:string)=>{
  setSelected(id);setTopups(null);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/merchants/'+id,{headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setTopups(j.data?.topups??[]);}
  }catch{}
 };
 useEffect(()=>{void load();},[token]);
 const detail=merchants?.find(m=>m.id===selected);
 const confirmTopup=async(topupId:string)=>{
  if(!proof.trim()||!note.trim()){notify('Referensi bukti dan catatan wajib diisi');return;}
  setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/topups/'+topupId+'/confirm',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({proofReference:proof.trim(),note:note.trim()})});
   if(r.ok){notify('Topup dikonfirmasi');setProof('');setNote('');if(selected)await loadDetail(selected);await load();}
   else{const j=await r.json();notify(j.error||'Gagal konfirmasi');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };
 const createTopup=async()=>{
  if(!selected)return;setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/topups',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({merchantId:selected,amount:topupAmount})});
   if(r.ok){notify('Topup intent dibuat');if(selected)await loadDetail(selected);}
   else{const j=await r.json();notify(j.error||'Gagal membuat topup');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading">
   <div><h2>Daftar Merchant</h2><p>Data dari server. Pilih merchant untuk melihat saldo dan mengelola topup.</p></div>
   <button className="button secondary" onClick={()=>{void load();notify('Daftar merchant diperbarui')}}><RefreshCw size={15}/></button>
  </div>
  {merchants===null?<p>Memuat…</p>:merchants.length===0?<p className="admin-ops-empty">Belum ada merchant.</p>:
  <div className="admin-ops-list">
   {merchants.map(m=><button type="button" key={m.id} className={'admin-ops-merchant '+(selected===m.id?'selected':'')} aria-pressed={selected===m.id} onClick={()=>loadDetail(m.id)}>
    <span><strong>{m.name}</strong><small>{m.email} · {date(m.createdAt)}</small></span><b>{idr(m.balance)}</b>
   </button>)}
  </div>}
  {detail&&<div className="admin-ops-detail">
   <div className="admin-ops-heading"><div><h3>{detail.name}</h3><p>{detail.email}</p></div><strong>{idr(detail.balance)}</strong></div>
   <h4>Topup Saldo Biaya</h4>
   <div className="admin-ops-form" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
    <input type="number" min={1000} max={999999999} value={topupAmount} onChange={e=>setTopupAmount(+e.target.value)} style={{width:160}}/>
    <button className="button secondary" onClick={createTopup} disabled={busy}>Buat Topup Intent</button>
   </div>
   <h4>Riwayat Topup</h4>
   {topups===null?<p>Memuat…</p>:topups.length===0?<p className="admin-ops-empty">Belum ada topup.</p>:
   <div className="admin-ops-ledger">
    {topups.map(t=><div key={t.id}><span><b>{idr(t.amount)}</b><small>{date(t.createdAt)}</small></span>
     {t.status==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
      <Badge tone="amber">Pending</Badge>
      <input value={proof} onChange={e=>setProof(e.target.value)} placeholder="Referensi bukti (min 6 karakter)" style={{fontSize:12,padding:'2px 6px',width:200}}/>
      <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Catatan admin (min 8 karakter)" style={{fontSize:12,padding:'2px 6px',width:200}}/>
      <button className="button primary" style={{fontSize:12,padding:'4px 8px'}} onClick={()=>confirmTopup(t.id)} disabled={busy}><CheckCircle2 size={13}/> Konfirmasi</button>
     </div>:<Badge tone="green">Dikonfirmasi</Badge>}
    </div>)}
   </div>}
  </div>}
 </section>;
}

function TicketAdmin({token,notify}:{token:string;notify:(m:string)=>void}){
 const[tickets,setTickets]=useState<Ticket[]|null>(null);
 const[reply,setReply]=useState<Record<string,string>>({});
 const[busy,setBusy]=useState<string|null>(null);
 const load=async()=>{
  try{const r=await fetch(API_ORIGIN+'/api/admin/tickets',{headers:{Authorization:`Bearer ${token}`}});if(r.ok){const j=await r.json();setTickets(j.data??[]);}}catch{setTickets([]);}
 };
 useEffect(()=>{void load();},[token]);
 const update=async(id:string,status:string)=>{
  setBusy(id);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/tickets/'+id,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status,reply:reply[id]||undefined})});
   if(r.ok){notify('Tiket diperbarui');setReply(v=>({...v,[id]:''}));await load();}
   else{const j=await r.json();notify(j.error||'Gagal');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(null);}
 };
 const tone=(s:string)=>s==='open'?'amber':s==='in_progress'?'blue':s==='resolved'?'green':'muted';
 const label=(s:string)=>({open:'Terbuka',in_progress:'Diproses',resolved:'Selesai',closed:'Ditutup'}[s]??s);
 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading"><div><h2>Tiket Pengaduan</h2><p>Semua tiket merchant.</p></div><button className="button secondary" onClick={()=>{void load();notify('Tiket diperbarui')}}><RefreshCw size={15}/></button></div>
  {tickets===null?<p>Memuat…</p>:tickets.length===0?<p className="admin-ops-empty">Belum ada tiket.</p>:
  <div className="table-wrap"><table><thead><tr><th>ID</th><th>Merchant</th><th>Subjek</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>
   {tickets.map(t=><tr key={t.id}><td><small style={{fontFamily:'monospace'}}>{t.id.slice(0,8)}…</small></td><td><b>{t.merchantName}</b><br/><small>{t.merchantEmail}</small></td><td>{t.subject}</td><td><Badge tone={tone(t.status)}>{label(t.status)}</Badge></td><td>{date(t.createdAt)}</td>
    <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
     <input value={reply[t.id]||''} onChange={e=>setReply(v=>({...v,[t.id]:e.target.value}))} placeholder="Balasan (opsional)" style={{fontSize:12,padding:'2px 6px',width:160}}/>
     {t.status!=='resolved'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>update(t.id,'resolved')} disabled={busy===t.id}><CheckCircle2 size={13}/> Selesai</button>}
     {t.status==='open'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>update(t.id,'in_progress')} disabled={busy===t.id}>Proses</button>}
     {t.status!=='closed'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>update(t.id,'closed')} disabled={busy===t.id}><XCircle size={13}/> Tutup</button>}
    </div></td>
   </tr>)}
  </tbody></table></div>}
 </section>;
}

import'./admin-operations.css';

export default function AdminOperations({notify}:{notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const[stats,setStats]=useState<{transactions:number;pending:number;paid:number;providers:number}|null>(null);
 const token=merchant?.token;
 const isAdmin=false; // Admin role check: server validates; this flag just controls UI tabs
 useEffect(()=>{
  if(!token)return;
  void (async()=>{
   try{
    const[txRes,portalRes,listenerRes]=await Promise.all([
     fetch(API_ORIGIN+'/api/v1/transactions',{headers:{Authorization:`Bearer ${token}`}}),
     fetch(API_ORIGIN+'/api/v1/shopee-portal',{headers:{Authorization:`Bearer ${token}`}}),
     fetch(API_ORIGIN+'/api/v1/shopee-listener',{headers:{Authorization:`Bearer ${token}`}}),
    ]);
    const txj=txRes.ok?await txRes.json():{data:[]};
    const portal=portalRes.ok?await portalRes.json():{data:{}};
    const listener=listenerRes.ok?await listenerRes.json():{data:{}};
    const txs:Array<{status:string}>=txj.data??[];
    const provCount=(portal.data?.status==='connected'?1:0)+(listener.data?.status==='receiving'?1:0);
    setStats({transactions:txs.length,pending:txs.filter((t)=>t.status==='pending').length,paid:txs.filter((t)=>t.status==='paid').length,providers:provCount});
   }catch{}
  })();
 },[token]);
 if(!merchant?.token)return <div className="empty"><Activity size={22}/><h3>Masuk terlebih dahulu</h3><p>Panel admin hanya tersedia setelah login.</p><Link className="button primary" to="/login">Masuk</Link></div>;
 const totals=[
  {label:'Total Transaksi',value:stats?String(stats.transactions):'—',detail:'Dari API server',icon:Database},
  {label:'Menunggu Pembayaran',value:stats?String(stats.pending):'—',detail:'Status pending',icon:Activity},
  {label:'Lunas',value:stats?String(stats.paid):'—',detail:'Pembayaran terverifikasi',icon:Wallet},
  {label:'Provider Aktif',value:stats?String(stats.providers):'—',detail:'Shopee Portal / Listener',icon:Radio},
 ];
 return <div className="admin-ops">
  <div className="admin-ops-grid">{totals.map(({label,value,detail,icon:Icon})=><div key={label} className="card admin-ops-kpi"><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{detail}</small></div>)}</div>
  <QrisPlatformSettings token={merchant.token} notify={notify}/>
  <MerchantList token={merchant.token} notify={notify}/>
  <TicketAdmin token={merchant.token} notify={notify}/>
  <div className="admin-ops-bottom">
   <section className="card"><h2>Kesiapan integrasi</h2>
    <div className="admin-ops-row"><span>Provider terhubung</span><b>{stats?stats.providers+' aktif':'—'}</b></div>
    <div className="admin-ops-row"><span>Total transaksi</span><b>{stats?stats.transactions:'—'}</b></div>
    <Link to="/dashboard/transactions" className="button secondary">Kelola transaksi <ArrowRight size={14}/></Link>
   </section>
   <section className="card"><h2>Dokumentasi & dukungan</h2>
    <p>Untuk pertanyaan integrasi, buka halaman panduan atau ajukan tiket pengaduan.</p>
    <div className="row-actions"><Link className="button secondary" to="/dashboard/support"><TicketCheck size={15}/> Tiket Pengaduan</Link><Link className="button secondary" to="/dashboard/integration-guide">Panduan API</Link></div>
   </section>
  </div>
 </div>;
}
