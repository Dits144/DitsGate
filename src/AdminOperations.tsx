import React,{useState,useEffect,useCallback}from'react';
import{Link}from'react-router-dom';
import{Activity,ArrowRight,Database,Wallet,RefreshCw,TicketCheck,CheckCircle2,XCircle,QrCode,Users,ShieldAlert,ShieldCheck,Plus,Minus,CalendarPlus,Search}from'lucide-react';
import{useMerchantSession}from'./merchant-session';
import{API_ORIGIN}from'./developer-api';
import'./admin-operations.css';

const idr=(v:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
const date=(s:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(s));
const Badge=({children,tone='muted'}:{children:React.ReactNode;tone?:string})=><span className={'badge '+tone}>{children}</span>;

const ledgerLabel=(k:string)=>({
 signup_bonus:'Bonus Daftar',
 admin_topup:'Topup Admin',
 admin_adjustment:'Penyesuaian Admin',
 tx_hold:'Saldo Ditahan (-100)',
 tx_refund:'Dana Dikembalikan (+100)',
 paid_order_fee:'Biaya Order Lunas',
}[k]??k.replaceAll('_',' '));

type MerchantRow={id:string;email:string;name:string;balance:number;heldBalance?:number;isActive?:boolean;subscriptionExpiresAt?:string|null;transactionCount?:number;paidCount?:number;createdAt:string};
type LedgerRow={id:string;amount:number;kind:string;sourceId:string;note?:string|null;createdAt:string};
type TxRow={id:string;orderId:string;amount:number;uniqueCode:number;status:string;createdAt:string;expiresAt:string;merchantName?:string;merchantEmail?:string};
type Ticket={id:string;merchantName:string;merchantEmail:string;subject:string;status:string;createdAt:string;updatedAt:string};
type Topup={id:string;merchantId:string;merchantName?:string;merchantEmail?:string;amount:number;status:string;note?:string|null;createdAt:string;confirmedAt?:string|null};
type SubOrder={id:string;merchantName:string;merchantEmail:string;months:number;totalAmount:number;status:string;createdAt:string};
type OverviewData={totalUsers:number;activeUsers:number;totalBalance:number;heldBalance:number;totalTransactions:number;pendingTransactions:number;paidTransactions:number;failedTransactions:number;paidVolume:number;totalFeeRevenue:number;openTickets:number;pendingSubscriptions:number;pendingTopups:number};

function TopupRequests({token,notify,onChanged}:{token:string;notify:(m:string)=>void;onChanged:()=>void}){
 const[rows,setRows]=useState<Topup[]|null>(null);
 const[filter,setFilter]=useState('all');
 const[proofs,setProofs]=useState<Record<string,string>>({});
 const[notes,setNotes]=useState<Record<string,string>>({});
 const[busy,setBusy]=useState<string|null>(null);

 const load=useCallback(async()=>{
  try{
   const q=filter==='all'?'':'?status='+encodeURIComponent(filter);
   const r=await fetch(API_ORIGIN+'/api/admin/topups'+q,{credentials:'include',headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setRows(j.data??[]);}else setRows([]);
  }catch{setRows([]);}
 },[token,filter]);
 useEffect(()=>{void load();},[load]);

 const confirmTopup=async(t:Topup)=>{
  setBusy(t.id);
  const proofReference=(proofs[t.id]||'').trim()||`TOPUP-${t.id.slice(0,8).toUpperCase()}`;
  const note=(notes[t.id]||'').trim()||'Disetujui admin melalui Panel Admin';
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/topups/${t.id}/confirm`,{
    method:'POST',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({proofReference,note}),
   });
   const j=await r.json().catch(()=>({}));
   if(r.ok){notify(`Top up ${idr(t.amount)} disetujui & saldo ditambahkan`);await load();onChanged();}
   else notify(j.error||'Gagal menyetujui top up');
  }catch{notify('Kesalahan jaringan');}finally{setBusy(null);}
 };

 const rejectTopup=async(t:Topup)=>{
  setBusy(t.id);
  const note=(notes[t.id]||'').trim()||'Ditolak oleh admin';
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/topups/${t.id}/reject`,{
    method:'POST',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({note}),
   });
   const j=await r.json().catch(()=>({}));
   if(r.ok){notify('Permintaan top up ditolak');await load();onChanged();}
   else notify(j.error||'Gagal menolak top up');
  }catch{notify('Kesalahan jaringan');}finally{setBusy(null);}
 };

 const pendingCount=rows?.filter(r=>r.status==='pending').length??0;

 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading">
   <div>
    <h2>Permintaan Top Up Saldo {pendingCount>0&&<Badge tone="amber">{pendingCount} Menunggu</Badge>}</h2>
    <p>Pengajuan top up dari halaman Top Up merchant (mulai Rp 5.000). Klik Setujui untuk langsung menambahkan saldo user.</p>
   </div>
   <div style={{display:'flex',gap:8,alignItems:'center'}}>
    <select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter status topup">
     <option value="all">Semua</option>
     <option value="pending">Menunggu</option>
     <option value="admin_confirmed">Disetujui</option>
     <option value="rejected">Ditolak</option>
    </select>
    <button className="button secondary" onClick={()=>{void load();notify('Permintaan top up diperbarui')}}><RefreshCw size={15}/></button>
   </div>
  </div>
  {rows===null?<p>Memuat…</p>:rows.length===0?<p className="admin-ops-empty">Belum ada permintaan top up dari merchant.</p>:
  <div className="table-wrap" style={{marginTop:12}}><table><thead><tr><th>User</th><th>Nominal</th><th>Status</th><th>Waktu</th><th>Aksi Admin</th></tr></thead><tbody>
   {rows.map(t=><tr key={t.id}>
    <td><b>{t.merchantName||t.merchantId.slice(0,8)}</b><br/><small>{t.merchantEmail||''}</small></td>
    <td><b>{idr(t.amount)}</b></td>
    <td>{t.status==='admin_confirmed'?<Badge tone="green">Disetujui</Badge>:t.status==='rejected'?<Badge tone="muted">Ditolak</Badge>:<Badge tone="amber">Menunggu</Badge>}</td>
    <td>{date(t.createdAt)}</td>
    <td>{t.status==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
     <input value={proofs[t.id]||''} onChange={e=>setProofs(v=>({...v,[t.id]:e.target.value}))} placeholder="Ref bukti (opsional)" style={{fontSize:12,padding:'4px 8px',width:140}}/>
     <input value={notes[t.id]||''} onChange={e=>setNotes(v=>({...v,[t.id]:e.target.value}))} placeholder="Catatan (opsional)" style={{fontSize:12,padding:'4px 8px',width:150}}/>
     <button className="button primary" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>void confirmTopup(t)} disabled={busy===t.id}><CheckCircle2 size={13}/> Setujui (+Saldo)</button>
     <button className="button secondary" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>void rejectTopup(t)} disabled={busy===t.id}><XCircle size={13}/> Tolak</button>
    </div>:<small className="muted">{t.note||'Selesai'}</small>}</td>
   </tr>)}
  </tbody></table></div>}
 </section>;
}

