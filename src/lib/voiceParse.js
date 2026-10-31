// Turns "Madurai lendhu Melur bus timing sollu", "Thirumangalam-ku private bus irukka?" or the Tamil-script
// equivalents into { from, to, type }. Pure functions: easy to test, no browser APIs.
//
// stops: [{ id, nameEn, nameTa, aliases[] }]
const MIN_LEN = 3
const FROM_AFTER = ['lendhu', 'lerndhu', 'lirundhu', 'lairundhu', 'irundhu', 'irunthu', 'lerunthu', 'laerundhu']
const TO_AFTER = ['kku', 'ukku', 'ku', 'varai']
const TA_FROM = ['இருந்து', 'ிருந்து']
const TA_TO = ['க்கு', 'ுக்கு', 'வரை']

const compact = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')

function variants(stop) {
  const out = new Set()
  for (const raw of [stop.nameEn, stop.nameTa, ...(stop.aliases || [])]) {
    const c = compact(raw)
    if (c.length < MIN_LEN) continue
    out.add(c)
    if (/[\u0B80-\u0BFF]/.test(c)) {                       // Tamil: also match inflected stems
      const noVirama = c.replace(/\u0BCD$/, '')
      if (noVirama.length >= MIN_LEN) out.add(noVirama)
      const noMa = c.replace(/ம்$/, '')
      if (noMa.length >= MIN_LEN) out.add(noMa)
    }
  }
  return [...out]
}

export function detectType(text) {
  const t = String(text || '').toLowerCase()
  if (/private|தனியார்|thaniyar|thaniyaar/.test(t)) return 'private'
  if (/mini\s?-?bus|மினி|\bmini\b/.test(t)) return 'minibus'
  if (/govt|government|arasu|அரசு|tnstc/.test(t)) return 'govt'
  return 'all'
}

export function parseVoiceQuery(text, stops) {
  const c = compact(text)
  const spans = new Map()                                  // "start-end" → Set(stopIds)
  for (const s of stops) {
    for (const v of variants(s)) {
      let i = c.indexOf(v)
      while (i !== -1) {
        const key = `${i}-${i + v.length}`
        if (!spans.has(key)) spans.set(key, new Set())
        spans.get(key).add(s.id)
        i = c.indexOf(v, i + 1)
      }
    }
  }
  // Longest spans first; skip anything overlapping an accepted span.
  const chosen = []
  const ordered = [...spans.entries()].map(([k, ids]) => {
    const [a, b] = k.split('-').map(Number); return { a, b, ids: [...ids] }
  }).sort((x, y) => (y.b - y.a) - (x.b - x.a) || x.a - y.a)
  for (const m of ordered) if (!chosen.some(k => m.a < k.b && m.b > k.a)) chosen.push(m)
  chosen.sort((x, y) => x.a - y.a)

  for (const m of chosen) {
    const after = c.slice(m.b, m.b + 14), before = c.slice(Math.max(0, m.a - 6), m.a)
    const afterShort = after.slice(0, 10)
    if (FROM_AFTER.some(w => after.startsWith(w)) || TA_FROM.some(w => afterShort.includes(w)) || before.endsWith('from')) m.role = 'from'
    else if (TO_AFTER.some(w => after.startsWith(w)) || TA_TO.some(w => afterShort.slice(0, 6).includes(w)) || before.endsWith('to') || before.endsWith('varai')) m.role = 'to'
  }
  let from = chosen.find(m => m.role === 'from'), to = chosen.find(m => m.role === 'to')
  const rest = chosen.filter(m => m !== from && m !== to)
  if (!from && !to) {
    if (chosen.length >= 2) { from = chosen[0]; to = chosen[1] }
    else if (chosen.length === 1) to = chosen[0]          // "Melur-ku bus irukka" style: destination only
  } else if (!from && rest.length) from = rest[0]
  else if (!to && rest.length) to = rest[rest.length - 1]

  return {
    fromCandidates: from ? from.ids : [],
    toCandidates: to ? to.ids : [],
    type: detectType(text),
    matched: chosen.length > 0,
  }
}
