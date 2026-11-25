import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PORTAL_ORIGIN = 'https://partner.shopee.co.id';
const PORTAL_BASE = 'https://shopeepay.shopee.co.id';
const PORTAL_PATHS = {
  stores: '/merchant/v1/partner-web/get-store-list',
  transactions: '/merchant/v1/partner-web/get-transaction-list',
};
const PORTAL_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0';
const TOKEN_WINDOW_SECONDS = 7 * 86_400;

export class PortalError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
  }
}

const invalidConfig = message => new PortalError(400, message);
const providerFailure = message => new PortalError(502, message);

function scopeText(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function scopeId(value, name) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  if (typeof text !== 'string' || !/^[0-9]{1,20}$/.test(text)) throw invalidConfig(`${name} harus berupa angka eksplisit.`);
  return text;
}

export function parsePortalConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidConfig('Konfigurasi portal tidak valid.');
  for (const key of Object.keys(input)) if (key !== 'token') throw invalidConfig('Field konfigurasi portal tidak dikenal.');
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length < 8 || token.length > 4096 || /[\r\n]/.test(token)) throw invalidConfig('Token portal tidak valid.');
  return { token };
}

export function portalKey(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) return null;
  try {
    const key = Buffer.from(raw, 'base64url');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptPortalToken(key, token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptPortalToken(key, blob) {
  const parts = typeof blob === 'string' ? blob.split('.') : [];
  if (parts.length !== 4 || parts[0] !== 'v1') throw new PortalError(500, 'Penyimpanan token portal rusak.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new PortalError(500, 'Token portal tidak dapat didekripsi.');
  }
}

async function portalRequest(fetchImpl, path, token, inner) {
  if (typeof fetchImpl !== 'function') throw new PortalError(503, 'Transport portal Shopee tidak tersedia.');
  const body = JSON.stringify({ data: { metadata: { token, language: 'id', timezone: 'Asia/Jakarta' }, ...inner } });
  let response;
  try {
    response = await fetchImpl(PORTAL_BASE + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: 'application/json',
        'accept-language': 'id,en-US;q=0.9,en;q=0.8',
        'content-type': 'application/json',
        origin: PORTAL_ORIGIN,
        referer: PORTAL_ORIGIN + '/',
        'user-agent': PORTAL_USER_AGENT,
        'x-timestamp-ms': String(Date.now()),
        'x-token': '',
      },
      body,
    });
  } catch {
    throw providerFailure('Portal Shopee tidak dapat dijangkau.');
  }
  if (!response || response.ok !== true || (response.url && response.url !== PORTAL_BASE + path) || response.redirected === true) throw providerFailure('Portal Shopee menolak permintaan.');
  let payload;
  try {
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('provider response too large');
    payload = JSON.parse(raw);
  } catch {
    throw providerFailure('Respons portal Shopee tidak valid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw providerFailure('Respons portal Shopee tidak valid.');
  if (String(payload.code ?? '') !== '0') throw providerFailure('Token portal Shopee tidak valid atau kedaluwarsa.');
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw providerFailure('Data portal Shopee tidak valid.');
  return payload.data;
}

function transactionWindow(nowMs = Date.now()) {
  const endTime = Math.floor(nowMs / 1000);
  return { startTime: endTime - TOKEN_WINDOW_SECONDS, endTime };
}

async function readStores(fetchImpl, token, storeId) {
  let lastStoreId = 0;
  const seen = new Set();
  const stores = [];
  for (let page = 0; page < 10; page++) {
    const data = await portalRequest(fetchImpl, PORTAL_PATHS.stores, token, { storeName: '', lastStoreId, pageSize: 30 });
    if (!Array.isArray(data.list)) throw providerFailure('Daftar toko portal Shopee tidak valid.');
    stores.push(...data.list);
    if (storeId) {
      const found = data.list.find(row => row && typeof row === 'object' && scopeText(row.storeId ?? row.store_id) === storeId);
      if (found) return [found];
    }
    if (data.list.length < 30 || (Number.isInteger(data.storeCount) && stores.length >= data.storeCount)) return stores;
    const next = scopeText(data.list.at(-1)?.storeId ?? data.list.at(-1)?.store_id);
    if (!/^[0-9]+$/.test(next) || seen.has(next)) throw providerFailure('Cursor toko portal Shopee tidak valid.');
    seen.add(next);
    lastStoreId = Number(next);
    if (!Number.isSafeInteger(lastStoreId)) throw providerFailure('Cursor toko portal Shopee tidak valid.');
  }
  throw providerFailure('Daftar toko portal Shopee melebihi batas halaman.');
}

async function readTransactions(fetchImpl, token) {
  let nextPosition = '';
  const seen = new Set();
  const rows = [];
  const window = transactionWindow();
  for (let page = 0; page < 20; page++) {
    const data = await portalRequest(fetchImpl, PORTAL_PATHS.transactions, token, {
      pageSize: 10,
      filter: { ...window, serviceList: [1, 3] },
      sorter: { field: 'createTime', order: 'descend' },
      next_position: nextPosition,
    });
    const hasSummaryShape = typeof data.total === 'number' || typeof data.totalCompletedCount === 'number' || Object.hasOwn(data, 'last_position');
    const list = (data.list === null || (data.list === undefined && hasSummaryShape))
      ? []
      : (data.list ?? data.transactionList ?? data.transaction_list);
    const rawCursor = data.next_position ?? data.nextPosition ?? data.last_position ?? data.lastPosition;
    const validCursor = rawCursor == null || typeof rawCursor === 'string' || (typeof rawCursor === 'number' && Number.isSafeInteger(rawCursor));
    if (!Array.isArray(list) || !validCursor) {
      const keys = Object.keys(data).join(', ') || 'none';
      throw providerFailure(`Daftar transaksi portal Shopee tidak valid (keys: ${keys}; list: ${list === null ? 'null' : typeof list}; cursor: ${typeof rawCursor}).`);
    }
    rows.push(...list);
    const cursor = rawCursor == null || rawCursor === 0 ? '' : String(rawCursor);
    if (!cursor || list.length === 0) return rows;
    if (cursor === nextPosition || seen.has(cursor)) throw providerFailure('Cursor transaksi portal Shopee tidak maju.');
    seen.add(cursor);
    nextPosition = cursor;
  }
  throw providerFailure('Feed portal Shopee melebihi batas halaman.');
}
 
function parsePortalAmount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[0-9]+$/.test(text) && !/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(text)) return null;
  const amount = Number(text.replaceAll('.', ''));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function portalTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) return new Date(Number(value.trim()) * 1000).toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

