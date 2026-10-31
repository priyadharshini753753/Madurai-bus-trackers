// Validation + persistence of a full route (stops, schedule, fares). Used by the admin
// editor, CSV import, conflict resolution and submission approval.
import { ApiError } from './http.js'
import { Validator } from './validate.js'
import { parseHHMM } from '../shared/time.js'

const STATUSES = ['verified', 'unverified', 'outdated', 'sample']
const BUS_TYPES = ['ordinary', 'express', 'deluxe', 'ac', 'mini']

export function parseRoutePayload(body, { allowSample = false } = {}) {
  const v = new Validator(body)
  v.str('routeNo', { required: true, max: 20 })
  v.int('operatorId', { min: 1, required: true })
  v.oneOf('busType', BUS_TYPES, { required: false, fallback: 'ordinary' })
  v.str('color', { max: 7, pattern: /^#[0-9a-fA-F]{6}$/ })
  v.oneOf('status', allowSample ? STATUSES : STATUSES.filter(s => s !== 'sample'), { required: false, fallback: 'unverified' })
  v.int('sourceId', { min: 1 }); v.date('verifiedAt'); v.str('notes', { max: 1000 }); v.bool('isActive', true)
  const out = v.done()
  const errors = {}

  if (out.status === 'verified' && (!out.sourceId || !out.verifiedAt))
    errors.status = 'A verified route needs a source and a verification date'

  // stops
  const rawStops = Array.isArray(body.stops) ? body.stops : []
  if (rawStops.length < 2 || rawStops.length > 120) errors.stops = 'Add between 2 and 120 stops'
  const stops = []
  const seen = new Set()
  let lastOffset = -1
  rawStops.forEach((s, i) => {
    const stopId = Number(s?.stopId)
    const off = s?.offsetMin === '' || s?.offsetMin == null ? null : Number(s.offsetMin)
    const dist = s?.distanceKm === '' || s?.distanceKm == null ? null : Number(s.distanceKm)
    if (!Number.isInteger(stopId) || stopId < 1) { errors.stops = `Stop ${i + 1}: choose a stop`; return }
    if (seen.has(stopId)) { errors.stops = `Stop ${i + 1}: the same stop appears twice`; return }
    seen.add(stopId)
    if (off != null && (!Number.isInteger(off) || off < 0 || off > 1440)) { errors.stops = `Stop ${i + 1}: minutes must be 0–1440`; return }
    if (off != null) { if (off < lastOffset) errors.stops = `Stop ${i + 1}: minutes must not decrease along the route`; lastOffset = off }
    if (dist != null && (!Number.isFinite(dist) || dist < 0)) { errors.stops = `Stop ${i + 1}: invalid distance`; return }
    if (i === 0 && off != null && off !== 0) errors.stops = 'First stop must be 0 minutes (or blank)'
    stops.push({ stopId, offsetMin: i === 0 ? 0 : off, distanceKm: dist })
  })

  // trips
  const rawTrips = Array.isArray(body.trips) ? body.trips : []
  if (rawTrips.length > 600) errors.trips = 'Too many trips (max 600)'
  const trips = []
  const tripKeys = new Set()
  rawTrips.forEach((t, i) => {
    const m = parseHHMM(t?.time)
    const days = Array.isArray(t?.days) ? [...new Set(t.days.map(Number))].sort() : []
    if (m == null) { errors.trips = `Trip ${i + 1}: invalid time (use HH:MM)`; return }
    if (!days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) { errors.trips = `Trip ${i + 1}: days must be 1 (Mon) to 7 (Sun)`; return }
    for (const k of ['validFrom', 'validTo']) if (t[k] && !/^\d{4}-\d{2}-\d{2}$/.test(t[k])) errors.trips = `Trip ${i + 1}: ${k} must be YYYY-MM-DD`
    const key = `${m}|${days}|${t.validFrom || ''}|${t.validTo || ''}`
    if (tripKeys.has(key)) return
    tripKeys.add(key)
    trips.push({ time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, days, validFrom: t.validFrom || null, validTo: t.validTo || null })
  })

  // fares
  const rawFares = Array.isArray(body.fares) ? body.fares : []
  if (rawFares.length > 300) errors.fares = 'Too many fares'
  const fares = []
  const order = Object.fromEntries(stops.map((s, i) => [s.stopId, i]))
  rawFares.forEach((f, i) => {
    const from = Number(f?.fromStopId), to = Number(f?.toStopId), amt = Number(f?.amount)
    const st = f?.status || 'unverified'
    if (!(from in order) || !(to in order) || order[from] >= order[to]) { errors.fares = `Fare ${i + 1}: stops must be on this route, in travel order`; return }
    if (!Number.isFinite(amt) || amt < 0 || amt > 100000) { errors.fares = `Fare ${i + 1}: invalid amount`; return }
    if (!STATUSES.includes(st) || (!allowSample && st === 'sample')) { errors.fares = `Fare ${i + 1}: invalid status`; return }
    const sid = f.sourceId ? Number(f.sourceId) : null
    if (st === 'verified' && (!sid || !f.verifiedAt)) { errors.fares = `Fare ${i + 1}: verified fare needs source and date`; return }
    fares.push({ fromStopId: from, toStopId: to, amount: amt, status: st, sourceId: sid, verifiedAt: f.verifiedAt || null })
  })

  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors)
  return { ...out, stops, trips, fares }
}

export async function saveRoute(db, id, data, user) {
  const first = data.stops[0].stopId, last = data.stops[data.stops.length - 1].stopId
  if (first === last) throw new ApiError(400, 'Validation failed', { stops: 'Origin and destination must differ' })

  const refs = await db.query(
    `SELECT (SELECT count(*) FROM operators WHERE id = $1 AND is_active)::int AS op,
            (SELECT count(*) FROM stops WHERE id = ANY($2) AND is_active)::int AS st,
            (SELECT count(*) FROM data_sources WHERE id = $3)::int AS src`,
    [data.operatorId, data.stops.map(s => s.stopId), data.sourceId])
  if (!refs.rows[0].op) throw new ApiError(400, 'Validation failed', { operatorId: 'Unknown or inactive operator' })
  if (refs.rows[0].st !== data.stops.length) throw new ApiError(400, 'Validation failed', { stops: 'One or more stops do not exist' })
  if (data.sourceId && !refs.rows[0].src) throw new ApiError(400, 'Validation failed', { sourceId: 'Unknown source' })

  let before = null
  try {
    if (id) {
      before = (await db.query('SELECT status, source_id, verified_at FROM routes WHERE id = $1', [id])).rows[0]
      if (!before) throw new ApiError(404, 'Route not found')
      await db.query(
        `UPDATE routes SET route_no=$2, operator_id=$3, bus_type=$4, origin_stop_id=$5, destination_stop_id=$6,
           color=COALESCE($7,color), status=$8, is_sample=($8 = 'sample'), source_id=$9, verified_at=$10, notes=$11, is_active=$12, updated_at=now()
         WHERE id=$1`,
        [id, data.routeNo, data.operatorId, data.busType, first, last, data.color, data.status, data.sourceId, data.verifiedAt, data.notes, data.isActive])
      await db.query('DELETE FROM route_stops WHERE route_id=$1', [id])
      await db.query('DELETE FROM schedules WHERE route_id=$1', [id])
      await db.query('DELETE FROM fares WHERE route_id=$1', [id])
    } else {
      id = (await db.query(
        `INSERT INTO routes(route_no, operator_id, bus_type, origin_stop_id, destination_stop_id, color, status, source_id, verified_at, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'#1D9E75'),$7,$8,$9,$10,$11) RETURNING id`,
        [data.routeNo, data.operatorId, data.busType, first, last, data.color, data.status, data.sourceId, data.verifiedAt, data.notes, data.isActive])).rows[0].id
    }
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'A route with the same number, operator and endpoints already exists')
    throw e
  }

  for (let i = 0; i < data.stops.length; i++) {
    const s = data.stops[i]
    await db.query('INSERT INTO route_stops(route_id, seq, stop_id, offset_min, distance_km) VALUES ($1,$2,$3,$4,$5)',
      [id, i, s.stopId, s.offsetMin, s.distanceKm])
  }
  for (const t of data.trips)
    await db.query('INSERT INTO schedules(route_id, departure_time, days, valid_from, valid_to) VALUES ($1,$2,$3,$4,$5)',
      [id, t.time, t.days, t.validFrom, t.validTo])
  for (const f of data.fares)
    await db.query(`INSERT INTO fares(route_id, from_stop_id, to_stop_id, amount, status, source_id, verified_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, f.fromStopId, f.toStopId, f.amount, f.status, f.sourceId, f.verifiedAt])

  const changed = !before || before.status !== data.status || before.source_id !== data.sourceId ||
    String(before.verified_at?.toISOString?.().slice(0, 10) ?? '') !== String(data.verifiedAt ?? '')
  if (changed)
    await db.query(`INSERT INTO verification_records(entity_type, entity_id, status, source_id, verified_by, note)
                    VALUES ('route',$1,$2,$3,$4,$5)`, [id, data.status, data.sourceId, user?.id ?? null, data.verifiedAt ? `Verified on ${data.verifiedAt}` : null])
  return id
}

/** Snapshot of a stored route for audit logs / conflict comparison. */
export async function snapshotRoute(db, id) {
  const r = (await db.query('SELECT route_no, operator_id, bus_type, status, source_id, verified_at, is_active FROM routes WHERE id=$1', [id])).rows[0]
  if (!r) return null
  const stops = (await db.query('SELECT stop_id, offset_min FROM route_stops WHERE route_id=$1 ORDER BY seq', [id])).rows
  const trips = (await db.query(`SELECT to_char(departure_time,'HH24:MI') AS t, days FROM schedules WHERE route_id=$1 ORDER BY departure_time, days`, [id])).rows
  return { ...r, stops: stops.map(s => `${s.stop_id}@${s.offset_min ?? ''}`), trips: trips.map(t => `${t.t}|${t.days.join('')}`) }
}
