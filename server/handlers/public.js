import { ApiError } from '../http.js'
import { query } from '../db.js'
import { Validator, ID } from '../validate.js'
import { loadNetwork, loadAlerts } from '../network.js'
import { planJourneys, lastBusAt } from '../../shared/planner.js'
import { nowIST, isDateStr, parseHHMM } from '../../shared/time.js'
import { rateLimit } from '../auth.js'
import { hashKey, clientIp } from '../http.js'

async function bump(event) {
  await query(`INSERT INTO usage_events(day, event, count) VALUES (CURRENT_DATE, $1, 1)
               ON CONFLICT (day, event) DO UPDATE SET count = usage_events.count + 1`, [event]).catch(() => {})
}

export async function health() {
  await query('SELECT 1')
  return { ok: true }
}

export async function meta() {
  const { rows } = await query(`SELECT status, count(*)::int AS n FROM routes WHERE is_active GROUP BY status`)
  const counts = Object.fromEntries(rows.map(r => [r.status, r.n]))
  const now = nowIST()
  return { counts, serverTime: new Date().toISOString(), today: now.dateStr, nowMinutes: now.minutes, timezone: 'Asia/Kolkata' }
}

export async function stops() {
  const { rows } = await query(
    `SELECT id, name_en AS "nameEn", name_ta AS "nameTa", aliases, lat, lng, is_sample AS "isSample"
       FROM stops WHERE is_active ORDER BY name_en`)
  return { stops: rows }
}

export async function listRoutes(ctx) {
  const type = ctx.query.type
  if (type && !['govt', 'private', 'minibus'].includes(type)) throw new ApiError(400, 'Invalid type')
  const routes = await loadNetwork()
  const today = nowIST().dateStr
  return {
    routes: routes.filter(r => !type || r.operator.type === type).map(r => {
      const first = r.stops[0], last = r.stops[r.stops.length - 1]
      const deps = r.trips.map(t => t.depMin)
      return {
        id: r.id, routeNo: r.routeNo, operator: r.operator, busType: r.busType, color: r.color,
        status: r.status, verifiedAt: r.verifiedAt, isSample: r.isSample, source: r.source,
        origin: first?.name, destination: last?.name, stopCount: r.stops.length,
        stopIds: r.stops.map(s => s.stopId),
        firstDepMin: deps.length ? Math.min(...deps) : null, lastDepMin: deps.length ? Math.max(...deps) : null,
        today,
      }
    }),
  }
}

export async function routeDetail(ctx) {
  const id = ID(ctx.params.id, 'route id')
  const [route] = await loadNetwork({ routeId: id })
  if (!route) throw new ApiError(404, 'Route not found')
  const fares = (await query(
    `SELECT f.from_stop_id AS "fromStopId", f.to_stop_id AS "toStopId", f.amount::float AS amount, f.status,
            f.verified_at AS "verifiedAt", s.name AS "sourceName"
       FROM fares f LEFT JOIN data_sources s ON s.id = f.source_id WHERE f.route_id = $1`, [id])).rows
  const alerts = await loadAlerts({ includeExpired: false, routeIds: [id], stopIds: route.stops.map(s => s.stopId) })
  return { route, fares, alerts, fetchedAt: new Date().toISOString() }
}

