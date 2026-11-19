import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight, BookOpen, Bot, Check, ChevronRight, Clipboard, Code2, ExternalLink, Laptop, Radio, RefreshCw, ShieldCheck, Store, Wallet} from 'lucide-react';
import './guide.css';

type GuideProps={notify:(message:string)=>void};
type Method={id:string;number:string;tag:string;title:string;description:string;icon:typeof Code2};
const methods:Method[]=[
  {id:'ai',number:'01',tag:'PALING CEPAT',title:'Pakai AI coding agent',description:'Siapkan instruksi implementasi untuk agen coding Anda.',icon:Bot},
  {id:'api',number:'02',tag:'WEBSITE & APLIKASI',title:'Integrasi REST API',description:'Buat transaksi di server, arahkan ke checkout, dan terima webhook.',icon:Code2},
  {id:'embed',number:'03',tag:'LANDING PAGE',title:'Tombol bayar HTML',description:'Tempel tautan checkout yang sudah dibuat server ke halaman Anda.',icon:Laptop},
  {id:'cloud',number:'04',tag:'OTOMATIS',title:'Cloud bank webhook',description:'Hubungkan notifikasi bank melalui provider yang didukung.',icon:Radio},
  {id:'pos',number:'05',tag:'TOKO FISIK',title:'Mode kasir',description:'Buat tautan bayar dan tampilkan checkout untuk pelanggan.',icon:Store},
  {id:'bot',number:'06',tag:'CHAT COMMERCE',title:'Bot WhatsApp / Telegram',description:'Kirim tautan checkout lewat chat dan cocokkan order dari webhook.',icon:Wallet},
];
const agents=['Cursor','Claude Code','Codex','GitHub Copilot','ChatGPT','Windsurf','Cline'];
const prompt=`Anda adalah senior engineer yang membantu mengintegrasikan gateway pembayaran DitsGate ke proyek ini. Sebelum mengubah kode, periksa dokumentasi resmi dan kontrak API yang benar-benar tersedia. Proyek contoh ini hanyalah DEMO browser; jangan menganggap endpoint di bawah sudah aktif.\n\n## Keamanan\n- Simpan DITSGATE_API_KEY dan DITSGATE_WEBHOOK_SECRET hanya di environment server. Jangan hardcode, kirim ke browser, chat, atau commit ke Git.\n- Hitung harga dari database server, bukan nominal yang dikirim browser. Semua nominal IDR berupa integer.\n- Jangan memproses pembayaran nyata atau mengubah status PAID tanpa bukti pembayaran terverifikasi.\n\n## Checkout server-side\n1. Buat order dengan external_order_id unik dan status PENDING di database.\n2. Dari server, panggil endpoint pembuatan transaksi sesuai dokumentasi resmi dengan Authorization: Bearer DITSGATE_API_KEY. Periksa struktur request/response serta kebijakan expiry dan biaya sebelum mengimplementasikan.\n3. Simpan ID transaksi, nominal dan checkout_url yang dikembalikan. Frontend hanya menerima checkout_url untuk navigasi; jangan membangun ulang QR sendiri.\n\n## Webhook\n1. Baca raw body persis seperti diterima sebelum parsing JSON.\n2. Verifikasi signature dan timestamp dengan algoritma dan urutan byte yang ditetapkan dokumentasi resmi. Jangan menebak formula HMAC; bandingkan digest secara timing-safe.\n3. Terapkan idempotensi event dan cocokkan external_order_id serta total_amount dengan order yang tersimpan.\n4. Bila event payment.paid tervalidasi, perbarui status dan jalankan fulfillment secara aman. Balas cepat; antrekan pekerjaan berat.\n\n## Status & fallback\nSediakan halaman atau perintah bot untuk melihat status order dari server. Bila polling digunakan sebagai fallback webhook, jalankan dari server dengan rate limit dan timeout yang sesuai kontrak resmi. Jangan pernah memanggil API ber-Authorization dari browser.\n\nJika proyek ini bot chat: kirim checkout_url ke chat, simpan relasi external_order_id ke chat pembeli di database, dan konfirmasi hanya setelah pembayaran terverifikasi.\n\nTambahkan pengujian untuk signature, replay, idempotensi, nominal tidak cocok, dan order duplikat. Setelah selesai, laporkan file yang berubah, cara uji end-to-end, dan asumsi yang belum diverifikasi.`;
const php=`<?php
// CONTOH STRUKTUR — sesuaikan URL dan kontrak dengan dokumentasi resmi.
// Jangan gunakan nilai dari browser sebagai harga dan jangan hardcode API key.
$amount = 50000; // Ambil dari harga di database server
$body = [
  'external_order_id' => 'INV-' . bin2hex(random_bytes(8)),
  'amount' => $amount,
  'customer_name' => 'Pelanggan',
  'return_url' => 'https://toko.example/order/status',
];
$ch = curl_init(getenv('DITSGATE_BASE_URL') . '/api/v1/transactions');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('DITSGATE_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode($body),
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($response === false || $status < 200 || $status >= 300) {
  throw new RuntimeException('Gagal membuat transaksi');
}
$data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
// Validasi checkout_url dan simpan transaksi sebelum redirect.
// Gunakan redirect hanya ke domain gateway yang resmi/diizinkan.
header('Location: ' . $data['data']['checkout_url'], true, 303);
exit;`;
const embed=`<!-- CONTOH: checkout_url dibuat di backend terlebih dahulu. -->
<a href="CHECKOUT_URL_DARI_SERVER" rel="noopener noreferrer">
  Bayar dengan DitsGate
</a>`;
const codeCopies:Record<string,string>={prompt,php,embed};

