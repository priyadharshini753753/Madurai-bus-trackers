import { useState } from 'react'
import { api, cachedGet } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { STATUS_LABEL } from '../lib/format'
import { StatusBadge } from '../components/Badges'
import StopInput from '../components/StopInput'
import { href } from '../hooks/useHashRoute'
import { Notice } from '../components/ui'

function FeedbackForm() {
  const [message, setMessage] = useState(''), [contact, setContact] = useState('')
  const [state, setState] = useState(null)
  async function send(e) {
    e.preventDefault(); setState(null)
    try { await api.post('/feedback', { message, contact, page: 'about' }); setState({ ok: true, text: 'Thank you. Your feedback was received.' }); setMessage('') }
    catch (err) { setState({ ok: false, text: err.fields?.message || err.message }) }
  }
  return (
    <form className="card" onSubmit={send}>
      <div className="card-title">Feedback · கருத்து</div>
      <div className="field"><label htmlFor="fm">Your message</label><textarea id="fm" rows={3} value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} required /></div>
      <div className="field"><label htmlFor="fc">Contact (optional)</label><input id="fc" value={contact} onChange={e => setContact(e.target.value)} maxLength={200} /></div>
      <button className="btn primary" type="submit">Send feedback</button>
      {state && <div className={`field-hint ${state.ok ? 'ok' : 'bad'}`} role="status">{state.text}</div>}
    </form>)
}

function SuggestForm({ stops }) {
  const [f, setF] = useState({ routeNo: '', operatorType: 'govt', originStopId: null, destinationStopId: null, intermediateStops: '', timings: '', fare: '', sourceNote: '', contact: '' })
  const [state, setState] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function send(e) {
    e.preventDefault(); setState(null)
    try { await api.post('/submissions', f); setState({ ok: true, text: 'Thank you. An admin will review this before it appears.' }) }
    catch (err) { setState({ ok: false, text: err.fields ? Object.values(err.fields).join(' · ') : err.message }) }
  }
  return (
    <form className="card" onSubmit={send} id="suggest">
      <div className="card-title">Suggest a route or correction · வழித்தடம் தெரிவி</div>
      <p className="small muted">Submissions are reviewed by an admin and are not shown to others until verified.</p>
      <div className="row2">
        <div className="field"><label htmlFor="sn">Bus number</label><input id="sn" value={f.routeNo} onChange={e => set('routeNo', e.target.value)} maxLength={20} required /></div>
        <div className="field"><label htmlFor="so">Type</label><select id="so" value={f.operatorType} onChange={e => set('operatorType', e.target.value)}><option value="govt">Government</option><option value="private">Private</option><option value="minibus">Mini-bus</option></select></div>
      </div>
      <StopInput label="Starts at" stops={stops} value={f.originStopId} onChange={id => set('originStopId', id)} />
      <StopInput label="Ends at" stops={stops} value={f.destinationStopId} onChange={id => set('destinationStopId', id)} />
      <div className="field"><label htmlFor="si">Stops in between (in order, optional)</label><input id="si" value={f.intermediateStops} onChange={e => set('intermediateStops', e.target.value)} /></div>
      <div className="field"><label htmlFor="st">Timings you know (optional)</label><input id="st" value={f.timings} onChange={e => set('timings', e.target.value)} /></div>
      <div className="field"><label htmlFor="sf">Where did you get this? (required)</label><input id="sf" value={f.sourceNote} onChange={e => set('sourceNote', e.target.value)} placeholder="e.g. board at the bus stand, driver, official notice" required /></div>
      <button className="btn primary" type="submit" disabled={!f.originStopId || !f.destinationStopId}>Submit for review</button>
      {state && <div className={`field-hint ${state.ok ? 'ok' : 'bad'}`} role="status">{state.text}</div>}
    </form>)
}

export default function AboutPage() {
  const { data } = useLoad(async () => {
    const [s, st] = await Promise.all([cachedGet('/sources'), cachedGet('/stops')])
    return { sources: s.data.sources, stops: st.data.stops }
  })
  return (
    <div className="page">
      <h1>More</h1>
      <nav className="card quick" aria-label="More pages">
        <a className="btn" href={href('map')}>Route map</a>
        <a className="btn" href={href('reminders')}>Last-bus reminders</a>
        <a className="btn" href={href('saved')}>Saved routes</a>
        <a className="btn" href={href('admin')}>Staff sign-in</a>
      </nav>
      <h2>About, data & feedback</h2>
      <section className="card">
        <p>Madurai Bus helps you plan bus journeys in Madurai district from <strong>scheduled timetables</strong>. It has <strong>no live GPS</strong>: it cannot tell you where a bus is now or whether it is running. All arrival times are estimates.</p>
        <div className="card-title">How to read data labels</div>
        <ul className="legend">{Object.keys(STATUS_LABEL).map(k => <li key={k}><StatusBadge status={k} /> <span className="small">{STATUS_LABEL[k].tip}</span></li>)}</ul>
        <p className="small muted">If a time or fare is missing we show "Timing unavailable" or "Fare not verified" rather than guessing.</p>
      </section>

      <section className="card">
        <div className="card-title">Data sources</div>
        {!data ? <p className="muted">Loading…</p> : data.sources.length === 0 ? <p className="muted">No sources recorded yet.</p> : (
          <table className="table"><thead><tr><th>Source</th><th>Type</th><th>Routes</th></tr></thead><tbody>
            {data.sources.map(s => <tr key={s.id}><td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.notes && <div className="small muted">{s.notes}</div>}</td><td>{s.type.replace('_', ' ')}</td><td>{s.routeCount}</td></tr>)}
          </tbody></table>)}
      </section>

      <FeedbackForm />
      {data && <SuggestForm stops={data.stops} />}
      <p className="small"><a href={href('admin')}>Staff sign-in</a></p>
    </div>
  )
}
