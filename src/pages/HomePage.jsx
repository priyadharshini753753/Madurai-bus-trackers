import { useEffect, useMemo, useState } from 'react'
import { api, cachedGet } from '../lib/api'
import { nowIST, fmtMinutes, fmtDuration } from '../lib/format'
import { useLoad } from '../hooks/useLoad'
import { useOnline } from '../hooks/useOnline'
import StopInput from '../components/StopInput'
import VoiceSearch from '../components/VoiceSearch'
import LegCard from '../components/LegCard'
import { Loading, ErrorBox, Empty, Notice } from '../components/ui'
import { href } from '../hooks/useHashRoute'

const FILTERS = [['all', 'All buses'], ['govt', 'Government'], ['private', 'Private'], ['minibus', 'Mini-bus']]
const pad = n => String(n).padStart(2, '0')

export default function HomePage() {
  const online = useOnline()
  const { data, error, loading, reload } = useLoad(() => cachedGet('/stops'))
  const stops = data?.data.stops || []
  const now = useMemo(() => nowIST(), [])

  const [from, setFrom] = useState(null)
  const [to, setTo] = useState(null)
  const [type, setType] = useState('all')
  const [date, setDate] = useState(now.dateStr)
  const [time, setTime] = useState(`${pad(Math.floor(now.minutes / 60))}:${pad(now.minutes % 60)}`)
  const [cands, setCands] = useState({ from: [], to: [] })
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function fromVoice(r) {
    setType(r.type)
    setFrom(r.fromCandidates.length === 1 ? r.fromCandidates[0] : null)
    setTo(r.toCandidates.length === 1 ? r.toCandidates[0] : null)
    setCands({ from: r.fromCandidates.length > 1 ? r.fromCandidates : [], to: r.toCandidates.length > 1 ? r.toCandidates : [] })
  }

  async function search() {
    setBusy(true); setErr(null); setRes(null)
    try { setRes(await api.get(`/search?from=${from}&to=${to}&type=${type}&date=${date}&time=${time}`)) }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  // Re-run when the filter changes after a search.
  useEffect(() => { if (res && from && to) search() }, [type]) // eslint-disable-line

  const swap = () => { setFrom(to); setTo(from); setCands({ from: [], to: [] }) }
  const same = from && to && from === to
  const name = id => stops.find(s => s.id === id)?.nameEn

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const empty = res && !res.direct.length && !res.transfers.length
  return (
    <div className="page">
      {data.fromCache && <Notice>Offline: showing the stop list saved on this device.</Notice>}
      <VoiceSearch stops={stops} onResult={fromVoice} />

      <section className="card" aria-label="Route search">
        <div className="card-title">Where to? · எங்கே போகணும்?</div>
        <StopInput label="From · எங்கிருந்து" stops={stops} value={from} onChange={id => { setFrom(id); setCands(c => ({ ...c, from: [] })) }} />
        {cands.from.length > 0 && <Pick label="Which starting stop?" ids={cands.from} name={name} onPick={id => { setFrom(id); setCands(c => ({ ...c, from: [] })) }} />}
        <div className="swap-row"><span className="rule" /><button className="swap-btn" onClick={swap} aria-label="Swap from and to">⇅</button><span className="rule" /></div>
        <StopInput label="To · எங்கே" stops={stops} value={to} onChange={id => { setTo(id); setCands(c => ({ ...c, to: [] })) }} />
        {cands.to.length > 0 && <Pick label="Which destination?" ids={cands.to} name={name} onPick={id => { setTo(id); setCands(c => ({ ...c, to: [] })) }} />}
        {same && <Notice kind="bad">Starting stop and destination are the same.</Notice>}

        <div className="seg" role="group" aria-label="Bus type filter">
          {FILTERS.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>{l}</button>)}
        </div>
        <div className="row2">
          <div className="field"><label htmlFor="d">Date</label><input id="d" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="t">Depart after</label><input id="t" type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
        </div>
        <button className="btn primary wide" disabled={!from || !to || same || busy || !online} onClick={search}>
          {busy ? 'Searching…' : 'Find buses'}
        </button>
        {!online && <div className="field-hint bad">You are offline. Search needs internet. Saved routes still work.</div>}
      </section>

      {err && <ErrorBox error={err} onRetry={search} />}
      {busy && <Loading text="Searching… தேடுகிறது" />}

      {res && !busy && (
        <section aria-live="polite">
          <p className="muted small">{name(res.query.from)} → {name(res.query.to)} · {date} · after {fmtMinutes(res.query.afterMin)}</p>
          {empty && (
            <Empty icon="🔍">
              <p><strong>No bus found between these stops</strong> in the data we have{type !== 'all' ? ` for ${FILTERS.find(f => f[0] === type)[1]}` : ''}.</p>
              <p className="muted">That can mean the route is not added yet, not that no bus runs. Try nearby stops{type !== 'all' ? ', or "All buses"' : ''}, or
                {' '}<a href={href('about')}>tell us about a route</a>.</p>
            </Empty>)}
          {res.direct.length > 0 && <h2 className="section">Direct buses · {res.direct.length}</h2>}
          {res.direct.map(l => <LegCard key={l.routeId} leg={l} />)}
          {res.transfers.length > 0 && <h2 className="section">With one change · ஒரு மாற்றத்துடன்</h2>}
          {res.transfers.map((t, i) => (
            <div key={i} className="transfer">
              <div className="transfer-head">Change at <strong>{t.transferStop}</strong> · wait ~{fmtDuration(t.waitMin)} · arrive ~{fmtMinutes(t.arriveMin)} <span className="muted">(estimate)</span></div>
              {t.legs.map(l => <LegCard key={l.routeId} leg={l} />)}
            </div>
          ))}
          {!empty && <p className="muted small">{res.note}</p>}
        </section>
      )}
    </div>
  )
}

function Pick({ label, ids, name, onPick }) {
  return (
    <div className="pick" role="group" aria-label={label}>
      <span className="muted small">{label}</span>
      {ids.map(id => <button key={id} className="chip-btn" onClick={() => onPick(id)}>{name(id)}</button>)}
    </div>
  )
}