export async function search(ctx) {
  const v = new Validator(ctx.query)
  v.int('from', { min: 1, required: true }); v.int('to', { min: 1, required: true })
  v.oneOf('type', ['all', 'govt', 'private', 'minibus'], { required: false, fallback: 'all' })
  const q = v.done()
  if (q.from === q.to) throw new ApiError(400, 'Starting stop and destination are the same')
  const now = nowIST()
  const dateStr = ctx.query.date ? (isDateStr(ctx.query.date) ? ctx.query.date : (() => { throw new ApiError(400, 'Invalid date') })()) : now.dateStr
  let afterMin = dateStr === now.dateStr ? now.minutes : 0
  if (ctx.query.time) {
    afterMin = parseHHMM(ctx.query.time)
    if (afterMin == null) throw new ApiError(400, 'Invalid time')
  }

  const stopRows = (await query('SELECT id, name_en FROM stops WHERE id = ANY($1) AND is_active', [[q.from, q.to]])).rows
  if (stopRows.length !== 2) throw new ApiError(404, 'Unknown stop')

  const routes = await loadNetwork()
  const { direct, transfers } = planJourneys({ routes, fromId: q.from, toId: q.to, dateStr, afterMin, type: q.type })

  const allIds = new Set([...direct.map(l => l.routeId), ...transfers.flatMap(t => t.legs.map(l => l.routeId))])
  const stopIdsByRoute = Object.fromEntries(routes.map(r => [r.id, r.stops.map(s => s.stopId)]))
  const alerts = await loadAlerts({ includeExpired: false, routeIds: [...allIds], stopIds: [...new Set([...allIds].flatMap(i => stopIdsByRoute[i]))] })
  const alertsFor = routeId => alerts.filter(a => a.targets.some(t => t.routeId === routeId ||
    (t.stopId && stopIdsByRoute[routeId]?.includes(t.stopId))))

  const faresQ = await query(
    `SELECT route_id, from_stop_id, to_stop_id, amount::float AS amount, status FROM fares WHERE route_id = ANY($1)`, [[...allIds]])
  const fareFor = (routeId, f, t) => {
    const x = faresQ.rows.find(r => r.route_id === routeId && r.from_stop_id === f && r.to_stop_id === t)
    return x ? { amount: x.amount, status: x.status } : null   // null → "Fare not verified"
  }
  const decorate = l => ({ ...l, fare: fareFor(l.routeId, l.fromStopId, l.toStopId), alerts: alertsFor(l.routeId) })

  const out = {
    query: { from: q.from, to: q.to, type: q.type, date: dateStr, afterMin },
    direct: direct.map(decorate),
    transfers: transfers.map(t => ({ ...t, transfers: 1, legs: t.legs.map(decorate) })),
    note: 'Times are scheduled departures and ETAs are estimates from stored schedules. No live bus location is available.',
  }
  await bump(direct.length || transfers.length ? 'search' : 'search_no_result')
  return out
}

export async function lastBus(ctx) {
  const v = new Validator(ctx.query); v.int('route', { min: 1, required: true }); v.int('stop', { min: 1, required: true }); v.date('date')
  const q = v.done()
  const [route] = await loadNetwork({ routeId: q.route })
  if (!route) throw new ApiError(404, 'Route not found')
  return { lastBoardMin: lastBusAt(route, q.stop, q.date || nowIST().dateStr), status: route.status }
}

export async function alerts(ctx) {
  return { alerts: await loadAlerts({ includeExpired: ctx.query.include === 'expired' }) }
}

export async function sources() {
  const { rows } = await query(
    `SELECT s.id, s.name, s.type, s.url, s.notes,
            (SELECT count(*)::int FROM routes r WHERE r.source_id = s.id AND r.is_active) AS "routeCount"
       FROM data_sources s ORDER BY s.name`)
  return { sources: rows }
}

export async function feedback(ctx) {
  await rateLimit(`fb:${hashKey(clientIp(ctx.req))}`, { limit: 10, windowSec: 3600 })
  const v = new Validator(ctx.body)
  v.str('message', { required: true, min: 5, max: 2000 }); v.str('contact', { max: 200 }); v.str('page', { max: 100 })
  const b = v.done()
  await query('INSERT INTO feedback(message, contact, page) VALUES ($1,$2,$3)', [b.message, b.contact, b.page])
  return { ok: true }
}

export async function submitRoute(ctx) {
  await rateLimit(`sub:${hashKey(clientIp(ctx.req))}`, { limit: 5, windowSec: 3600 })
  const v = new Validator(ctx.body)
  v.str('routeNo', { required: true, max: 20 })
  v.oneOf('operatorType', ['govt', 'private', 'minibus'])
  v.int('originStopId', { min: 1, required: true }); v.int('destinationStopId', { min: 1, required: true })
  v.str('intermediateStops', { max: 1000 }); v.str('timings', { max: 1000 }); v.str('fare', { max: 200 })
  v.str('sourceNote', { required: true, min: 3, max: 500 }); v.str('contact', { max: 200 })
  const b = v.done()
  if (b.originStopId === b.destinationStopId) throw new ApiError(400, 'Validation failed', { destinationStopId: 'Must differ from origin' })
  const ok = (await query('SELECT count(*)::int AS n FROM stops WHERE id = ANY($1)', [[b.originStopId, b.destinationStopId]])).rows[0].n
  if (ok !== 2) throw new ApiError(400, 'Validation failed', { originStopId: 'Unknown stop' })
  const r = await query('INSERT INTO submissions(payload) VALUES ($1) RETURNING id', [b])
  return { ok: true, id: r.rows[0].id }
}
