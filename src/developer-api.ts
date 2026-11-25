const envOrigin = (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env?.VITE_DITSGATE_API_URL;
export const API_ORIGIN = envOrigin || (typeof window !== 'undefined' && !['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname) ? window.location.origin : 'http://127.0.0.1:5180');

export function safeSandboxOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw new Error('Origin API tidak valid.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
  if (!loopback && url.protocol !== 'https:') throw new Error('Origin remote harus menggunakan HTTPS; HTTP hanya untuk loopback lokal.');
  return url.origin;
}

export type SandboxKey = { id: string; name: string; prefix: string; webhookUrl: string | null; qrisId: string | null; lastUsedAt?: string | null; revokedAt: string | null; deliveryEnabled: boolean };
export type SandboxWebhook = { url: string | null; secretConfigured: boolean; deliveryEnabled: boolean };
export type SandboxQris = { id: string; name: string };

export async function sandboxRequest<T>(origin: string, path: string, method = 'GET', token?: string, payload?: unknown): Promise<T> {
  const response = await fetch(safeSandboxOrigin(origin) + path, {
    method,
    headers: { ...(token && token !== 'cookie_session' ? { Authorization: `Bearer ${token}` } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    credentials: 'include', cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : `Permintaan gagal (${response.status}).`);
  return json as T;
}
