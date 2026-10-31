import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { Loading, ErrorBox } from '../components/ui'
import { StatusBadge } from '../components/Badges'
import { DAYS } from '../lib/format'
import { parseHHMM } from '../../shared/time.js'
import { useToast, errText, Field } from './shared'

const BLANK = { routeNo: '', operatorId: '', busType: 'ordinary', status: 'unverified', sourceId: '', verifiedAt: '', notes: '', isActive: true, color: '#1D9E75',
  stops: [{ stopId: '', offsetMin: 0 }, { stopId: '', offsetMin: '' }], groups: [{ times: '', days: [1, 2, 3, 4, 5, 6, 7], validFrom: '', validTo: '' }], fares: [] }

// trips[] ↔ groups[] (one group = one set of departure times sharing the same days/validity)
function toGroups(trips) {
  const m = new Map()
  for (const t of trips) {
    const k = `${t.days.join('')}|${t.validFrom || ''}|${t.validTo || ''}`
    if (!m.has(k)) m.set(k, { times: [], days: t.days, validFrom: t.validFrom || '', validTo: t.validTo || '' })
    m.get(k).times.push(t.time)
  }
  return [...m.values()].map(g => ({ ...g, times: g.times.join(', ') }))
}
function expandTimes(text) {
  const out = []
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\/(\d+)$/.exec(part)
    if (r) { const a = parseHHMM(r[1]), b = parseHHMM(r[2]), s = Number(r[3]); if (a != null && b != null && s > 0) for (let t = a; t <= b; t += s) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`) ; else out.push(part) }
    else out.push(part)
  }
  return out
}

function Editor({ id, ref_, onClose, user }) {
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState([])
  const [toast, say, view] = useToast()
  useEffect(() => {
    if (!id) return setForm({ ...BLANK, stops: BLANK.stops.map(s => ({ ...s })), groups: BLANK.groups.map(g => ({ ...g })) })
    api.get('/admin/routes/' + id).then(({ route, history }) => {
      setHistory(history)
      setForm({ routeNo: route.routeNo, operatorId: route.operator.id, busType: route.busType, status: route.status, sourceId: route.sourceId ?? '', verifiedAt: route.verifiedAt || '',
        notes: route.notes || '', isActive: route.isActive, color: route.color, isSample: route.isSample,
        stops: route.stops.map(s => ({ stopId: s.stopId, offsetMin: s.offsetMin ?? '' })), groups: toGroups(route.trips),
        fares: route.fares.map(f => ({ ...f, sourceId: f.sourceId ?? '' })) })
    }, e => say('bad', e.message))
  }, [id])
  if (!form) return <Loading />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const move = (i, d) => setForm(f => { const s = [...f.stops]; const j = i + d; if (j < 0 || j >= s.length) return f; [s[i], s[j]] = [s[j], s[i]]; return { ...f, stops: s } })
  const upd = (key, i, patch) => setForm(f => ({ ...f, [key]: f[key].map((x, k) => k === i ? { ...x, ...patch } : x) }))

  async function save() {
    const trips = form.groups.flatMap(g => expandTimes(g.times).map(time => ({ time, days: g.days, validFrom: g.validFrom || null, validTo: g.validTo || null })))
    const body = { ...form, operatorId: Number(form.operatorId), sourceId: form.sourceId ? Number(form.sourceId) : null, verifiedAt: form.verifiedAt || null,
      stops: form.stops.map((s, i) => ({ stopId: Number(s.stopId), offsetMin: s.offsetMin === '' ? null : Number(s.offsetMin) })),
      trips, fares: form.fares.map(f => ({ ...f, fromStopId: Number(f.fromStopId), toStopId: Number(f.toStopId), amount: Number(f.amount), sourceId: f.sourceId ? Number(f.sourceId) : null, verifiedAt: f.verifiedAt || null })) }
    delete body.groups
    try { id ? await api.put('/admin/routes/' + id, body) : await api.post('/admin/routes', body); say('ok', 'Saved.'); ref_.reload(); if (!id) onClose() }
    catch (e) { say('bad', errText(e)) }
  }

  const stopOpts = ref_.stops.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)
  return (
    <div className="card editor">
      <div className="row-between"><h2>{id ? `Edit route ${form.routeNo}` : 'New route'}</h2><button className="btn" onClick={onClose}>Close</button></div>
      {form.isSample && <div className="notice notice-warn">Sample record. Replace with verified data before publishing for real passengers.</div>}
      <div className="row3">
        <Field label="Route number"><input value={form.routeNo} onChange={e => set('routeNo', e.target.value)} /></Field>
        <Field label="Operator"><select value={form.operatorId} onChange={e => set('operatorId', e.target.value)}><option value="">Choose…</option>{ref_.operators.map(o => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}</select></Field>
        <Field label="Bus type"><select value={form.busType} onChange={e => set('busType', e.target.value)}>{['ordinary', 'express', 'deluxe', 'ac', 'mini'].map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
      <div className="row3">
        <Field label="Verification status"><select value={form.status} onChange={e => set('status', e.target.value)}>{['unverified', 'verified', 'outdated', ...(form.isSample ? ['sample'] : [])].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Source"><select value={form.sourceId} onChange={e => set('sourceId', e.target.value)}><option value="">None</option>{ref_.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Verified on"><input type="date" value={form.verifiedAt} onChange={e => set('verifiedAt', e.target.value)} /></Field>
      </div>

      <h3>Stops in order (minutes from the first stop; leave blank if unknown)</h3>
      {form.stops.map((s, i) => (
        <div className="row-stop" key={i}>
          <span className="small">{i + 1}</span>
          <select value={s.stopId} onChange={e => upd('stops', i, { stopId: e.target.value })} aria-label={`Stop ${i + 1}`}><option value="">Choose stop…</option>{stopOpts}</select>
          <input type="number" min="0" disabled={i === 0} value={i === 0 ? 0 : s.offsetMin} onChange={e => upd('stops', i, { offsetMin: e.target.value })} aria-label={`Minutes for stop ${i + 1}`} placeholder="min" />
          <button className="btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="btn danger" onClick={() => set('stops', form.stops.filter((_, k) => k !== i))} aria-label="Remove stop">✕</button>
        </div>))}
      <button className="btn" onClick={() => set('stops', [...form.stops, { stopId: '', offsetMin: '' }])}>+ Add stop</button>

      <h3>Schedule (departures from the first stop)</h3>
      <p className="small muted">Type times like <code>06:00, 06:30, 07:00</code> or a range <code>06:00-21:00/30</code> (every 30 min).</p>
      {form.groups.map((g, i) => (
        <div className="card inner" key={i}>
          <Field label="Departure times"><textarea rows={2} value={g.times} onChange={e => upd('groups', i, { times: e.target.value })} /></Field>
          <div className="days">{DAYS.map((d, k) => <label key={d} className="inline"><input type="checkbox" checked={g.days.includes(k + 1)} onChange={e => upd('groups', i, { days: e.target.checked ? [...g.days, k + 1].sort() : g.days.filter(x => x !== k + 1) })} />{d}</label>)}</div>
          <div className="row2"><Field label="Valid from"><input type="date" value={g.validFrom} onChange={e => upd('groups', i, { validFrom: e.target.value })} /></Field>
            <Field label="Valid to"><input type="date" value={g.validTo} onChange={e => upd('groups', i, { validTo: e.target.value })} /></Field></div>
          <button className="btn danger" onClick={() => set('groups', form.groups.filter((_, k) => k !== i))}>Remove this group</button>
        </div>))}
      <button className="btn" onClick={() => set('groups', [...form.groups, { times: '', days: [1, 2, 3, 4, 5, 6, 7], validFrom: '', validTo: '' }])}>+ Add schedule group</button>

      <h3>Fares</h3>
      {form.fares.map((f, i) => (
        <div className="row-fare" key={i}>
          <select value={f.fromStopId} onChange={e => upd('fares', i, { fromStopId: e.target.value })} aria-label="Fare from"><option value="">From…</option>{stopOpts}</select>
          <select value={f.toStopId} onChange={e => upd('fares', i, { toStopId: e.target.value })} aria-label="Fare to"><option value="">To…</option>{stopOpts}</select>
          <input type="number" min="0" step="0.5" value={f.amount} onChange={e => upd('fares', i, { amount: e.target.value })} aria-label="Amount ₹" placeholder="₹" />
          <select value={f.status} onChange={e => upd('fares', i, { status: e.target.value })} aria-label="Fare status">{['unverified', 'verified', 'outdated', ...(f.status === 'sample' ? ['sample'] : [])].map(x => <option key={x}>{x}</option>)}</select>
          <input type="date" value={f.verifiedAt || ''} onChange={e => upd('fares', i, { verifiedAt: e.target.value })} aria-label="Fare verified on" />
          <button className="btn danger" onClick={() => set('fares', form.fares.filter((_, k) => k !== i))}>✕</button>
        </div>))}
      <button className="btn" onClick={() => set('fares', [...form.fares, { fromStopId: '', toStopId: '', amount: '', status: 'unverified', sourceId: form.sourceId, verifiedAt: '' }])}>+ Add fare</button>

      <Field label="Notes"><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <label className="inline"><input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} /> Active (visible to passengers)</label>
      <div className="actions"><button className="btn primary" onClick={save}>Save route</button></div>
      {view}
      {history.length > 0 && <details><summary>Verification history ({history.length})</summary><ul className="small">{history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('en-IN')} · {h.status} · {h.source || 'no source'} · {h.by || ''}</li>)}</ul></details>}
    </div>)
}

export default function RoutesAdmin({ user, go }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [r, o, s, so] = await Promise.all([api.get('/admin/routes'), api.get('/admin/operators'), api.get('/admin/stops'), api.get('/sources')])
    return { routes: r.routes, operators: o.operators, stops: s.stops.filter(x => x.isActive), sources: so.sources }
  })
  const [editing, setEditing] = useState(go?.editId ?? undefined)   // undefined = list, null = new, number = edit
  const [q, setQ] = useState('')
  const [toast, say, view] = useToast()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const ref_ = { ...data, reload }
  if (editing !== undefined) return <Editor id={editing} ref_={ref_} user={user} onClose={() => { setEditing(undefined); reload() }} />

  async function toggle(r) {
    try { await api.post(`/admin/routes/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`); reload() } catch (e) { say('bad', errText(e)) }
  }
  const rows = data.routes.filter(r => !q || `${r.routeNo} ${r.origin} ${r.destination} ${r.operator.name}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <div className="row-between"><h2>Routes ({rows.length})</h2><button className="btn primary" onClick={() => setEditing(null)}>+ New route</button></div>
      <input className="search-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search routes…" aria-label="Search routes" />
      {view}
      <div className="scroll"><table className="table"><thead><tr><th>No.</th><th>Operator</th><th>Route</th><th>Status</th><th>Trips</th><th>Active</th><th /></tr></thead><tbody>
        {rows.map(r => <tr key={r.id} className={r.isActive ? '' : 'dim'}><td>{r.routeNo}</td><td>{r.operator.name}</td><td>{r.origin} → {r.destination}</td>
          <td><StatusBadge status={r.status} verifiedAt={r.verifiedAt} /></td><td>{r.tripCount}</td><td>{r.isActive ? 'Yes' : 'No'}</td>
          <td className="nowrap"><button className="btn" onClick={() => setEditing(r.id)}>Edit</button>
            {(user.role === 'admin' || !r.isActive) && <button className="btn" onClick={() => toggle(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}
      </tbody></table></div>
    </div>)
}
