// Time helpers. All schedule times are minutes since midnight, India Standard Time.
export const TZ = 'Asia/Kolkata'

export function nowIST(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value])
  )
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`
  return { dateStr, minutes: Number(parts.hour) * 60 + Number(parts.minute), isoDow: isoDow(dateStr) }
}

// 1 = Monday … 7 = Sunday
export function isoDow(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h > 23 || min > 59 ? null : h * 60 + min
}

export function fmtMinutes(total) {
  if (total == null) return null
  const day = Math.floor(total / 1440)
  const m = ((total % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0')
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}${day > 0 ? ' (+1 day)' : ''}`
}

export function fmtDuration(min) {
  if (min == null) return null
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim()
}
