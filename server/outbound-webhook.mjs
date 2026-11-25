import { isIP } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';

export function validateWebhookUrl(value) {
 if (typeof value !== 'string' || value.length > 2048) throw Object.assign(new Error('URL webhook HTTPS publik diperlukan.'), {status:400});
 let url;
 try { url = new URL(value); } catch { throw Object.assign(new Error('URL webhook tidak valid.'), {status:400}); }
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443' ||
     isIP(host) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
     host.split('.').some(part => part.startsWith('-') || part.endsWith('-')) ||
     /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) {
  throw Object.assign(new Error('URL webhook harus HTTPS dengan hostname publik tanpa kredensial.'), {status:400});
 }
 return url.href;
}

export async function deliverWebhook({ url, secret, payload, fetchImpl = globalThis.fetch, maxAttempts = 3 }) {
 validateWebhookUrl(url);
 const rawBody = JSON.stringify(payload);
 const timestamp = String(Math.floor(Date.now() / 1000));
 const deliveryId = randomUUID();
 const signature = secret
  ? createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  : '';

 let lastStatus = 0;
 let lastError = null;

 for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), 10_000);
   const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
     'content-type': 'application/json',
     'x-qrisgate-timestamp': timestamp,
     'x-qrisgate-signature': signature,
     'x-ditsgate-delivery-id': deliveryId,
    },
    body: rawBody,
    signal: controller.signal,
   });
   clearTimeout(timer);
   lastStatus = res.status;
   if (res.ok) {
    return { ok: true, status: res.status, deliveryId, attempts: attempt };
   }
   lastError = `HTTP ${res.status}`;
  } catch (err) {
   lastError = err instanceof Error ? err.message : String(err);
  }
  if (attempt < maxAttempts) {
   await new Promise(r => setTimeout(r, 300 * (2 ** (attempt - 1))));
  }
 }
 return { ok: false, status: lastStatus, deliveryId, attempts: maxAttempts, error: lastError };
}
