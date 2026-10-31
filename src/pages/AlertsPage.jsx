import { useState } from 'react'
import { cachedGet } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { Loading, ErrorBox, Empty, Notice } from '../components/ui'
import { ALERT_TYPE, fmtDate } from '../lib/format'

export default function AlertsPage() {
  const { data, error, loading, reload } = useLoad(() => cachedGet('/alerts?include=expired'))
  const [showOld, setShowOld] = useState(false)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const all = data.data.alerts
  const active = all.filter(a => a.state !== 'expired')
  const expired = all.filter(a => a.state === 'expired')
  const Card = ({ a }) => (
    <article className={`card alert ${a.state}`}>
      <header><span className="badge">{ALERT_TYPE[a.type]}</span>
        <span className={`badge ${a.verificationStatus === 'verified' ? 'status-verified' : 'status-unverified'}`}>{a.verificationStatus === 'verified' ? '✔ Verified' : '? Unverified'}</span>
        <span className="badge">{a.state === 'expired' ? 'Expired' : a.state === 'upcoming' ? 'Upcoming' : 'Active'}</span></header>
      <h3>{a.title}</h3>{a.body && <p>{a.body}</p>}
      <p className="small muted">Announced {fmtDate(a.startsAt)} · {a.endsAt ? `valid until ${fmtDate(a.endsAt)}` : 'end time not known'}<br />Source: {a.source}</p>
    </article>)
  return (
    <div className="page">
      <h1>Service alerts · அறிவிப்புகள்</h1>
      {data.fromCache && <Notice>Offline: showing alerts saved earlier. They may be out of date.</Notice>}
      {active.length === 0 ? <Empty icon="✅">No active service alerts right now. This does not guarantee every bus is running.</Empty> : active.map(a => <Card key={a.id} a={a} />)}
      {expired.length > 0 && <><button className="btn" onClick={() => setShowOld(v => !v)}>{showOld ? 'Hide' : 'Show'} expired alerts ({expired.length})</button>{showOld && expired.map(a => <Card key={a.id} a={a} />)}</>}
    </div>
  )
}
