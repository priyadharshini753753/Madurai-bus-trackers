import { ApiError } from '../http.js'
import { query, tx } from '../db.js'
import { Validator, ID } from '../validate.js'
import { audit } from '../auth.js'
import { loadNetwork } from '../network.js'
import { parseRoutePayload, saveRoute, snapshotRoute } from '../routeSave.js'
import { importCsv, applyConflict } from '../importer.js'
import { toCsv } from '../csv.js'
import { fmtMinutes } from '../../shared/time.js'

const STALE_DAYS = 180

// ───────── Overview, statistics and data-quality issues ─────────
export async function overview() {
  const routes = await loadNetwork({ activeOnly: false })
  const issues = []
  const count = {}
  const add = (r, code, label) => { (count[code] ||= { label, n: 0 }).n++; issues.push({ routeId: r.id, routeNo: r.routeNo, code, label }) }
  const staleBefore = new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10)
  for (const r of routes.filter(x => x.isActive)) {
    if (r.stops.length < 2) add(r, 'few_stops', 'Fewer than 2 stops')
    if (!r.trips.length) add(r, 'no_schedule', 'No schedule')
    if (r.stops.some((s, i) => i > 0 && s.offsetMin == null)) add(r, 'no_durations', 'Missing stop timings (ETA unavailable)')
    if (!r.source) add(r, 'no_source', 'No source recorded')
    if (r.status === 'unverified') add(r, 'unverified', 'Unverified')
    if (r.status === 'sample') add(r, 'sample', 'Sample data')
    if (r.status === 'outdated') add(r, 'outdated', 'Marked outdated')
    if (r.status === 'verified' && (!r.verifiedAt || r.verifiedAt < staleBefore)) add(r, 'stale', `Verification older than ${STALE_DAYS} days`)
  }
  const noFare = (await query(`SELECT r.id, r.route_no FROM routes r WHERE r.is_active AND NOT EXISTS (SELECT 1 FROM fares f WHERE f.route_id = r.id)`)).rows
  for (const r of noFare) add({ id: r.id, routeNo: r.route_no }, 'no_fare', 'No fare information')

  const dupes = (await query(
    `SELECT lower(a.route_no) AS no, array_agg(a.id) AS ids FROM routes a WHERE a.is_active
      GROUP BY lower(a.route_no), a.origin_stop_id, a.destination_stop_id HAVING count(*) > 1`)).rows
  for (const d of dupes) issues.push({ routeId: d.ids[0], routeNo: d.no, code: 'possible_duplicate', label: 'Possible duplicate route' })

  const usage = (await query(`SELECT event, sum(count)::int AS n FROM usage_events WHERE day > CURRENT_DATE - 7 GROUP BY event`)).rows
  const stats = (await query(
    `SELECT (SELECT count(*) FROM routes WHERE is_active)::int AS routes,
            (SELECT count(*) FROM routes WHERE NOT is_active)::int AS inactive,
            (SELECT count(*) FROM stops WHERE is_active)::int AS stops,
            (SELECT count(*) FROM operators WHERE is_active)::int AS operators,
            (SELECT count(*) FROM submissions WHERE status='pending')::int AS pending,
            (SELECT count(*) FROM feedback)::int AS feedback,
            (SELECT count(*) FROM alerts WHERE status='published' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()))::int AS "activeAlerts"`)).rows[0]
  const byStatus = (await query(`SELECT status, count(*)::int AS n FROM routes WHERE is_active GROUP BY status`)).rows
  const byType = (await query(`SELECT o.type, count(*)::int AS n FROM routes r JOIN operators o ON o.id=r.operator_id WHERE r.is_active GROUP BY o.type`)).rows
  return {
    stats, byStatus, byType,
    usage7d: Object.fromEntries(usage.map(u => [u.event, u.n])),
    issueSummary: Object.entries(count).map(([code, v]) => ({ code, ...v })),
    issues: issues.slice(0, 300),
  }
}