function QrisPlatformSettings({token,notify,onChanged}:{token:string;notify:(m:string)=>void;onChanged:()=>void}){
 const[qrisPayload,setQrisPayload]=useState('');
 const[updatedAt,setUpdatedAt]=useState<string|null>(null);
 const[saving,setSaving]=useState(false);
 const[subs,setSubs]=useState<SubOrder[]|null>(null);

 const load=useCallback(async()=>{
  try{
   const[sRes,subRes]=await Promise.all([
    fetch(API_ORIGIN+'/api/admin/settings',{credentials:'include',headers:{Authorization:`Bearer ${token}`}}),
    fetch(API_ORIGIN+'/api/admin/subscriptions',{credentials:'include',headers:{Authorization:`Bearer ${token}`}}),
   ]);
   if(sRes.ok){const j=await sRes.json();setQrisPayload(j.data?.qrisPayload||'');setUpdatedAt(j.data?.updatedAt||null);}
   if(subRes.ok){const j=await subRes.json();setSubs(j.data??[]);}
  }catch{}
 },[token]);
 useEffect(()=>{void load();},[load]);

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
   if(r.ok){notify('Langganan diaktifkan');await load();onChanged();}
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

function MerchantList({token,notify,onChanged}:{token:string;notify:(m:string)=>void;onChanged:()=>void}){
 const[merchants,setMerchants]=useState<MerchantRow[]|null>(null);
 const[search,setSearch]=useState('');
 const[selected,setSelected]=useState<string|null>(null);
 const[adjustAmount,setAdjustAmount]=useState(10000);
 const[adjustNote,setAdjustNote]=useState('');
 const[topupAmount,setTopupAmount]=useState(50000);
 const[proof,setProof]=useState('');
 const[note,setNote]=useState('');
 const[topups,setTopups]=useState<Topup[]|null>(null);
 const[ledger,setLedger]=useState<LedgerRow[]|null>(null);
 const[userTxs,setUserTxs]=useState<TxRow[]|null>(null);
 const[detailTab,setDetailTab]=useState<'ledger'|'tx'|'topups'>('ledger');
 const[busy,setBusy]=useState(false);

 const load=useCallback(async()=>{
  try{
   const q=search.trim()?`?q=${encodeURIComponent(search.trim())}`:'';
   const r=await fetch(API_ORIGIN+'/api/admin/merchants'+q,{credentials:'include',headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setMerchants(j.data??[]);}
   else setMerchants([]);
  }catch{setMerchants([]);}
 },[token,search]);

 const loadDetail=async(id:string)=>{
  setSelected(id);setTopups(null);setLedger(null);setUserTxs(null);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/merchants/'+id,{credentials:'include',headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){
    const j=await r.json();
    setTopups(j.data?.topups??[]);
    setLedger(j.data?.ledger??[]);
    setUserTxs(j.data?.transactions??[]);
   }
  }catch{}
 };
 useEffect(()=>{void load();},[load]);

 const detail=merchants?.find(m=>m.id===selected);

 const adjustBalance=async(sign:1|-1)=>{
  if(!selected)return;
  const amt=Math.trunc(Number(adjustAmount));
  if(!Number.isSafeInteger(amt)||amt<=0){notify('Masukkan nominal lebih dari 0');return;}
  setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/merchants/${selected}/balance`,{
    method:'POST',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({amount:sign*amt,note:adjustNote.trim()||undefined}),
   });
   const j=await r.json();
   if(r.ok){
    notify(sign>0?`Saldo +${idr(amt)} berhasil ditambahkan`:`Saldo -${idr(amt)} berhasil dikurangi`);
    setAdjustNote('');
    await Promise.all([loadDetail(selected),load()]);
    onChanged();
   }else notify(j.error||'Gagal memperbarui saldo');
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 const toggleStatus=async(isActive:boolean)=>{
  if(!selected)return;setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/merchants/${selected}`,{
    method:'PATCH',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({isActive}),
   });
   if(r.ok){
    notify(isActive?'Akun user diaktifkan kembali':'Akun user dinonaktifkan');
    await Promise.all([loadDetail(selected),load()]);
    onChanged();
   }else{const j=await r.json();notify(j.error||'Gagal memperbarui akun');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 const grantSubDays=async(days:number)=>{
  if(!selected)return;setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/merchants/${selected}`,{
    method:'PATCH',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({addSubscriptionDays:days}),
   });
   if(r.ok){
    notify(`Langganan ditambah +${days} hari`);
    await Promise.all([loadDetail(selected),load()]);
    onChanged();
   }else{const j=await r.json();notify(j.error||'Gagal menambah langganan');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 const confirmTopup=async(topupId:string)=>{
  if(!proof.trim()||!note.trim()){notify('Referensi bukti dan catatan wajib diisi');return;}
  setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/topups/'+topupId+'/confirm',{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({proofReference:proof.trim(),note:note.trim()})});
   if(r.ok){notify('Topup dikonfirmasi');setProof('');setNote('');if(selected)await loadDetail(selected);await load();onChanged();}
   else{const j=await r.json();notify(j.error||'Gagal konfirmasi');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 const createTopup=async()=>{
  if(!selected)return;setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/topups',{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({merchantId:selected,amount:topupAmount})});
   if(r.ok){notify('Topup intent dibuat');if(selected)await loadDetail(selected);}
   else{const j=await r.json();notify(j.error||'Gagal membuat topup');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(false);}
 };

 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading">
   <div><h2><Users size={18} style={{verticalAlign:'text-bottom',marginRight:6}}/>Manajemen User &amp; Saldo</h2><p>User baru otomatis mendapat saldo awal Rp 3.000. Pilih user untuk tambah/kurangi saldo, kelola status akun, atau periksa mutasi.</p></div>
   <button className="button secondary" onClick={()=>{void load();notify('Daftar user diperbarui')}}><RefreshCw size={15}/></button>
  </div>
  <div className="admin-ops-search">
   <label style={{display:'flex',alignItems:'center',gap:8}}>
    <Search size={16}/>
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama atau email user..."/>
   </label>
  </div>
  {merchants===null?<p>Memuat…</p>:merchants.length===0?<p className="admin-ops-empty">Belum ada user terdaftar.</p>:
  <div className="admin-ops-list">
   {merchants.map(m=><button type="button" key={m.id} className={'admin-ops-merchant '+(selected===m.id?'selected':'')} aria-pressed={selected===m.id} onClick={()=>void loadDetail(m.id)}>
    <span>
     <strong>{m.name} {m.isActive===false&&<Badge tone="amber">Nonaktif</Badge>}</strong>
     <small>{m.email}</small>
     <small>{m.transactionCount??0} transaksi ({m.paidCount??0} lunas){(m.heldBalance??0)>0?` · Ditahan ${idr(m.heldBalance??0)}`:''}</small>
    </span>
    <b>{idr(m.balance)}</b>
   </button>)}
  </div>}
  {detail&&<div className="admin-ops-detail">
   <div className="admin-ops-heading">
    <div>
     <h3>{detail.name} {detail.isActive===false?<Badge tone="amber">Dinonaktifkan</Badge>:<Badge tone="green">Aktif</Badge>}</h3>
     <p>{detail.email} · Bergabung {date(detail.createdAt)}{detail.subscriptionExpiresAt?` · Langganan s/d ${date(detail.subscriptionExpiresAt)}`:''}</p>
    </div>
    <div style={{textAlign:'right'}}>
     <strong style={{fontSize:20}}>{idr(detail.balance)}</strong>
     {(detail.heldBalance??0)>0&&<div><small className="muted">Ditahan: {idr(detail.heldBalance??0)}</small></div>}
    </div>
   </div>

   <div className="row-actions" style={{margin:'12px 0',display:'flex',gap:8,flexWrap:'wrap'}}>
    {detail.isActive===false
     ?<button className="button secondary" onClick={()=>void toggleStatus(true)} disabled={busy}><ShieldCheck size={14}/> Aktifkan Akun</button>
     :<button className="button secondary" onClick={()=>void toggleStatus(false)} disabled={busy}><ShieldAlert size={14}/> Nonaktifkan Akun</button>}
    <button className="button secondary" onClick={()=>void grantSubDays(30)} disabled={busy}><CalendarPlus size={14}/> Tambah Langganan +30 Hari</button>
   </div>

   <h4>Tambah / Sesuaikan Saldo Langsung</h4>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
    {[3000,10000,50000,100000].map(v=><button key={v} type="button" className="button secondary" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>setAdjustAmount(v)}>+{idr(v)}</button>)}
   </div>
   <div className="admin-ops-form" style={{marginTop:8,marginBottom:16}}>
    <label>Nominal (Rp)<input type="number" min={1} max={999999999} value={adjustAmount} onChange={e=>setAdjustAmount(+e.target.value)}/></label>
    <label>Catatan Admin (opsional)<input value={adjustNote} onChange={e=>setAdjustNote(e.target.value)} placeholder="Contoh: Topup transfer BCA / Bonus promo"/></label>
    <button type="button" className="button primary" onClick={()=>void adjustBalance(1)} disabled={busy}><Plus size={15}/> Tambah Saldo</button>
    <button type="button" className="button secondary" onClick={()=>void adjustBalance(-1)} disabled={busy}><Minus size={15}/> Kurangi Saldo</button>
   </div>

   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
    <button type="button" className={'button '+(detailTab==='ledger'?'primary':'secondary')} onClick={()=>setDetailTab('ledger')}>Mutasi Saldo ({ledger?.length??0})</button>
    <button type="button" className={'button '+(detailTab==='tx'?'primary':'secondary')} onClick={()=>setDetailTab('tx')}>Transaksi ({userTxs?.length??0})</button>
    <button type="button" className={'button '+(detailTab==='topups'?'primary':'secondary')} onClick={()=>setDetailTab('topups')}>Topup Intent QRIS ({topups?.length??0})</button>
   </div>

   {detailTab==='ledger'&&(ledger===null?<p>Memuat…</p>:ledger.length===0?<p className="admin-ops-empty">Belum ada mutasi saldo.</p>:
   <div className="admin-ops-ledger">
    {ledger.map(l=><div key={l.id}>
     <span><strong>{ledgerLabel(l.kind)}</strong><small>{l.note||l.sourceId.slice(0,12)} · {date(l.createdAt)}</small></span>
     <span><b style={{color:l.amount>0?'var(--green,#15803d)':'inherit'}}>{l.amount>0?'+':''}{idr(l.amount)}</b></span>
    </div>)}
   </div>)}

   {detailTab==='tx'&&(userTxs===null?<p>Memuat…</p>:userTxs.length===0?<p className="admin-ops-empty">Belum ada transaksi.</p>:
   <div className="table-wrap"><table><thead><tr><th>Order ID</th><th>Nominal</th><th>Status</th><th>Waktu</th></tr></thead><tbody>
    {userTxs.map(t=><tr key={t.id}><td><b>{t.orderId}</b><br/><small>{t.id.slice(0,8)}</small></td><td>{idr(t.amount)}</td><td><Badge tone={t.status==='paid'?'green':t.status==='pending'?'amber':'muted'}>{t.status.toUpperCase()}</Badge></td><td>{date(t.createdAt)}</td></tr>)}
   </tbody></table></div>)}

   {detailTab==='topups'&&<>
    <div className="admin-ops-form" style={{marginTop:4,marginBottom:12}}>
     <label>Nominal Topup Intent<input type="number" min={1000} max={999999999} value={topupAmount} onChange={e=>setTopupAmount(+e.target.value)}/></label>
     <button className="button secondary" onClick={createTopup} disabled={busy}>Buat Topup Intent QRIS</button>
    </div>
    {topups===null?<p>Memuat…</p>:topups.length===0?<p className="admin-ops-empty">Belum ada topup intent.</p>:
    <div className="admin-ops-ledger">
     {topups.map(t=><div key={t.id}><span><b>{idr(t.amount)}</b><small>{date(t.createdAt)}</small></span>
      {t.status==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
       <Badge tone="amber">Pending</Badge>
       <input value={proof} onChange={e=>setProof(e.target.value)} placeholder="Referensi bukti (min 6 karakter)" style={{fontSize:12,padding:'2px 6px',width:200}}/>
       <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Catatan admin (min 8 karakter)" style={{fontSize:12,padding:'2px 6px',width:200}}/>
       <button className="button primary" style={{fontSize:12,padding:'4px 8px'}} onClick={()=>void confirmTopup(t.id)} disabled={busy}><CheckCircle2 size={13}/> Konfirmasi</button>
      </div>:<Badge tone="green">Dikonfirmasi</Badge>}
     </div>)}
    </div>}
   </>}
  </div>}
 </section>;
}

function GlobalTransactions({token,notify,onChanged}:{token:string;notify:(m:string)=>void;onChanged:()=>void}){
 const[rows,setRows]=useState<TxRow[]|null>(null);
 const[status,setStatus]=useState('all');
 const[q,setQ]=useState('');
 const[busy,setBusy]=useState<string|null>(null);

 const load=useCallback(async()=>{
  try{
   const params=new URLSearchParams();
   if(status!=='all')params.set('status',status);
   if(q.trim())params.set('q',q.trim());
   const r=await fetch(API_ORIGIN+'/api/admin/transactions?'+params.toString(),{credentials:'include',headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setRows(j.data??[]);}else setRows([]);
  }catch{setRows([]);}
 },[token,status,q]);
 useEffect(()=>{void load();},[load]);

 const resolveTx=async(id:string,nextStatus:'paid'|'failed'|'cancelled')=>{
  setBusy(id);
  try{
   const r=await fetch(API_ORIGIN+`/api/admin/transactions/${id}`,{
    method:'PATCH',credentials:'include',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({status:nextStatus}),
   });
   if(r.ok){
    notify(nextStatus==='paid'?'Transaksi ditandai Lunas (Rp 100 terpotong)':'Transaksi dibatalkan/gagal (Rp 100 dikembalikan)');
    await load();
    onChanged();
   }else{const j=await r.json();notify(j.error||'Gagal memproses transaksi');}
  }catch{notify('Kesalahan jaringan');}finally{setBusy(null);}
 };

 return <section className="card admin-ops-manage">
  <div className="admin-ops-heading">
   <div><h2>Monitor Transaksi Global</h2><p>Setiap transaksi menahan Rp 100. Tandai Lunas untuk memotong final, atau Gagal/Batal untuk mengembalikan Rp 100 ke user.</p></div>
   <button className="button secondary" onClick={()=>{void load();notify('Transaksi diperbarui')}}><RefreshCw size={15}/></button>
  </div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'12px 0'}}>
   <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter status transaksi">
    <option value="all">Semua status</option>
    <option value="pending">Pending (Ditahan)</option>
    <option value="paid">Lunas</option>
    <option value="failed">Gagal</option>
    <option value="expired">Kedaluwarsa</option>
    <option value="cancelled">Dibatalkan</option>
   </select>
   <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Cari Order ID atau user..." style={{minWidth:220}}/>
  </div>
  {rows===null?<p>Memuat…</p>:rows.length===0?<p className="admin-ops-empty">Belum ada transaksi tercatat.</p>:
  <div className="table-wrap"><table><thead><tr><th>Order ID</th><th>User</th><th>Nominal</th><th>Status</th><th>Waktu</th><th>Aksi Admin</th></tr></thead><tbody>
   {rows.map(t=><tr key={t.id}>
    <td><b>{t.orderId}</b><br/><small>{t.id.slice(0,8)}</small></td>
    <td><b>{t.merchantName}</b><br/><small>{t.merchantEmail}</small></td>
    <td>{idr(t.amount)}</td>
    <td><Badge tone={t.status==='paid'?'green':t.status==='pending'?'amber':'muted'}>{t.status.toUpperCase()}</Badge></td>
    <td>{date(t.createdAt)}</td>
    <td>{t.status==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
     <button className="button primary" style={{fontSize:12,padding:'4px 8px'}} onClick={()=>void resolveTx(t.id,'paid')} disabled={busy===t.id}>Lunas</button>
     <button className="button secondary" style={{fontSize:12,padding:'4px 8px'}} onClick={()=>void resolveTx(t.id,'failed')} disabled={busy===t.id}>Gagal (+100)</button>
    </div>:<small className="muted">Final</small>}</td>
   </tr>)}
  </tbody></table></div>}
 </section>;
}

function TicketAdmin({token,notify,onChanged}:{token:string;notify:(m:string)=>void;onChanged:()=>void}){
 const[tickets,setTickets]=useState<Ticket[]|null>(null);
 const[reply,setReply]=useState<Record<string,string>>({});
 const[busy,setBusy]=useState<string|null>(null);
 const load=useCallback(async()=>{
  try{const r=await fetch(API_ORIGIN+'/api/admin/tickets',{credentials:'include',headers:{Authorization:`Bearer ${token}`}});if(r.ok){const j=await r.json();setTickets(j.data??[]);}}catch{setTickets([]);}
 },[token]);
 useEffect(()=>{void load();},[load]);
 const update=async(id:string,status:string)=>{
  setBusy(id);
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/tickets/'+id,{method:'PATCH',credentials:'include',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status,reply:reply[id]||undefined})});
   if(r.ok){notify('Tiket diperbarui');setReply(v=>({...v,[id]:''}));await load();onChanged();}
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
     {t.status!=='resolved'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>void update(t.id,'resolved')} disabled={busy===t.id}><CheckCircle2 size={13}/> Selesai</button>}
     {t.status==='open'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>void update(t.id,'in_progress')} disabled={busy===t.id}>Proses</button>}
     {t.status!=='closed'&&<button className="button secondary" style={{fontSize:12}} onClick={()=>void update(t.id,'closed')} disabled={busy===t.id}><XCircle size={13}/> Tutup</button>}
    </div></td>
   </tr>)}
  </tbody></table></div>}
 </section>;
}

export default function AdminOperations({notify}:{notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const[overview,setOverview]=useState<OverviewData|null>(null);
 const token=merchant?.token;

 const loadOverview=useCallback(async()=>{
  if(!token)return;
  try{
   const r=await fetch(API_ORIGIN+'/api/admin/overview',{credentials:'include',headers:{Authorization:`Bearer ${token}`}});
   if(r.ok){const j=await r.json();setOverview(j.data??null);}
  }catch{}
 },[token]);

 useEffect(()=>{void loadOverview();},[loadOverview]);

 if(!merchant?.token)return <div className="empty"><Activity size={22}/><h3>Masuk terlebih dahulu</h3><p>Panel admin hanya tersedia setelah login.</p><Link className="button primary" to="/login">Masuk</Link></div>;
 const totals=[
  {label:'Total User',value:overview?String(overview.totalUsers):'—',detail:overview?`${overview.activeUsers} akun aktif`:'Memuat...',icon:Users},
  {label:'Total Saldo User',value:overview?idr(overview.totalBalance):'—',detail:overview?`Ditahan: ${idr(overview.heldBalance)}`:'Memuat...',icon:Wallet},
  {label:'Total Transaksi',value:overview?String(overview.totalTransactions):'—',detail:overview?`${overview.paidTransactions} lunas · ${overview.pendingTransactions} pending`:'Memuat...',icon:Database},
  {label:'Pendapatan Fee',value:overview?idr(overview.totalFeeRevenue):'—',detail:overview?`${overview.openTickets} tiket · ${overview.pendingSubscriptions} langganan`:'Memuat...',icon:Activity},
 ];
 return <div className="admin-ops">
  <div className="admin-ops-grid">{totals.map(({label,value,detail,icon:Icon})=><div key={label} className="card admin-ops-kpi"><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{detail}</small></div>)}</div>
  <TopupRequests token={merchant.token} notify={notify} onChanged={()=>void loadOverview()}/>
  <MerchantList token={merchant.token} notify={notify} onChanged={()=>void loadOverview()}/>
  <GlobalTransactions token={merchant.token} notify={notify} onChanged={()=>void loadOverview()}/>
  <QrisPlatformSettings token={merchant.token} notify={notify} onChanged={()=>void loadOverview()}/>
  <TicketAdmin token={merchant.token} notify={notify} onChanged={()=>void loadOverview()}/>
  <div className="admin-ops-bottom">
   <section className="card"><h2>Ringkasan Operasional</h2>
    <div className="admin-ops-row"><span>Volume lunas platform</span><b>{overview?idr(overview.paidVolume):'—'}</b></div>
    <div className="admin-ops-row"><span>Transaksi gagal / kedaluwarsa</span><b>{overview?overview.failedTransactions:'—'}</b></div>
    <div className="admin-ops-row"><span>Topup intent pending</span><b>{overview?overview.pendingTopups:'—'}</b></div>
    <Link to="/dashboard/transactions" className="button secondary">Kelola transaksi <ArrowRight size={14}/></Link>
   </section>
   <section className="card"><h2>Dokumentasi &amp; dukungan</h2>
    <p>Untuk pertanyaan integrasi, buka halaman panduan atau ajukan tiket pengaduan.</p>
    <div className="row-actions"><Link className="button secondary" to="/dashboard/support"><TicketCheck size={15}/> Tiket Pengaduan</Link><Link className="button secondary" to="/dashboard/integration-guide">Panduan API</Link></div>
   </section>
  </div>
 </div>;
}
