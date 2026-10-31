import { emit } from './bus.js';
import { session } from './session.js';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || (status === 0 ? 'Serveur injoignable. Vérifiez la connexion réseau.' : `Erreur ${status}`));
    this.status = status;
    this.body = body || {};
  }
}

let online = true;
function setOnline(v) { if (v !== online) { online = v; emit('connection', v); } }
export const isOnline = () => online;

export async function api(method, url, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && session.me) headers['x-csrf-token'] = session.me.csrfToken;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    setOnline(false);
    throw new ApiError(0, null);
  }
  setOnline(true);
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session.me && session.me.state === 'active' && !url.startsWith('/api/auth/')) emit('session-expired');
    if (res.status === 402) emit('license-blocked', data);
    throw new ApiError(res.status, data);
  }
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const put = (u, b) => api('PUT', u, b);

export async function fetchBlob(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.blob();
}
