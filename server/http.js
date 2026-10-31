import crypto from 'node:crypto'

export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (typeof data === 'string') { res.end(data); return }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

const MAX_BODY = 2 * 1024 * 1024
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) return req.body
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null
  if (raw === null) {
    const chunks = []; let size = 0
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new ApiError(413, 'Request too large'); chunks.push(c) }
    raw = Buffer.concat(chunks).toString('utf8')
  }
  if (!raw) return {}
  const type = String(req.headers['content-type'] || '')
  if (type.includes('application/json')) {
    try { return JSON.parse(raw) } catch { throw new ApiError(400, 'Invalid JSON') }
  }
  return { _raw: raw }
}

export function parseCookies(req) {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown'
}
export const hashKey = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)
