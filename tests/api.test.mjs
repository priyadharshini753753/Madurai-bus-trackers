// Integration tests. Run with the dev server up:  BASE=http://127.0.0.1:5173 npm test
// Needs the sample seed + the two test users from the README (admin@/editor@example.test).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadEnv } from '../server/env.js'
import { query, closePool } from '../server/db.js'

loadEnv()
const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const H = { 'x-requested-with': 'mbt', 'content-type': 'application/json' }

async function api(method, path, { body, cookie, headers, raw } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method, headers: { ...(method === 'GET' ? {} : H), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, json, text, headers: res.headers }
}
async function signIn(email, password) {
  const r = await api('POST', '/auth/login', { body: { email, password } })
  assert.equal(r.status, 200, r.text)
  return r.headers.get('set-cookie').split(';')[0]
}

let admin, editor, ids = {}
before(async () => {
  await query('DELETE FROM rate_limits')
  await query("UPDATE users SET failed_attempts=0, locked_until=NULL")
  admin = await signIn('admin@example.test', 'Test-Admin-Pass-123')
  editor = await signIn('editor@example.test', 'Test-Editor-Pass-123')
  const stops = (await api('GET', '/stops')).json.stops
  for (const s of stops) ids[s.nameEn] = s.id
  ids.opGovt = (await query(`SELECT id FROM operators WHERE type='govt' LIMIT 1`)).rows[0].id
})
after(async () => {
  await query(`DELETE FROM submissions WHERE payload->>'routeNo' LIKE 'TST%'`)
  await query(`DELETE FROM alerts WHERE title LIKE 'TEST %'`)
  await query(`DELETE FROM verification_records WHERE entity_type='route' AND entity_id IN (SELECT id FROM routes WHERE route_no LIKE 'TST%')`)
  await query(`DELETE FROM verification_records WHERE source_id IN (SELECT id FROM data_sources WHERE name LIKE 'TEST %')`)
  await query(`DELETE FROM routes WHERE route_no LIKE 'TST%'`)
  await query(`DELETE FROM operators WHERE name LIKE 'TEST %'`)
  await query(`DELETE FROM data_sources WHERE name LIKE 'TEST %'`)
  await query(`DELETE FROM feedback WHERE message LIKE 'TEST %'`)
  await query('DELETE FROM rate_limits')
  await closePool()
})

test('health + meta', async () => {
  assert.equal((await api('GET', '/health')).json.ok, true)
  const m = (await api('GET', '/meta')).json
  assert.ok(m.counts.sample >= 6)
})