// ───────── Operators (admin only) ─────────
export async function listOperators() {
  return { operators: (await query('SELECT id, name, type, authority, is_active AS "isActive", is_sample AS "isSample" FROM operators ORDER BY name')).rows }
}
export async function saveOperator(ctx) {
  const v = new Validator(ctx.body)
  v.str('name', { required: true, max: 120 }); v.oneOf('type', ['govt', 'private', 'minibus']); v.str('authority', { max: 200 }); v.bool('isActive', true)
  const b = v.done()
  try {
    if (ctx.params.id) {
      const id = ID(ctx.params.id)
      const before = (await query('SELECT * FROM operators WHERE id=$1', [id])).rows[0]
      if (!before) throw new ApiError(404, 'Operator not found')
      await query('UPDATE operators SET name=$2, type=$3, authority=$4, is_active=$5 WHERE id=$1', [id, b.name, b.type, b.authority, b.isActive])
      await audit(ctx.user, ctx.req, 'update', 'operator', id, before, b)
      return { id }
    }
    const id = (await query('INSERT INTO operators(name, type, authority, is_active) VALUES ($1,$2,$3,$4) RETURNING id', [b.name, b.type, b.authority, b.isActive])).rows[0].id
    await audit(ctx.user, ctx.req, 'create', 'operator', id, null, b)
    return { id }
  } catch (e) { if (e.code === '23505') throw new ApiError(409, 'An operator with this name already exists'); throw e }
}

