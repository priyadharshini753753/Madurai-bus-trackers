import { useState, useId, cloneElement } from 'react'

export const useToast = () => {
  const [t, set] = useState(null)
  return [t, (kind, text) => set({ kind, text }), t && <div className={`field-hint ${t.kind}`} role="status">{t.text}</div>]
}
export const errText = e => e.fields ? Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join(' · ') : e.message

// Generic add/edit table. fields: [{ key, label, type, options?, placeholder? }]
export function Crud({ title, rows, columns, fields, save, blank, canWrite = true, extraRow }) {
  const [form, setForm] = useState(null)
  const [toast, say, view] = useToast()
  async function submit(e) {
    e.preventDefault()
    try { await save(form); setForm(null); say('ok', 'Saved.') } catch (x) { say('bad', errText(x)) }
  }
  return (
    <div>
      <div className="row-between"><h2>{title}</h2>{canWrite && <button className="btn" onClick={() => setForm({ ...blank })}>+ Add</button>}</div>
      {view}
      {form && (
        <form className="card" onSubmit={submit}>
          {fields.map(f => (
            <div className="field" key={f.key}><label htmlFor={'f-' + f.key}>{f.label}</label>
              {f.type === 'select' ? <select id={'f-' + f.key} value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>{f.options.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
                : f.type === 'checkbox' ? <input id={'f-' + f.key} type="checkbox" checked={!!form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.checked })} />
                : <input id={'f-' + f.key} type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} value={form[f.key] ?? ''} placeholder={f.placeholder} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}
            </div>))}
          <div className="actions"><button className="btn primary" type="submit">Save</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>)}
      <div className="scroll"><table className="table"><thead><tr>{columns.map(c => <th key={c[0]}>{c[0]}</th>)}{canWrite && <th />}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>{columns.map(c => <td key={c[0]}>{c[1](r)}</td>)}
          {canWrite && <td><button className="btn" onClick={() => setForm({ ...r, ...(extraRow ? extraRow(r) : {}) })}>Edit</button></td>}</tr>)}</tbody></table></div>
    </div>)
}

// Label + control with a proper for/id link (screen readers, click-to-focus, test selectors).
export function Field({ label, children }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>
}