test('direct search + schedule-based ETA estimate', async () => {
  const r = (await api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Mattuthavani']}&date=2026-10-29&time=08:00`)).json
  const leg = r.direct.find(l => l.routeNo === '1A')
  assert.ok(leg, 'route 1A found')
  assert.equal(leg.durationMin, 20)
  assert.equal(leg.upcoming[0].boardMin, 480)              // 08:00 sample departure
  assert.equal(leg.upcoming[0].alightMin, 500)             // +20 min estimate
  assert.deepEqual(leg.intermediateStops, ['Tallakulam', 'Goripalayam', 'Anna Nagar', 'Thirunagar'])
  assert.equal(leg.estimateBasis, 'estimate-from-schedule')
  assert.equal(leg.fare.status, 'sample')                  // sample fare is labelled
  assert.match(r.note, /No live bus location/)
})

test('fare missing → null (UI shows "Fare not verified")', async () => {
  const r = (await api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Melur']}&date=2026-10-29&time=08:00`)).json
  assert.equal(r.direct[0].routeNo, '5C'); assert.equal(r.direct[0].fare, null)
})

test('transfer journey (KK Nagar → Melur via Mattuthavani)', async () => {
  const r = (await api('GET', `/search?from=${ids['KK Nagar']}&to=${ids['Melur']}&date=2026-10-29&time=08:00`)).json
  assert.equal(r.direct.length, 0)
  const t = r.transfers[0]
  assert.equal(t.transferStop, 'Mattuthavani'); assert.equal(t.transfers, 1)
  assert.ok(t.waitMin >= 5); assert.equal(t.legs.length, 2)
})

test('government / private / mini-bus filters', async () => {
  const q = type => api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Thirumangalam']}&date=2026-10-29&time=08:00&type=${type}`)
  assert.equal((await q('private')).json.direct[0].operator.type, 'private')
  assert.equal((await q('govt')).json.direct.length, 0)
  const mini = (await api('GET', `/search?from=${ids['Alanganallur']}&to=${ids['Mattuthavani']}&date=2026-10-29&time=08:00&type=minibus`)).json
  assert.equal(mini.direct[0].routeNo, 'MB3')
  assert.equal((await api('GET', '/routes?type=bogus')).status, 400)
})

test('operating days respected (mini-bus not on Sunday 2026-11-01)', async () => {
  const r = (await api('GET', `/search?from=${ids['Alanganallur']}&to=${ids['Mattuthavani']}&date=2026-11-01&time=00:00`)).json
  assert.equal(r.direct[0].timingAvailable, false)
  assert.equal(r.direct[0].upcoming.length, 0)
})

test('no route / bad input', async () => {
  const r = (await api('GET', `/search?from=${ids['Melur']}&to=${ids['Periyar Bus Stand']}&date=2026-10-29&time=08:00`)).json
  assert.equal(r.direct.length, 0)
  assert.equal((await api('GET', `/search?from=1&to=1`)).status, 400)
  assert.equal((await api('GET', `/search?from=abc&to=2`)).status, 400)
  assert.equal((await api('GET', `/search?from=1&to=2&date=31-12-2026`)).status, 400)
  assert.equal((await api('GET', `/search?from=1&to=999999`)).status, 404)
})

test('auth: admin endpoints need a session; wrong password rejected', async () => {
  assert.equal((await api('GET', '/admin/overview')).status, 401)
  assert.equal((await api('POST', '/admin/routes', { body: {} })).status, 401)
  const bad = await api('POST', '/auth/login', { body: { email: 'admin@example.test', password: 'wrong-password-xx' } })
  assert.equal(bad.status, 401)
  const ok = await api('POST', '/auth/login', { body: { email: 'admin@example.test', password: 'Test-Admin-Pass-123' } })
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/); assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/)
  assert.equal((await api('GET', '/auth/me', { cookie: admin })).json.user.role, 'admin')
  assert.equal((await api('GET', '/auth/me', { cookie: 'mbt_session=forged.value' })).json.user, null)
})

