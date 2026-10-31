import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Loading } from '../components/ui'
import Overview from './Overview'
import RoutesAdmin from './RoutesAdmin'
import { StopsAdmin, OperatorsAdmin, SourcesAdmin } from './DataAdmin'
import { AlertsAdmin, SubmissionsAdmin, ImportExport, AuditAdmin, FeedbackAdmin } from './OpsAdmin'

const TABS = [
  ['overview', 'Overview', ['admin', 'editor'], Overview],
  ['routes', 'Routes & schedules', ['admin', 'editor'], RoutesAdmin],
  ['stops', 'Stops', ['admin', 'editor'], StopsAdmin],
  ['operators', 'Operators', ['admin'], OperatorsAdmin],
  ['sources', 'Sources', ['admin', 'editor'], SourcesAdmin],
  ['alerts', 'Service alerts', ['admin'], AlertsAdmin],
  ['submissions', 'Submissions', ['admin', 'editor'], SubmissionsAdmin],
  ['import', 'Import / export', ['admin', 'editor'], ImportExport],
  ['audit', 'Audit log', ['admin'], AuditAdmin],
  ['feedback', 'Feedback', ['admin', 'editor'], FeedbackAdmin],
]

function Login({ onDone }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true)
    try { onDone((await api.post('/auth/login', { email, password })).user) }
    catch (x) { setErr(x.fields ? Object.values(x.fields).join(' · ') : x.message) } finally { setBusy(false) }
  }
  return (
    <div className="page narrow">
      <h1>Staff sign-in</h1>
      <form className="card" onSubmit={submit}>
        <div className="field"><label htmlFor="ae">Email</label><input id="ae" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="ap">Password</label><input id="ap" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <div className="field-hint bad" role="alert">{err}</div>}
      </form>
    </div>)
}

export default function AdminPage() {
  const [user, setUser] = useState(undefined)
  const [tab, setTab] = useState('overview')
  const [go, setGo] = useState(null)           // cross-tab navigation payload (e.g. open route editor)
  useEffect(() => { api.get('/auth/me').then(r => setUser(r.user), () => setUser(null)) }, [])
  if (user === undefined) return <Loading />
  if (!user) return <Login onDone={setUser} />

  const allowed = TABS.filter(t => t[2].includes(user.role))
  const Current = (allowed.find(t => t[0] === tab) || allowed[0])[3]
  const open = (t, payload) => { setGo(payload || null); setTab(t) }
  async function logout() { await api.post('/auth/logout'); setUser(null) }

  return (
    <div className="page wide">
      <div className="row-between"><h1>Admin dashboard</h1>
        <span className="small">{user.email} <span className="badge">{user.role}</span> <button className="btn" onClick={logout}>Sign out</button></span></div>
      <nav className="admin-tabs" aria-label="Admin sections">
        {allowed.map(([k, l]) => <button key={k} aria-current={tab === k} onClick={() => open(k)}>{l}</button>)}
      </nav>
      <Current user={user} go={go} open={open} />
    </div>)
}
