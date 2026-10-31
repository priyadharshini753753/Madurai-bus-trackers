// CSV import of routes with source tracking, duplicate detection and conflict flagging.
//
// Columns (header row required, order free):
//   route_no, operator, operator_type, bus_type, stops, departures, days, fare_full, fare_status,
//   source_name, source_url, source_type, verified_date, status
//   stops       = "Periyar Bus Stand@0;Goripalayam@6;Melur@45"  (@minutes optional; names must already exist)
//   departures  = "06:00;06:30" or a range "06:00-21:00/30"
//   days        = "1-7" or "1,2,3"  (1 = Monday … 7 = Sunday)
import { tx } from './db.js'
import { parseCsv } from './csv.js'
import { parseHHMM } from '../shared/time.js'
import { saveRoute, parseRoutePayload, snapshotRoute } from './routeSave.js'
import { ApiError } from './http.js'

const ROLLBACK = Symbol('rollback')
const lc = s => String(s || '').trim().toLowerCase()

function parseDepartures(s) {
  const out = []
  for (const part of String(s || '').split(/[;|]/).map(x => x.trim()).filter(Boolean)) {
    const range = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\/(\d{1,3})$/.exec(part)
    if (range) {
      const a = parseHHMM(range[1]), b = parseHHMM(range[2]), step = Number(range[3])
      if (a == null || b == null || step < 1 || b < a) throw new Error(`Bad departure range "${part}"`)
      for (let t = a; t <= b; t += step) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    } else {
      if (parseHHMM(part) == null) throw new Error(`Bad departure time "${part}"`)
      out.push(part)
    }
  }
  return out
}
function parseDays(s) {
  if (!s) return [1, 2, 3, 4, 5, 6, 7]
  const days = new Set()
  for (const p of String(s).split(',')) {
    const m = /^(\d)-(\d)$/.exec(p.trim())
    if (m) for (let d = +m[1]; d <= +m[2]; d++) days.add(d)
    else if (/^\d$/.test(p.trim())) days.add(+p.trim())
    else throw new Error(`Bad days "${s}"`)
  }
  return [...days].sort()
}

