// Loads routes (with ordered stops + trips) from the DB into the shape used by shared/planner.js
import { query } from './db.js'
import { parseHHMM } from '../shared/time.js'

const d = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null)

export async function loadNetwork({ activeOnly = true, routeId = null } = {}) {
  const where = [], params = []
  if (activeOnly) where.push('r.is_active AND o.is_active')
  if (routeId) { params.push(routeId); where.push(`r.id = $${params.length}`) }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const routes = (await query(
    `SELECT r.id, r.route_no, r.bus_type, r.color, r.status, r.verified_at, r.is_active, r.is_sample, r.notes,
            o.id AS op_id, o.name AS op_name, o.type AS op_type,
            s.id AS src_id, s.name AS src_name, s.url AS src_url, s.type AS src_type
       FROM routes r JOIN operators o ON o.id = r.operator_id
       LEFT JOIN data_sources s ON s.id = r.source_id ${W} ORDER BY r.route_no`, params)).rows
  if (!routes.length) return []
  const ids = routes.map(r => r.id)

  const stops = (await query(
    `SELECT rs.route_id, rs.seq, rs.stop_id, rs.offset_min, rs.distance_km, st.name_en, st.name_ta, st.lat, st.lng
       FROM route_stops rs JOIN stops st ON st.id = rs.stop_id
      WHERE rs.route_id = ANY($1) ORDER BY rs.route_id, rs.seq`, [ids])).rows
  const trips = (await query(
    `SELECT route_id, to_char(departure_time,'HH24:MI') AS t, days, valid_from, valid_to
       FROM schedules WHERE route_id = ANY($1) ORDER BY departure_time`, [ids])).rows

  const stopsBy = {}, tripsBy = {}
  for (const s of stops) (stopsBy[s.route_id] ||= []).push({
    stopId: s.stop_id, seq: s.seq, name: s.name_en, nameTa: s.name_ta,
    offsetMin: s.offset_min, distanceKm: s.distance_km == null ? null : Number(s.distance_km),
    lat: s.lat, lng: s.lng,
  })
  for (const t of trips) (tripsBy[t.route_id] ||= []).push({
    depMin: parseHHMM(t.t), days: t.days.map(Number), validFrom: d(t.valid_from), validTo: d(t.valid_to),
  })

  return routes.map(r => ({
    id: r.id, routeNo: r.route_no, busType: r.bus_type, color: r.color, status: r.status,
    verifiedAt: d(r.verified_at), isActive: r.is_active, isSample: r.is_sample, notes: r.notes,
    operator: { id: r.op_id, name: r.op_name, type: r.op_type },
    source: r.src_id ? { id: r.src_id, name: r.src_name, url: r.src_url, type: r.src_type } : null,
    stops: stopsBy[r.id] || [],
    trips: tripsBy[r.id] || [],
  }))
}

/** Published alerts that are active now (or recently expired when includeExpired). */
export async function loadAlerts({ includeExpired = false, routeIds = null, stopIds = null } = {}) {
  const rows = (await query(
    `SELECT a.id, a.type, a.title, a.body, a.starts_at, a.ends_at, a.status, a.verification_status, a.source_text,
            COALESCE(json_agg(json_build_object('routeId', t.route_id, 'stopId', t.stop_id)) FILTER (WHERE t.alert_id IS NOT NULL), '[]') AS targets,
            (a.ends_at IS NOT NULL AND a.ends_at <= now()) AS expired,
            (a.starts_at > now()) AS upcoming
       FROM alerts a LEFT JOIN alert_targets t ON t.alert_id = a.id
      WHERE a.status = 'published'
        ${includeExpired ? "AND (a.ends_at IS NULL OR a.ends_at > now() - interval '30 days')" : 'AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())'}
      GROUP BY a.id ORDER BY a.starts_at DESC LIMIT 200`)).rows
  const out = rows.map(a => ({
    id: a.id, type: a.type, title: a.title, body: a.body, startsAt: a.starts_at, endsAt: a.ends_at,
    verificationStatus: a.verification_status, source: a.source_text, targets: a.targets,
    state: a.expired ? 'expired' : a.upcoming ? 'upcoming' : 'active',
  }))
  if (!routeIds && !stopIds) return out
  return out.filter(a => a.targets.some(t =>
    (t.routeId && routeIds?.includes(t.routeId)) || (t.stopId && stopIds?.includes(t.stopId))))
}
