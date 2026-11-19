import {createHmac,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {balanceOf} from './db.mjs';


const error=(status,message)=>Object.assign(new Error(message),{status});
const MAX_BYTES=32_768;
const events=new Map([['payment.paid','paid'],['payment.expired','expired'],['payment.cancelled','cancelled']]);

async function rawBytes(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw error(413,'Payload terlalu besar.');chunks.push(chunk)}
 return Buffer.concat(chunks);
}

export async function receiveQrisgateWebhook(req,db,secret){
 if(!secret)throw error(503,'Webhook belum dikonfigurasi.');
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw error(415,'Content-Type harus application/json.');
 const timestamp=req.headers['x-qrisgate-timestamp'];
 if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)throw error(401,'Timestamp tidak valid atau kedaluwarsa.');
 const signature=req.headers['x-qrisgate-signature'];
 const hex=typeof signature==='string'?signature.replace(/^sha256=/,''):'';
 if(!/^[a-f0-9]{64}$/i.test(hex))throw error(401,'Signature tidak valid.');
 const bytes=await rawBytes(req);
 const expected=createHmac('sha256',secret).update(timestamp).update('.').update(bytes).digest();
 const actual=Buffer.from(hex,'hex');
 if(!timingSafeEqual(expected,actual))throw error(401,'Signature tidak valid.');
 let payload;try{payload=JSON.parse(bytes.toString('utf8'))}catch{throw error(400,'JSON tidak valid.')}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw error(400,'Payload tidak valid.');
 const event=req.headers['x-qrisgate-event'],deliveryId=req.headers['x-qrisgate-delivery-id'];
 if(typeof event!=='string'||!events.has(event)||event!==payload.event)throw error(400,'Event tidak valid.');
 if(typeof deliveryId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId))throw error(400,'Delivery ID tidak valid.');
 if(typeof payload.external_order_id!=='string'||typeof payload.transaction_id!=='string'||!Number.isSafeInteger(payload.base_amount)||!Number.isSafeInteger(payload.unique_code)||!Number.isSafeInteger(payload.total_amount)||payload.total_amount!==payload.base_amount+payload.unique_code)throw error(400,'Data order tidak valid.');
 return db.transaction(()=>{
  const bodyHash=createHash('sha256').update(bytes).digest('hex');
  const previous=db.prepare('SELECT body_hash FROM webhook_deliveries WHERE delivery_id=?').get(deliveryId);
  if(previous){if(previous.body_hash!==bodyHash)throw error(409,'Delivery ID dipakai untuk payload berbeda.');return {received:true,duplicate:true}};
  const order=db.prepare('SELECT * FROM provider_orders WHERE external_order_id=?').get(payload.external_order_id);
  if(!order)throw error(404,'Order tidak ditemukan.');
  if(order.provider_transaction_id!==payload.transaction_id||order.base_amount!==payload.base_amount||order.unique_code!==payload.unique_code||order.total_amount!==payload.total_amount)throw error(409,'Data pembayaran tidak cocok.');
  const next=events.get(event);
  if(order.status!=='pending')throw error(409,'Order sudah berstatus final.');
  if(next==='paid'){
   if(balanceOf(db,order.user_id)<100)throw error(409,'Saldo merchant tidak mencukupi untuk biaya Rp100.');
   db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),order.user_id,-100,'paid_order_fee',order.id,null,new Date().toISOString());
  }
  db.prepare('UPDATE provider_orders SET status=?,paid_at=? WHERE id=? AND status=?').run(next,next==='paid'?new Date().toISOString():null,order.id,'pending');
  db.prepare('INSERT INTO webhook_deliveries (delivery_id,order_id,event,body_hash,received_at) VALUES (?,?,?,?,?)').run(deliveryId,order.id,event,bodyHash,new Date().toISOString());
  return {received:true,duplicate:false};
 })();
}
