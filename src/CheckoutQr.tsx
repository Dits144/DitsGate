import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {Download,QrCode} from 'lucide-react';
import type {QrisAsset} from './store';
import {generateQris} from './qrisEmv';

type Props={qris:QrisAsset|null;total:number};

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
    .catch(()=>{if(active)setError('Gagal membuat gambar QRIS.')});
  }catch(e){setError(e instanceof Error?e.message:'Payload QRIS tidak valid.')}
  return()=>{active=false};
 },[qris?.payload,qris?.mode,total]);
 const image=qris?.payload?png:qris?.image||'';
 const label=qris?.payload?'Kode QRIS Pembayaran':'Gambar QRIS statis merchant';
 return <div className="qr-display">{image?<img src={image} alt={label}/>:<QrCode size={66} strokeWidth={1} className="muted"/>}
  <p>{error?`QRIS tidak tersedia: ${error}`:qris?.payload?png?(qris.mode==='static'?'Pindai QRIS dan masukkan nominal tepat sesuai total bayar.':'Pindai QRIS dengan aplikasi pembayaran Anda (nominal terisi otomatis).'):'Menyiapkan QRIS…':qris?.image?label:'QRIS merchant belum diunggah'}</p>
  {image&&<button className="button secondary" type="button" onClick={()=>{const a=document.createElement('a');a.href=image;a.download=qris?.payload?`qris-${total}.png`:qris?.fileName||'qris.png';a.click()}}><Download size={15}/> Unduh QRIS</button>}
 </div>;
}
