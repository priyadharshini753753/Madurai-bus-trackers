import { api } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { Loading, ErrorBox } from '../components/ui'

export default function Overview({ open }) {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/overview'))
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const s = data.stats, u = data.usage7d
  const cards = [['Active routes', s.routes], ['Stops', s.stops], ['Operators', s.operators], ['Pending submissions', s.pending], ['Active alerts', s.activeAlerts], ['Feedback received', s.feedback],
    ['Searches (7 days)', u.search || 0], ['Searches with no result', u.search_no_result || 0]]
  return (
    <div>
      <div className="stat-grid">{cards.map(([l, n]) => <div className="card stat" key={l}><div className="n">{n}</div><div className="small muted">{l}</div></div>)}</div>
      <div className="card"><div className="card-title">Routes by verification</div>
        {data.byStatus.map(b => <span key={b.status} className={`badge status-${b.status}`}>{b.status}: {b.n}</span>)}
        {' '}{data.byType.map(b => <span key={b.type} className={`badge type-${b.type}`}>{b.type}: {b.n}</span>)}</div>
      <div className="card"><div className="card-title">Data-quality issues</div>
        {data.issueSummary.length === 0 ? <p className="ok">No issues found.</p> : <>
          <div className="chips">{data.issueSummary.map(i => <span className="badge" key={i.code}>{i.label}: {i.n}</span>)}</div>
          <div className="scroll"><table className="table"><thead><tr><th>Route</th><th>Issue</th><th /></tr></thead><tbody>
            {data.issues.filter(i => i.code !== 'sample' && i.code !== 'no_fare').slice(0, 60).map((i, k) => <tr key={k}><td>{i.routeNo}</td><td>{i.label}</td>
              <td><button className="btn" onClick={() => open('routes', { editId: i.routeId })}>Fix</button></td></tr>)}</tbody></table></div></>}
      </div>
    </div>)
}
