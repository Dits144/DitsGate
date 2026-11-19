import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {Download,QrCode} from 'lucide-react';
import type {QrisAsset} from './store';
import {generateQris} from './qrisEmv';

type Props={qris:QrisAsset|null;total:number};

/** Checkout is a browser-only demonstration; generated QR is never a payment confirmation. */
export default function CheckoutQr({qris,total}:Props){
 const [png,setPng]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  setPng('');setError('');
  if(!qris?.payload)return()=>{active=false};
  try{
   const result=generateQris(qris.payload,total,qris.mode||'dynamic');
   QRCode.toDataURL(result.raw,{width:280,margin:2,errorCorrectionLevel:'M'})
    .then(url=>{if(active)setPng(url)})
    .catch(()=>{if(active)setError('Gagal membuat gambar QRIS simulasi.')});
  }catch(e){setError(e instanceof Error?e.message:'Payload QRIS tidak valid.')}
  return()=>{active=false};
 },[qris?.payload,qris?.mode,total]);
 const image=qris?.payload?png:qris?.image||'';
 const label=qris?.payload?'Simulasi QRIS berdasarkan payload merchant':'Gambar QRIS statis merchant (belum divalidasi)';
 return <div className="qr-display">{image?<img src={image} alt={label}/>:<QrCode size={66} strokeWidth={1} className="muted"/>}
  <p>{error?`QRIS tidak tersedia: ${error}`:qris?.payload?png?(qris.mode==='static'?'Simulasi QRIS statis asli — nominal harus diisi manual; jangan transfer uang untuk menguji aplikasi.':'Simulasi QRIS dengan nominal order — bukan pembayaran aktif.'):'Menyiapkan QRIS simulasi…':qris?.image?label:'QRIS merchant belum diunggah'}</p>
  {image&&<button className="button secondary" onClick={()=>{const a=document.createElement('a');a.href=image;a.download=qris?.payload?`qris-simulasi-${total}.png`:qris?.fileName||'qris-demo.png';a.click()}}><Download size={15}/> Unduh gambar</button>}
 </div>;
}