export default function GuidePage({notify}:GuideProps){
 const [agent,setAgent]=useState('Cursor');
 const [copied,setCopied]=useState('');
 const copy=async(key:string)=>{let success=false;try{await navigator.clipboard.writeText(codeCopies[key]);success=true}catch{const field=document.createElement('textarea');field.value=codeCopies[key];field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();success=document.execCommand('copy');field.remove()}if(success){setCopied(key);notify('Teks disalin ke clipboard');window.setTimeout(()=>setCopied(v=>v===key?'':v),2300)}else notify('Clipboard tidak tersedia. Pilih dan salin teks secara manual.')};
 const refresh=()=>{setAgent('Cursor');setCopied('');window.scrollTo({top:0,behavior:'smooth'});notify('Panduan demo ditampilkan ulang — tidak ada sinkronisasi server.')};
 return <div className="integration-guide" id="panduan">
  <div className="page-head"><div><h1>Panduan Integrasi</h1><p>Website, bot & toko</p></div><div className="head-actions"><button className="button secondary" onClick={refresh}><RefreshCw size={15}/> Segarkan</button></div></div>
  <div className="guide-disclaimer" role="note"><ShieldCheck size={19}/><span><strong>Referensi perencanaan · mode demo lokal.</strong> DitsGate di proyek ini belum menyediakan API, webhook, deteksi bank, atau checkout produksi. URL dan contoh kode di bawah adalah pola ilustratif; verifikasi kontrak resmi sebelum menggunakannya untuk uang sungguhan.</span></div>
  <header className="guide-hero"><div className="guide-eyebrow"><BookOpen size={15}/> PANDUAN INTEGRASI TOKO & WEBSITE</div><h2>Terima pembayaran dengan alur yang tepat untuk bisnis Anda.</h2><p>Pilih metode yang cocok: website/aplikasi, bot chat, atau toko fisik. Mulai dari prompt AI bila ingin dibantu implementasi, lalu validasi semuanya di backend Anda.</p><div className="guide-hero-actions"><a className="button primary" href="#metode"><span>Jelajahi metode</span><ArrowRight size={16}/></a><Link className="button secondary" to="/dashboard">Lihat langkah di Dashboard</Link></div></header>
  <nav className="guide-method-nav" id="metode" aria-label="Pilih metode integrasi">{methods.map(m=><a key={m.id} href={'#metode-'+m.id} className="guide-method-link"><span className="guide-method-icon"><m.icon size={19}/></span><span className="guide-method-copy"><small>METODE {m.number} · {m.tag}</small><b>{m.title}</b><span>{m.description}</span></span><ChevronRight size={17}/></a>)}</nav>
  <div className="guide-content">
   <section className="guide-panel guide-feature" id="metode-ai"><div className="guide-section-top"><span className="guide-num">01</span><span className="guide-label">PALING CEPAT · PAKAI AI AGENT</span></div><h2>Serahkan integrasi ke AI coding agent Anda</h2><p>Salin prompt di bawah dan tempel ke alat coding pilihan Anda. Instruksinya mengutamakan backend yang aman, validasi webhook, dan status pesanan—bukan kunci API yang ditempel ke chat.</p><div className="guide-agent-tabs" role="group" aria-label="Pilihan AI coding agent">{agents.map(a=><button key={a} type="button" className={agent===a?'active':''} aria-pressed={agent===a} onClick={()=>setAgent(a)}>{a}</button>)}</div><div className="guide-code-head"><div><b>Prompt lengkap</b><small>Untuk {agent} · salin semua, lalu sesuaikan dengan dokumentasi resmi.</small></div><button className="button secondary" onClick={()=>copy('prompt')}>{copied==='prompt'?<Check size={15}/>:<Clipboard size={15}/>} {copied==='prompt'?'Disalin':'Salin Prompt'}</button></div><pre className="guide-code"><code>{prompt}</code></pre><p className="guide-footnote">Jangan tempel API key asli ke AI publik. Prompt ini hanya memakai nama environment variable.</p></section>
   <section className="guide-panel" id="metode-api"><div className="guide-section-top"><span className="guide-num">02</span><span className="guide-label">WEBSITE / APLIKASI KUSTOM</span></div><h2>Integrasi REST API</h2><p>Alur referensi untuk PHP, Node.js, Python, Laravel, dan aplikasi server-side lain. <strong>Path endpoint dan bentuk respons harus dicocokkan dengan API resmi saat tersedia.</strong></p><div className="guide-flow">{[['1','Buat transaksi','Server menghitung harga database dan membuat pesanan dengan ID unik.'],['2','Arahkan ke checkout','Kirim checkout_url yang telah divalidasi ke frontend untuk dibuka pembeli.'],['3','Terima webhook','Verifikasi event di server, cocokkan order, lalu perbarui status secara idempoten.']].map(([n,t,d])=><div key={n}><span>{n}</span><b>{t}</b><p>{d}</p></div>)}</div><div className="guide-code-head"><div><b>Contoh struktur PHP</b><small>Ilustratif; bukan SDK atau endpoint yang telah diuji.</small></div><button className="button secondary" onClick={()=>copy('php')}>{copied==='php'?<Check size={15}/>:<Clipboard size={15}/>} {copied==='php'?'Disalin':'Salin Kode PHP'}</button></div><pre className="guide-code"><code>{php}</code></pre></section>
   <section className="guide-panel" id="metode-embed"><div className="guide-section-top"><span className="guide-num">03</span><span className="guide-label">LANDING PAGE / WORDPRESS / BLOG</span></div><h2>Tombol bayar HTML</h2><p>Tempel tautan checkout <em>yang sudah dibuat oleh server Anda</em> pada tombol halaman. HTML statis saja tidak dapat membuat transaksi aman: API key dan perhitungan harga wajib tetap di server.</p><div className="guide-code-head"><div><b>Contoh tombol HTML</b><small>Ganti placeholder dengan checkout_url dari backend.</small></div><button className="button secondary" onClick={()=>copy('embed')}>{copied==='embed'?<Check size={15}/>:<Clipboard size={15}/>} {copied==='embed'?'Disalin':'Salin HTML'}</button></div><pre className="guide-code"><code>{embed}</code></pre></section>
   <section className="guide-panel" id="metode-cloud"><div className="guide-section-top"><span className="guide-num">04</span><span className="guide-label">OTOMATIS · TANPA HP STANDBY</span></div><h2>Cloud bank webhook</h2><p>Jika provider seperti Moota atau Cekmutasi mendukung notifikasi mutasi, Anda dapat meneruskannya ke backend yang memverifikasi asal, token perangkat, nominal, dan ID pesanan. <strong>Integrasi provider belum aktif dalam demo ini.</strong></p><div className="guide-provider-grid"><div><Radio size={20}/><b>Moota</b><p>Periksa izin, format payload, dan header autentikasi di dokumentasi provider.</p></div><div><Radio size={20}/><b>Cekmutasi</b><p>Gunakan endpoint server resmi setelah diaktifkan; jangan mengirim token lewat query URL.</p></div></div><div className="guide-callout">Simpan device token hanya di server. Jangan pasang pada URL <code>?token=…</code> karena URL dapat tercatat di log.</div><Link className="guide-text-link" to="/dashboard/detectors">Lihat detektor pembayaran demo <ArrowRight size={15}/></Link></section>
   <section className="guide-panel" id="metode-pos"><div className="guide-section-top"><span className="guide-num">05</span><span className="guide-label">TOKO FISIK / KASIR</span></div><h2>Mode kasir tanpa website</h2><p>Di toko fisik, kasir dapat membuat permintaan pembayaran dan memperlihatkan checkout kepada pelanggan. Pada proyek ini alur tersebut <strong>hanya simulasi lokal</strong>: tidak mendeteksi uang masuk atau menerbitkan bukti pembayaran resmi.</p><ol className="guide-list"><li>Buka Dashboard di tablet atau ponsel kasir.</li><li>Buat sesi pembayaran demo dengan nominal pesanan.</li><li>Tunjukkan halaman checkout demo kepada pelanggan untuk meninjau alur.</li><li>Untuk operasional nyata, tunggu verifikasi bank dari backend sebelum menyatakan lunas.</li></ol><Link className="button secondary" to="/dashboard/transactions">Buka transaksi demo <ExternalLink size={15}/></Link></section>
   <section className="guide-panel" id="metode-bot"><div className="guide-section-top"><span className="guide-num">06</span><span className="guide-label">BOT WHATSAPP / TELEGRAM / DISCORD</span></div><h2>Terima pembayaran dari chat</h2><p>Server bot membuat transaksi, mengirim checkout_url ke pembeli, lalu menerima konfirmasi dari webhook terverifikasi. Bot tidak perlu membuat halaman QR sendiri.</p><div className="guide-flow">{[['1','Bot buat transaksi','Simpan external_order_id dan relasinya ke pesanan/chat.'],['2','Kirim tautan','Balas chat dengan checkout_url dari respons server.'],['3','Konfirmasi tervalidasi','Webhook yang terverifikasi memperbarui order dan mengirim konfirmasi.']].map(([n,t,d])=><div key={n}><span>{n}</span><b>{t}</b><p>{d}</p></div>)}</div><div className="guide-callout"><ShieldCheck size={19}/> API key hanya berada di server bot, bukan di kode klien atau pesan chat. Cocokkan pesanan melalui external_order_id, bukan nominal saja.</div><h3>Dua hal yang sering terlewat</h3><ol className="guide-list"><li>Webhook bisa terlambat atau gagal. Siapkan rekonsiliasi/polling dari server sesuai batas rate API resmi; jangan meletakkan Authorization di browser.</li><li>Idempotensi wajib: event yang sama tidak boleh mengaktifkan pesanan atau mengirim barang dua kali.</li></ol><Link className="guide-text-link" to="/dashboard/developers">Lihat halaman API & Webhook demo <ArrowRight size={15}/></Link></section>
   <section className="guide-next"><div><span className="guide-label">ALAT BANTU TAMBAHAN</span><h2>Mulai dari satu transaksi demo</h2><p>Coba alur checkout di browser tanpa koding. Ini bukan QRIS dinamis nyata dan tidak menerima dana.</p></div><Link className="button primary" to="/dashboard/transactions">Buka transaksi demo <ArrowRight size={16}/></Link></section>
  </div>
 </div>;
}
