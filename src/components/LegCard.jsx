import { useEffect, useState } from 'react'
import { fmtMinutes, fmtDuration } from '../lib/format'
import { api } from '../lib/api'
import { isSaved, saveRoute, removeSaved } from '../lib/saved'
import { OperatorBadge, StatusBadge, RouteNo } from './Badges'
import { href } from '../hooks/useHashRoute'
import { ALERT_TYPE } from '../lib/format'

export function FareLine({ fare }) {
  if (!fare) return <span className="muted">Fare not verified</span>
  const label = fare.status === 'sample' ? 'Sample fare (not real)' : fare.status === 'verified' ? 'Fare' : `Fare (${fare.status})`
  return <span>{label}: ₹{fare.amount}</span>
}

export function AlertList({ alerts }) {
  if (!alerts?.length) return null
  return (
    <ul className="alert-inline">
      {alerts.map(a => (
        <li key={a.id}><strong>{ALERT_TYPE[a.type]}:</strong> {a.title}
          {a.verificationStatus !== 'verified' && <em> (unverified)</em>}</li>
      ))}
    </ul>
  )
}

// One bus leg of a journey. Everything shown as a time is a scheduled time or an estimate.
export default function LegCard({ leg, tripDate }) {
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { isSaved(leg.routeId).then(setSaved) }, [leg.routeId])

  async function toggleSave() {
    setBusy(true); setMsg(null)
    try {
      if (saved) { await removeSaved(leg.routeId); setSaved(false) }
      else { await saveRoute(await api.get('/routes/' + leg.routeId)); setSaved(true); setMsg('Saved for offline use.') }
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const next = leg.upcoming[0]
  const noTiming = !leg.timingAvailable
  return (
    <article className="card leg" style={{ borderLeftColor: leg.color }}>
      <header className="leg-head">
        <RouteNo no={leg.routeNo} color={leg.color} big />
        <div className="leg-title">
          <div><strong>{leg.operator.name}</strong></div>
          <div className="chips"><OperatorBadge type={leg.operator.type} /><StatusBadge status={leg.status} verifiedAt={leg.verifiedAt} /></div>
        </div>
      </header>

      <div className="leg-route">
        <div><span className="muted">Board</span> <strong>{leg.boardingStop}</strong></div>
        <div className="arrow" aria-hidden="true">↓ {leg.stopCount} stop{leg.stopCount > 1 ? 's' : ''}</div>
        <div><span className="muted">Get off</span> <strong>{leg.destinationStop}</strong></div>
      </div>

      <dl className="facts">
        <div><dt>Scheduled departure</dt>
          <dd>{noTiming ? <span className="muted">Timing unavailable{leg.scheduleAvailable ? ' for this day/time' : ''}</span>
            : <span className="times">{leg.upcoming.map((u, i) => <span key={i} className={`time ${i === 0 ? 'next' : ''}`}>{fmtMinutes(u.boardMin)}</span>)}</span>}
          </dd></div>
        <div><dt>Journey time</dt>
          <dd>{leg.durationMin != null ? `~${fmtDuration(leg.durationMin)} (estimate)` : <span className="muted">Duration unavailable</span>}</dd></div>
        <div><dt>Expected arrival</dt>
          <dd>{next?.alightMin != null ? `${fmtMinutes(next.alightMin)} (estimate)` : <span className="muted">Unavailable</span>}</dd></div>
        <div><dt>Fare</dt><dd><FareLine fare={leg.fare} /></dd></div>
        {leg.lastBoardMin != null && (
          <div><dt>Last scheduled bus</dt><dd>{fmtMinutes(leg.lastBoardMin)} <span className="muted">(not a guarantee)</span></dd></div>)}
      </dl>

      {leg.intermediateStops.length > 0 && (
        <details className="stops-detail"><summary>Stops in between ({leg.intermediateStops.length})</summary>
          <ol>{leg.intermediateStops.map((s, i) => <li key={i}>{s}</li>)}</ol></details>)}

      <AlertList alerts={leg.alerts} />

      <div className="actions">
        <a className="btn" href={href(`route/${leg.routeId}`, { from: leg.fromStopId, to: leg.toStopId })}>Full route & stops</a>
        <button className="btn" onClick={toggleSave} disabled={busy} aria-pressed={saved}>{saved ? 'Saved offline' : 'Save offline'}</button>
        <a className="btn" href={href('reminders', { route: leg.routeId, stop: leg.fromStopId })}>Last-bus reminder</a>
        <a className="btn" href={href('safety', { route: leg.routeId, from: leg.fromStopId, to: leg.toStopId })}>Share trip</a>
      </div>
      {msg && <div className="field-hint ok" role="status">{msg}</div>}
    </article>
  )
}