export async function importCsv(text, { dryRun, user, fileName }) {
  const records = parseCsv(text)
  if (!records.length) throw new ApiError(400, 'The CSV is empty or has no data rows')
  if (records.length > 1000) throw new ApiError(400, 'Too many rows (max 1000 per import)')
  const summary = { rows: records.length, created: 0, duplicates: 0, conflicts: 0, errors: [], warnings: [], operatorsCreated: 0, sourcesCreated: 0 }
  const conflicts = []

  try {
    await tx(async db => {
      const stopMap = new Map()
      for (const s of (await db.query('SELECT id, name_en, name_ta, aliases FROM stops WHERE is_active')).rows) {
        stopMap.set(lc(s.name_en), s.id)
        if (s.name_ta) stopMap.set(lc(s.name_ta), s.id)
      }
      const opMap = new Map((await db.query('SELECT id, name FROM operators')).rows.map(o => [lc(o.name), o.id]))
      const srcMap = new Map((await db.query('SELECT id, name FROM data_sources')).rows.map(o => [lc(o.name), o.id]))
      const keysInFile = new Map()

      for (const rec of records) {
        const row = rec._row
        await db.query('SAVEPOINT r')
        try {
          if (!rec.route_no) throw new Error('route_no is required')
          if (!rec.operator) throw new Error('operator is required')

          // operator
          let opId = opMap.get(lc(rec.operator))
          if (!opId) {
            if (!['govt', 'private', 'minibus'].includes(rec.operator_type)) throw new Error(`Unknown operator "${rec.operator}" – give operator_type (govt/private/minibus) to create it`)
            opId = (await db.query('INSERT INTO operators(name, type) VALUES ($1,$2) RETURNING id', [rec.operator, rec.operator_type])).rows[0].id
            opMap.set(lc(rec.operator), opId); summary.operatorsCreated++
          }
          // source
          let sourceId = null
          if (rec.source_name) {
            sourceId = srcMap.get(lc(rec.source_name))
            if (!sourceId) {
              const type = rec.source_type || 'public_record'
              if (!['official', 'operator', 'public_record', 'field_survey', 'user_submission'].includes(type)) throw new Error(`Bad source_type "${type}"`)
              sourceId = (await db.query('INSERT INTO data_sources(name, type, url) VALUES ($1,$2,$3) RETURNING id', [rec.source_name, type, rec.source_url || null])).rows[0].id
              srcMap.set(lc(rec.source_name), sourceId); summary.sourcesCreated++
            }
          }
          // stops
          const stops = String(rec.stops || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
            const [name, off] = x.split('@')
            const id = stopMap.get(lc(name))
            if (!id) throw new Error(`Unknown stop "${name}" – add it under Stops first`)
            return { stopId: id, offsetMin: off === undefined || off.trim() === '' ? null : Number(off) }
          })
          // status
          let status = rec.status || 'unverified'
          if (!['verified', 'unverified', 'outdated'].includes(status)) throw new Error(`Bad status "${status}"`)
          if (status === 'verified' && (!sourceId || !rec.verified_date)) {
            status = 'unverified'; summary.warnings.push({ row, message: 'Marked verified but source_name/verified_date missing → imported as unverified' })
          }
          const days = parseDays(rec.days)
          const trips = parseDepartures(rec.departures).map(time => ({ time, days }))
          const fares = []
          if (rec.fare_full) {
            const f = stops.length >= 2 ? { fromStopId: stops[0].stopId, toStopId: stops[stops.length - 1].stopId } : null
            if (f) fares.push({ ...f, amount: Number(rec.fare_full), status: rec.fare_status || 'unverified', sourceId, verifiedAt: rec.verified_date || null })
          }
          const data = parseRoutePayload({
            routeNo: rec.route_no, operatorId: opId, busType: rec.bus_type || 'ordinary', status,
            sourceId, verifiedAt: rec.verified_date || null, stops, trips, fares, isActive: true,
          })

          const first = data.stops[0].stopId, last = data.stops.at(-1).stopId
          const key = `${lc(data.routeNo)}|${opId}|${first}|${last}`
          const sig = [data.stops.map(s => `${s.stopId}@${s.offsetMin ?? ''}`).join(','), data.trips.map(t => `${t.time}|${t.days.join('')}`).sort().join(',')].join('#')

          const existing = (await db.query(
            `SELECT id FROM routes WHERE lower(route_no)=$1 AND operator_id=$2 AND origin_stop_id=$3 AND destination_stop_id=$4`,
            [lc(data.routeNo), opId, first, last])).rows[0]

          if (keysInFile.has(key)) {
            const same = keysInFile.get(key) === sig
            if (same) summary.duplicates++
            else { summary.conflicts++; conflicts.push({ row, routeNo: data.routeNo, reason: 'duplicate_in_file', existingId: null, resolved: false, data }) }
          } else if (existing) {
            const snap = await snapshotRoute(db, existing.id)
            const existingSig = [snap.stops.join(','), [...snap.trips].sort().join(',')].join('#')
            if (existingSig === sig) summary.duplicates++
            else {
              const diff = []
              if (snap.stops.join(',') !== data.stops.map(s => `${s.stopId}@${s.offsetMin ?? ''}`).join(',')) diff.push('stops')
              if ([...snap.trips].sort().join(',') !== data.trips.map(t => `${t.time}|${t.days.join('')}`).sort().join(',')) diff.push('schedule')
              summary.conflicts++
              conflicts.push({ row, routeNo: data.routeNo, reason: 'differs_from_existing', differs: diff, existingId: existing.id, resolved: false, data })
            }
          } else {
            await saveRoute(db, null, data, user)
            summary.created++
          }
          keysInFile.set(key, sig)
          await db.query('RELEASE SAVEPOINT r')
        } catch (e) {
          await db.query('ROLLBACK TO SAVEPOINT r')
          const msg = e instanceof ApiError ? `${e.message}${e.fields ? ': ' + Object.values(e.fields).join('; ') : ''}` : e.message
          summary.errors.push({ row, routeNo: rec.route_no || null, message: msg })
        }
      }
      if (dryRun) throw ROLLBACK
    })
  } catch (e) { if (e !== ROLLBACK) throw e }

  return { summary, conflicts }
}

export async function applyConflict(db, conflict, user) {
  if (!conflict.existingId) throw new ApiError(400, 'In-file duplicates cannot be applied; fix the CSV and re-import')
  await saveRoute(db, conflict.existingId, conflict.data, user)
}
