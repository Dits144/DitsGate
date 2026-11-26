import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openDatabase, balanceOf, heldBalanceOf, settleTxInTx, expireOverdueInTx, expireOverdueTransactions, SIGNUP_BONUS, TX_FEE } from './db.mjs';
import { validateWebhookUrl, deliverWebhook } from './outbound-webhook.mjs';
import { shopeepayConfig } from './shopeepay.mjs';
import { parsePortalConfig, portalKey, encryptPortalToken, decryptPortalToken, probeShopeePortal, readShopeePortalFeed, PortalError } from './shopee-portal.mjs';
const keyShape=r=>({id:r.id,name:r.name,prefix:r.prefix,webhookUrl:r.webhook_url,qrisId:r.qris_id,createdAt:r.created_at,lastUsedAt:r.last_used_at,revokedAt:r.revoked_at,environment:'production',deliveryEnabled:true});
const webhookShape=r=>({url:r?.url??null,secretConfigured:!!r?.secret_hash,createdAt:r?.created_at??null,updatedAt:r?.updated_at??null,deliveryEnabled:true});
const validName=s=>typeof s==='string'&&s.trim().length>=1&&s.trim().length<=100;
const validAmount = v => Number.isSafeInteger(v) && v >= 1 && v <= 999_999_999;
const ledgerShape = r => ({id:r.id,amount:r.amount,kind:r.kind,sourceId:r.source_id,actorId:r.actor_id,note:r.note??null,createdAt:r.created_at});
const topupShape = r => ({id:r.id,merchantId:r.user_id,amount:r.amount,uniqueCode:r.unique_code??0,totalAmount:(r.total_amount&&r.total_amount>0)?r.total_amount:(r.amount+(r.unique_code??0)),expiresAt:r.expires_at??null,status:r.status,createdBy:r.created_by,createdAt:r.created_at,confirmedBy:r.confirmed_by,confirmedAt:r.confirmed_at,proofReference:r.proof_reference,note:r.note});
const ticketShape=r=>({id:r.id,userId:r.user_id,transactionId:r.transaction_id??null,subject:r.subject,description:r.description,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
const msgShape=r=>({id:r.id,ticketId:r.ticket_id,senderId:r.sender_id,role:r.role,message:r.message,createdAt:r.created_at});
const subOrderShape=r=>({id:r.id,userId:r.user_id,months:r.months,baseAmount:r.base_amount,uniqueCode:r.unique_code,totalAmount:r.total_amount,qrisPayload:r.qris_payload,status:r.status,createdAt:r.created_at,expiresAt:r.expires_at,paidAt:r.paid_at??null});
const SUB_PLANS=[{months:1,baseAmount:10000},{months:2,baseAmount:20000},{months:3,baseAmount:30000},{months:5,baseAmount:40000}];
const DEFAULT_ADMIN_WA='6282120196167';
const getPlatformQrisPayload=(db)=>{const row=db.prepare("SELECT value FROM platform_settings WHERE key='subscription_qris_payload'").get();return row?.value?.trim()||process.env.DITSGATE_ADMIN_TOPUP_QRIS||'';};
const getTopupMode=(db)=>{const row=db.prepare("SELECT value FROM platform_settings WHERE key='topup_mode'").get();return row?.value==='auto'?'auto':'manual';};
const getAdminWhatsapp=(db)=>{const row=db.prepare("SELECT value FROM platform_settings WHERE key='admin_whatsapp'").get();return row?.value?.trim()||DEFAULT_ADMIN_WA;};
const getAdminPortalConnection=(db)=>db.prepare("SELECT c.* FROM shopee_portal_connections c JOIN users u ON u.id=c.user_id WHERE u.role='admin' ORDER BY c.updated_at DESC LIMIT 1").get();

export async function syncAdminShopeeTopups(db,{shopeePortalFetch=globalThis.fetch,shopeePortalKey=process.env.DITSGATE_PORTAL_ENCRYPTION_KEY,force=false}={}){
 const mode=getTopupMode(db);
 if(!force&&mode!=='auto')return {skipped:true,reason:'manual_mode',matched:0,checked:0};
 const conn=getAdminPortalConnection(db);
 if(!conn)return {skipped:true,reason:'unconfigured',matched:0,checked:0};
 if(!force&&conn.status==='session_broken')return {skipped:true,reason:'session_broken',matched:0,checked:0};
 const pendingTopups=db.prepare("SELECT * FROM topup_intents WHERE status='pending' ORDER BY created_at ASC").all();
 const pendingSubs=db.prepare("SELECT * FROM subscription_orders WHERE status='pending' ORDER BY created_at ASC").all();
 if(!force&&pendingTopups.length===0&&pendingSubs.length===0)return {skipped:true,reason:'no_pending',matched:0,checked:0};
 const keyBuf=portalKey(shopeePortalKey);
 if(!keyBuf||keyBuf.length!==32)throw fail(503,'Kunci enkripsi token tidak tersedia.');
 let token;
 try{
  token=decryptPortalToken(keyBuf,conn.token_enc);
 }catch{
  db.prepare("UPDATE shopee_portal_connections SET status='session_broken',last_checked_at=?,last_error=? WHERE user_id=?").run(now(),'Kunci token portal tidak cocok atau data rusak.',conn.user_id);
  throw fail(500,'Token portal admin tidak dapat didekripsi.');
 }
 let rows;
 try{
  rows=await readShopeePortalFeed({fetchImpl:shopeePortalFetch,token,merchantId:conn.merchant_id,storeId:conn.store_id});
  db.prepare("UPDATE shopee_portal_connections SET status='connected',last_checked_at=?,last_error=NULL,transaction_count=? WHERE user_id=? AND token_enc=?").run(now(),rows.length,conn.user_id,conn.token_enc);
 }catch(e){
  if(e instanceof PortalError){
   db.prepare("UPDATE shopee_portal_connections SET status='session_broken',last_checked_at=?,last_error=? WHERE user_id=? AND token_enc=?").run(now(),e.message,conn.user_id,conn.token_enc);
   throw fail(e.status,e.message);
  }
  throw e;
 }
 let matched=0;
 db.transaction(()=>{
  const stamp=now();
  for(const intent of pendingTopups){
   const expectedAmount=(intent.total_amount&&intent.total_amount>0)?intent.total_amount:(intent.amount+(intent.unique_code??0));
   const minTimeMs=Date.parse(intent.created_at)-120_000;
   const maxTimeMs=intent.expires_at?Date.parse(intent.expires_at):(Date.parse(intent.created_at)+86_400_000);
   const match=rows.find(r=>{
    if(r.amountIdr!==expectedAmount)return false;
    if(r.createdAt){
     const txMs=Date.parse(r.createdAt);
     if(Number.isFinite(txMs)&&(txMs<minTimeMs||txMs>maxTimeMs))return false;
    }
    const ref='SHOPEE-'+r.id;
    return !db.prepare('SELECT 1 FROM topup_intents WHERE proof_reference=?').get(ref);
   });
   if(!match)continue;
   const ref='SHOPEE-'+match.id;
   const upd=db.prepare("UPDATE topup_intents SET status='admin_confirmed',confirmed_by=?,confirmed_at=?,proof_reference=?,note=? WHERE id=? AND status='pending'").run(conn.user_id,stamp,ref,`Otomatis via ShopeePay (${ref})`,intent.id);
   if(upd.changes){
    db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),intent.user_id,intent.amount,'admin_topup',intent.id,conn.user_id,`Topup otomatis ShopeePay (${ref})`,stamp);
    matched++;
   }
  }
  for(const ord of pendingSubs){
   const minTimeMs=Date.parse(ord.created_at)-120_000;
   const maxTimeMs=Date.parse(ord.expires_at);
   const match=rows.find(r=>{
    if(r.amountIdr!==ord.total_amount)return false;
    if(r.createdAt){
     const txMs=Date.parse(r.createdAt);
     if(Number.isFinite(txMs)&&(txMs<minTimeMs||txMs>maxTimeMs))return false;
    }
    const ref='SHOPEE-SUB-'+r.id;
    return !db.prepare("SELECT 1 FROM ledger_entries WHERE source_id=?").get(ref);
   });
   if(!match)continue;
   const u=db.prepare('SELECT subscription_expires_at FROM users WHERE id=?').get(ord.user_id);
   const baseMs=u?.subscription_expires_at&&Date.parse(u.subscription_expires_at)>Date.now()?Date.parse(u.subscription_expires_at):Date.now();
   const newExpires=new Date(baseMs+ord.months*30*86_400_000).toISOString();
   const upd=db.prepare("UPDATE subscription_orders SET status='paid',paid_at=?,confirmed_by=? WHERE id=? AND status='pending'").run(stamp,conn.user_id,ord.id);
   if(upd.changes){
    db.prepare('UPDATE users SET subscription_expires_at=? WHERE id=?').run(newExpires,ord.user_id);
    matched++;
   }
  }
 })();
 return {skipped:false,checked:rows.length,matched,transactions:rows};
}
const merchantShape = (db,r) => {
 const txStats = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) AS paid FROM transactions WHERE user_id=?").get(r.id);
 return {id:r.id,email:r.email,name:r.name,createdAt:r.created_at,isActive:r.is_active!==0,subscriptionExpiresAt:r.subscription_expires_at??null,balance:balanceOf(db,r.id),heldBalance:heldBalanceOf(db,r.id),transactionCount:txStats.total,paidCount:txStats.paid};
};
import { receiveQrisgateWebhook } from './webhook.mjs';
const scrypt = promisify(scryptCallback);
const MAX_BODY=32_768;
const now=()=>new Date().toISOString();
const hash=(s)=>createHash('sha256').update(s).digest('hex');
const send=(res,status,body,extra={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(body))};
const fail=(status,error)=>Object.assign(new Error(error),{status});
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw fail(413,'Payload terlalu besar.');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw fail(400,'JSON tidak valid.')}}
function bearer(req){
 const auth=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization||'')?.[1];
 if(auth)return auth;
 const cookie=String(req.headers.cookie||'');
 return /(?:^|;\s*)ditsgate_session=([A-Za-z0-9_-]{32,128})(?:;|$)/.exec(cookie)?.[1];
}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex')}
async function verifyPassword(password,stored){const [salt,hex]=stored.split(':');const expected=Buffer.from(hex,'hex');return expected.length===64&&timingSafeEqual(expected,await scrypt(password,salt,64))}
// Offline-only trusted operation: never exposed as an HTTP route and never elevates an existing account.
export async function bootstrapAdmin(db,{email=process.env.DITSGATE_ADMIN_EMAIL,password,name='Administrator'}={}){
 const configured=process.env.DITSGATE_ADMIN_EMAIL?.trim().toLowerCase();
 if(!configured||email?.trim().toLowerCase()!==configured||typeof password!=='string'||password.length<12||password.length>256||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configured))throw new Error('Admin bootstrap configuration invalid.');
 const id=randomUUID();
 db.prepare("INSERT INTO users (id,email,password_hash,name,created_at,role) VALUES (?,?,?,?,?,'admin')").run(id,configured,await passwordHash(password),name,now());
 return id;
}
const digits=(v)=>typeof v==='string'&&/^[0-9]{6,20}$/.test(v);
const bankShape=(r)=>({id:r.id,bank:r.bank,holder:r.holder,numberMasked:'\u2022\u2022\u2022\u2022 '+r.number.slice(-4),isDefault:!!r.is_default,status:'unverified',createdAt:r.created_at});
const assetShape=(r)=>({id:r.id,payload:r.payload,provider:r.provider,name:r.name,city:r.city,mode:r.mode,isDefault:!!r.is_default,createdAt:r.created_at});
const txShape=(r)=>({id:r.id,orderId:r.order_id,amount:r.amount,uniqueCode:r.unique_code,total:r.amount+r.unique_code,qrisId:r.qris_id,status:r.status,createdAt:r.created_at,expiresAt:r.expires_at});
function parseEmv(raw){if(typeof raw!=='string'||!raw.startsWith('000201')||raw.length>4096)throw fail(400,'String QRIS EMVCo tidak valid.');let offset=0,tags=[],seen=new Set;while(offset<raw.length){if(offset+4>raw.length)throw fail(400,'Tag QRIS terpotong.');const tag=raw.slice(offset,offset+2),len=Number(raw.slice(offset+2,offset+4));if(!/^\d\d$/.test(tag)||!/^\d\d$/.test(raw.slice(offset+2,offset+4))||seen.has(tag)||offset+4+len>raw.length)throw fail(400,'Tag QRIS tidak valid.');seen.add(tag);tags.push({tag,value:raw.slice(offset+4,offset+4+len)});offset+=4+len}if(tags.at(-1)?.tag!=='63'||tags.at(-1).value.length!==4)throw fail(400,'Checksum QRIS tidak ditemukan.');let crc=0xffff;for(const byte of Buffer.from(raw.slice(0,-4),'utf8')){crc^=byte<<8;for(let i=0;i<8;i++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff}if(crc.toString(16).toUpperCase().padStart(4,'0')!==tags.at(-1).value.toUpperCase())throw fail(400,'Checksum QRIS salah.');return tags}
 export function createApp({db=openDatabase(process.env.DITSGATE_DB||'data/ditsgate.sqlite'),allowOrigin='http://127.0.0.1:5179',webhookSecret=process.env.QRISGATE_WEBHOOK_SECRET,shopeePortalFetch=globalThis.fetch,shopeePortalKey=process.env.DITSGATE_PORTAL_ENCRYPTION_KEY}={}){
 const allowedOrigins=new Set(String(allowOrigin||'').split(',').map(s=>s.trim()).filter(Boolean));
 const rateLimiter=new Map();function checkRate(key,maxReq,windowMs){const ts=Date.now();let arr=rateLimiter.get(key)??[];arr=arr.filter(t=>ts-t<windowMs);if(arr.length>=maxReq)throw fail(429,'Terlalu banyak percobaan. Coba lagi nanti.');arr.push(ts);rateLimiter.set(key,arr)}
 const handler=async(req,res)=>{const origin=req.headers.origin;const originAllowed=Boolean(origin&&allowedOrigins.has(origin));if(origin&&!originAllowed){return send(res,403,{error:'Origin tidak diizinkan.'})}const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const path=url.pathname;const method=req.method||'GET';if(originAllowed){res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-allow-credentials','true');res.setHeader('vary','Origin')}
 if(method==='OPTIONS'){if(!originAllowed)return send(res,403,{error:'Origin tidak diizinkan.'});res.writeHead(204,{'access-control-allow-methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-credentials':'true'});return res.end()}
 try{
 if(path==='/api/health'&&method==='GET')return send(res,200,{ok:true,mode:'production'});
 if(path==='/api/webhooks/qrisgate'&&method==='POST')return send(res,200,await receiveQrisgateWebhook(req,db,webhookSecret));
 // QRISGate's public Android ingestion shape. Never settle an order from a notification.
 if(path==='/api/v1/mutations/ingest'&&method==='POST'){
  const credential=req.headers['x-device-token'];
  const device=typeof credential==='string'&&/^dt_[A-Za-z0-9_-]{32,128}$/.test(credential)&&db.prepare('SELECT user_id FROM shopee_listener_devices WHERE token_hash=?').get(hash(credential));
  if(!device)throw fail(401,'Token perangkat tidak valid.');
  const notification=await body(req);
  if(!notification||typeof notification!=='object'||Array.isArray(notification)||Object.keys(notification).some(key=>!['source_app','title','text'].includes(key))||typeof notification.source_app!=='string'||!/^([a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/.test(notification.source_app)||notification.source_app.length>160||typeof notification.title!=='string'||!notification.title.trim()||notification.title.length>200||typeof notification.text!=='string'||!notification.text.trim()||notification.text.length>4096)throw fail(400,'Notifikasi tidak valid.');
  const eventId=req.headers['x-event-id']??null;
  if(eventId!==null&&(typeof eventId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)))throw fail(400,'Event ID tidak valid.');
  const contentHash=hash(JSON.stringify([notification.source_app,notification.title,notification.text]));
  // Parse for display only. Notification contents and displayed amount are untrusted.
  const match=/\bRp\s*([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+)\b/i.exec(notification.text);
  const amount=match?Number(match[1].replaceAll('.','')):null;
  const result=db.transaction(()=>{
   const previous=eventId&&db.prepare('SELECT * FROM android_mutation_signals WHERE user_id=? AND event_id=?').get(device.user_id,eventId);
   if(previous){if(previous.text_hash!==contentHash||previous.source_app!==notification.source_app||previous.title!==notification.title)throw fail(409,'Event ID memiliki isi berbeda.');return {row:previous,duplicate:true}}
   const id=randomUUID(),stamp=now();
   db.prepare('INSERT INTO android_mutation_signals (id,user_id,event_id,source_app,title,text_hash,amount,received_at) VALUES (?,?,?,?,?,?,?,?)').run(id,device.user_id,eventId,notification.source_app,notification.title,contentHash,Number.isSafeInteger(amount)&&amount>0?amount:null,stamp);
   db.prepare('UPDATE shopee_listener_devices SET last_seen_at=? WHERE user_id=?').run(stamp,device.user_id);
   return {row:db.prepare('SELECT * FROM android_mutation_signals WHERE id=?').get(id),duplicate:false};
  })();
  return send(res,result.duplicate?200:202,{data:{id:result.row.id,eventId:result.row.event_id,sourceApp:result.row.source_app,title:result.row.title,amount:result.row.amount,receivedAt:result.row.received_at,verification:'unverified_listener_signal',providerConnected:false},duplicate:result.duplicate});
 }
 // Listener tokens are device credentials, not merchant sessions or Shopee portal credentials.
 if(path==='/api/v1/shopee-listener/ingest'&&method==='POST'){
  const deviceToken=bearer(req);
  const device=deviceToken?.startsWith('dt_')&&db.prepare('SELECT user_id FROM shopee_listener_devices WHERE token_hash=?').get(hash(deviceToken));
  if(!device)throw fail(401,'Token listener tidak valid.');
  const event=await body(req);
  if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.eventId!=='string'||!event.eventId.match(/^[A-Za-z0-9_-]{1,100}$/)||!validAmount(event.amount)||event.issuer!=='ShopeePay'||typeof event.occurredAt!=='string'||!Number.isFinite(Date.parse(event.occurredAt))||Math.abs(Date.now()-Date.parse(event.occurredAt))>86_400_000)throw fail(400,'Notifikasi listener tidak valid.');
  const result=db.transaction(()=>{
   const prior=db.prepare('SELECT * FROM shopee_listener_events WHERE user_id=? AND event_id=?').get(device.user_id,event.eventId);
   if(prior){if(prior.amount!==event.amount||prior.occurred_at!==event.occurredAt||prior.issuer!==event.issuer)throw fail(409,'Event ID memiliki isi berbeda.');return {duplicate:true,row:prior}}
   const id=randomUUID(),stamp=now();
   db.prepare('INSERT INTO shopee_listener_events (id,user_id,event_id,amount,occurred_at,issuer,received_at) VALUES (?,?,?,?,?,?,?)').run(id,device.user_id,event.eventId,event.amount,event.occurredAt,event.issuer,stamp);
   db.prepare('UPDATE shopee_listener_devices SET last_seen_at=? WHERE user_id=?').run(stamp,device.user_id);
   return {duplicate:false,row:db.prepare('SELECT * FROM shopee_listener_events WHERE id=?').get(id)};
  })();
  return send(res,result.duplicate?200:202,{data:{id:result.row.id,eventId:result.row.event_id,amount:result.row.amount,occurredAt:result.row.occurred_at,issuer:result.row.issuer,receivedAt:result.row.received_at,verification:'unverified_listener_signal'},duplicate:result.duplicate,notice:'Sinyal belum memverifikasi settlement dan tidak mengubah status transaksi.'});
 }
 if(path==='/api/auth/register'&&method==='POST'){checkRate('reg:'+req.socket.remoteAddress,5,60_000);const input=await body(req);const email=String(input.email||'').trim().toLowerCase(),password=input.password,name=String(input.name||'').trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||typeof password!=='string'||password.length<12||password.length>256||name.length<2||name.length>100)throw fail(400,'Nama, email, atau password (minimal 12 karakter) tidak valid.');if(process.env.DITSGATE_ADMIN_EMAIL?.trim().toLowerCase()===email)throw fail(403,'Email ini dicadangkan untuk bootstrap administratif.');const id=randomUUID(),pwHash=await passwordHash(password),stamp=now();try{db.transaction(()=>{db.prepare("INSERT INTO users (id,email,password_hash,name,created_at,role) VALUES (?,?,?,?,?,'merchant')").run(id,email,pwHash,name,stamp);db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,SIGNUP_BONUS,'signup_bonus',id,null,'Bonus saldo awal pendaftaran',stamp)})()}catch(e){if(e.code==='ERR_SQLITE_ERROR')throw fail(409,'Email sudah terdaftar.');throw e}return send(res,201,{id,email,name,balance:SIGNUP_BONUS})}
 if(path==='/api/auth/login'&&method==='POST'){checkRate('login:'+req.socket.remoteAddress,10,60_000);const input=await body(req),email=String(input.email||'').trim().toLowerCase();const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user||typeof input.password!=='string'||!(await verifyPassword(input.password,user.password_hash)))throw fail(401,'Email atau password salah.');if(user.is_active===0)throw fail(403,'Akun Anda sedang dinonaktifkan oleh admin.');const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user.id,Date.now()+86_400_000);const isHttps=req.headers['x-forwarded-proto']==='https'||req.socket.encrypted;return send(res,200,{token,expiresIn:86400,user:{id:user.id,email:user.email,name:user.name,role:user.role}},{'set-cookie':`ditsgate_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${isHttps?'; Secure':''}`})}
 const token=bearer(req),session=token&&db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
 const keyAccess=!session&&token?.startsWith('dg_test_')&&/^\/api\/v1\/transactions$/.test(path)&&['GET','POST'].includes(method);
 const apiKey=keyAccess&&db.prepare('SELECT * FROM merchant_api_keys WHERE key_hash=? AND revoked_at IS NULL').get(hash(token));
 if(!session&&!apiKey)throw fail(401,'Autentikasi diperlukan.');
 const owner=session?.user_id??apiKey.user_id;
 const ownerState=db.prepare('SELECT is_active FROM users WHERE id=?').get(owner);
 if(!ownerState||ownerState.is_active===0)throw fail(403,'Akun dinonaktifkan atau tidak ditemukan.');
 if(apiKey)db.prepare('UPDATE merchant_api_keys SET last_used_at=? WHERE id=? AND revoked_at IS NULL').run(now(),apiKey.id);
 if(path==='/api/auth/me'&&method==='GET'){
  if(!session)throw fail(401,'Autentikasi diperlukan.');
  const u=db.prepare('SELECT id,email,name,role,created_at FROM users WHERE id=?').get(owner);
  if(!u)throw fail(401,'Sesi tidak valid.');
  return send(res,200,{user:{id:u.id,email:u.email,name:u.name,role:u.role}});
 }
 if(path==='/api/v1/shopeepay/config'||path==='/api/v1/shopeepay/check'){
  if(!session)throw fail(401,'Sesi merchant diperlukan.');
  if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
  if(path==='/api/v1/shopeepay/config'&&method==='GET')return send(res,200,{data:shopeepayConfig(process.env)});
  if(path==='/api/v1/shopeepay/check'&&method==='POST'){
   const x=await body(req);
   if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.referenceId!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).test(x.referenceId)||!validAmount(x.amount)||!Number.isSafeInteger(x.amount*100))throw fail(400,'Referensi atau nominal tidak valid.');
   if(!shopeepayConfig(process.env).configured)throw fail(503,'ShopeePay belum dikonfigurasi.');
   // Demo QRIS transactions and QRISGate provider_orders are not ShopeePay-created orders.
   // No trusted persisted ShopeePay order exists, so never send a user-supplied reference upstream.
   throw fail(409,'Order ShopeePay terikat belum tersedia; pemeriksaan ditolak.');
  }
  throw fail(404,'Endpoint tidak ditemukan.');
 }
 if(path==='/api/v1/shopee-listener'||path==='/api/v1/shopee-listener/events'){
  if(!session)throw fail(401,'Sesi merchant diperlukan.');
  if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
  const device=db.prepare('SELECT * FROM shopee_listener_devices WHERE user_id=?').get(owner);
  const state=()=>({status:device?(device.last_seen_at?'receiving':'awaiting_event'):'unconfigured',providerConnected:false,source:'android_listener',lastSeenAt:device?.last_seen_at??null,createdAt:device?.created_at??null});
  if(path==='/api/v1/shopee-listener/events'&&method==='GET'){
   const legacy=db.prepare('SELECT * FROM shopee_listener_events WHERE user_id=? ORDER BY received_at DESC,id DESC LIMIT 100').all(owner).map(r=>({id:r.id,eventId:r.event_id,amount:r.amount,occurredAt:r.occurred_at,issuer:r.issuer,receivedAt:r.received_at,verification:'unverified_listener_signal'}));
   const android=db.prepare('SELECT * FROM android_mutation_signals WHERE user_id=? ORDER BY received_at DESC,id DESC LIMIT 100').all(owner).map(r=>({id:r.id,eventId:r.event_id,sourceApp:r.source_app,title:r.title,amount:r.amount,receivedAt:r.received_at,verification:'unverified_listener_signal'}));
   return send(res,200,{data:[...legacy,...android].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||b.id.localeCompare(a.id)).slice(0,100)});
  }
  if(path==='/api/v1/shopee-listener'&&method==='GET')return send(res,200,{data:state()});
  if(path==='/api/v1/shopee-listener'&&method==='POST'){
   await body(req);
   if(device)throw fail(409,'Listener sudah dipasangkan; cabut sebelum memasangkan ulang.');
   const raw='dt_'+randomBytes(32).toString('base64url');
   db.prepare('INSERT INTO shopee_listener_devices (user_id,token_hash,created_at) VALUES (?,?,?)').run(owner,hash(raw),now());
   return send(res,201,{data:{status:'awaiting_event',providerConnected:false,source:'android_listener'},token:raw,notice:'Token perangkat hanya ditampilkan sekali. Bukan koneksi API Shopee Partner.'});
  }
  if(path==='/api/v1/shopee-listener'&&method==='DELETE'){
   if(!device)throw fail(404,'Listener tidak ditemukan.');
   db.prepare('DELETE FROM shopee_listener_devices WHERE user_id=?').run(owner);
   return send(res,200,{ok:true});
  }
  throw fail(404,'Endpoint tidak ditemukan.');
  }
  if(path==='/api/v1/shopee-portal' && method==='POST'){
    if(!session)throw fail(401,'Sesi merchant diperlukan.');
    if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
    const x=await body(req);
    const cfg=parsePortalConfig(x);
    // Reconnection replaces an expired token only after a successful fresh probe.
    const keyBuf=portalKey(shopeePortalKey);
    if(!keyBuf||keyBuf.length!==32)throw fail(503,'Kunci enkripsi token tidak tersedia.');
    let verified;
    try{
      verified=await probeShopeePortal({fetchImpl:shopeePortalFetch,token:cfg.token});
    }catch(e){
      if(e instanceof PortalError)throw fail(e.status,e.message);
      throw e;
    }
    const tokenEnc=encryptPortalToken(keyBuf,cfg.token);
    const now=new Date().toISOString();
    db.prepare("INSERT INTO shopee_portal_connections (user_id,store_id,merchant_id,token_enc,status,last_checked_at,last_error,transaction_count,created_at,updated_at) VALUES (?,?,?,?,'connected',?,NULL,0,?,?) ON CONFLICT(user_id) DO UPDATE SET store_id=excluded.store_id,merchant_id=excluded.merchant_id,token_enc=excluded.token_enc,status='connected',last_checked_at=excluded.last_checked_at,last_error=NULL,transaction_count=0,updated_at=excluded.updated_at").run(owner,verified.storeId,verified.merchantId,tokenEnc,now,now,now);
    return send(res,201,{data:{status:'connected',storeId:verified.storeId,merchantId:verified.merchantId,providerConnected:true,paymentVerified:false,transactions:verified.rows}});
  }
  if(path==='/api/v1/shopee-portal/transactions' && method==='GET'){
    if(!session)throw fail(401,'Sesi merchant diperlukan.');
    if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
    const connection=db.prepare('SELECT * FROM shopee_portal_connections WHERE user_id=?').get(owner);
    if(!connection)throw fail(404,'Belum terhubung ke Shopee.');
    const keyBuf=portalKey(shopeePortalKey);
    if(!keyBuf||keyBuf.length!==32)throw fail(503,'Kunci enkripsi token tidak tersedia.');
    let token;
    try{
      token=decryptPortalToken(keyBuf,connection.token_enc);
    }catch{
      db.prepare("UPDATE shopee_portal_connections SET status='session_broken',last_checked_at=?,last_error=? WHERE user_id=?").run(now(),'Kunci token portal tidak cocok atau data rusak.',owner);
      throw fail(500,'Token portal tidak dapat didekripsi. Hubungkan ulang dengan token baru.');
    }
    try{
      const rows=await readShopeePortalFeed({fetchImpl:shopeePortalFetch,token,merchantId:connection.merchant_id,storeId:connection.store_id});
      const changed=db.prepare("UPDATE shopee_portal_connections SET status='connected',last_checked_at=?,last_error=NULL,transaction_count=? WHERE user_id=? AND token_enc=?").run(now(),rows.length,owner,connection.token_enc);
      if(!changed.changes)throw fail(409,'Koneksi portal berubah selama pembacaan mutasi. Segarkan kembali.');
      return send(res,200,{data:rows});
    }catch(e){
      if(e instanceof PortalError){
        const changed=db.prepare("UPDATE shopee_portal_connections SET status='session_broken',last_checked_at=?,last_error=? WHERE user_id=? AND token_enc=?").run(now(),e.message,owner,connection.token_enc);
        if(!changed.changes)throw fail(409,'Koneksi portal berubah selama pembacaan mutasi. Segarkan kembali.');
        throw fail(e.status,e.message);
      }
      throw e;
    }
  }
  if(path==='/api/v1/shopee-portal' && method==='GET'){
    if(!session)throw fail(401,'Sesi merchant diperlukan.');
    if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
    const connection=db.prepare('SELECT * FROM shopee_portal_connections WHERE user_id=?').get(owner);
    return send(res,200,{data:{status:connection?.status??'unconfigured',storeId:connection?.store_id??null,merchantId:connection?.merchant_id??null,providerConnected:connection?.status==='connected',lastCheckedAt:connection?.last_checked_at??null,lastError:connection?.last_error??null,transactionCount:connection?.transaction_count??0}});
  }
  if(path==='/api/v1/shopee-portal' && method==='DELETE'){
    if(!session)throw fail(401,'Sesi merchant diperlukan.');
    if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
    const connection=db.prepare('SELECT * FROM shopee_portal_connections WHERE user_id=?').get(owner);
    if(!connection)throw fail(404,'Belum terhubung ke Shopee Portal.');
    db.prepare('DELETE FROM shopee_portal_connections WHERE user_id=?').run(owner);
    return send(res,200,{ok:true});
  }
  if(path==='/api/v1/api-keys' || path.startsWith('/api/v1/api-keys/') || path.startsWith('/api/v1/webhook-settings')){
  if(!session)throw fail(401,'Sesi akun diperlukan.');
  if(db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role!=='merchant')throw fail(403,'Akun merchant diperlukan.');
  if(path==='/api/v1/api-keys'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM merchant_api_keys WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(keyShape)});
  if(path==='/api/v1/api-keys'&&method==='POST'){
   const x=await body(req);
   if(!validName(x.name)||x.webhookUrl!==undefined&&x.webhookUrl!==null&&typeof x.webhookUrl!=='string')throw fail(400,'Nama atau URL webhook tidak valid.');
   const webhookUrl=x.webhookUrl==null?null:validateWebhookUrl(x.webhookUrl);
   if(x.qrisId!==undefined&&x.qrisId!==null&&(!db.prepare('SELECT 1 FROM qris_assets WHERE id=? AND user_id=?').get(x.qrisId,owner)))throw fail(400,'QRIS bukan milik merchant.');
   const raw='dg_test_'+randomBytes(32).toString('base64url'),id=randomUUID(),stamp=now();
   db.prepare('INSERT INTO merchant_api_keys (id,user_id,name,key_hash,prefix,webhook_url,qris_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,owner,x.name.trim(),hash(raw),raw.slice(0,16),webhookUrl,x.qrisId??null,stamp);
   return send(res,201,{data:keyShape(db.prepare('SELECT * FROM merchant_api_keys WHERE id=?').get(id)),key:raw,notice:'Kunci local test hanya ditampilkan sekali. Belum ada pengiriman webhook.'});
  }
  const keyId=/^\/api\/v1\/api-keys\/([a-f0-9-]{36})$/.exec(path)?.[1];
  if(keyId&&method==='PATCH'){
   const row=db.prepare('SELECT * FROM merchant_api_keys WHERE id=? AND user_id=?').get(keyId,owner);
   if(!row)throw fail(404,'Kunci tidak ditemukan.');
   if(row.revoked_at)throw fail(409,'Kunci sudah dicabut.');
   const x=await body(req);
   if(!x||typeof x!=='object'||Array.isArray(x)||!Object.keys(x).length||Object.keys(x).some(k=>!['name','webhookUrl','qrisId'].includes(k)))throw fail(400,'Pengaturan kunci tidak valid.');
   if(Object.hasOwn(x,'name')&&!validName(x.name))throw fail(400,'Nama kunci tidak valid.');
   if(Object.hasOwn(x,'webhookUrl')&&x.webhookUrl!==null&&typeof x.webhookUrl!=='string')throw fail(400,'URL webhook tidak valid.');
   if(Object.hasOwn(x,'qrisId')&&x.qrisId!==null&&(typeof x.qrisId!=='string'||!db.prepare('SELECT 1 FROM qris_assets WHERE id=? AND user_id=?').get(x.qrisId,owner)))throw fail(400,'QRIS bukan milik merchant.');
   const destination=Object.hasOwn(x,'webhookUrl')?(x.webhookUrl===null?null:validateWebhookUrl(x.webhookUrl)):row.webhook_url;
   db.prepare('UPDATE merchant_api_keys SET name=?,webhook_url=?,qris_id=? WHERE id=? AND user_id=? AND revoked_at IS NULL').run(Object.hasOwn(x,'name')?x.name.trim():row.name,destination,Object.hasOwn(x,'qrisId')?x.qrisId:row.qris_id,keyId,owner);
   return send(res,200,{data:keyShape(db.prepare('SELECT * FROM merchant_api_keys WHERE id=? AND user_id=?').get(keyId,owner))});
  }
  if(keyId&&method==='DELETE'){
   const row=db.prepare('SELECT 1 FROM merchant_api_keys WHERE id=? AND user_id=?').get(keyId,owner);
   if(!row)throw fail(404,'Kunci tidak ditemukan.');
   db.prepare('UPDATE merchant_api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?').run(now(),keyId,owner);
   return send(res,200,{ok:true});
  }
  if(path==='/api/v1/webhook-settings'&&method==='GET')return send(res,200,{data:webhookShape(db.prepare('SELECT * FROM merchant_webhook_settings WHERE user_id=?').get(owner))});
  if(path==='/api/v1/webhook-settings'&&method==='PATCH'){
   const x=await body(req);
   if(!Object.hasOwn(x,'url')||x.url!==null&&typeof x.url!=='string')throw fail(400,'URL webhook tidak valid.');
   const destination=x.url===null?null:validateWebhookUrl(x.url),stamp=now();
   db.prepare('INSERT INTO merchant_webhook_settings (user_id,url,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET url=excluded.url,updated_at=excluded.updated_at').run(owner,destination,stamp,stamp);
   return send(res,200,{data:webhookShape(db.prepare('SELECT * FROM merchant_webhook_settings WHERE user_id=?').get(owner))});
  }
  if(path==='/api/v1/webhook-settings/rotate-secret'&&method==='POST'){
   await body(req);
   const secret=randomBytes(32).toString('base64url'),stamp=now();
   db.prepare('INSERT INTO merchant_webhook_settings (user_id,secret_hash,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret_hash=excluded.secret_hash,updated_at=excluded.updated_at').run(owner,hash(secret),stamp,stamp);
   return send(res,200,{data:webhookShape(db.prepare('SELECT * FROM merchant_webhook_settings WHERE user_id=?').get(owner)),secret,notice:'Secret webhook hanya ditampilkan sekali. Simpan di environment server Anda.'});
  }
  if(path==='/api/v1/webhook-settings/test'&&method==='POST'){
   const settings=db.prepare('SELECT * FROM merchant_webhook_settings WHERE user_id=?').get(owner);
   if(!settings?.url)throw fail(400,'URL webhook belum dikonfigurasi.');
   const result=await deliverWebhook({url:settings.url,secret:null,payload:{event:'webhook.ping',timestamp:now(),merchant_id:owner},maxAttempts:1});
   return send(res,result.ok?200:502,{data:result});
  }
  throw fail(404,'Endpoint tidak ditemukan.');
 }
 if(path==='/api/auth/logout'&&method==='POST'){if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));return send(res,200,{ok:true},{'set-cookie':'ditsgate_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'})}
 if(path==='/api/v1/balance'&&method==='GET'){expireOverdueTransactions(db,owner);return send(res,200,{balance:balanceOf(db,owner),heldBalance:heldBalanceOf(db,owner),currency:'IDR'})}
 if(path==='/api/v1/ledger'&&method==='GET'){expireOverdueTransactions(db,owner);return send(res,200,{data:db.prepare('SELECT * FROM ledger_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(ledgerShape)})}
 if(path==='/api/v1/topups'&&method==='GET'){
  if(!session)throw fail(401,'Sesi akun diperlukan.');
  const rows=db.prepare('SELECT * FROM topup_intents WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(topupShape);
  const mode=getTopupMode(db),conn=getAdminPortalConnection(db);
  return send(res,200,{data:rows,qrisPayload:getPlatformQrisPayload(db),mode,listenerOnline:conn?.status==='connected',adminWhatsapp:getAdminWhatsapp(db)});
 }
 if(path==='/api/v1/topups'&&method==='POST'){
  if(!session)throw fail(401,'Sesi akun diperlukan.');
  const x=await body(req);
  const amount=Number(x.amount);
  if(!Number.isSafeInteger(amount)||amount<5000||amount>999_999_999)throw fail(400,'Minimal nominal top up adalah Rp 5.000.');
  const mode=getTopupMode(db),conn=getAdminPortalConnection(db);
  const useUnique=mode==='auto'&&conn?.status==='connected';
  const id=randomUUID(),stamp=now(),expiresAt=new Date(Date.now()+30*60_000).toISOString();
  let uniqueCode=0;
  if(useUnique){
   const used=new Set(db.prepare("SELECT total_amount FROM topup_intents WHERE status='pending' AND (expires_at IS NULL OR expires_at>?)").all(stamp).map(r=>r.total_amount));
   for(let c=1;c<=299;c++){if(!used.has(amount+c)){uniqueCode=c;break}}
   if(uniqueCode===0)uniqueCode=Math.floor(Math.random()*299)+1;
  }
  const totalAmount=amount+uniqueCode;
  db.prepare('INSERT INTO topup_intents (id,user_id,amount,unique_code,total_amount,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,owner,amount,uniqueCode,totalAmount,expiresAt,owner,stamp);
  return send(res,201,{data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(id)),qrisPayload:getPlatformQrisPayload(db),mode,listenerOnline:conn?.status==='connected',adminWhatsapp:getAdminWhatsapp(db),notice:useUnique?'Transfer sesuai total nominal (termasuk kode unik) agar terverifikasi otomatis.':'Permintaan top up dibuat. Lakukan transfer dan konfirmasi ke admin.'});
 }
 if(path==='/api/v1/topups/sync'&&method==='POST'){
  if(!session)throw fail(401,'Sesi akun diperlukan.');
  checkRate('topup-sync:'+owner,12,60_000);
  let syncResult={skipped:true,matched:0};
  try{syncResult=await syncAdminShopeeTopups(db,{shopeePortalFetch,shopeePortalKey,force:false});}catch(e){syncResult={skipped:false,matched:0,error:e.message};}
  const rows=db.prepare('SELECT * FROM topup_intents WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(topupShape);
  return send(res,200,{data:rows,balance:balanceOf(db,owner),sync:syncResult});
 }
 if(path==='/api/v1/subscription'&&method==='GET'){
  const u=db.prepare('SELECT subscription_expires_at FROM users WHERE id=?').get(owner);
  const expiresAt=u?.subscription_expires_at??null;
  const active=Boolean(expiresAt&&Date.parse(expiresAt)>Date.now());
  const qrisRow=db.prepare("SELECT value FROM platform_settings WHERE key='subscription_qris_payload'").get();
  const qrisConfigured=Boolean((qrisRow?.value&&qrisRow.value.trim())||process.env.DITSGATE_ADMIN_TOPUP_QRIS);
  const orders=db.prepare('SELECT * FROM subscription_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(owner).map(subOrderShape);
  return send(res,200,{data:{active,expiresAt,plans:SUB_PLANS,qrisConfigured,orders}});
 }
 if(path==='/api/v1/subscription/checkout'&&method==='POST'){
  const x=await body(req);
  const plan=SUB_PLANS.find(p=>p.months===Number(x.months));
  if(!plan)throw fail(400,'Paket langganan tidak valid.');
  const qrisRow=db.prepare("SELECT value FROM platform_settings WHERE key='subscription_qris_payload'").get();
  const qrisPayload=qrisRow?.value?.trim()||process.env.DITSGATE_ADMIN_TOPUP_QRIS||'';
  if(!qrisPayload)throw fail(503,'QRIS DitsGate belum dikonfigurasi oleh admin.');
  const usedCodes=new Set(db.prepare("SELECT unique_code FROM subscription_orders WHERE status='pending' AND expires_at>?").all(now()).map(r=>r.unique_code));
  let uniqueCode=1;
  for(let c=1;c<=20;c++){if(!usedCodes.has(c)){uniqueCode=c;break}}
  if(usedCodes.has(uniqueCode))uniqueCode=Math.floor(Math.random()*20)+1;
  const id=randomUUID(),stamp=now(),expiresAt=new Date(Date.now()+30*60_000).toISOString();
  db.prepare('INSERT INTO subscription_orders (id,user_id,months,base_amount,unique_code,total_amount,qris_payload,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,owner,plan.months,plan.baseAmount,uniqueCode,plan.baseAmount+uniqueCode,qrisPayload,'pending',stamp,expiresAt);
  return send(res,201,{data:subOrderShape(db.prepare('SELECT * FROM subscription_orders WHERE id=?').get(id))});
 }
 if(path.startsWith('/api/admin/')){
  const admin=db.prepare('SELECT role,email FROM users WHERE id=?').get(owner);
  if(admin?.role!=='admin'||!process.env.DITSGATE_ADMIN_EMAIL||admin.email!==process.env.DITSGATE_ADMIN_EMAIL.trim().toLowerCase())throw fail(403,'Akses admin diperlukan.');
  if(path==='/api/admin/overview'&&method==='GET'){
   expireOverdueTransactions(db);
   const userStats=db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END),0) AS active FROM users WHERE role='merchant'").get();
   const totalBalance=db.prepare("SELECT COALESCE(SUM(l.amount),0) AS s FROM ledger_entries l JOIN users u ON u.id=l.user_id WHERE u.role='merchant'").get().s;
   const heldBalance=db.prepare("SELECT COALESCE(COUNT(*),0) * ? AS held FROM transactions t WHERE t.status='pending' AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.kind='tx_hold' AND l.source_id=t.id)").get(TX_FEE).held;
   const txStats=db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending, COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) AS paid, COALESCE(SUM(CASE WHEN status IN ('failed','expired','cancelled') THEN 1 ELSE 0 END),0) AS failed, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS paidVolume FROM transactions").get();
   const feeCollected=db.prepare("SELECT COALESCE(-SUM(amount),0) AS fee FROM ledger_entries WHERE kind='paid_order_fee'").get().fee + (txStats.paid * TX_FEE);
   const openTickets=db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('open','in_progress')").get().n;
   const pendingSubs=db.prepare("SELECT COUNT(*) AS n FROM subscription_orders WHERE status='pending'").get().n;
   const pendingTopups=db.prepare("SELECT COUNT(*) AS n FROM topup_intents WHERE status='pending'").get().n;
   return send(res,200,{data:{totalUsers:userStats.total,activeUsers:userStats.active,totalBalance,heldBalance,totalTransactions:txStats.total,pendingTransactions:txStats.pending,paidTransactions:txStats.paid,failedTransactions:txStats.failed,paidVolume:txStats.paidVolume,totalFeeRevenue:feeCollected,openTickets,pendingSubscriptions:pendingSubs,pendingTopups}});
  }
  if(path==='/api/admin/merchants'&&method==='GET'){
   expireOverdueTransactions(db);
   const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
   const rows=db.prepare("SELECT id,email,name,created_at,is_active,subscription_expires_at FROM users WHERE role='merchant' ORDER BY created_at DESC,id DESC LIMIT 200").all();
   const filtered=q?rows.filter(r=>r.name.toLowerCase().includes(q)||r.email.toLowerCase().includes(q)):rows;
   return send(res,200,{data:filtered.map(r=>merchantShape(db,r))});
  }
  const merchantId=/^\/api\/admin\/merchants\/([a-f0-9-]{36})$/.exec(path)?.[1];
  if(merchantId&&method==='GET'){
   expireOverdueTransactions(db,merchantId);
   const merchant=db.prepare("SELECT id,email,name,created_at,is_active,subscription_expires_at FROM users WHERE id=? AND role='merchant'").get(merchantId);
   if(!merchant)throw fail(404,'Merchant tidak ditemukan.');
   return send(res,200,{data:{...merchantShape(db,merchant),ledger:db.prepare('SELECT * FROM ledger_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(merchantId).map(ledgerShape),topups:db.prepare('SELECT * FROM topup_intents WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(merchantId).map(topupShape),transactions:db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(merchantId).map(txShape)}});
  }
  if(merchantId&&method==='PATCH'){
   const x=await body(req);
   const merchant=db.prepare("SELECT * FROM users WHERE id=? AND role='merchant'").get(merchantId);
   if(!merchant)throw fail(404,'Merchant tidak ditemukan.');
   const result=db.transaction(()=>{
    if(typeof x.isActive==='boolean'){
     db.prepare('UPDATE users SET is_active=? WHERE id=?').run(x.isActive?1:0,merchantId);
     if(!x.isActive)db.prepare('DELETE FROM sessions WHERE user_id=?').run(merchantId);
    }
    if(x.addSubscriptionDays!==undefined){
     const days=Number(x.addSubscriptionDays);
     if(!Number.isSafeInteger(days)||days<1||days>3650)throw fail(400,'Jumlah hari langganan tidak valid (1-3650).');
     const baseMs=merchant.subscription_expires_at&&Date.parse(merchant.subscription_expires_at)>Date.now()?Date.parse(merchant.subscription_expires_at):Date.now();
     db.prepare('UPDATE users SET subscription_expires_at=? WHERE id=?').run(new Date(baseMs+days*86_400_000).toISOString(),merchantId);
    }
    return merchantShape(db,db.prepare("SELECT id,email,name,created_at,is_active,subscription_expires_at FROM users WHERE id=?").get(merchantId));
   })();
   return send(res,200,{data:result});
  }
  const balanceAdjustId=/^\/api\/admin\/merchants\/([a-f0-9-]{36})\/balance$/.exec(path)?.[1];
  if(balanceAdjustId&&method==='POST'){
   const x=await body(req);
   const amount=Number(x.amount);
   if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>999_999_999)throw fail(400,'Nominal saldo harus bilangan bulat selain 0.');
   const note=typeof x.note==='string'&&x.note.trim()?x.note.trim().slice(0,200):(amount>0?'Penambahan saldo oleh admin':'Penyesuaian saldo oleh admin');
   const result=db.transaction(()=>{
    const merchant=db.prepare("SELECT id FROM users WHERE id=? AND role='merchant'").get(balanceAdjustId);
    if(!merchant)throw fail(404,'Merchant tidak ditemukan.');
    const current=balanceOf(db,balanceAdjustId);
    if(current+amount<0)throw fail(409,'Saldo user tidak mencukupi untuk pengurangan ini.');
    const entryId=randomUUID(),sourceId=randomUUID(),kind=amount>0?'admin_topup':'admin_adjustment',stamp=now();
    db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(entryId,balanceAdjustId,amount,kind,sourceId,owner,note,stamp);
    return {balance:balanceOf(db,balanceAdjustId),entry:ledgerShape(db.prepare('SELECT * FROM ledger_entries WHERE id=?').get(entryId))};
   })();
   return send(res,200,result);
  }
  if(path==='/api/admin/transactions'&&method==='GET'){
   expireOverdueTransactions(db);
   const statusFilter=String(url.searchParams.get('status')||'').trim();
   const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
   const rows=db.prepare('SELECT t.*,u.name AS merchant_name,u.email AS merchant_email FROM transactions t JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC,t.id DESC LIMIT 150').all();
   const filtered=rows.filter(r=>(!statusFilter||statusFilter==='all'||r.status===statusFilter)&&(!q||r.order_id.toLowerCase().includes(q)||r.merchant_name.toLowerCase().includes(q)||r.merchant_email.toLowerCase().includes(q)));
   return send(res,200,{data:filtered.map(r=>({...txShape(r),userId:r.user_id,merchantName:r.merchant_name,merchantEmail:r.merchant_email}))});
  }
  const adminTxId=/^\/api\/admin\/transactions\/([a-f0-9-]{36})$/.exec(path)?.[1];
  if(adminTxId&&method==='PATCH'){
   const x=await body(req);
   if(!['paid','failed','expired','cancelled'].includes(x.status))throw fail(400,'Status transaksi tidak valid.');
   const result=db.transaction(()=>{
    const tx=db.prepare('SELECT * FROM transactions WHERE id=?').get(adminTxId);
    if(!tx)throw fail(404,'Transaksi tidak ditemukan.');
    if(tx.status!=='pending')throw fail(409,'Transaksi sudah berstatus final.');
    settleTxInTx(db,tx,x.status,owner,typeof x.note==='string'&&x.note.trim()?x.note.trim().slice(0,200):'');
    return {data:txShape(db.prepare('SELECT * FROM transactions WHERE id=?').get(adminTxId)),balance:balanceOf(db,tx.user_id),heldBalance:heldBalanceOf(db,tx.user_id)};
   })();
   return send(res,200,result);
  }
  if(path==='/api/admin/topups'&&method==='GET'){
   const statusFilter=String(url.searchParams.get('status')||'').trim();
   const rows=db.prepare("SELECT t.*,u.name AS merchant_name,u.email AS merchant_email FROM topup_intents t JOIN users u ON t.user_id=u.id ORDER BY CASE WHEN t.status='pending' THEN 0 ELSE 1 END, t.created_at DESC, t.id DESC LIMIT 200").all();
   const filtered=statusFilter&&statusFilter!=='all'?rows.filter(r=>r.status===statusFilter):rows;
   return send(res,200,{data:filtered.map(r=>({...topupShape(r),merchantName:r.merchant_name,merchantEmail:r.merchant_email}))});
  }
  if(path==='/api/admin/topups'&&method==='POST'){
   const x=await body(req);
   const qrisPayload=getPlatformQrisPayload(db);
   if(!qrisPayload)throw fail(503,'QRIS topup admin belum dikonfigurasi.');
   if(!validAmount(x.amount)||typeof x.merchantId!=='string'||!db.prepare("SELECT 1 FROM users WHERE id=? AND role='merchant'").get(x.merchantId))throw fail(400,'Merchant atau nominal tidak valid.');
   const id=randomUUID();db.prepare('INSERT INTO topup_intents (id,user_id,amount,created_by,created_at) VALUES (?,?,?,?,?)').run(id,x.merchantId,x.amount,owner,now());
   return send(res,201,{data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(id)),instructions:{qrisPayload,notice:'Pending; bayar ke QRIS admin yang dikonfigurasi. Kredit hanya setelah konfirmasi manual admin dengan bukti eksternal.'}})
  }
  const topupId=/^\/api\/admin\/topups\/([a-f0-9-]{36})\/confirm$/.exec(path)?.[1];
  if(topupId&&method==='POST'){
   const x=await body(req),reference=x.proofReference;
   if(typeof reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(reference)||typeof x.note!=='string'||x.note.trim().length<8||x.note.length>500)throw fail(400,'Referensi bukti eksternal dan catatan wajib diisi.');
   const result=db.transaction(()=>{
    const intent=db.prepare('SELECT * FROM topup_intents WHERE id=?').get(topupId);
    if(!intent)throw fail(404,'Topup tidak ditemukan.');
    if(intent.status!=='pending')throw fail(409,'Topup sudah diproses.');
    if(db.prepare('SELECT 1 FROM topup_intents WHERE proof_reference=?').get(reference))throw fail(409,'Referensi bukti sudah dipakai.');
    const stamp=now();
    db.prepare("UPDATE topup_intents SET status='admin_confirmed',confirmed_by=?,confirmed_at=?,proof_reference=?,note=? WHERE id=? AND status='pending'").run(owner,stamp,reference,x.note.trim(),topupId);
    db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),intent.user_id,intent.amount,'admin_topup',topupId,owner,`Topup disetujui (${reference})`,stamp);
    return {data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(topupId)),balance:balanceOf(db,intent.user_id),verification:'admin_confirmed_only'};
   })();return send(res,200,result)
  }
  const rejectTopupId=/^\/api\/admin\/topups\/([a-f0-9-]{36})\/reject$/.exec(path)?.[1];
  if(rejectTopupId&&method==='POST'){
   const x=await body(req);
   const reason=typeof x.note==='string'&&x.note.trim()?x.note.trim().slice(0,500):'Ditolak oleh admin';
   const result=db.transaction(()=>{
    const intent=db.prepare('SELECT * FROM topup_intents WHERE id=?').get(rejectTopupId);
    if(!intent)throw fail(404,'Topup tidak ditemukan.');
    if(intent.status!=='pending')throw fail(409,'Topup sudah diproses.');
    const stamp=now();
    db.prepare("UPDATE topup_intents SET status='rejected',confirmed_by=?,confirmed_at=?,note=? WHERE id=? AND status='pending'").run(owner,stamp,reason,rejectTopupId);
    return {data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(rejectTopupId))};
   })();
   return send(res,200,result);
  }
  if(path==='/api/admin/tickets'&&method==='GET')return send(res,200,{data:db.prepare('SELECT t.*,u.name as merchant_name,u.email as merchant_email FROM support_tickets t JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC LIMIT 200').all().map(r=>({...ticketShape(r),merchantName:r.merchant_name,merchantEmail:r.merchant_email}))});
  const adminTicketId=/^\/api\/admin\/tickets\/([a-f0-9-]{36})$/.exec(path)?.[1];
  if(adminTicketId&&method==='PATCH'){
   const x=await body(req);
   if(!['open','in_progress','resolved','closed'].includes(x.status))throw fail(400,'Status tidak valid.');
   const stamp=now();
   const changed=db.prepare('UPDATE support_tickets SET status=?,updated_at=? WHERE id=?').run(x.status,stamp,adminTicketId);
   if(!changed.changes)throw fail(404,'Tiket tidak ditemukan.');
   if(x.reply&&typeof x.reply==='string'&&x.reply.trim()){
    db.prepare('INSERT INTO ticket_messages (id,ticket_id,sender_id,role,message,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),adminTicketId,owner,'admin',x.reply.trim(),stamp);
   }
   return send(res,200,{data:ticketShape(db.prepare('SELECT * FROM support_tickets WHERE id=?').get(adminTicketId))});
  }
  if(path==='/api/admin/settings'&&method==='GET'){
   const qrisRow=db.prepare("SELECT value,updated_at FROM platform_settings WHERE key='subscription_qris_payload'").get();
   const conn=getAdminPortalConnection(db);
   return send(res,200,{data:{qrisPayload:qrisRow?.value??process.env.DITSGATE_ADMIN_TOPUP_QRIS??'',updatedAt:qrisRow?.updated_at??null,topupMode:getTopupMode(db),adminWhatsapp:getAdminWhatsapp(db),shopeePortal:{status:conn?.status??'unconfigured',storeId:conn?.store_id??null,merchantId:conn?.merchant_id??null,providerConnected:conn?.status==='connected',lastCheckedAt:conn?.last_checked_at??null,lastError:conn?.last_error??null,transactionCount:conn?.transaction_count??0}}});
  }
  if(path==='/api/admin/settings'&&method==='PUT'){
   const x=await body(req);
   const stamp=now();
   if(Object.hasOwn(x,'qrisPayload')){
    const payload=typeof x.qrisPayload==='string'?x.qrisPayload.trim():'';
    if(payload)parseEmv(payload);
    if(payload)db.prepare("INSERT INTO platform_settings (key,value,updated_at) VALUES ('subscription_qris_payload',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(payload,stamp);
    else db.prepare("DELETE FROM platform_settings WHERE key='subscription_qris_payload'").run();
   }
   if(Object.hasOwn(x,'topupMode')){
    if(!['auto','manual'].includes(x.topupMode))throw fail(400,'Mode pembayaran harus auto atau manual.');
    db.prepare("INSERT INTO platform_settings (key,value,updated_at) VALUES ('topup_mode',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(x.topupMode,stamp);
   }
   if(Object.hasOwn(x,'adminWhatsapp')){
    const wa=String(x.adminWhatsapp||'').replace(/\D/g,'');
    if(!/^62[0-9]{8,14}$/.test(wa))throw fail(400,'Nomor WhatsApp harus format 628xxx (10-16 digit).');
    db.prepare("INSERT INTO platform_settings (key,value,updated_at) VALUES ('admin_whatsapp',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(wa,stamp);
   }
   const qrisRow=db.prepare("SELECT value,updated_at FROM platform_settings WHERE key='subscription_qris_payload'").get();
   return send(res,200,{data:{qrisPayload:qrisRow?.value??'',updatedAt:qrisRow?.updated_at??stamp,topupMode:getTopupMode(db),adminWhatsapp:getAdminWhatsapp(db)}});
  }
  if(path==='/api/admin/shopee-portal'&&method==='POST'){
   const x=await body(req);
   const cfg=parsePortalConfig(x);
   const keyBuf=portalKey(shopeePortalKey);
   if(!keyBuf||keyBuf.length!==32)throw fail(503,'Kunci enkripsi token tidak tersedia.');
   let verified;
   try{verified=await probeShopeePortal({fetchImpl:shopeePortalFetch,token:cfg.token});}
   catch(e){if(e instanceof PortalError)throw fail(e.status,e.message);throw e;}
   const tokenEnc=encryptPortalToken(keyBuf,cfg.token);
   const stamp=now();
   db.prepare("INSERT INTO shopee_portal_connections (user_id,store_id,merchant_id,token_enc,status,last_checked_at,last_error,transaction_count,created_at,updated_at) VALUES (?,?,?,?,'connected',?,NULL,?,?,?) ON CONFLICT(user_id) DO UPDATE SET store_id=excluded.store_id,merchant_id=excluded.merchant_id,token_enc=excluded.token_enc,status='connected',last_checked_at=excluded.last_checked_at,last_error=NULL,transaction_count=excluded.transaction_count,updated_at=excluded.updated_at").run(owner,verified.storeId,verified.merchantId,tokenEnc,stamp,verified.rows.length,stamp,stamp);
   let matched=0;
   if(getTopupMode(db)==='auto'){
    try{const s=await syncAdminShopeeTopups(db,{shopeePortalFetch,shopeePortalKey,force:true});matched=s.matched||0;}catch{}
   }
   return send(res,201,{data:{status:'connected',storeId:verified.storeId,merchantId:verified.merchantId,providerConnected:true,transactionCount:verified.rows.length,transactions:verified.rows,matched}});
  }
  if(path==='/api/admin/shopee-portal'&&method==='DELETE'){
   db.prepare('DELETE FROM shopee_portal_connections WHERE user_id=?').run(owner);
   return send(res,200,{ok:true});
  }
  if(path==='/api/admin/shopee-portal/sync'&&method==='POST'){
   const result=await syncAdminShopeeTopups(db,{shopeePortalFetch,shopeePortalKey,force:true});
   return send(res,200,{data:result});
  }
  if(path==='/api/admin/subscriptions'&&method==='GET'){
   const rows=db.prepare('SELECT s.*,u.name as merchant_name,u.email as merchant_email FROM subscription_orders s JOIN users u ON s.user_id=u.id ORDER BY s.created_at DESC LIMIT 100').all();
   return send(res,200,{data:rows.map(r=>({...subOrderShape(r),merchantName:r.merchant_name,merchantEmail:r.merchant_email}))});
  }
  const subConfirmId=/^\/api\/admin\/subscriptions\/([a-f0-9-]{36})\/confirm$/.exec(path)?.[1];
  if(subConfirmId&&method==='POST'){
   const result=db.transaction(()=>{
    const ord=db.prepare('SELECT * FROM subscription_orders WHERE id=?').get(subConfirmId);
    if(!ord)throw fail(404,'Order langganan tidak ditemukan.');
    if(ord.status!=='pending')throw fail(409,'Order langganan sudah diproses.');
    const u=db.prepare('SELECT subscription_expires_at FROM users WHERE id=?').get(ord.user_id);
    const baseMs=u?.subscription_expires_at&&Date.parse(u.subscription_expires_at)>Date.now()?Date.parse(u.subscription_expires_at):Date.now();
    const newExpires=new Date(baseMs+ord.months*30*86_400_000).toISOString();
    const stamp=now();
    db.prepare("UPDATE subscription_orders SET status='paid',paid_at=?,confirmed_by=? WHERE id=?").run(stamp,owner,subConfirmId);
    db.prepare('UPDATE users SET subscription_expires_at=? WHERE id=?').run(newExpires,ord.user_id);
    return {data:subOrderShape(db.prepare('SELECT * FROM subscription_orders WHERE id=?').get(subConfirmId)),subscriptionExpiresAt:newExpires};
   })();
   return send(res,200,result);
  }
  throw fail(404,'Endpoint tidak ditemukan.');
 }
 // ── Support Tickets ──────────────────────────────────────────────────────────
 if(path==='/api/v1/tickets'&&method==='GET'){return send(res,200,{data:db.prepare('SELECT * FROM support_tickets WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(ticketShape)})}
 if(path==='/api/v1/tickets'&&method==='POST'){
  const x=await body(req);
  if(typeof x.subject!=='string'||!x.subject.trim()||x.subject.length>200)throw fail(400,'Subjek wajib diisi (maks 200 karakter).');
  if(typeof x.description!=='string'||!x.description.trim()||x.description.length>5000)throw fail(400,'Deskripsi wajib diisi (maks 5000 karakter).');
  if(x.transactionId!==undefined&&x.transactionId!==null&&typeof x.transactionId!=='string')throw fail(400,'ID transaksi tidak valid.');
  const id=randomUUID(),stamp=now();
  db.prepare('INSERT INTO support_tickets (id,user_id,transaction_id,subject,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,owner,x.transactionId??null,x.subject.trim(),x.description.trim(),'open',stamp,stamp);
  return send(res,201,{data:ticketShape(db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id))});
 }
 const ticketId=/^\/api\/v1\/tickets\/([a-f0-9-]{36})/.exec(path)?.[1];
 if(ticketId){
  const ticket=db.prepare('SELECT * FROM support_tickets WHERE id=? AND user_id=?').get(ticketId,owner);
  if(!ticket)throw fail(404,'Tiket tidak ditemukan.');
  if(path==='/api/v1/tickets/'+ticketId&&method==='GET'){
   const messages=db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at,id').all(ticketId).map(msgShape);
   return send(res,200,{data:{...ticketShape(ticket),messages}});
  }
  if(path==='/api/v1/tickets/'+ticketId+'/messages'&&method==='POST'){
   const x=await body(req);
   if(typeof x.message!=='string'||!x.message.trim()||x.message.length>5000)throw fail(400,'Pesan wajib diisi.');
   const msgId=randomUUID(),stamp=now();
   db.prepare('INSERT INTO ticket_messages (id,ticket_id,sender_id,role,message,created_at) VALUES (?,?,?,?,?,?)').run(msgId,ticketId,owner,'merchant',x.message.trim(),stamp);
   db.prepare('UPDATE support_tickets SET updated_at=? WHERE id=?').run(stamp,ticketId);
   return send(res,201,{data:msgShape(db.prepare('SELECT * FROM ticket_messages WHERE id=?').get(msgId))});
  }
 }
 if(path==='/api/v1/bank-accounts'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM banks WHERE user_id=? ORDER BY created_at,id').all(owner).map(bankShape)});
 if(path==='/api/v1/bank-accounts'&&method==='POST'){const x=await body(req);if(!['BCA','BRI','BNI','Mandiri','CIMB Niaga','Bank lainnya'].includes(x.bank)||typeof x.holder!=='string'||!x.holder.trim()||x.holder.trim().length>100||!digits(x.number))throw fail(400,'Data rekening tidak valid.');const id=randomUUID(),first=!db.prepare('SELECT 1 FROM banks WHERE user_id=?').get(owner),main=first||x.isDefault===true;const run=db.transaction(()=>{if(main)db.prepare('UPDATE banks SET is_default=0 WHERE user_id=?').run(owner);db.prepare('INSERT INTO banks VALUES (?,?,?,?,?,?,?)').run(id,owner,x.bank,x.holder.trim(),x.number,main?1:0,now())});run();return send(res,201,{data:bankShape(db.prepare('SELECT * FROM banks WHERE id=?').get(id))})}
 const bankId=/^\/api\/v1\/bank-accounts\/([a-f0-9-]{36})$/.exec(path)?.[1];if(bankId){const row=db.prepare('SELECT * FROM banks WHERE id=? AND user_id=?').get(bankId,owner);if(!row)throw fail(404,'Rekening tidak ditemukan.');if(method==='PATCH'){const x=await body(req),bank=x.bank??row.bank,holder=x.holder??row.holder,number=x.number??row.number,main=x.isDefault===true||row.is_default&&x.isDefault!==false;if(!['BCA','BRI','BNI','Mandiri','CIMB Niaga','Bank lainnya'].includes(bank)||typeof holder!=='string'||!holder.trim()||holder.trim().length>100||!digits(number))throw fail(400,'Data rekening tidak valid.');db.transaction(()=>{if(main)db.prepare('UPDATE banks SET is_default=0 WHERE user_id=?').run(owner);db.prepare('UPDATE banks SET bank=?,holder=?,number=?,is_default=? WHERE id=? AND user_id=?').run(bank,holder.trim(),number,main?1:0,bankId,owner)})();return send(res,200,{data:bankShape(db.prepare('SELECT * FROM banks WHERE id=?').get(bankId))})}if(method==='DELETE'){db.transaction(()=>{db.prepare('DELETE FROM banks WHERE id=? AND user_id=?').run(bankId,owner);if(row.is_default){const next=db.prepare('SELECT id FROM banks WHERE user_id=? ORDER BY created_at,id LIMIT 1').get(owner);if(next)db.prepare('UPDATE banks SET is_default=1 WHERE id=?').run(next.id)}})();return send(res,200,{ok:true})}}
 if(path==='/api/v1/qris'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM qris_assets WHERE user_id=? ORDER BY created_at,id').all(owner).map(assetShape)});
 if(path==='/api/v1/qris'&&method==='POST'){const x=await body(req),tags=parseEmv(x.payload);if(!['dynamic','compatible','static'].includes(x.mode)||typeof x.name!=='string'||!x.name.trim()||x.name.length>100||typeof x.city!=='string'||!x.city.trim()||x.city.length>100)throw fail(400,'Konfigurasi QRIS tidak valid.');const id=randomUUID(),first=!db.prepare('SELECT 1 FROM qris_assets WHERE user_id=?').get(owner),main=first||x.isDefault===true;db.transaction(()=>{if(main)db.prepare('UPDATE qris_assets SET is_default=0 WHERE user_id=?').run(owner);db.prepare('INSERT INTO qris_assets VALUES (?,?,?,?,?,?,?,?,?)').run(id,owner,x.payload,String(x.provider||'Penerbit belum dikenali').slice(0,100),x.name.trim(),x.city.trim(),x.mode,main?1:0,now())})();return send(res,201,{data:assetShape(db.prepare('SELECT * FROM qris_assets WHERE id=?').get(id)),tagCount:tags.length})}
 const qrisId=/^\/api\/v1\/qris\/([a-f0-9-]{36})$/.exec(path)?.[1];if(qrisId){const row=db.prepare('SELECT * FROM qris_assets WHERE id=? AND user_id=?').get(qrisId,owner);if(!row)throw fail(404,'QRIS tidak ditemukan.');if(method==='PATCH'){const x=await body(req),payload=x.payload??row.payload,mode=x.mode??row.mode,name=x.name??row.name,city=x.city??row.city,provider=x.provider??row.provider,main=x.isDefault===true||row.is_default&&x.isDefault!==false;parseEmv(payload);if(!['dynamic','compatible','static'].includes(mode)||typeof name!=='string'||!name.trim()||name.length>100||typeof city!=='string'||!city.trim()||city.length>100||typeof provider!=='string'||provider.length>100)throw fail(400,'Konfigurasi QRIS tidak valid.');db.transaction(()=>{if(main)db.prepare('UPDATE qris_assets SET is_default=0 WHERE user_id=?').run(owner);db.prepare('UPDATE qris_assets SET payload=?,provider=?,name=?,city=?,mode=?,is_default=? WHERE id=? AND user_id=?').run(payload,provider,name.trim(),city.trim(),mode,main?1:0,qrisId,owner)})();return send(res,200,{data:assetShape(db.prepare('SELECT * FROM qris_assets WHERE id=?').get(qrisId))})}if(method==='DELETE'){const linked=db.prepare('SELECT 1 FROM transactions WHERE qris_id=? LIMIT 1').get(qrisId);if(linked)throw fail(409,'QRIS memiliki transaksi; tidak dapat dihapus.');db.transaction(()=>{db.prepare('DELETE FROM qris_assets WHERE id=? AND user_id=?').run(qrisId,owner);if(row.is_default){const next=db.prepare('SELECT id FROM qris_assets WHERE user_id=? ORDER BY created_at,id LIMIT 1').get(owner);if(next)db.prepare('UPDATE qris_assets SET is_default=1 WHERE id=?').run(next.id)}})();return send(res,200,{ok:true})}}
 if(path==='/api/v1/transactions'&&method==='GET'){expireOverdueTransactions(db,owner);return send(res,200,{data:apiKey?.qris_id?db.prepare('SELECT * FROM transactions WHERE user_id=? AND qris_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner,apiKey.qris_id).map(txShape):db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(txShape)})}
 if(path==='/api/v1/transactions'&&method==='POST'){
  const x=await body(req);
  if(typeof x.order_id!=='string'||!x.order_id.trim()||x.order_id.length>100||!Number.isSafeInteger(x.amount)||x.amount<1||x.amount>999_999_999)throw fail(400,'Order ID atau nominal tidak valid.');
  const expMins=x.expirationMinutes===undefined?30:Number(x.expirationMinutes);
  if(!Number.isSafeInteger(expMins)||expMins<1||expMins>1440)throw fail(400,'Durasi kedaluwarsa tidak valid.');
  const selectedId=x.qris_id??apiKey?.qris_id;
  const asset=selectedId?db.prepare('SELECT * FROM qris_assets WHERE id=? AND user_id=?').get(selectedId,owner):db.prepare('SELECT * FROM qris_assets WHERE user_id=? AND is_default=1').get(owner);
  if(!asset)throw fail(400,'Kartu QRIS milik akun belum tersedia.');
  if(apiKey?.qris_id&&asset.id!==apiKey.qris_id)throw fail(403,'Kunci dibatasi ke QRIS terpilih.');
  const id=randomUUID(),unique=0,orderId=x.order_id.trim(),stamp=now(),expiresAt=new Date(Date.now()+expMins*60_000).toISOString();
  try{
   const result=db.transaction(()=>{
    expireOverdueInTx(db,owner);
    if(balanceOf(db,owner)<TX_FEE)throw fail(409,`Saldo biaya tidak mencukupi (minimal Rp ${TX_FEE} ditahan untuk membuat transaksi).`);
    db.prepare('INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?)').run(id,owner,orderId,x.amount,unique,asset.id,'pending',stamp,expiresAt);
    db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),owner,-TX_FEE,'tx_hold',id,owner,`Saldo ditahan untuk transaksi · ${orderId}`,stamp);
    return {data:txShape(db.prepare('SELECT * FROM transactions WHERE id=?').get(id)),balance:balanceOf(db,owner),heldBalance:heldBalanceOf(db,owner),feeHeld:TX_FEE};
   })();
   return send(res,201,result);
  }catch(e){if(e.code==='ERR_SQLITE_ERROR')throw fail(409,'Order ID sudah digunakan.');throw e}
 }
 const merchantTxId=/^\/api\/v1\/transactions\/([a-f0-9-]{36})$/.exec(path)?.[1];
 if(merchantTxId&&method==='PATCH'){
  if(!session)throw fail(401,'Sesi akun diperlukan.');
  const x=await body(req);
  if(!['cancelled','failed','expired'].includes(x.status))throw fail(400,'Status pembatalan tidak valid.');
  const result=db.transaction(()=>{
   const tx=db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(merchantTxId,owner);
   if(!tx)throw fail(404,'Transaksi tidak ditemukan.');
   if(tx.status!=='pending')throw fail(409,'Transaksi sudah berstatus final.');
   settleTxInTx(db,tx,x.status,owner);
   return {data:txShape(db.prepare('SELECT * FROM transactions WHERE id=?').get(merchantTxId)),balance:balanceOf(db,owner),heldBalance:heldBalanceOf(db,owner)};
  })();
  return send(res,200,result);
 }
 throw fail(404,'Endpoint tidak ditemukan.');
 }catch(e){return send(res,e.status||500,{error:e.status?e.message:'Kesalahan server.'})}
 };
 const server=createServer(handler);return {server,db};
}

