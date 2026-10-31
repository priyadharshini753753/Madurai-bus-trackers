// Minimal RFC-4180 CSV parse/format (quoted fields, embedded commas/newlines/quotes).
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  const s = String(text).replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(x => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some(x => x.trim() !== '')) rows.push(row)
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  return rows.slice(1).map((r, i) => ({
    _row: i + 2,
    ...Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])),
  }))
}

// Cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
export function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (header, rows) =>
  [header.join(','), ...rows.map(r => header.map(h => csvCell(r[h])).join(','))].join('\n') + '\n'
