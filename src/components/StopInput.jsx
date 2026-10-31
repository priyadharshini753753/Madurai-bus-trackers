import { useEffect, useId, useState } from 'react'

const norm = s => String(s || '').trim().toLowerCase()
export function findStop(stops, text) {
  const t = norm(text)
  if (!t) return null
  return stops.find(s => norm(s.nameEn) === t || norm(s.nameTa) === t) || null
}

// Type-ahead stop picker: the user types or picks a name; value is the stop id (or null).
export default function StopInput({ label, stops, value, onChange, disabled }) {
  const id = useId()
  const current = stops.find(s => s.id === value)
  const [text, setText] = useState(current?.nameEn || '')
  useEffect(() => { setText(current?.nameEn || '') }, [value, stops.length]) // eslint-disable-line

  function handle(e) {
    const t = e.target.value
    setText(t)
    const hit = findStop(stops, t)
    onChange(hit ? hit.id : null)
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} list={id + '-list'} value={text} onChange={handle} disabled={disabled}
        placeholder="Type or pick a stop" autoComplete="off"
        aria-invalid={!!text && !current} />
      <datalist id={id + '-list'}>
        {stops.map(s => <option key={s.id} value={s.nameEn}>{s.nameTa}</option>)}
      </datalist>
      {text && !current && <div className="field-hint bad">Pick a stop from the list</div>}
    </div>
  )
}
