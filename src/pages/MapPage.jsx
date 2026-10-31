import { lazy, Suspense, useState } from 'react'
import { cachedGet } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { useOnline } from '../hooks/useOnline'
import { Loading, ErrorBox, Notice } from '../components/ui'
import { href } from '../hooks/useHashRoute'

const BusMap = lazy(() => import('../components/BusMap'))
const FILTERS = [['all', 'All'], ['govt', 'Government'], ['private', 'Private'], ['minibus', 'Mini-bus']]

export default function MapPage() {
  const online = useOnline()
  const { data, error, loading, reload } = useLoad(async () => {
    const [r, s] = await Promise.all([cachedGet('/routes'), cachedGet('/stops')])
    return { routes: r.data.routes, stops: s.data.stops }
  })
  const [type, setType] = useState('all')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const byId = Object.fromEntries(data.stops.map(s => [s.id, s]))
  const routes = data.routes.filter(r => type === 'all' || r.operator.type === type).map(r => ({
    id: r.id, routeNo: r.routeNo, color: r.color, isSample: r.isSample, stopIds: r.stopIds,
    positions: r.stopIds.map(i => byId[i]).filter(s => s?.lat != null).map(s => [s.lat, s.lng]),
  }))
  return (
    <div className="page">
      <h1>Route map</h1>
      <div className="seg" role="group" aria-label="Bus type filter">
        {FILTERS.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>{l}</button>)}
      </div>
      {!online && <Notice>Offline: map background tiles need internet. Route lines still show.</Notice>}
      <div className="map-card tall">
        <Suspense fallback={<Loading text="Loading map…" />}>
          <BusMap routes={routes} stops={data.stops} onPickRoute={r => { window.location.hash = href(`route/${r.id}`) }} />
        </Suspense>
      </div>
      <p className="muted small">Lines join stops in order; they are not exact road paths. Tap a line to open the route.</p>
    </div>
  )
}
