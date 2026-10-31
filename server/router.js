import { ApiError, send, readBody } from './http.js'
import { login, makeSession, sessionCookie, currentUser, requireRole, requireCsrfHeader, audit, rateLimit } from './auth.js'
import { Validator } from './validate.js'
import { hashKey, clientIp } from './http.js'
import * as pub from './handlers/public.js'
import * as adm from './handlers/admin.js'

const ANY = ['admin', 'editor']
const ADMIN = ['admin']

// [method, pattern, handler, roles|null(public)]
const ROUTES = [
  ['GET', '/health', pub.health, null],
  ['GET', '/meta', pub.meta, null],
  ['GET', '/stops', pub.stops, null],
  ['GET', '/routes', pub.listRoutes, null],
  ['GET', '/routes/:id', pub.routeDetail, null],
  ['GET', '/search', pub.search, null],
  ['GET', '/last-bus', pub.lastBus, null],
  ['GET', '/alerts', pub.alerts, null],
  ['GET', '/sources', pub.sources, null],
  ['POST', '/feedback', pub.feedback, null],
  ['POST', '/submissions', pub.submitRoute, null],

  ['GET', '/admin/overview', adm.overview, ANY],
  ['GET', '/admin/operators', adm.listOperators, ANY],
  ['POST', '/admin/operators', adm.saveOperator, ADMIN],
  ['PUT', '/admin/operators/:id', adm.saveOperator, ADMIN],
  ['GET', '/admin/stops', adm.listStops, ANY],
  ['POST', '/admin/stops', adm.saveStop, ANY],
  ['PUT', '/admin/stops/:id', adm.saveStop, ANY],
  ['POST', '/admin/sources', adm.saveSource, ANY],
  ['PUT', '/admin/sources/:id', adm.saveSource, ANY],
  ['GET', '/admin/routes', adm.adminListRoutes, ANY],
  ['GET', '/admin/routes/:id', adm.adminRouteDetail, ANY],
  ['POST', '/admin/routes', adm.createRoute, ANY],
  ['PUT', '/admin/routes/:id', adm.updateRoute, ANY],
  ['POST', '/admin/routes/:id/deactivate', ctx => adm.setRouteActive(ctx, false), ADMIN],
  ['POST', '/admin/routes/:id/activate', ctx => adm.setRouteActive(ctx, true), ANY],
  ['GET', '/admin/alerts', adm.adminAlerts, ADMIN],
  ['POST', '/admin/alerts', adm.createAlert, ADMIN],
  ['POST', '/admin/alerts/:id/archive', adm.archiveAlert, ADMIN],
  ['GET', '/admin/submissions', adm.listSubmissions, ANY],
  ['POST', '/admin/submissions/:id/review', adm.reviewSubmission, ANY],
  ['POST', '/admin/import', adm.importRoutes, ANY],
  ['POST', '/admin/import/:id/resolve', adm.resolveConflicts, ADMIN],
  ['GET', '/admin/export', adm.exportRoutes, ANY],
  ['GET', '/admin/audit', adm.auditLog, ADMIN],
  ['GET', '/admin/feedback', adm.feedbackList, ANY],
]

const compiled = ROUTES.map(([method, pattern, handler, roles]) => ({
  method, handler, roles,
  re: new RegExp('^' + pattern.replace(/:[a-z]+/g, '([^/]+)') + '$'),
  names: [...pattern.matchAll(/:([a-z]+)/g)].map(m => m[1]),
}))

async function authRoute(req, res, path, body) {
  if (path === '/auth/me' && req.method === 'GET') {
    const user = await currentUser(req)
    return send(res, 200, { user })
  }
  if (path === '/auth/login' && req.method === 'POST') {
    requireCsrfHeader(req)
    await rateLimit(`login:${hashKey(clientIp(req))}`, { limit: 20, windowSec: 900 })
    const v = new Validator(body); v.email('email'); v.str('password', { required: true, max: 200 })
    const b = v.done()
    const user = await login(b.email, b.password)
    await audit(user, req, 'login', 'user', user.id, null, null)
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(makeSession(user)) })
  }
  if (path === '/auth/logout' && req.method === 'POST') {
    requireCsrfHeader(req)
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true }) })
  }
  return false
}

export async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/'
    const query = Object.fromEntries(url.searchParams)
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    if (req.method === 'OPTIONS') return send(res, 204, '')

    const body = isWrite ? await readBody(req) : {}
    if (path.startsWith('/auth/') && (await authRoute(req, res, path, body)) !== false) return

    for (const r of compiled) {
      if (r.method !== req.method) continue
      const m = r.re.exec(path)
      if (!m) continue
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]))
      let user = null
      if (r.roles) {
        if (isWrite) requireCsrfHeader(req)
        user = await requireRole(req, r.roles)   // server-side authorization, role re-read from DB
      } else if (isWrite) requireCsrfHeader(req)
      const result = await r.handler({ req, query, params, body, user })
      if (result?.csv && path === '/admin/export') {
        return send(res, 200, result.csv, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
        })
      }
      return send(res, 200, result)
    }
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: e.message, fields: e.fields })
    console.error('[api]', req.method, req.url, e)
    send(res, 500, { error: 'Something went wrong on the server' })
  }
}
