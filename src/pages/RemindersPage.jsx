import { useEffect, useState } from 'react'
import { cachedGet } from '../lib/api'
import { listSaved, loadRouteDetail } from '../lib/saved'
import { listReminders, saveReminder, deleteReminder, reminderTimes } from '../lib/reminders'
import { notificationPermission, askNotificationPermission, notify } from '../lib/notify'
import { lastBusAt } from '../../shared/planner.js'
import { nowIST, fmtMinutes } from '../lib/format'
import { Notice, Loading, Empty } from '../components/ui'

export default function RemindersPage({ query }) {
  const [routes, setRoutes] = useState(null)
  const [routeId, setRouteId] = useState(query.route ? Number(query.route) : null)
  const [detail, setDetail] = useState(null)
  const [stopId, setStopId] = useState(query.stop ? Number(query.stop) : null)
  const [lead, setLead] = useState(30)
  const [reminders, setReminders] = useState([])
  const [perm, setPerm] = useState(notificationPermission())
  const [msg, setMsg] = useState(null)

  const reload = async () => setReminders(await listReminders())
  useEffect(() => {
    (async () => {
      try { setRoutes((await cachedGet('/routes')).data.routes) }
      catch { setRoutes((await listSaved()).map(s => ({ id: s.route.id, routeNo: s.route.routeNo, origin: s.route.stops[0]?.name, destination: s.route.stops.at(-1)?.name }))) }
      reload()
    })()
    window.addEventListener('mbt:reminders-changed', reload)
    return () => window.removeEventListener('mbt:reminders-changed', reload)
  }, [])
  useEffect(() => {
    setDetail(null)
    if (routeId) loadRouteDetail(routeId).then(d => { setDetail(d); setStopId(s => d.route.stops.some(x => x.stopId === s) ? s : d.route.stops[0].stopId) }).catch(e => setMsg({ kind: 'bad', text: e.message }))
  }, [routeId])

  if (!routes) return <Loading />
  const today = nowIST()
  const preview = detail && stopId ? lastBusAt(detail.route, stopId, today.dateStr) : undefined

  async function add() {
    const stopName = detail.route.stops.find(s => s.stopId === stopId).name
    await saveReminder({ id: crypto.randomUUID(), routeId, stopId, stopName, leadMin: lead, enabled: true, createdAt: new Date().toISOString(),
      route: { id: detail.route.id, routeNo: detail.route.routeNo, status: detail.route.status, stops: detail.route.stops, trips: detail.route.trips } })
    setMsg({ kind: 'ok', text: 'Reminder saved on this device.' })
  }
  async function enable() { setPerm(await askNotificationPermission()) }

  return (
    <div className="page">
      <h1>Last-bus reminders · கடைசி பஸ்</h1>
      <Notice>Reminders use the <strong>scheduled</strong> timetable. They cannot tell you whether a bus is actually running. Notifications are shown only while this app is open or installed and your browser allows it.</Notice>

      <section className="card">
        <div className="card-title">Notifications</div>
        {perm === 'unsupported' && <p className="small">This browser cannot show notifications. Reminders will appear inside the app while it is open.</p>}
        {perm === 'default' && <><p className="small">Allow notifications so a reminder can pop up before the last bus. You can still see in-app alerts without it.</p><button className="btn" onClick={enable}>Allow notifications</button></>}
        {perm === 'granted' && <><p className="small ok">Notifications are allowed.</p><button className="btn" onClick={() => notify('Test reminder', 'This is how a last-bus reminder will look.')}>Send test</button></>}
        {perm === 'denied' && <p className="small bad">Notifications are blocked. Change this in your browser's site settings. In-app alerts still work while the app is open.</p>}
      </section>

      <section className="card">
        <div className="card-title">New reminder</div>
        <div className="field"><label htmlFor="r">Route</label>
          <select id="r" value={routeId ?? ''} onChange={e => setRouteId(Number(e.target.value) || null)}>
            <option value="">Choose a route</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.routeNo} · {r.origin} → {r.destination}</option>)}
          </select></div>
        {detail && <>
          <div className="row2">
            <div className="field"><label htmlFor="s">Boarding stop</label>
              <select id="s" value={stopId ?? ''} onChange={e => setStopId(Number(e.target.value))}>
                {detail.route.stops.slice(0, -1).map(s => <option key={s.stopId} value={s.stopId}>{s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="l">Remind me</label>
              <select id="l" value={lead} onChange={e => setLead(Number(e.target.value))}>
                {[10, 15, 30, 45, 60, 90].map(m => <option key={m} value={m}>{m} min before</option>)}</select></div>
          </div>
          {preview == null
            ? <Notice kind="bad">No scheduled bus from this stop today, or the timing is unavailable. A reminder cannot be calculated.</Notice>
            : <p>Last scheduled bus today: <strong>{fmtMinutes(preview)}</strong> → reminder at <strong>{fmtMinutes(preview - lead)}</strong></p>}
          {detail.route.status !== 'verified' && <Notice>This route's timings are <strong>{detail.route.status === 'sample' ? 'sample data' : 'not verified'}</strong>. Do not rely on this reminder.</Notice>}
          <button className="btn primary" disabled={preview == null} onClick={add}>Save reminder</button>
        </>}
        {msg && <div className={`field-hint ${msg.kind}`} role="status">{msg.text}</div>}
      </section>

      <h2 className="section">Your reminders</h2>
      {reminders.length === 0 ? <Empty icon="⏰">No reminders yet.</Empty> : reminders.map(r => {
        const t = reminderTimes(r, today)
        return (
          <article key={r.id} className="card">
            <strong>Route {r.route.routeNo} from {r.stopName}</strong>
            <p className="small">{t ? <>Last scheduled bus today {fmtMinutes(t.lastMin)} · reminder {fmtMinutes(t.notifyAt)} ({r.leadMin} min before)</> : <span className="muted">No scheduled bus today</span>}</p>
            {r.route.status !== 'verified' && <p className="small warn">Timing not verified.</p>}
            <div className="actions">
              <button className="btn" aria-pressed={r.enabled} onClick={() => saveReminder({ ...r, enabled: !r.enabled })}>{r.enabled ? 'On' : 'Off'}</button>
              <button className="btn danger" onClick={() => deleteReminder(r.id)}>Delete</button>
            </div>
          </article>)
      })}
    </div>
  )
}
