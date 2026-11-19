import { isIP } from 'node:net';

// Configuration only: no outbound requests until provider events and delivery policy are verified.
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
