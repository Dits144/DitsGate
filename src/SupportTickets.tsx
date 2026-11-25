import React,{useState,useEffect,useRef} from 'react';
import{Link,useNavigate,useParams}from'react-router-dom';
import{MessageSquare,Plus,RefreshCw,ChevronRight,Send,ArrowLeft,AlertCircle,CheckCircle2,Clock,Inbox}from'lucide-react';
import{useMerchantSession}from'./merchant-session';
import{API_ORIGIN}from'./developer-api';

type Ticket={id:string;transactionId:string|null;subject:string;description:string;status:'open'|'in_progress'|'resolved'|'closed';createdAt:string;updatedAt:string};
type Message={id:string;ticketId:string;senderId:string;role:'merchant'|'admin';message:string;createdAt:string};
type TicketDetail=Ticket&{messages:Message[]};

const idr=(v:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
const date=(s:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const statusTone=(s:string)=>s==='open'?'amber':s==='in_progress'?'blue':s==='resolved'?'green':'muted';
const statusLabel=(s:string)=>({open:'Terbuka',in_progress:'Diproses',resolved:'Selesai',closed:'Ditutup'}[s]??s);

const Badge=({children,tone='muted'}:{children:React.ReactNode;tone?:string})=><span className={'badge '+tone}>{children}</span>;
const Empty=({title,desc,action}:{title:string;desc:string;action?:React.ReactNode})=><div className="empty"><div className="empty-icon"><Inbox size={22}/></div><h3>{title}</h3><p>{desc}</p>{action}</div>;

export function TicketList({notify}:{notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const nav=useNavigate();
 const[tickets,setTickets]=useState<Ticket[]|null>(null);
 const[loading,setLoading]=useState(false);
 const load=async()=>{
  if(!merchant?.token)return;
  setLoading(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/tickets',{headers:{Authorization:`Bearer ${merchant.token}`}});
   if(r.ok){const j=await r.json();setTickets(j.data??[]);}
  }catch{}finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[merchant?.token]);

 if(!merchant)return <div className="empty"><AlertCircle size={22}/><h3>Masuk terlebih dahulu</h3><p>Masuk ke akun merchant untuk melihat tiket pengaduan.</p><Link className="button primary" to="/login">Masuk</Link></div>;

 return <>
  <div className="page-head"><div><h1>Tiket Pengaduan</h1><p>Ajukan pertanyaan atau keluhan seputar transaksi.</p></div><div className="head-actions"><button className="button secondary" onClick={()=>{void load();notify('Daftar tiket diperbarui')}} disabled={loading}><RefreshCw size={15}/> Segarkan</button><button className="button primary" onClick={()=>nav('/dashboard/support/new')}><Plus size={16}/> Buat Tiket</button></div></div>
  <section className="card">
   {tickets===null?<div className="empty"><p>Memuat...</p></div>:tickets.length===0?<Empty title="Belum ada tiket" desc="Ajukan tiket bila ada pertanyaan atau kendala transaksi." action={<button className="button primary" onClick={()=>nav('/dashboard/support/new')}><Plus size={16}/> Buat Tiket Pertama</button>}/>:
   <div className="table-wrap"><table><thead><tr><th>ID Tiket</th><th>Subjek</th><th>Transaksi</th><th>Status</th><th>Terakhir Diperbarui</th><th>Aksi</th></tr></thead><tbody>
   {tickets.map(t=><tr key={t.id}><td><small style={{fontFamily:'monospace'}}>{t.id.slice(0,8)}…</small></td><td><b>{t.subject}</b></td><td>{t.transactionId?<small style={{fontFamily:'monospace'}}>{t.transactionId.slice(0,12)}…</small>:'—'}</td><td><Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge></td><td>{date(t.updatedAt)}</td><td><Link className="button secondary" to={'/dashboard/support/'+t.id}>Lihat <ChevronRight size={14}/></Link></td></tr>)}
   </tbody></table></div>}
  </section>
 </>;
}

export function NewTicket({notify}:{notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const nav=useNavigate();
 const[subject,setSubject]=useState('');
 const[description,setDescription]=useState('');
 const[txId,setTxId]=useState('');
 const[error,setError]=useState('');
 const[busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try{
   const r=await fetch(API_ORIGIN+'/api/v1/tickets',{method:'POST',headers:{Authorization:`Bearer ${merchant!.token}`,'Content-Type':'application/json'},body:JSON.stringify({subject,description,transactionId:txId||null})});
   if(r.ok){notify('Tiket berhasil dibuat');nav('/dashboard/support');}
   else{const j=await r.json();setError(j.error||'Gagal membuat tiket.');}
  }catch{setError('Kesalahan jaringan.');}finally{setBusy(false);}
 }
 if(!merchant)return <div className="empty"><AlertCircle size={22}/><h3>Masuk terlebih dahulu</h3><Link className="button primary" to="/login">Masuk</Link></div>;
 return <>
  <div className="page-head"><div><Link className="back-link" to="/dashboard/support"><ArrowLeft size={16}/> Kembali</Link><h1>Buat Tiket Pengaduan</h1><p>Deskripsikan kendala Anda sejelas mungkin.</p></div></div>
  <section className="card" style={{maxWidth:640}}>
   <form onSubmit={submit} className="stack">
    <label>Subjek <input required maxLength={200} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Contoh: Transaksi sudah lunas tapi belum terkonfirmasi"/></label>
    <label>ID Transaksi (opsional) <input value={txId} onChange={e=>setTxId(e.target.value)} placeholder="trx_..." style={{fontFamily:'monospace'}}/></label>
    <label>Deskripsi lengkap <textarea required maxLength={5000} rows={6} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Jelaskan masalah Anda, sertakan bukti pembayaran, waktu kejadian, dan langkah yang sudah dicoba."/></label>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="row-actions"><button className="button primary" disabled={busy}>{busy?'Mengirim...':'Kirim Tiket'}</button><Link className="button secondary" to="/dashboard/support">Batal</Link></div>
   </form>
  </section>
 </>;
}

export function TicketDetail({notify}:{notify:(m:string)=>void}){
 const merchant=useMerchantSession();
 const{id}=useParams<{id:string}>();
 const[ticket,setTicket]=useState<TicketDetail|null>(null);
 const[loading,setLoading]=useState(true);
 const[message,setMessage]=useState('');
 const[sending,setSending]=useState(false);
 const bottomRef=useRef<HTMLDivElement>(null);
 const load=async()=>{
  if(!merchant?.token||!id)return;
  try{const r=await fetch(API_ORIGIN+'/api/v1/tickets/'+id,{headers:{Authorization:`Bearer ${merchant.token}`}});if(r.ok){const j=await r.json();setTicket(j.data);}}
  catch{}finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[merchant?.token,id]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[ticket?.messages?.length]);
 async function send(e:React.FormEvent){
  e.preventDefault();if(!message.trim())return;setSending(true);
  try{const r=await fetch(API_ORIGIN+'/api/v1/tickets/'+id+'/messages',{method:'POST',headers:{Authorization:`Bearer ${merchant!.token}`,'Content-Type':'application/json'},body:JSON.stringify({message})});
   if(r.ok){setMessage('');await load();notify('Pesan terkirim');}
   else{const j=await r.json();notify(j.error||'Gagal mengirim.');}
  }catch{notify('Kesalahan jaringan.');}finally{setSending(false);}
 }
 if(!merchant)return <div className="empty"><AlertCircle size={22}/><h3>Masuk terlebih dahulu</h3><Link className="button primary" to="/login">Masuk</Link></div>;
 if(loading)return <div className="empty"><p>Memuat…</p></div>;
 if(!ticket)return <div className="empty"><AlertCircle size={22}/><h3>Tiket tidak ditemukan</h3><Link className="button secondary" to="/dashboard/support">Kembali</Link></div>;
 const closed=ticket.status==='closed'||ticket.status==='resolved';
 return <>
  <div className="page-head"><div><Link className="back-link" to="/dashboard/support"><ArrowLeft size={16}/> Kembali</Link><h1 style={{display:'flex',gap:8,alignItems:'center'}}>{ticket.subject} <Badge tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Badge></h1><p style={{fontFamily:'monospace',fontSize:12}}>{ticket.id}{ticket.transactionId&&<> · Transaksi: {ticket.transactionId}</>}</p></div></div>
  <section className="card" style={{maxWidth:720}}>
   <div className="ticket-desc" style={{background:'var(--surface)',borderRadius:8,padding:'12px 16px',marginBottom:16}}><b>Deskripsi awal</b><p style={{marginTop:4,whiteSpace:'pre-wrap'}}>{ticket.description}</p></div>
   <div className="ticket-thread" style={{display:'flex',flexDirection:'column',gap:12,marginBottom:16}}>
    {ticket.messages.length===0&&<p className="muted" style={{textAlign:'center'}}>Belum ada balasan.</p>}
    {ticket.messages.map(m=><div key={m.id} className={'ticket-msg '+(m.role==='admin'?'admin':'merchant')} style={{alignSelf:m.role==='admin'?'flex-start':'flex-end',maxWidth:'80%',background:m.role==='admin'?'var(--surface)':'var(--accent-soft,#dbeafe)',borderRadius:12,padding:'10px 14px'}}>
     <small style={{fontWeight:600,color:'var(--text-muted)'}}>{m.role==='admin'?'Tim DitsGate':'Anda'} · {date(m.createdAt)}</small>
     <p style={{margin:'4px 0 0',whiteSpace:'pre-wrap'}}>{m.message}</p>
    </div>)}
    <div ref={bottomRef}/>
   </div>
   {!closed?<form onSubmit={send} style={{display:'flex',gap:8}}>
    <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={2} style={{flex:1,resize:'vertical'}} placeholder="Tulis balasan..." maxLength={5000}/>
    <button className="button primary" type="submit" disabled={sending||!message.trim()} style={{alignSelf:'flex-end'}}><Send size={16}/></button>
   </form>:<div className="info-line"><CheckCircle2 size={16}/> Tiket ini sudah {statusLabel(ticket.status).toLowerCase()}. Tidak dapat menambah pesan baru.</div>}
  </section>
 </>;
}

export default TicketList;
