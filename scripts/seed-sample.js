// Seeds SAMPLE data for development/testing. Every record is flagged is_sample = true
// and status = 'sample'. These are NOT real timetables. Do not run in production
// unless you want the demo data (the app labels it clearly everywhere).
//   npm run db:seed-sample            add sample data if missing
//   npm run db:seed-sample -- --reset remove previous sample routes first
import { loadEnv } from '../server/env.js'
import { tx, closePool } from '../server/db.js'

loadEnv()
const reset = process.argv.includes('--reset')

const STOPS = [
  ['Periyar Bus Stand', 'பெரியார் பேருந்து நிலையம்', ['periyar', 'madurai', 'மதுரை'], 9.9195, 78.1192],
  ['Mattuthavani', 'மாட்டுத்தாவணி', ['mattuthavani', 'madurai', 'மதுரை'], 9.9312, 78.1394],
  ['Anna Nagar', 'அண்ணா நகர்', ['annanagar'], 9.9401, 78.1256],
  ['Goripalayam', 'கோரிப்பாளையம்', ['goripalayam'], 9.9103, 78.1297],
  ['Arapalayam', 'ஆரப்பாளையம்', [], 9.9509, 78.1511],
  ['Tallakulam', 'தல்லாகுளம்', ['thallakulam'], 9.9274, 78.1108],
  ['KK Nagar', 'கே.கே. நகர்', ['kknagar'], 9.9608, 78.1342],
  ['Melur', 'மேலூர்', ['meloor'], 10.0452, 78.3401],
  ['Bypass Road', 'புறவழிச்சாலை', ['bypass'], 9.9721, 78.1688],
  ['Thirunagar', 'திருநகர்', ['tirunagar'], 9.9183, 78.1451],
  ['Thirumangalam', 'திருமங்கலம்', ['tirumangalam'], 9.8225, 77.9887],
  ['Alanganallur', 'அலங்காநல்லூர்', ['alanganalur'], 10.0227, 78.0775],
]
// [no, operatorKey, busType, color, [stopName, offsetMin][], firstDep, lastDep, everyMin, days]
const ALL = [1, 2, 3, 4, 5, 6, 7]
const ROUTES = [
  ['1A', 'govt', 'ordinary', '#1D9E75', [['Periyar Bus Stand', 0], ['Tallakulam', 4], ['Goripalayam', 7], ['Anna Nagar', 11], ['Thirunagar', 15], ['Mattuthavani', 20]], '06:00', '21:00', 15, ALL],
  ['5C', 'govt', 'express', '#3B8BD4', [['Periyar Bus Stand', 0], ['Goripalayam', 6], ['Bypass Road', 14], ['Arapalayam', 20], ['Melur', 45]], '06:00', '21:00', 30, ALL],
  ['7', 'govt', 'ordinary', '#D85A30', [['KK Nagar', 0], ['Anna Nagar', 8], ['Mattuthavani', 15]], '06:10', '21:40', 20, ALL],
  ['44', 'govt', 'ordinary', '#BA7517', [['Mattuthavani', 0], ['Bypass Road', 12], ['Melur', 35]], '06:15', '20:30', 45, ALL],
  ['P12', 'private', 'ordinary', '#8E6BD6', [['Periyar Bus Stand', 0], ['Thirunagar', 12], ['Thirumangalam', 40]], '06:30', '20:30', 30, ALL],
  ['MB3', 'minibus', 'mini', '#C2559A', [['Alanganallur', 0], ['Mattuthavani', 25]], '06:30', '19:30', 60, [1, 2, 3, 4, 5, 6]],
]
const OPERATORS = {
  govt: ['TNSTC Madurai', 'govt', 'Tamil Nadu State Transport Corporation'],
  private: ['Sample Private Operator', 'private', null],
  minibus: ['Sample Mini-bus Operator', 'minibus', null],
}

function hhmm(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

await tx(async db => {
  if (reset) {
    await db.query('DELETE FROM routes WHERE is_sample')
    await db.query('DELETE FROM stops WHERE is_sample AND id NOT IN (SELECT stop_id FROM route_stops)')
    await db.query('DELETE FROM operators WHERE is_sample AND id NOT IN (SELECT operator_id FROM routes)')
  }
  const src = await db.query(
    `INSERT INTO data_sources(name, type, notes) VALUES ('Sample data (not real)', 'sample',
       'Placeholder records for development and testing. Not verified against any operator.')
     ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`)
  const sourceId = src.rows[0].id

  const stopId = {}
  for (const [en, ta, aliases, lat, lng] of STOPS) {
    const r = await db.query(
      `INSERT INTO stops(name_en, name_ta, aliases, lat, lng, is_sample) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (lower(name_en)) DO UPDATE SET name_ta = COALESCE(stops.name_ta, EXCLUDED.name_ta), aliases = EXCLUDED.aliases RETURNING id`,
      [en, ta, aliases, lat, lng])
    stopId[en] = r.rows[0].id
  }
  const opId = {}
  for (const [k, [name, type, authority]] of Object.entries(OPERATORS)) {
    const r = await db.query(
      `INSERT INTO operators(name, type, authority, is_sample) VALUES ($1,$2,$3,true)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name, type, authority])
    opId[k] = r.rows[0].id
  }

  let created = 0
  for (const [no, opKey, busType, color, stops, first, last, every, days] of ROUTES) {
    const o = stopId[stops[0][0]], d = stopId[stops[stops.length - 1][0]]
    const r = await db.query(
      `INSERT INTO routes(route_no, operator_id, bus_type, origin_stop_id, destination_stop_id, color, status, source_id, is_sample)
       VALUES ($1,$2,$3,$4,$5,$6,'sample',$7,true) ON CONFLICT DO NOTHING RETURNING id`,
      [no, opId[opKey], busType, o, d, color, sourceId])
    if (!r.rows.length) continue
    created++
    const rid = r.rows[0].id
    for (let i = 0; i < stops.length; i++)
      await db.query('INSERT INTO route_stops(route_id, seq, stop_id, offset_min) VALUES ($1,$2,$3,$4)', [rid, i, stopId[stops[i][0]], stops[i][1]])
    for (let t = toMin(first); t <= toMin(last); t += every)
      await db.query('INSERT INTO schedules(route_id, departure_time, days) VALUES ($1,$2,$3)', [rid, hhmm(t), days])
    if (no === '1A')   // one labelled sample fare so the fare UI can be exercised
      await db.query(`INSERT INTO fares(route_id, from_stop_id, to_stop_id, amount, status, source_id)
                      VALUES ($1,$2,$3,10,'sample',$4)`, [rid, stopId['Periyar Bus Stand'], stopId['Mattuthavani'], sourceId])
  }
  console.log(`Sample seed done. ${created} new sample routes.`)
})
await closePool()
