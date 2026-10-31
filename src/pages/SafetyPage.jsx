import { useEffect, useRef, useState } from 'react'
import { cachedGet } from '../lib/api'
import { listSaved, loadRouteDetail } from '../lib/saved'
import { idb } from '../lib/idb'
import { tripsOn, buildLeg } from '../../shared/planner.js'
import { nowIST, fmtMinutes } from '../lib/format'
import { buildTripMessage, buildSosMessage, shareText, getLocation, smsHref, whatsappHref } from '../lib/share'
import { EMERGENCY } from '../config/emergency'
import { Notice } from '../components/ui'

const cleanPhone = s => String(s).replace(/[\s\-().]/g, '')
const validPhone = s => /^\+?\d{10,15}$/.test(cleanPhone(s))

export default function SafetyPage({ query }) {
  const [contacts, setContacts] = useState([])
  const [name, setName] = useState(''), [phone, setPhone] = useState('')
  const [cErr, setCErr] = useState(null)

  const [routes, setRoutes] = useState([])
  const [routeId, setRouteId] = useState(query.route ? Number(query.route) : null)
  const [detail, setDetail] = useState(null)
  const [fromId, setFromId] = useState(query.from ? Number(query.from) : null)
  const [toId, setToId] = useState(query.to ? Number(query.to) : null)
  const [withLoc, setWithLoc] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState(null)

  const [sosOpen, setSosOpen] = useState(false)
  const [sosLoc, setSosLoc] = useState(false)
  const [sos, setSos] = useState(null)          // { text, locNote }
  const confirmRef = useRef(null)

  const loadContacts = async () => setContacts((await idb.list('contact:')).sort((a, b) => a.name.localeCompare(b.name)))
  useEffect(() => {
    loadContacts();
    (async () => {
      try { setRoutes((await cachedGet('/routes')).data.routes) }
      catch { setRoutes((await listSaved()).map(s => ({ id: s.route.id, routeNo: s.route.routeNo, origin: s.route.stops[0]?.name, destination: s.route.stops.at(-1)?.name }))) }
    })()
  }, [])
  useEffect(() => {
    setDetail(null)
    if (routeId) loadRouteDetail(routeId).then(d => {
      setDetail(d)
      const ids = d.route.stops.map(s => s.stopId)
      setFromId(f => ids.includes(f) ? f : ids[0]); setToId(t => ids.includes(t) ? t : ids.at(-1))
    }).catch(() => {})
  }, [routeId])
  useEffect(() => { if (sosOpen) confirmRef.current?.focus() }, [sosOpen])

  async function addContact(e) {
    e.preventDefault(); setCErr(null)
    if (!name.trim()) return setCErr('Enter a name.')
    if (!validPhone(phone)) return setCErr('Enter a valid phone number (10–15 digits, optional +country code).')
    if (contacts.length >= 5) return setCErr('You can keep up to 5 trusted contacts.')
    const id = crypto.randomUUID()
    await idb.set('contact:' + id, { id, name: name.trim().slice(0, 60), phone: cleanPhone(phone) })
    setName(''); setPhone(''); loadContacts()
  }
  const removeContact = async c => { await idb.del('contact:' + c.id); loadContacts() }

  async function prepareTrip() {
    setResult(null)
    const r = detail.route
    const today = nowIST()
    const leg = buildLeg(r, fromId, toId, today.dateStr, today.minutes)
    if (!leg) return setResult({ ok: false, message: 'Choose a boarding stop that comes before the destination on this route.' })
    const next = leg.upcoming[0]
    let location = null, note = ''
    if (withLoc) {
      const loc = await getLocation()
      if (loc.ok) location = loc; else note = loc.message
    }
    setMessage(buildTripMessage({ routeNo: r.routeNo, operator: r.operator.name, boarding: leg.boardingStop, destination: leg.destinationStop, departMin: next?.boardMin, arriveMin: next?.alightMin, location }))
    if (note) setResult({ ok: false, message: note })
  }
  async function doShare() { setResult(await shareText(message, 'My bus trip')) }
  async function doCopy() {
    try { await navigator.clipboard.writeText(message); setResult({ ok: true, message: 'Message copied.' }) }
    catch { setResult({ ok: false, message: 'Could not copy automatically. Select the text and copy it yourself.' }) }
  }

  async function confirmSos() {
    let loc = null, locNote = 'Location sharing was off.'
    if (sosLoc) {
      const l = await getLocation()
      if (l.ok) { loc = l; locNote = 'Your location is included in the message.' } else locNote = l.message
    }
    setSos({ text: buildSosMessage({ location: loc }), locNote })
    setSosOpen(false)
  }

  const stopsList = detail?.route.stops || []
  return (
    <div className="page">
      <h1>Women's Safety Mode · பாதுகாப்பு</h1>
      <Notice kind="bad"><strong>If you are in danger, call 112 now.</strong> This app cannot call the police or send messages for you automatically. Anything you share is sent only after you choose an app and press send there.</Notice>

      <section className="card">
        <div className="card-title">Emergency numbers (India)</div>
        <ul className="emerg">{EMERGENCY.map(e => <li key={e.number}><a className="btn call" href={`tel:${e.number}`}>Call {e.number}</a> {e.label} · {e.labelTa}</li>)}</ul>
        <p className="small muted">These are national numbers. Confirm they work for you. Calls need phone signal.</p>
      </section>

      <section className="card sos-card">
        <button className="sos" onClick={() => { setSos(null); setSosOpen(true) }}>SOS · உதவி</button>
        <p className="small">Opens a confirmation first, so it cannot be triggered by accident. Nothing is sent until you confirm and pick an app.</p>
        {sos && (
          <div className="sos-out" role="alert">
            <p><strong>Step 1:</strong> <a className="btn call big" href="tel:112">Call 112</a></p>
            <p><strong>Step 2 (optional):</strong> message your trusted contacts. {sos.locNote}</p>
            <textarea readOnly value={sos.text} rows={4} aria-label="Emergency message" />
            <div className="actions">
              <button className="btn" onClick={async () => setResult(await shareText(sos.text, 'Emergency'))}>Share message…</button>
              {contacts.map(c => <a key={c.id} className="btn" href={smsHref(c.phone, sos.text)}>SMS {c.name}</a>)}
            </div>
            {contacts.length === 0 && <p className="small muted">Add trusted contacts below to message them directly.</p>}
            <p className="small muted">Opening SMS or a share sheet does not send the message. Press send in that app.</p>
          </div>)}
      </section>

      {sosOpen && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="sos-t" onKeyDown={e => e.key === 'Escape' && setSosOpen(false)}>
          <div className="modal">
            <h2 id="sos-t">Do you need help now?</h2>
            <p>This will prepare an emergency message and show the 112 call button. Nothing is sent automatically.</p>
            <label className="inline"><input type="checkbox" checked={sosLoc} onChange={e => setSosLoc(e.target.checked)} /> Include my current location in the message (asks your device for permission)</label>
            <div className="actions">
              <button ref={confirmRef} className="btn" onClick={() => setSosOpen(false)}>Cancel</button>
              <button className="btn sosbtn" onClick={confirmSos}>Yes, I need help</button>
            </div>
          </div>
        </div>)}

      <section className="card">
        <div className="card-title">Trusted contacts · நம்பகமான தொடர்புகள்</div>
        <p className="small muted">Saved only on this device. They are never uploaded or shown to anyone else.</p>
        {contacts.map(c => <div key={c.id} className="row-between contact"><span><strong>{c.name}</strong> · {c.phone}</span>
          <button className="btn danger" onClick={() => removeContact(c)} aria-label={`Remove ${c.name}`}>Remove</button></div>)}
        <form onSubmit={addContact} className="row2">
          <div className="field"><label htmlFor="cn">Name</label><input id="cn" value={name} onChange={e => setName(e.target.value)} maxLength={60} /></div>
          <div className="field"><label htmlFor="cp">Phone</label><input id="cp" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91…" /></div>
          <button className="btn" type="submit">Add contact</button>
        </form>
        {cErr && <div className="field-hint bad" role="alert">{cErr}</div>}
      </section>

      <section className="card">
        <div className="card-title">Share my trip · பயணத்தைப் பகிர்</div>
        <div className="field"><label htmlFor="sr">Route</label>
          <select id="sr" value={routeId ?? ''} onChange={e => { setRouteId(Number(e.target.value) || null); setMessage('') }}>
            <option value="">Choose a route</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.routeNo} · {r.origin} → {r.destination}</option>)}</select></div>
        {detail && <>
          <div className="row2">
            <div className="field"><label htmlFor="sf">Boarding point</label><select id="sf" value={fromId ?? ''} onChange={e => setFromId(Number(e.target.value))}>{stopsList.map(s => <option key={s.stopId} value={s.stopId}>{s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="st">Destination</label><select id="st" value={toId ?? ''} onChange={e => setToId(Number(e.target.value))}>{stopsList.map(s => <option key={s.stopId} value={s.stopId}>{s.name}</option>)}</select></div>
          </div>
          <label className="inline"><input type="checkbox" checked={withLoc} onChange={e => setWithLoc(e.target.checked)} /> Include my current location (asks permission)</label>
          <button className="btn primary" onClick={prepareTrip}>Prepare message</button>
        </>}
        {message && <>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={7} aria-label="Trip message" />
          <div className="actions">
            <button className="btn" onClick={doShare}>Share…</button>
            <button className="btn" onClick={doCopy}>Copy</button>
            {contacts.map(c => <span key={c.id} className="inline-actions">
              <a className="btn" href={smsHref(c.phone, message)}>SMS {c.name}</a>
              <a className="btn" href={whatsappHref(c.phone, message)} target="_blank" rel="noreferrer">WhatsApp {c.name}</a></span>)}
          </div>
          <p className="small muted">Times in the message are scheduled times and estimates, not live tracking.</p>
        </>}
        {result && <div className={`field-hint ${result.ok ? 'ok' : 'bad'}`} role="status">{result.message}</div>}
      </section>
    </div>
  )
}
