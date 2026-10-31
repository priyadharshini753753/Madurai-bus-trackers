export { fmtMinutes, fmtDuration, nowIST, TZ } from '../../shared/time.js'

export const TYPE_LABEL = {
  govt: { en: 'Government', ta: 'அரசு' },
  private: { en: 'Private', ta: 'தனியார்' },
  minibus: { en: 'Mini-bus', ta: 'மினி பஸ்' },
}
export const STATUS_LABEL = {
  verified: { en: 'Verified', ta: 'சரிபார்க்கப்பட்டது', icon: '✔', tip: 'Checked against a recorded source on the date shown.' },
  unverified: { en: 'Unverified', ta: 'சரிபார்க்கப்படவில்லை', icon: '?', tip: 'Not yet checked. Treat timings as a guide only.' },
  outdated: { en: 'Outdated', ta: 'பழையது', icon: '!', tip: 'Verification is old. Confirm at the bus stand.' },
  sample: { en: 'Sample data', ta: 'மாதிரி தரவு', icon: '◌', tip: 'Placeholder record for testing. Not a real timetable.' },
}
export const ALERT_TYPE = {
  cancellation: 'Cancellation', diversion: 'Diversion', stop_change: 'Stop change',
  road_closure: 'Road closure', schedule_change: 'Schedule change',
}
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
export const fmtDay = s => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