// ───────── Stops ─────────
export async function listStops() {
  return { stops: (await query(`SELECT id, name_en AS "nameEn", name_ta AS "nameTa", aliases, lat, lng, is_active AS "isActive", is_sample AS "isSample" FROM stops ORDER BY name_en`)).rows }
}
export async function saveStop(ctx) {
  const v = new Validator(ctx.body)
  v.str('nameEn', { required: true, max: 120 }); v.str('nameTa', { max: 120 })
  v.num('lat', { min: -90, max: 90 }); v.num('lng', { min: -180, max: 180 }); v.bool('isActive', true)
  const aliases = Array.isArray(ctx.body.aliases) ? ctx.body.aliases : String(ctx.body.aliases || '').split(',')
  const b = v.done()
  b.aliases = [...new Set(aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
  if ((b.lat == null) !== (b.lng == null)) throw new ApiError(400, 'Validation failed', { lat: 'Give both latitude and longitude, or neither' })
  try {
    if (ctx.params.id) {
      const id = ID(ctx.params.id)
      const before = (await query('SELECT * FROM stops WHERE id=$1', [id])).rows[0]
      if (!before) throw new ApiError(404, 'Stop not found')
      await query('UPDATE stops SET name_en=$2, name_ta=$3, aliases=$4, lat=$5, lng=$6, is_active=$7, updated_at=now() WHERE id=$1',
        [id, b.nameEn, b.nameTa, b.aliases, b.lat, b.lng, b.isActive])
      await audit(ctx.user, ctx.req, 'update', 'stop', id, before, b)
      return { id }
    }
    const id = (await query('INSERT INTO stops(name_en, name_ta, aliases, lat, lng, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [b.nameEn, b.nameTa, b.aliases, b.lat, b.lng, b.isActive])).rows[0].id
    await audit(ctx.user, ctx.req, 'create', 'stop', id, null, b)
    return { id }
  } catch (e) { if (e.code === '23505') throw new ApiError(409, 'A stop with this name already exists'); throw e }
}

// ───────── Data sources ─────────
export async function saveSource(ctx) {
  const v = new Validator(ctx.body)
  v.str('name', { required: true, max: 200 }); v.oneOf('type', ['official', 'operator', 'public_record', 'field_survey', 'user_submission'])
  v.str('url', { max: 500, pattern: /^https?:\/\//i }); v.str('notes', { max: 1000 })
  const b = v.done()
  try {
    if (ctx.params.id) {
      const id = ID(ctx.params.id)
      const before = (await query('SELECT * FROM data_sources WHERE id=$1', [id])).rows[0]
      if (!before) throw new ApiError(404, 'Source not found')
      await query('UPDATE data_sources SET name=$2, type=$3, url=$4, notes=$5 WHERE id=$1', [id, b.name, b.type, b.url, b.notes])
      await audit(ctx.user, ctx.req, 'update', 'source', id, before, b)
      return { id }
    }
    const id = (await query('INSERT INTO data_sources(name, type, url, notes) VALUES ($1,$2,$3,$4) RETURNING id', [b.name, b.type, b.url, b.notes])).rows[0].id
    await audit(ctx.user, ctx.req, 'create', 'source', id, null, b)
    return { id }
  } catch (e) { if (e.code === '23505') throw new ApiError(409, 'A source with this name already exists'); throw e }
}

// ───────── Routes ─────────
export async function adminListRoutes() {
  const routes = await loadNetwork({ activeOnly: false })
  return {
    routes: routes.map(r => ({
      id: r.id, routeNo: r.routeNo, operator: r.operator, busType: r.busType, status: r.status, isActive: r.isActive,
      isSample: r.isSample, verifiedAt: r.verifiedAt, source: r.source,
      origin: r.stops[0]?.name, destination: r.stops.at(-1)?.name, stopCount: r.stops.length, tripCount: r.trips.length,
    })),
  }
}
export async function adminRouteDetail(ctx) {
  const id = ID(ctx.params.id)
  const [r] = await loadNetwork({ activeOnly: false, routeId: id })
  if (!r) throw new ApiError(404, 'Route not found')
  const trips = (await query(`SELECT to_char(departure_time,'HH24:MI') AS time, days, valid_from AS "validFrom", valid_to AS "validTo" FROM schedules WHERE route_id=$1 ORDER BY departure_time`, [id])).rows
    .map(t => ({ ...t, days: t.days.map(Number), validFrom: t.validFrom?.toISOString?.().slice(0, 10) ?? null, validTo: t.validTo?.toISOString?.().slice(0, 10) ?? null }))
  const fares = (await query(`SELECT from_stop_id AS "fromStopId", to_stop_id AS "toStopId", amount::float AS amount, status, source_id AS "sourceId", verified_at AS "verifiedAt" FROM fares WHERE route_id=$1`, [id])).rows
    .map(f => ({ ...f, verifiedAt: f.verifiedAt?.toISOString?.().slice(0, 10) ?? null }))
  const history = (await query(`SELECT v.status, v.note, v.created_at AS "at", u.email AS "by", s.name AS source
                                  FROM verification_records v LEFT JOIN users u ON u.id=v.verified_by LEFT JOIN data_sources s ON s.id=v.source_id
                                 WHERE v.entity_type='route' AND v.entity_id=$1 ORDER BY v.created_at DESC LIMIT 20`, [id])).rows
  return { route: { ...r, sourceId: r.source?.id ?? null, trips, fares }, history }
}
export async function createRoute(ctx) {
  const data = parseRoutePayload(ctx.body)
  const id = await tx(async db => {
    const id = await saveRoute(db, null, data, ctx.user)
    await audit(ctx.user, ctx.req, 'create', 'route', id, null, await snapshotRoute(db, id))
    return id
  })
  return { id }
}
export async function updateRoute(ctx) {
  const id = ID(ctx.params.id)
  const data = parseRoutePayload(ctx.body, { allowSample: true })
  await tx(async db => {
    const before = await snapshotRoute(db, id)
    await saveRoute(db, id, data, ctx.user)
    await audit(ctx.user, ctx.req, 'update', 'route', id, before, await snapshotRoute(db, id))
  })
  return { id }
}
export async function setRouteActive(ctx, active) {
  const id = ID(ctx.params.id)
  const r = await query('UPDATE routes SET is_active=$2, updated_at=now() WHERE id=$1 RETURNING id', [id, active])
  if (!r.rows.length) throw new ApiError(404, 'Route not found')
  await audit(ctx.user, ctx.req, active ? 'activate' : 'deactivate', 'route', id, { isActive: !active }, { isActive: active })
  return { id, isActive: active }
}

// ───────── Service alerts (admin only) ─────────
export async function adminAlerts() {
  const rows = (await query(
    `SELECT a.id, a.type, a.title, a.body, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status,
            a.verification_status AS "verificationStatus", a.source_text AS source,
            (a.ends_at IS NOT NULL AND a.ends_at <= now()) AS expired,
            COALESCE(json_agg(json_build_object('routeId', t.route_id, 'stopId', t.stop_id)) FILTER (WHERE t.alert_id IS NOT NULL), '[]') AS targets
       FROM alerts a LEFT JOIN alert_targets t ON t.alert_id=a.id GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100`)).rows
  return { alerts: rows }
}
export async function createAlert(ctx) {
  const v = new Validator(ctx.body)
  v.oneOf('type', ['cancellation', 'diversion', 'stop_change', 'road_closure', 'schedule_change'])
  v.str('title', { required: true, max: 160 }); v.str('body', { max: 2000 })
  v.timestamp('startsAt'); v.timestamp('endsAt')
  v.str('source', { required: true, min: 3, max: 300 }); v.oneOf('verificationStatus', ['verified', 'unverified'])
  const routeIds = v.array('routeIds', { max: 50 }); const stopIds = v.array('stopIds', { max: 50 })
  const b = v.done()
  const rids = [...new Set(routeIds.map(Number))], sids = [...new Set(stopIds.map(Number))]
  if ([...rids, ...sids].some(n => !Number.isInteger(n) || n < 1)) throw new ApiError(400, 'Validation failed', { routeIds: 'Invalid id' })
  if (!rids.length && !sids.length) throw new ApiError(400, 'Validation failed', { routeIds: 'Choose at least one affected route or stop' })
  const starts = b.startsAt || new Date().toISOString()
  if (b.endsAt && Date.parse(b.endsAt) <= Date.parse(starts)) throw new ApiError(400, 'Validation failed', { endsAt: 'Must be after the start time' })
  const id = await tx(async db => {
    const chk = await db.query('SELECT (SELECT count(*) FROM routes WHERE id=ANY($1))::int AS r, (SELECT count(*) FROM stops WHERE id=ANY($2))::int AS s', [rids, sids])
    if (chk.rows[0].r !== rids.length || chk.rows[0].s !== sids.length) throw new ApiError(400, 'Validation failed', { routeIds: 'Unknown route or stop' })
    const id = (await db.query(
      `INSERT INTO alerts(type, title, body, starts_at, ends_at, verification_status, source_text, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [b.type, b.title, b.body, starts, b.endsAt, b.verificationStatus, b.source, ctx.user.id])).rows[0].id
    for (const r of rids) await db.query('INSERT INTO alert_targets(alert_id, route_id) VALUES ($1,$2)', [id, r])
    for (const s of sids) await db.query('INSERT INTO alert_targets(alert_id, stop_id) VALUES ($1,$2)', [id, s])
    await audit(ctx.user, ctx.req, 'publish', 'alert', id, null, { ...b, routeIds: rids, stopIds: sids })
    return id
  })
  return { id }
}
export async function archiveAlert(ctx) {
  const id = ID(ctx.params.id)
  const r = await query(`UPDATE alerts SET status='archived' WHERE id=$1 RETURNING id`, [id])
  if (!r.rows.length) throw new ApiError(404, 'Alert not found')
  await audit(ctx.user, ctx.req, 'archive', 'alert', id, { status: 'published' }, { status: 'archived' })
  return { id }
}

// ───────── Submissions ─────────
export async function listSubmissions() {
  const rows = (await query(
    `SELECT s.id, s.payload, s.status, s.review_note AS "reviewNote", s.created_at AS "createdAt", s.created_route_id AS "createdRouteId",
            o.name_en AS origin, d.name_en AS destination
       FROM submissions s LEFT JOIN stops o ON o.id = (s.payload->>'originStopId')::int LEFT JOIN stops d ON d.id = (s.payload->>'destinationStopId')::int
      ORDER BY (s.status='pending') DESC, s.created_at DESC LIMIT 100`)).rows
  return { submissions: rows }
}
export async function reviewSubmission(ctx) {
  const id = ID(ctx.params.id)
  const v = new Validator(ctx.body); v.oneOf('decision', ['approve', 'reject']); v.str('note', { max: 500 })
  const b = v.done()
  return tx(async db => {
    const s = (await db.query(`SELECT * FROM submissions WHERE id=$1 FOR UPDATE`, [id])).rows[0]
    if (!s) throw new ApiError(404, 'Submission not found')
    if (s.status !== 'pending') throw new ApiError(409, 'Already reviewed')
    let createdRouteId = null
    if (b.decision === 'approve') {
      const p = s.payload
      const op = (await db.query('SELECT id FROM operators WHERE type=$1 AND is_active ORDER BY id LIMIT 1', [p.operatorType])).rows[0]
      if (!op) throw new ApiError(400, `No active ${p.operatorType} operator exists. Add one first.`)
      let src = (await db.query(`SELECT id FROM data_sources WHERE lower(name)='user submissions'`)).rows[0]
      if (!src) src = (await db.query(`INSERT INTO data_sources(name,type,notes) VALUES ('User submissions','user_submission','Reported by passengers; needs verification') RETURNING id`)).rows[0]
      const notes = [`Submitted route. Source note: ${p.sourceNote}`, p.intermediateStops && `Stops: ${p.intermediateStops}`, p.timings && `Timings: ${p.timings}`, p.fare && `Fare: ${p.fare}`].filter(Boolean).join('\n').slice(0, 1000)
      const data = parseRoutePayload({
        routeNo: p.routeNo, operatorId: op.id, busType: p.operatorType === 'minibus' ? 'mini' : 'ordinary', status: 'unverified',
        sourceId: src.id, notes, isActive: false,
        stops: [{ stopId: p.originStopId, offsetMin: 0 }, { stopId: p.destinationStopId, offsetMin: null }], trips: [], fares: [],
      })
      createdRouteId = await saveRoute(db, null, data, ctx.user)   // inactive draft: admin completes & verifies it
    }
    await db.query(`UPDATE submissions SET status=$2, reviewer_id=$3, review_note=$4, created_route_id=$5, reviewed_at=now() WHERE id=$1`,
      [id, b.decision === 'approve' ? 'approved' : 'rejected', ctx.user.id, b.note, createdRouteId])
    await audit(ctx.user, ctx.req, b.decision, 'submission', id, { status: 'pending' }, { createdRouteId, note: b.note })
    return { id, createdRouteId }
  })
}

// ───────── CSV import / export ─────────
export async function importRoutes(ctx) {
  const text = ctx.body?._raw ?? ctx.body?.csv
  if (typeof text !== 'string' || !text.trim()) throw new ApiError(400, 'Send the CSV as text')
  const dryRun = ctx.query.dryRun !== 'false'
  const { summary, conflicts } = await importCsv(text, { dryRun, user: ctx.user, fileName: ctx.query.fileName || null })
  const batch = (await query(`INSERT INTO import_batches(file_name, user_id, dry_run, summary, conflicts) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [String(ctx.query.fileName || '').slice(0, 200) || null, ctx.user.id, dryRun, summary, JSON.stringify(dryRun ? conflicts.map(({ data, ...c }) => c) : conflicts)])).rows[0].id
  if (!dryRun) await audit(ctx.user, ctx.req, 'import', 'import_batch', batch, null, summary)
  return { batchId: batch, dryRun, summary, conflicts: conflicts.map(({ data, ...c }) => c) }
}
export async function resolveConflicts(ctx) {
  const id = ID(ctx.params.id)
  const v = new Validator(ctx.body); v.oneOf('action', ['apply', 'dismiss']); const rows = v.array('rows', { max: 500, required: true })
  const b = v.done()
  return tx(async db => {
    const batch = (await db.query('SELECT * FROM import_batches WHERE id=$1 FOR UPDATE', [id])).rows[0]
    if (!batch) throw new ApiError(404, 'Import not found')
    if (batch.dry_run) throw new ApiError(400, 'This was a dry run. Import for real first.')
    const conflicts = batch.conflicts
    let applied = 0
    for (const c of conflicts) {
      if (c.resolved || !rows.map(Number).includes(c.row)) continue
      if (b.action === 'apply') { await applyConflict(db, c, ctx.user); applied++ }
      c.resolved = b.action
    }
    await db.query('UPDATE import_batches SET conflicts=$2 WHERE id=$1', [id, JSON.stringify(conflicts)])
    await audit(ctx.user, ctx.req, `conflict_${b.action}`, 'import_batch', id, null, { rows, applied })
    return { applied }
  })
}
export async function exportRoutes(ctx) {
  const routes = await loadNetwork({ activeOnly: false })
  const rows = routes.filter(r => !r.isSample).map(r => {
    const groups = new Map()
    for (const t of r.trips) { const k = t.days.join(','); (groups.get(k) || groups.set(k, []).get(k)).push(t.depMin) }
    const [days, deps] = [...groups.entries()][0] || ['1,2,3,4,5,6,7', []]
    const hh = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return {
      route_no: r.routeNo, operator: r.operator.name, operator_type: r.operator.type, bus_type: r.busType,
      stops: r.stops.map(s => `${s.name}@${s.offsetMin ?? ''}`).join(';'),
      departures: deps.map(hh).join(';'), days,
      source_name: r.source?.name || '', source_url: r.source?.url || '', verified_date: r.verifiedAt || '',
      status: r.status === 'sample' ? 'unverified' : r.status,
      note: groups.size > 1 ? 'Has several day patterns – only the first is exported' : '',
    }
  })
  const header = ['route_no', 'operator', 'operator_type', 'bus_type', 'stops', 'departures', 'days', 'source_name', 'source_url', 'verified_date', 'status', 'note']
  await audit(ctx.user, ctx.req, 'export', 'routes', null, null, { count: rows.length })
  return { csv: toCsv(header, rows), filename: 'madurai-routes-export.csv' }
}

// ───────── Audit log & feedback ─────────
export async function auditLog(ctx) {
  const limit = Math.min(Number(ctx.query.limit) || 100, 500)
  return { entries: (await query(
    `SELECT id, user_email AS "user", action, entity, entity_id AS "entityId", before, after, created_at AS "at" FROM audit_log ORDER BY id DESC LIMIT $1`, [limit])).rows }
}
export async function feedbackList() {
  return { feedback: (await query('SELECT id, message, contact, page, created_at AS "at" FROM feedback ORDER BY id DESC LIMIT 100')).rows }
}
