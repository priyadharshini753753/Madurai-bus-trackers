import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { ApiError, parseCookies, clientIp } from './http.js'
import { query } from './db.js'

const scrypt = promisify(crypto.scrypt)
const COOKIE = 'mbt_session'
const SESSION_HOURS = 8
const MAX_FAILS = 5
const LOCK_MIN = 15

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`
}
export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p })
  return crypto.timingSafeEqual(actual, expected)
}

function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)')
  return s
}
const b64 = b => Buffer.from(b).toString('base64url')
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url')

export function makeSession(user) {
  const payload = b64(JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_HOURS * 3600e3 }))
  return `${payload}.${sign(payload)}`
}
export function sessionCookie(token, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''
  return `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? 0 : SESSION_HOURS * 3600}`
}

/** Returns the current user from the DB (role is re-read every request), or null. */
export async function currentUser(req) {
  const token = parseCookies(req)[COOKIE]
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expect = sign(payload)
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
  let data
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { return null }
  if (!data.uid || data.exp < Date.now()) return null
  const { rows } = await query('SELECT id, email, role, is_active FROM users WHERE id = $1', [data.uid])
  return rows[0]?.is_active ? { id: rows[0].id, email: rows[0].email, role: rows[0].role } : null
}

export async function requireRole(req, roles) {
  const user = await currentUser(req)
  if (!user) throw new ApiError(401, 'Please sign in')
  if (!roles.includes(user.role)) throw new ApiError(403, 'You do not have permission for this action')
  return user
}

// CSRF defence for state-changing requests: cookies are SameSite=Lax AND a custom
// header is required (browsers will not add it on cross-site form posts).
export function requireCsrfHeader(req) {
  if (req.headers['x-requested-with'] !== 'mbt') throw new ApiError(403, 'Missing request header')
}

export async function login(email, password) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email])
  const u = rows[0]
  // Same generic error for unknown user / wrong password / locked → no account enumeration.
  const bad = new ApiError(401, 'Incorrect email or password')
  if (!u || !u.is_active) { await hashPassword('x'); throw bad }
  if (u.locked_until && u.locked_until > new Date()) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.')
  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_attempts + 1
    await query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1',
      [u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60e3) : null])
    throw bad
  }
  await query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id])
  return { id: u.id, email: u.email, role: u.role }
}

export async function audit(user, req, action, entity, entityId, before, after) {
  await query(
    `INSERT INTO audit_log(user_id, user_email, action, entity, entity_id, before, after, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user?.id ?? null, user?.email ?? null, action, entity, entityId == null ? null : String(entityId),
      before ?? null, after ?? null, clientIp(req)])
}

export async function rateLimit(key, { limit, windowSec }) {
  const { rows } = await query(
    `INSERT INTO rate_limits(key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`, [key, windowSec])
  if (rows[0].count > limit) throw new ApiError(429, 'Too many requests. Please try again later.')
}
