import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openDatabase, balanceOf } from './db.mjs';
import { validateWebhookUrl } from './outbound-webhook.mjs';
import { shopeepayConfig } from './shopeepay.mjs';
const keyShape=r=>({id:r.id,name:r.name,prefix:r.prefix,webhookUrl:r.webhook_url,qrisId:r.qris_id,createdAt:r.created_at,lastUsedAt:r.last_used_at,revokedAt:r.revoked_at,environment:'local-test',deliveryEnabled:false});
const webhookShape=r=>({url:r?.url??null,secretConfigured:!!r?.secret_hash,createdAt:r?.created_at??null,updatedAt:r?.updated_at??null,deliveryEnabled:false});
const validName=s=>typeof s==='string'&&s.trim().length>=1&&s.trim().length<=100;
const validAmount = v => Number.isSafeInteger(v) && v >= 1 && v <= 999_999_999;
const ledgerShape = r => ({id:r.id,amount:r.amount,kind:r.kind,sourceId:r.source_id,actorId:r.actor_id,createdAt:r.created_at});
const topupShape = r => ({id:r.id,merchantId:r.user_id,amount:r.amount,status:r.status,createdBy:r.created_by,createdAt:r.created_at,confirmedBy:r.confirmed_by,confirmedAt:r.confirmed_at,proofReference:r.proof_reference,note:r.note});
const merchantShape = (db,r) => ({id:r.id,email:r.email,name:r.name,createdAt:r.created_at,balance:balanceOf(db,r.id)});
import { receiveQrisgateWebhook } from './webhook.mjs';
const scrypt = promisify(scryptCallback);
const MAX_BODY=32_768;
const now=()=>new Date().toISOString();
const hash=(s)=>createHash('sha256').update(s).digest('hex');
const send=(res,status,body,extra={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(body))};
const fail=(status,error)=>Object.assign(new Error(error),{status});
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw fail(413,'Payload terlalu besar.');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw fail(400,'JSON tidak valid.')}}
function bearer(req){return /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization||'')?.[1]}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex')}
async function verifyPassword(password,stored){const [salt,hex]=stored.split(':');const expected=Buffer.from(hex,'hex');return expected.length===64&&timingSafeEqual(expected,await scrypt(password,salt,64))}
// Offline-only trusted operation: never exposed as an HTTP route and never elevates an existing account.
export async function bootstrapAdmin(db,{email=process.env.DITSGATE_ADMIN_EMAIL,password,name='Administrator'}={}){
 const configured=process.env.DITSGATE_ADMIN_EMAIL?.trim().toLowerCase();
 if(!configured||email?.trim().toLowerCase()!==configured||typeof password!=='string'||password.length<16||password.length>256||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configured))throw new Error('Admin bootstrap configuration invalid.');
 const id=randomUUID();
 db.prepare("INSERT INTO users (id,email,password_hash,name,created_at,role) VALUES (?,?,?,?,?,'admin')").run(id,configured,await passwordHash(password),name,now());
 return id;
}
const digits=(v)=>typeof v==='string'&&/^[0-9]{6,20}$/.test(v);
const bankShape=(r)=>({id:r.id,bank:r.bank,holder:r.holder,numberMasked:'•••• '+r.number.slice(-4),isDefault:!!r.is_default,status:'unverified',createdAt:r.created_at});
const assetShape=(r)=>({id:r.id,payload:r.payload,provider:r.provider,name:r.name,city:r.city,mode:r.mode,isDefault:!!r.is_default,createdAt:r.created_at});
const txShape=(r)=>({id:r.id,orderId:r.order_id,amount:r.amount,uniqueCode:r.unique_code,total:r.amount+r.unique_code,qrisId:r.qris_id,status:r.status,createdAt:r.created_at,expiresAt:r.expires_at});
function parseEmv(raw){if(typeof raw!=='string'||!raw.startsWith('000201')||raw.length>4096)throw fail(400,'String QRIS EMVCo tidak valid.');let offset=0,tags=[],seen=new Set;while(offset<raw.length){if(offset+4>raw.length)throw fail(400,'Tag QRIS terpotong.');const tag=raw.slice(offset,offset+2),len=Number(raw.slice(offset+2,offset+4));if(!/^\d\d$/.test(tag)||!/^\d\d$/.test(raw.slice(offset+2,offset+4))||seen.has(tag)||offset+4+len>raw.length)throw fail(400,'Tag QRIS tidak valid.');seen.add(tag);tags.push({tag,value:raw.slice(offset+4,offset+4+len)});offset+=4+len}if(tags.at(-1)?.tag!=='63'||tags.at(-1).value.length!==4)throw fail(400,'Checksum QRIS tidak ditemukan.');let crc=0xffff;for(const byte of Buffer.from(raw.slice(0,-4),'utf8')){crc^=byte<<8;for(let i=0;i<8;i++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff}if(crc.toString(16).toUpperCase().padStart(4,'0')!==tags.at(-1).value.toUpperCase())throw fail(400,'Checksum QRIS salah.');return tags}
export function createApp({db=openDatabase(process.env.DITSGATE_DB||'data/ditsgate.sqlite'),allowOrigin='http://127.0.0.1:5179',webhookSecret=process.env.QRISGATE_WEBHOOK_SECRET}={}){
 const handler=async(req,res)=>{const origin=req.headers.origin;if(origin&&origin!==allowOrigin){return send(res,403,{error:'Origin tidak diizinkan.'})}const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const path=url.pathname;const method=req.method||'GET';if(origin===allowOrigin){res.setHeader('access-control-allow-origin',allowOrigin);res.setHeader('vary','Origin')}
 if(method==='OPTIONS'){if(origin!==allowOrigin)return send(res,403,{error:'Origin tidak diizinkan.'});res.writeHead(204,{'access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS','access-control-allow-headers':'Authorization, Content-Type'});return res.end()}
 try{
 if(path==='/api/health'&&method==='GET')return send(res,200,{ok:true,mode:'local-sandbox'});
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
 if(path==='/api/auth/register'&&method==='POST'){const input=await body(req);const email=String(input.email||'').trim().toLowerCase(),password=input.password,name=String(input.name||'').trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||typeof password!=='string'||password.length<12||password.length>256||name.length<2||name.length>100)throw fail(400,'Nama, email, atau password (minimal 12 karakter) tidak valid.');if(process.env.DITSGATE_ADMIN_EMAIL?.trim().toLowerCase()===email)throw fail(403,'Email ini dicadangkan untuk bootstrap administratif.');const id=randomUUID();try{db.prepare("INSERT INTO users (id,email,password_hash,name,created_at,role) VALUES (?,?,?,?,?,'merchant')").run(id,email,await passwordHash(password),name,now())}catch(e){if(e.code==='ERR_SQLITE_ERROR')throw fail(409,'Email sudah terdaftar.');throw e}return send(res,201,{id,email,name})}
 if(path==='/api/auth/login'&&method==='POST'){const input=await body(req),email=String(input.email||'').trim().toLowerCase();const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user||typeof input.password!=='string'||!(await verifyPassword(input.password,user.password_hash)))throw fail(401,'Email atau password salah.');const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user.id,Date.now()+86_400_000);return send(res,200,{token,expiresIn:86400,user:{id:user.id,email:user.email,name:user.name}})}
 const token=bearer(req),session=token&&db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
 const keyAccess=!session&&token?.startsWith('dg_test_')&&/^\/api\/v1\/transactions$/.test(path)&&['GET','POST'].includes(method);
 const apiKey=keyAccess&&db.prepare('SELECT * FROM merchant_api_keys WHERE key_hash=? AND revoked_at IS NULL').get(hash(token));
 if(!session&&!apiKey)throw fail(401,'Autentikasi diperlukan.');
 if(apiKey)db.prepare('UPDATE merchant_api_keys SET last_used_at=? WHERE id=? AND revoked_at IS NULL').run(now(),apiKey.id);
 const owner=session?.user_id??apiKey.user_id;
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
   return send(res,200,{data:webhookShape(db.prepare('SELECT * FROM merchant_webhook_settings WHERE user_id=?').get(owner)),secret,notice:'Secret local test ditampilkan sekali. Belum digunakan untuk pengiriman webhook.'});
  }
  throw fail(404,'Endpoint tidak ditemukan.');
 }
 if(path==='/api/auth/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));return send(res,200,{ok:true})}
 if(path==='/api/v1/balance'&&method==='GET')return send(res,200,{balance:balanceOf(db,owner),currency:'IDR'});
 if(path==='/api/v1/ledger'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM ledger_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(ledgerShape)});
 if(path.startsWith('/api/admin/')){
  const admin=db.prepare('SELECT role,email FROM users WHERE id=?').get(owner);
  if(admin?.role!=='admin'||!process.env.DITSGATE_ADMIN_EMAIL||admin.email!==process.env.DITSGATE_ADMIN_EMAIL.trim().toLowerCase())throw fail(403,'Akses admin diperlukan.');
  if(path==='/api/admin/merchants'&&method==='GET')return send(res,200,{data:db.prepare("SELECT id,email,name,created_at FROM users WHERE role='merchant' ORDER BY created_at DESC,id DESC LIMIT 100").all().map(r=>merchantShape(db,r))});
  const merchantId=/^\/api\/admin\/merchants\/([a-f0-9-]{36})$/.exec(path)?.[1];
  if(merchantId&&method==='GET'){const merchant=db.prepare("SELECT id,email,name,created_at FROM users WHERE id=? AND role='merchant'").get(merchantId);if(!merchant)throw fail(404,'Merchant tidak ditemukan.');return send(res,200,{data:{...merchantShape(db,merchant),ledger:db.prepare('SELECT * FROM ledger_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(merchantId).map(ledgerShape),topups:db.prepare('SELECT * FROM topup_intents WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(merchantId).map(topupShape)}})}
  if(path==='/api/admin/topups'&&method==='POST'){
   const x=await body(req);
   if(!process.env.DITSGATE_ADMIN_TOPUP_QRIS)throw fail(503,'QRIS topup admin belum dikonfigurasi.');
   if(!validAmount(x.amount)||typeof x.merchantId!=='string'||!db.prepare("SELECT 1 FROM users WHERE id=? AND role='merchant'").get(x.merchantId))throw fail(400,'Merchant atau nominal tidak valid.');
   const id=randomUUID();db.prepare('INSERT INTO topup_intents (id,user_id,amount,created_by,created_at) VALUES (?,?,?,?,?)').run(id,x.merchantId,x.amount,owner,now());
   return send(res,201,{data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(id)),instructions:{qrisPayload:process.env.DITSGATE_ADMIN_TOPUP_QRIS,notice:'Pending; bayar ke QRIS admin yang dikonfigurasi. Kredit hanya setelah konfirmasi manual admin dengan bukti eksternal. Tidak ada verifikasi QRIS otomatis.'}})
  }
  const topupId=/^\/api\/admin\/topups\/([a-f0-9-]{36})\/confirm$/.exec(path)?.[1];
  if(topupId&&method==='POST'){
   const x=await body(req),reference=x.proofReference;
   if(typeof reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(reference)||typeof x.note!=='string'||x.note.trim().length<8||x.note.length>500)throw fail(400,'Referensi bukti eksternal dan catatan wajib diisi.');
   const result=db.transaction(()=>{
    const intent=db.prepare('SELECT * FROM topup_intents WHERE id=?').get(topupId);
    if(!intent)throw fail(404,'Topup tidak ditemukan.');
    if(intent.status!=='pending')throw fail(409,'Topup sudah dikonfirmasi.');
    if(db.prepare('SELECT 1 FROM topup_intents WHERE proof_reference=?').get(reference))throw fail(409,'Referensi bukti sudah dipakai.');
    const stamp=now();
    db.prepare("UPDATE topup_intents SET status='admin_confirmed',confirmed_by=?,confirmed_at=?,proof_reference=?,note=? WHERE id=? AND status='pending'").run(owner,stamp,reference,x.note.trim(),topupId);
    db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),intent.user_id,intent.amount,'admin_topup',topupId,owner,stamp);
    return {data:topupShape(db.prepare('SELECT * FROM topup_intents WHERE id=?').get(topupId)),balance:balanceOf(db,intent.user_id),verification:'admin_confirmed_only'};
   })();return send(res,200,result)
  }
  throw fail(404,'Endpoint tidak ditemukan.');
 }
 if(path==='/api/v1/bank-accounts'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM banks WHERE user_id=? ORDER BY created_at,id').all(owner).map(bankShape)});
 if(path==='/api/v1/bank-accounts'&&method==='POST'){const x=await body(req);if(!['BCA','BRI','BNI','Mandiri','CIMB Niaga','Bank lainnya'].includes(x.bank)||typeof x.holder!=='string'||!x.holder.trim()||x.holder.trim().length>100||!digits(x.number))throw fail(400,'Data rekening tidak valid.');const id=randomUUID(),first=!db.prepare('SELECT 1 FROM banks WHERE user_id=?').get(owner),main=first||x.isDefault===true;const run=db.transaction(()=>{if(main)db.prepare('UPDATE banks SET is_default=0 WHERE user_id=?').run(owner);db.prepare('INSERT INTO banks VALUES (?,?,?,?,?,?,?)').run(id,owner,x.bank,x.holder.trim(),x.number,main?1:0,now())});run();return send(res,201,{data:bankShape(db.prepare('SELECT * FROM banks WHERE id=?').get(id))})}
 const bankId=/^\/api\/v1\/bank-accounts\/([a-f0-9-]{36})$/.exec(path)?.[1];if(bankId){const row=db.prepare('SELECT * FROM banks WHERE id=? AND user_id=?').get(bankId,owner);if(!row)throw fail(404,'Rekening tidak ditemukan.');if(method==='PATCH'){const x=await body(req),bank=x.bank??row.bank,holder=x.holder??row.holder,number=x.number??row.number,main=x.isDefault===true||row.is_default&&x.isDefault!==false;if(!['BCA','BRI','BNI','Mandiri','CIMB Niaga','Bank lainnya'].includes(bank)||typeof holder!=='string'||!holder.trim()||holder.trim().length>100||!digits(number))throw fail(400,'Data rekening tidak valid.');db.transaction(()=>{if(main)db.prepare('UPDATE banks SET is_default=0 WHERE user_id=?').run(owner);db.prepare('UPDATE banks SET bank=?,holder=?,number=?,is_default=? WHERE id=? AND user_id=?').run(bank,holder.trim(),number,main?1:0,bankId,owner)})();return send(res,200,{data:bankShape(db.prepare('SELECT * FROM banks WHERE id=?').get(bankId))})}if(method==='DELETE'){db.transaction(()=>{db.prepare('DELETE FROM banks WHERE id=? AND user_id=?').run(bankId,owner);if(row.is_default){const next=db.prepare('SELECT id FROM banks WHERE user_id=? ORDER BY created_at,id LIMIT 1').get(owner);if(next)db.prepare('UPDATE banks SET is_default=1 WHERE id=?').run(next.id)}})();return send(res,200,{ok:true})}}
 if(path==='/api/v1/qris'&&method==='GET')return send(res,200,{data:db.prepare('SELECT * FROM qris_assets WHERE user_id=? ORDER BY created_at,id').all(owner).map(assetShape)});
 if(path==='/api/v1/qris'&&method==='POST'){const x=await body(req),tags=parseEmv(x.payload);if(!['dynamic','compatible','static'].includes(x.mode)||typeof x.name!=='string'||!x.name.trim()||x.name.length>100||typeof x.city!=='string'||!x.city.trim()||x.city.length>100)throw fail(400,'Konfigurasi QRIS tidak valid.');const id=randomUUID(),first=!db.prepare('SELECT 1 FROM qris_assets WHERE user_id=?').get(owner),main=first||x.isDefault===true;db.transaction(()=>{if(main)db.prepare('UPDATE qris_assets SET is_default=0 WHERE user_id=?').run(owner);db.prepare('INSERT INTO qris_assets VALUES (?,?,?,?,?,?,?,?,?)').run(id,owner,x.payload,String(x.provider||'Penerbit belum dikenali').slice(0,100),x.name.trim(),x.city.trim(),x.mode,main?1:0,now())})();return send(res,201,{data:assetShape(db.prepare('SELECT * FROM qris_assets WHERE id=?').get(id)),tagCount:tags.length})}
 const qrisId=/^\/api\/v1\/qris\/([a-f0-9-]{36})$/.exec(path)?.[1];if(qrisId){const row=db.prepare('SELECT * FROM qris_assets WHERE id=? AND user_id=?').get(qrisId,owner);if(!row)throw fail(404,'QRIS tidak ditemukan.');if(method==='PATCH'){const x=await body(req),payload=x.payload??row.payload,mode=x.mode??row.mode,name=x.name??row.name,city=x.city??row.city,provider=x.provider??row.provider,main=x.isDefault===true||row.is_default&&x.isDefault!==false;parseEmv(payload);if(!['dynamic','compatible','static'].includes(mode)||typeof name!=='string'||!name.trim()||name.length>100||typeof city!=='string'||!city.trim()||city.length>100||typeof provider!=='string'||provider.length>100)throw fail(400,'Konfigurasi QRIS tidak valid.');db.transaction(()=>{if(main)db.prepare('UPDATE qris_assets SET is_default=0 WHERE user_id=?').run(owner);db.prepare('UPDATE qris_assets SET payload=?,provider=?,name=?,city=?,mode=?,is_default=? WHERE id=? AND user_id=?').run(payload,provider,name.trim(),city.trim(),mode,main?1:0,qrisId,owner)})();return send(res,200,{data:assetShape(db.prepare('SELECT * FROM qris_assets WHERE id=?').get(qrisId))})}if(method==='DELETE'){const linked=db.prepare('SELECT 1 FROM transactions WHERE qris_id=? LIMIT 1').get(qrisId);if(linked)throw fail(409,'QRIS memiliki transaksi; tidak dapat dihapus.');db.transaction(()=>{db.prepare('DELETE FROM qris_assets WHERE id=? AND user_id=?').run(qrisId,owner);if(row.is_default){const next=db.prepare('SELECT id FROM qris_assets WHERE user_id=? ORDER BY created_at,id LIMIT 1').get(owner);if(next)db.prepare('UPDATE qris_assets SET is_default=1 WHERE id=?').run(next.id)}})();return send(res,200,{ok:true})}}
 if(path==='/api/v1/transactions'&&method==='GET')return send(res,200,{data:apiKey?.qris_id?db.prepare('SELECT * FROM transactions WHERE user_id=? AND qris_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner,apiKey.qris_id).map(txShape):db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(txShape)});
 if(path==='/api/v1/transactions'&&method==='POST'){const x=await body(req);if(typeof x.order_id!=='string'||!x.order_id.trim()||x.order_id.length>100||!Number.isSafeInteger(x.amount)||x.amount<1||x.amount>999_999_999)throw fail(400,'Order ID atau nominal tidak valid.');const selectedId=x.qris_id??apiKey?.qris_id;const asset=selectedId?db.prepare('SELECT * FROM qris_assets WHERE id=? AND user_id=?').get(selectedId,owner):db.prepare('SELECT * FROM qris_assets WHERE user_id=? AND is_default=1').get(owner);if(!asset)throw fail(400,'Kartu QRIS milik akun belum tersedia.');if(apiKey?.qris_id&&asset.id!==apiKey.qris_id)throw fail(403,'Kunci dibatasi ke QRIS terpilih.');const id=randomUUID(),unique=0;try{db.prepare('INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?)').run(id,owner,x.order_id.trim(),x.amount,unique,asset.id,'demo_only',now(),new Date(Date.now()+30*60_000).toISOString())}catch(e){if(e.code==='ERR_SQLITE_ERROR')throw fail(409,'Order ID sudah digunakan.');throw e}return send(res,201,{data:txShape(db.prepare('SELECT * FROM transactions WHERE id=?').get(id)),mode:'local-sandbox',notice:'Tidak membuat pembayaran atau mendeteksi mutasi bank.'})}
 throw fail(404,'Endpoint tidak ditemukan.');
 }catch(e){return send(res,e.status||500,{error:e.status?e.message:'Kesalahan server.'})}
 };
 const server=createServer(handler);return {server,db};
}
