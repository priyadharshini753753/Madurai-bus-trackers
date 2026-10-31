import { useState } from 'react'
import { api } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { Loading, ErrorBox, Empty } from '../components/ui'
import { ALERT_TYPE, fmtDate } from '../lib/format'
import { useToast, errText, Field } from './shared'

const istToIso = v => (v ? `${v}:00+05:30` : null)     // <input type="datetime-local"> is entered in IST

export function AlertsAdmin() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [a, r, s] = await Promise.all([api.get('/admin/alerts'), api.get('/admin/routes'), api.get('/admin/stops')])
    return { alerts: a.alerts, routes: r.routes, stops: s.stops }
  })
  const blank = { type: 'diversion', title: '', body: '', startsAt: '', endsAt: '', source: '', verificationStatus: 'unverified', routeIds: [], stopIds: [] }
  const [f, setF] = useState(blank)
  const [toast, say, view] = useToast()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const multi = (k, e) => setF({ ...f, [k]: [...e.target.selectedOptions].map(o => Number(o.value)) })
  async function publish(e) {
    e.preventDefault()
    try { await api.post('/admin/alerts', { ...f, startsAt: istToIso(f.startsAt), endsAt: istToIso(f.endsAt) }); setF(blank); say('ok', 'Alert published.'); reload() }
    catch (x) { say('bad', errText(x)) }
  }
  return (
    <div>
      <h2>Publish a service alert</h2>
      <p className="small muted">Only publish information from a real notice. Include the source. Times are India time.</p>
      <form className="card" onSubmit={publish}>
        <div className="row2">
          <Field label="Type"><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{Object.entries(ALERT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Verification"><select value={f.verificationStatus} onChange={e => setF({ ...f, verificationStatus: e.target.value })}><option value="unverified">Unverified</option><option value="verified">Verified</option></select></Field>
        </div>
        <Field label="Headline"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={160} /></Field>
        <Field label="Details"><textarea rows={2} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
        <div className="row2">
          <Field label="Starts (blank = now)"><input type="datetime-local" value={f.startsAt} onChange={e => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label="Ends (blank = not known)"><input type="datetime-local" value={f.endsAt} onChange={e => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <Field label="Source of this information"><input value={f.source} onChange={e => setF({ ...f, source: e.target.value })} placeholder="e.g. TNSTC notice dated …" /></Field>
        <div className="row2">
          <Field label="Affected routes (hold Ctrl/Cmd to select several)"><select multiple size={5} value={f.routeIds.map(String)} onChange={e => multi('routeIds', e)}>{data.routes.map(r => <option key={r.id} value={r.id}>{r.routeNo} · {r.origin} → {r.destination}</option>)}</select></Field>
          <Field label="Affected stops"><select multiple size={5} value={f.stopIds.map(String)} onChange={e => multi('stopIds', e)}>{data.stops.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></Field>
        </div>
        <button className="btn primary" type="submit">Publish alert</button>{view}
      </form>
      <h2>Existing alerts</h2>
      {data.alerts.length === 0 ? <Empty icon="✅">No alerts yet.</Empty> : data.alerts.map(a => (
        <div className="card" key={a.id}><div className="row-between"><strong>{a.title}</strong>
          <span><span className="badge">{ALERT_TYPE[a.type]}</span> <span className="badge">{a.status === 'archived' ? 'Archived' : a.expired ? 'Expired' : 'Active'}</span></span></div>
          <p className="small muted">{fmtDate(a.startsAt)} → {a.endsAt ? fmtDate(a.endsAt) : 'open'} · {a.source} · {a.verificationStatus}</p>
          {a.status === 'published' && <button className="btn" onClick={async () => { await api.post(`/admin/alerts/${a.id}/archive`); reload() }}>Archive</button>}</div>))}
    </div>)
}

export function SubmissionsAdmin() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/submissions'))
  const [toast, say, view] = useToast()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  async function review(id, decision) {
    try { const r = await api.post(`/admin/submissions/${id}/review`, { decision }); say('ok', decision === 'approve' ? `Approved. A draft route (#${r.createdRouteId}, inactive, unverified) was created. Complete and verify it under Routes.` : 'Rejected.'); reload() }
    catch (e) { say('bad', errText(e)) }
  }
  return (
    <div><h2>Route submissions from passengers</h2>{view}
      {data.submissions.length === 0 ? <Empty icon="📭">No submissions.</Empty> : data.submissions.map(s => (
        <div className="card" key={s.id}><div className="row-between"><strong>{s.payload.routeNo} · {s.origin} → {s.destination}</strong><span className="badge">{s.status}</span></div>
          <p className="small">Type: {s.payload.operatorType}{s.payload.intermediateStops && ` · Stops: ${s.payload.intermediateStops}`}{s.payload.timings && ` · Timings: ${s.payload.timings}`}</p>
          <p className="small muted">Source note: {s.payload.sourceNote} · {fmtDate(s.createdAt)}</p>
          {s.status === 'pending' && <div className="actions"><button className="btn primary" onClick={() => review(s.id, 'approve')}>Approve (create draft)</button><button className="btn danger" onClick={() => review(s.id, 'reject')}>Reject</button></div>}</div>))}
    </div>)
}

const TEMPLATE = `route_no,operator,operator_type,bus_type,stops,departures,days,fare_full,source_name,source_url,source_type,verified_date,status
EXAMPLE-1,Example Operator,private,ordinary,Periyar Bus Stand@0;Melur@50,06:00-20:00/60,1-7,,Example source,https://example.org,operator,2026-01-15,verified
`
export function ImportExport({ user }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [res, setRes] = useState(null)
  const [pick, setPick] = useState([])
  const [busy, setBusy] = useState(false)
  const [toast, say, view] = useToast()

  async function run(dry) {
    setBusy(true); setRes(null); setPick([])
    try { setRes(await api.postText(`/admin/import?dryRun=${dry}&fileName=${encodeURIComponent(fileName)}`, text)) } catch (e) { say('bad', errText(e)) } finally { setBusy(false) }
  }
  async function resolve(action) {
    try { const r = await api.post(`/admin/import/${res.batchId}/resolve`, { action, rows: pick }); say('ok', `${action === 'apply' ? `Applied ${r.applied}` : 'Dismissed'} conflict(s).`); setRes({ ...res, conflicts: res.conflicts.map(c => pick.includes(c.row) ? { ...c, resolved: action } : c) }); setPick([]) }
    catch (e) { say('bad', errText(e)) }
  }
  async function download(content, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv' })); a.download = name; a.click() }
  async function exportAll() {
    try { const r = await fetch('/api/admin/export', { credentials: 'same-origin' }); if (!r.ok) throw new Error('Export failed'); download(await r.text(), 'madurai-routes-export.csv') } catch (e) { say('bad', e.message) }
  }
  return (
    <div>
      <h2>Import / export routes (CSV)</h2>
      <p className="small muted">Imports record the source and verification date. Duplicates are skipped; routes that differ from an existing one are flagged as conflicts for review, never overwritten silently. Stops must already exist. Always run a dry run first.</p>
      <div className="actions"><button className="btn" onClick={() => download(TEMPLATE, 'route-import-template.csv')}>Download template</button><button className="btn" onClick={exportAll}>Export all routes (CSV)</button></div>
      <div className="card">
        <div className="field"><label htmlFor="csvf">CSV file</label><input id="csvf" type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files[0]; if (f) { setFileName(f.name); setText(await f.text()) } }} /></div>
        <div className="field"><label htmlFor="csvt">…or paste CSV</label><textarea id="csvt" rows={6} value={text} onChange={e => setText(e.target.value)} /></div>
        <div className="actions"><button className="btn" disabled={!text || busy} onClick={() => run(true)}>1. Dry run (nothing is saved)</button>
          <button className="btn primary" disabled={!text || busy} onClick={() => run(false)}>2. Import for real</button></div>
        {view}
      </div>
      {res && <div className="card" aria-live="polite">
        <h3>{res.dryRun ? 'Dry run result (nothing saved)' : 'Import result'}</h3>
        <p>Rows: {res.summary.rows} · new: <strong>{res.summary.created}</strong> · duplicates skipped: {res.summary.duplicates} · conflicts: <strong>{res.summary.conflicts}</strong> · errors: <strong>{res.summary.errors.length}</strong></p>
        {res.summary.errors.length > 0 && <ul className="bad small">{res.summary.errors.map((e, i) => <li key={i}>Row {e.row}{e.routeNo ? ` (${e.routeNo})` : ''}: {e.message}</li>)}</ul>}
        {res.summary.warnings.length > 0 && <ul className="warn small">{res.summary.warnings.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
        {res.conflicts.length > 0 && <><h4>Conflicts to review</h4>
          {res.conflicts.map(c => <label key={c.row} className="inline block"><input type="checkbox" disabled={res.dryRun || !!c.resolved || user.role !== 'admin'} checked={pick.includes(c.row)} onChange={e => setPick(e.target.checked ? [...pick, c.row] : pick.filter(x => x !== c.row))} />
            Row {c.row} · {c.routeNo} · {c.reason === 'duplicate_in_file' ? 'appears twice in the file with different data' : `differs from the saved route (${c.differs.join(', ')})`}{c.resolved && ` · ${c.resolved}`}</label>)}
          {!res.dryRun && user.role === 'admin' && <div className="actions"><button className="btn primary" disabled={!pick.length} onClick={() => resolve('apply')}>Replace saved route with CSV data</button><button className="btn" disabled={!pick.length} onClick={() => resolve('dismiss')}>Keep saved route</button></div>}
          {user.role !== 'admin' && <p className="small muted">Only an admin can resolve conflicts.</p>}</>}
      </div>}
    </div>)
}

export function AuditAdmin() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/audit?limit=200'))
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div><h2>Audit log</h2><div className="scroll"><table className="table small"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Change</th></tr></thead><tbody>
      {data.entries.map(e => <tr key={e.id}><td className="nowrap">{fmtDate(e.at)}</td><td>{e.user || '—'}</td><td>{e.action}</td><td>{e.entity} {e.entityId}</td>
        <td><details><summary>details</summary><pre>{JSON.stringify({ before: e.before, after: e.after }, null, 1).slice(0, 1500)}</pre></details></td></tr>)}</tbody></table></div></div>)
}

export function FeedbackAdmin() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/feedback'))
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <div><h2>Feedback</h2>{data.feedback.length === 0 ? <Empty icon="📭">No feedback yet.</Empty> : data.feedback.map(f => <div className="card" key={f.id}><p>{f.message}</p><p className="small muted">{fmtDate(f.at)}{f.contact && ` · ${f.contact}`}</p></div>)}</div>
}
