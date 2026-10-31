import { idb } from './idb'

export class ApiFail extends Error {
  constructor(message, status, fields) { super(message); this.status = status; this.fields = fields }
}

async function request(method, path, body, { raw, headers } = {}) {
  let res
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { 'x-requested-with': 'mbt', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiFail('Cannot reach the server. Check your internet connection.', 0)
  }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text()
  if (!res.ok) throw new ApiFail(data?.error || `Request failed (${res.status})`, res.status, data?.fields)
  return data
}

export const api = {
  get: p => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  postText: (p, text, type = 'text/csv') => request('POST', p, text, { raw: true, headers: { 'content-type': type } }),
}

/** GET with an IndexedDB fallback so the app still opens offline. Returns { data, fromCache, cachedAt }. */
export async function cachedGet(path) {
  const key = 'cache:' + path
  try {
    const data = await api.get(path)
    idb.set(key, { data, at: new Date().toISOString() })
    return { data, fromCache: false, cachedAt: null }
  } catch (e) {
    if (e.status !== 0) throw e
    const hit = await idb.get(key)
    if (hit) return { data: hit.data, fromCache: true, cachedAt: hit.at }
    throw e
  }
}
