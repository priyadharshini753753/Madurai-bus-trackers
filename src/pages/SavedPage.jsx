import { useEffect, useState } from 'react'
import { listSaved, removeSaved, refreshAll, getLastSync } from '../lib/saved'
import { fmtDate } from '../lib/format'
import { useOnline } from '../hooks/useOnline'
import { Empty, Notice, Loading } from '../components/ui'
import { RouteNo, StatusBadge, OperatorBadge } from '../components/Badges'
import { href } from '../hooks/useHashRoute'

export default function SavedPage() {
  const online = useOnline()
  const [items, setItems] = useState(null)
  const [last, setLast] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = async () => { setItems(await listSaved()); setLast(await getLastSync()) }
  useEffect(() => { load(); window.addEventListener('mbt:saved-changed', load); return () => window.removeEventListener('mbt:saved-changed', load) }, [])

  // Refresh automatically when the connection comes back.
  useEffect(() => { if (online && items?.length) refresh(true) }, [online]) // eslint-disable-line

  async function refresh(quiet) {
    setBusy(true); setMsg(null)
    const r = await refreshAll()
    const bad = r.filter(x => !x.ok)
    if (!quiet || bad.length) setMsg(bad.length ? `Updated ${r.length - bad.length} of ${r.length}. ${bad[0].reason}` : `Updated ${r.length} route${r.length > 1 ? 's' : ''}.`)
    setBusy(false)
  }

  if (!items) return <Loading />
  return (
    <div className="page">
      <h1>Saved routes · சேமித்தவை</h1>
      <Notice>Saved timetables work without internet, but they may be outdated. Buses can be cancelled or rescheduled. Refresh when you are online.</Notice>
      <div className="card row-between">
        <div className="small"><strong>Last sync:</strong> {last ? fmtDate(last) : 'never'}<br /><span className="muted">{online ? 'Online' : 'Offline: cannot refresh now'}</span></div>
        <button className="btn" disabled={!online || busy || !items.length} onClick={() => refresh(false)}>{busy ? 'Refreshing…' : 'Refresh all'}</button>
      </div>
      {msg && <div className="field-hint ok" role="status">{msg}</div>}

      {items.length === 0 ? (
        <Empty icon="☆">No saved routes yet. Open a route and tap <strong>Save offline</strong>.<br /><a href={href('')}>Find a bus</a></Empty>
      ) : items.map(it => (
        <article key={it.route.id} className="card leg" style={{ borderLeftColor: it.route.color }}>
          <header className="leg-head">
            <RouteNo no={it.route.routeNo} color={it.route.color} big />
            <div className="leg-title">
              <strong>{it.route.stops[0]?.name} → {it.route.stops.at(-1)?.name}</strong>
              <div className="chips"><OperatorBadge type={it.route.operator.type} /><StatusBadge status={it.route.status} verifiedAt={it.route.verifiedAt} /></div>
            </div>
          </header>
          <p className="small muted">Saved {fmtDate(it.savedAt)} · updated {fmtDate(it.syncedAt)}</p>
          {it.removedFromServer && <Notice kind="bad">This route is no longer in the system.</Notice>}
          <div className="actions">
            <a className="btn" href={href(`route/${it.route.id}`)}>Open timetable</a>
            <a className="btn" href={href('reminders', { route: it.route.id })}>Reminder</a>
            <button className="btn danger" onClick={() => removeSaved(it.route.id)}>Remove</button>
          </div>
        </article>
      ))}
    </div>
  )
}