export function sanitizePortalTransactions(rows, merchantId, storeId) {
  if (!Array.isArray(rows)) throw providerFailure('Daftar transaksi portal Shopee tidak valid.');
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (scopeText(row.storeId ?? row.store_id) !== storeId) continue;
    if (merchantId && scopeText(row.merchantId ?? row.merchant_id) !== merchantId) continue;
    const id = scopeText(row.transactionId ?? row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const orderId = scopeText(row.externalTransactionId ?? row.displayTransactionId);
    out.push({
      id,
      orderId: orderId || null,
      amountIdr: parsePortalAmount(row.amount ?? row.amount_idr),
      status: Number.isInteger(row.status) ? row.status : null,
      createdAt: portalTimestamp(row.createTime ?? row.create_time),
      storeId,
      merchantId,
      paymentVerified: false,
    });
  }
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function probeShopeePortal({ fetchImpl, token, merchantId, storeId }) {
  const stores = await readStores(fetchImpl, token, storeId);
  const rows = await readTransactions(fetchImpl, token);
  // Without user-supplied IDs, require one unambiguous merchant/store pair in the
  // provider's transaction feed. Empty or mixed feeds cannot establish ownership.
  if (!storeId || !merchantId) {
    const pairs = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new PortalError(422, 'Cakupan transaksi portal tidak valid.');
      const s = scopeText(row.storeId ?? row.store_id);
      const m = scopeText(row.merchantId ?? row.merchant_id);
      if (!/^[0-9]{1,20}$/.test(s) || !/^[0-9]{1,20}$/.test(m)) throw new PortalError(422, 'Identitas toko dan merchant tidak tersedia pada transaksi portal.');
      pairs.add(`${s}:${m}`);
    }
    if (pairs.size !== 1) throw new PortalError(422, 'Daftar transaksi kosong atau memuat beberapa cakupan toko/merchant. Koneksi belum dapat diverifikasi.');
    [storeId, merchantId] = [...pairs][0].split(':');
  }
  const scopedStore = stores.find(row => row && typeof row === 'object' && scopeText(row.storeId ?? row.store_id) === storeId);
  if (!scopedStore) throw new PortalError(422, 'Toko tidak ditemukan dalam cakupan merchant portal.');
  const onStore = scopeText(scopedStore.merchantId ?? scopedStore.merchant_id);
  if (onStore && onStore !== merchantId) throw new PortalError(422, 'Identitas merchant transaksi tidak cocok dengan toko portal.');
  const scopedRows = sanitizePortalTransactions(rows, merchantId, storeId);
  if (!onStore && scopedRows.length === 0) throw new PortalError(422, 'Cakupan merchant dan toko belum terbukti oleh portal Shopee.');
  return { rows: scopedRows, storeId, merchantId };
}

export async function readShopeePortalFeed({ fetchImpl, token, merchantId, storeId }) {
  // Revalidate ownership on every refresh; an unrelated feed must not restore connected.
  const { rows } = await probeShopeePortal({ fetchImpl, token, merchantId, storeId });
  return rows;
}