test('auth: CSRF header required on writes', async () => {
  const r = await fetch(BASE + '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'TEST no header' }) })
  assert.equal(r.status, 403)
})

test('authorization is enforced on the server: editor cannot use admin-only endpoints', async () => {
  assert.equal((await api('GET', '/admin/overview', { cookie: editor })).status, 200)
  assert.equal((await api('GET', '/admin/audit', { cookie: editor })).status, 403)
  assert.equal((await api('GET', '/admin/alerts', { cookie: editor })).status, 403)
  assert.equal((await api('POST', '/admin/alerts', { cookie: editor, body: {} })).status, 403)
  assert.equal((await api('POST', '/admin/operators', { cookie: editor, body: { name: 'TEST Op', type: 'private' } })).status, 403)
  assert.equal((await api('GET', '/admin/audit', { cookie: admin })).status, 200)
})

test('route validation rejects bad input with field errors', async () => {
  const good = { routeNo: 'TST-1', operatorId: ids.opGovt, stops: [{ stopId: ids['Periyar Bus Stand'], offsetMin: 0 }, { stopId: ids['Melur'], offsetMin: 30 }], trips: [] }
  const bad = async patch => api('POST', '/admin/routes', { cookie: admin, body: { ...good, ...patch } })
  assert.equal((await bad({ routeNo: '' })).status, 400)
  assert.equal((await bad({ stops: [good.stops[0]] })).status, 400)
  assert.equal((await bad({ stops: [{ stopId: 1, offsetMin: 10 }, { stopId: 2, offsetMin: 5 }] })).status, 400)    // decreasing minutes
  assert.equal((await bad({ trips: [{ time: '25:99', days: [1] }] })).status, 400)
  assert.equal((await bad({ trips: [{ time: '08:00', days: [9] }] })).status, 400)
  assert.equal((await bad({ status: 'verified' })).status, 400)                                                      // needs source+date
  assert.equal((await bad({ status: 'sample' })).status, 400)
  assert.equal((await bad({ operatorId: 99999 })).status, 400)
  const r = await bad({ routeNo: 'x'.repeat(40) }); assert.ok(r.json.fields.routeNo)
})

test('route create / edit / duplicate / deactivate + audit log', async () => {
  const body = { routeNo: 'TST-2', operatorId: ids.opGovt, status: 'unverified',
    stops: [{ stopId: ids['Periyar Bus Stand'], offsetMin: 0 }, { stopId: ids['Anna Nagar'], offsetMin: 12 }, { stopId: ids['Melur'], offsetMin: 40 }],
    trips: [{ time: '07:00', days: [1, 2, 3, 4, 5] }, { time: '17:30', days: [1, 2, 3, 4, 5] }],
    fares: [{ fromStopId: ids['Periyar Bus Stand'], toStopId: ids['Melur'], amount: 25, status: 'unverified' }] }
  const c = await api('POST', '/admin/routes', { cookie: editor, body }); assert.equal(c.status, 200, c.text)
  const id = c.json.id
  assert.equal((await api('POST', '/admin/routes', { cookie: editor, body })).status, 409)                          // duplicate
  const s = (await api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Melur']}&date=2026-10-29&time=06:00`)).json
  const leg = s.direct.find(l => l.routeNo === 'TST-2')
  assert.equal(leg.fare.amount, 25); assert.equal(leg.fare.status, 'unverified'); assert.equal(leg.durationMin, 40)
  const up = await api('PUT', `/admin/routes/${id}`, { cookie: editor, body: { ...body, status: 'verified', sourceId: 1, verifiedAt: '2026-10-29' } })
  assert.equal(up.status, 200, up.text)
  const detail = (await api('GET', `/admin/routes/${id}`, { cookie: admin })).json
  assert.equal(detail.route.status, 'verified'); assert.ok(detail.history.length >= 2)
  assert.equal((await api('POST', `/admin/routes/${id}/deactivate`, { cookie: editor })).status, 403)             // admin only
  assert.equal((await api('POST', `/admin/routes/${id}/deactivate`, { cookie: admin })).status, 200)
  const s2 = (await api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Melur']}&date=2026-10-29&time=06:00`)).json
  assert.ok(!s2.direct.find(l => l.routeNo === 'TST-2'), 'inactive route hidden from passengers')
  const log = (await api('GET', '/admin/audit?limit=50', { cookie: admin })).json.entries
  assert.ok(log.some(e => e.entity === 'route' && e.action === 'create' && e.user === 'editor@example.test'))
  assert.ok(log.some(e => e.action === 'deactivate'))
})

test('missing schedule / durations handled gracefully', async () => {
  const body = { routeNo: 'TST-3', operatorId: ids.opGovt, stops: [{ stopId: ids['Tallakulam'], offsetMin: 0 }, { stopId: ids['Arapalayam'], offsetMin: null }], trips: [] }
  assert.equal((await api('POST', '/admin/routes', { cookie: admin, body })).status, 200)
  const leg = (await api('GET', `/search?from=${ids['Tallakulam']}&to=${ids['Arapalayam']}&date=2026-10-29&time=08:00`)).json.direct.find(l => l.routeNo === 'TST-3')
  assert.equal(leg.timingAvailable, false); assert.equal(leg.durationMin, null); assert.equal(leg.scheduleAvailable, false)
  const ov = (await api('GET', '/admin/overview', { cookie: admin })).json
  assert.ok(ov.issues.some(i => i.routeNo === 'TST-3' && i.code === 'no_schedule'))
  assert.ok(ov.issues.some(i => i.routeNo === 'TST-3' && i.code === 'no_durations'))
})

test('service alerts: publish, show on route, expire, archive', async () => {
  const route1A = (await api('GET', '/routes')).json.routes.find(r => r.routeNo === '1A')
  const mk = (extra = {}) => api('POST', '/admin/alerts', { cookie: admin, body: { type: 'diversion', title: 'TEST diversion', source: 'Test notice', verificationStatus: 'unverified', routeIds: [route1A.id], ...extra } })
  assert.equal((await mk({ type: 'bogus' })).status, 400)
  assert.equal((await mk({ routeIds: [] })).status, 400)
  assert.equal((await mk({ startsAt: '2026-10-29T10:00:00Z', endsAt: '2026-10-29T09:00:00Z' })).status, 400)
  const live = await mk({ endsAt: new Date(Date.now() + 3600e3).toISOString() }); assert.equal(live.status, 200, live.text)
  const old = await mk({ title: 'TEST old closure', type: 'road_closure', startsAt: new Date(Date.now() - 2 * 864e5).toISOString(), endsAt: new Date(Date.now() - 864e5).toISOString() })
  const s = (await api('GET', `/search?from=${ids['Periyar Bus Stand']}&to=${ids['Mattuthavani']}&date=2026-10-29&time=08:00`)).json
  assert.ok(s.direct.find(l => l.routeNo === '1A').alerts.some(a => a.title === 'TEST diversion'))
  const active = (await api('GET', '/alerts')).json.alerts
  assert.ok(!active.some(a => a.title === 'TEST old closure'), 'expired not active')
  const all = (await api('GET', '/alerts?include=expired')).json.alerts
  assert.equal(all.find(a => a.title === 'TEST old closure').state, 'expired')
  await api('POST', `/admin/alerts/${live.json.id}/archive`, { cookie: admin })
  assert.ok(!(await api('GET', '/alerts')).json.alerts.some(a => a.title === 'TEST diversion'))
})

test('CSV import: dry run, create, duplicate, conflict, resolve; export', async () => {
  const csv = (dep = '06:00-08:00/60') => [
    'route_no,operator,operator_type,bus_type,stops,departures,days,fare_full,source_name,source_url,source_type,verified_date,status',
    `TST-C1,TEST Import Operator,private,ordinary,Periyar Bus Stand@0;Goripalayam@8;Melur@50,${dep},1-6,30,TEST Import Source,https://example.test,operator,2026-10-01,verified`,
    `TST-C2,TEST Import Operator,private,ordinary,Periyar Bus Stand@0;Nowhere Town@8,06:00,1-7,,,,,,unverified`,
    `TST-C3,TEST Import Operator,private,ordinary,Tallakulam@0;Melur@20,07:00,1-7,,,,,,verified`,
  ].join('\n')
  const post = (text, dry) => api('POST', `/admin/import?dryRun=${dry}&fileName=test.csv`, { cookie: admin, body: text, raw: true, headers: { 'content-type': 'text/csv' } })
  const dry = (await post(csv(), true)).json
  assert.equal(dry.summary.created, 2); assert.equal(dry.summary.errors.length, 1)
  assert.match(dry.summary.errors[0].message, /Unknown stop/)
  assert.equal((await query(`SELECT count(*)::int n FROM routes WHERE route_no LIKE 'TST-C%'`)).rows[0].n, 0, 'dry run writes nothing')
  assert.ok(dry.summary.warnings.some(w => /unverified/.test(w.message)))      // C3 verified w/o source downgraded
  const real = (await post(csv(), false)).json; assert.equal(real.summary.created, 2)
  const again = (await post(csv(), false)).json; assert.equal(again.summary.duplicates, 2); assert.equal(again.summary.created, 0)
  const conf = (await post(csv('06:00-09:00/60'), false)).json
  assert.equal(conf.summary.conflicts, 1); assert.deepEqual(conf.conflicts[0].differs, ['schedule'])
  const c1 = (await query(`SELECT count(*)::int n FROM schedules s JOIN routes r ON r.id=s.route_id WHERE r.route_no='TST-C1'`)).rows[0].n
  assert.equal(c1, 3, 'conflict not applied automatically')
  assert.equal((await api('POST', `/admin/import/${conf.batchId}/resolve`, { cookie: editor, body: { action: 'apply', rows: [2] } })).status, 403)
  assert.equal((await api('POST', `/admin/import/${conf.batchId}/resolve`, { cookie: admin, body: { action: 'apply', rows: [2] } })).json.applied, 1)
  assert.equal((await query(`SELECT count(*)::int n FROM schedules s JOIN routes r ON r.id=s.route_id WHERE r.route_no='TST-C1'`)).rows[0].n, 4)
  const exp = await api('GET', '/admin/export', { cookie: admin })
  assert.match(exp.text, /TST-C1/); assert.match(exp.headers.get('content-type'), /text\/csv/)
  assert.equal((await post('', false)).status, 400)
})

test('public submission → review → inactive draft route', async () => {
  const body = { routeNo: 'TST-S1', operatorType: 'private', originStopId: ids['Tallakulam'], destinationStopId: ids['Thirumangalam'], sourceNote: 'TEST seen on bus board' }
  assert.equal((await api('POST', '/submissions', { body: { ...body, originStopId: 'x' } })).status, 400)
  const sub = await api('POST', '/submissions', { body }); assert.equal(sub.status, 200, sub.text)
  assert.equal((await api('GET', '/admin/submissions')).status, 401)
  const rev = await api('POST', `/admin/submissions/${sub.json.id}/review`, { cookie: editor, body: { decision: 'approve' } })
  assert.equal(rev.status, 200, rev.text)
  const r = (await query('SELECT is_active, status FROM routes WHERE id=$1', [rev.json.createdRouteId])).rows[0]
  assert.deepEqual(r, { is_active: false, status: 'unverified' })
  assert.equal((await api('POST', `/admin/submissions/${sub.json.id}/review`, { cookie: editor, body: { decision: 'approve' } })).status, 409)
})

test('feedback validation', async () => {
  assert.equal((await api('POST', '/feedback', { body: { message: 'x' } })).status, 400)
  assert.equal((await api('POST', '/feedback', { body: { message: 'TEST feedback works' } })).status, 200)
})

test('SQL injection attempt is treated as data', async () => {
  const r = await api('GET', `/search?from=1;DROP TABLE routes&to=2`)
  assert.equal(r.status, 400)
  assert.ok((await api('GET', '/routes')).json.routes.length >= 6)
})

test('rate limiting on public POST endpoints', async () => {
  let last
  for (let i = 0; i < 12; i++) last = await api('POST', '/feedback', { body: { message: 'TEST rate limit ' + i } })
  assert.equal(last.status, 429)
})

test('account lockout after repeated wrong passwords', async () => {
  await query('DELETE FROM rate_limits')
  let r
  for (let i = 0; i < 5; i++) r = await api('POST', '/auth/login', { body: { email: 'editor@example.test', password: 'wrong-password-' + i } })
  assert.equal(r.status, 401)
  const locked = await api('POST', '/auth/login', { body: { email: 'editor@example.test', password: 'Test-Editor-Pass-123' } })
  assert.equal(locked.status, 429)
  await query("UPDATE users SET failed_attempts=0, locked_until=NULL")
})
