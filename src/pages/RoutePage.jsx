import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getSaved, saveRoute, removeSaved, isSaved } from '../lib/saved'
import { useLoad } from '../hooks/useLoad'
import { fmtMinutes, fmtDate, fmtDay, nowIST } from '../lib/format'
import { tripsOn } from '../../shared/planner.js'
import { stopOffset } from '../../shared/eta.js'
import { Loading, ErrorBox, Notice } from '../components/ui'
import { StatusBadge, OperatorBadge, RouteNo } from '../components/Badges'
import { AlertList } from '../components/LegCard'
import { href } from '../hooks/useHashRoute'

const BusMap = lazy(() => import('../components/BusMap'))

async function loadRoute(id) {
  try { return { ...(await api.get('/routes/' + id)), offline: false } }
  catch (e) {
    if (e.status === 0) {
      const s = await getSaved(id)
      if (s) return { ...s, offline: true }
    }
    throw e
  }
}

export default function RoutePage({ id, query }) {
  const { data, error, loading, reload } = useLoad(() => loadRoute(id), [id])
  const [saved, setSaved] = useState(false)
  const [msg, setMsg] = useState(null)
  const [board, setBoard] = useState(null)
  const [date, setDate] = useState(nowIST().dateStr)
  useEffect(() => { isSaved(Number(id)).then(setSaved) }, [id])
  useEffect(() => { if (data) setBoard(data.route.stops.some(s => s.stopId === Number(query.from)) ? Number(query.from) : data.route.stops[0]?.stopId) }, [data]) // eslint-disable-line

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { route, fares, alerts, offline } = data

  async function toggleSave() {
    setMsg(null)
    try {
      if (saved) { await removeSaved(route.id); setSaved(false) }
      else { await saveRoute({ route, fares, alerts, fetchedAt: data.fetchedAt }); setSaved(true); setMsg('Saved for offline use.') }
    } catch (e) { setMsg(e.message) }
  }

  const bi = route.stops.findIndex(s => s.stopId === board)
  const off = stopOffset(route, bi)
  const today = nowIST()
  const deps = off == null ? [] : tripsOn(route, date).map(d => d + off)
  const nextIdx = date === today.dateStr ? deps.findIndex(d => d >= today.minutes) : 0
  const nameOf = sid => route.stops.find(s => s.stopId === sid)?.name
  const positions = route.stops.filter(s => s.lat != null).map(s => [s.lat, s.lng])

  return (
    <div className="page">
      <a className="back" href={href('')}>← Back to search</a>
      {offline && <Notice>You are offline. Showing the copy saved on this device (saved {fmtDate(data.savedAt)}, last refreshed {fmtDate(data.syncedAt)}). Offline schedules may be outdated.</Notice>}
      {data.removedFromServer && <Notice kind="bad">This route is no longer in the system. Confirm before travelling.</Notice>}

      <header className="route-head">
        <RouteNo no={route.routeNo} color={route.color} big />
        <div>
          <h1>{route.stops[0]?.name} → {route.stops.at(-1)?.name}</h1>
          <div className="chips"><OperatorBadge type={route.operator.type} /><StatusBadge status={route.status} verifiedAt={route.verifiedAt} />
            <span className="badge">{route.operator.name}</span><span className="badge">{route.busType}</span></div>
        </div>
      </header>

      {route.status !== 'verified' && <Notice>{route.status === 'sample' ? 'This is sample data for testing. Do not rely on it for travel.' : 'Not verified. Confirm timings at the bus stand before travelling.'}</Notice>}
      <AlertList alerts={alerts} />

      <section className="card">
        <div className="card-title">Departure times · புறப்பாடு நேரம்</div>
        <div className="row2">
          <div className="field"><label htmlFor="b">Boarding stop</label>
            <select id="b" value={board ?? ''} onChange={e => setBoard(Number(e.target.value))}>
              {route.stops.map(s => <option key={s.stopId} value={s.stopId}>{s.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="dd">Date</label><input id="dd" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>
        {off == null ? <p className="muted">Timing unavailable for this stop (no travel time recorded).</p>
          : deps.length === 0 ? <p className="muted">Timing unavailable: no scheduled trips on this date.</p>
          : <>
            <p className="small muted">{deps.length} scheduled trips · first {fmtMinutes(deps[0])} · last {fmtMinutes(deps.at(-1))} <span>(scheduled times, not live)</span></p>
            <div className="times wrap">{deps.map((d, i) => <span key={i} className={`time ${i === nextIdx ? 'next' : ''}`}>{fmtMinutes(d).replace(' ', '\u00a0')}</span>)}</div>
          </>}
      </section>

      <section className="card">
        <div className="card-title">All stops in order · நிறுத்தங்கள்</div>
        <ol className="timeline">
          {route.stops.map((s, i) => {
            const o = stopOffset(route, i)
            const tag = s.stopId === Number(query.from) ? 'Board' : s.stopId === Number(query.to) ? 'Get off' : null
            return (
              <li key={s.stopId} className="tl-item">
                <div className="tl-rail"><div className="tl-dot" style={{ background: route.color, borderColor: route.color }} />{i < route.stops.length - 1 && <div className="tl-line" />}</div>
                <div className="tl-body"><span>{s.name} {s.nameTa && <span className="muted">· {s.nameTa}</span>} {tag && <span className="tl-tag">{tag}</span>}</span>
                  <span className="muted">{i === 0 ? 'Start' : o != null ? `+${o} min` : 'time n/a'}</span></div>
              </li>)
          })}
        </ol>
        <p className="small muted">Minutes are estimates from the route start, not live.</p>
      </section>

      <section className="card">
        <div className="card-title">Fares · கட்டணம்</div>
        {fares.length === 0 ? <p className="muted">Fare not verified.</p> : (
          <table className="table"><thead><tr><th>From</th><th>To</th><th>Fare</th><th>Status</th></tr></thead>
            <tbody>{fares.map((f, i) => <tr key={i}><td>{nameOf(f.fromStopId)}</td><td>{nameOf(f.toStopId)}</td><td>₹{f.amount}</td>
              <td><StatusBadge status={f.status} verifiedAt={f.verifiedAt} /></td></tr>)}</tbody></table>)}
      </section>

      <section className="card">
        <div className="card-title">About this data</div>
        <p className="small">Source: {route.source ? <>{route.source.name}{route.source.url && <> · <a href={route.source.url} target="_blank" rel="noreferrer">link</a></>}</> : <span className="muted">not recorded</span>}</p>
        <p className="small">Last verified: {route.verifiedAt ? fmtDay(route.verifiedAt) : <span className="muted">never</span>}</p>
      </section>

      <div className="actions">
        <button className="btn" onClick={toggleSave} aria-pressed={saved}>{saved ? 'Saved offline · Remove' : 'Save offline'}</button>
        <a className="btn" href={href('reminders', { route: route.id, stop: board })}>Last-bus reminder</a>
        <a className="btn" href={href('safety', { route: route.id, from: Number(query.from) || route.stops[0].stopId, to: Number(query.to) || route.stops.at(-1).stopId })}>Share trip</a>
      </div>
      {msg && <div className="field-hint ok" role="status">{msg}</div>}

      {positions.length > 1 && !offline && (
        <section className="card map-card" aria-label="Route map">
          <Suspense fallback={<Loading text="Loading map…" />}>
            <BusMap routes={[{ id: route.id, routeNo: route.routeNo, color: route.color, positions, isSample: route.isSample, stopIds: route.stops.map(s => s.stopId) }]}
              stops={route.stops.map(s => ({ id: s.stopId, name: s.name, lat: s.lat, lng: s.lng }))} />
          </Suspense>
        </section>)}
    </div>
  )
}
