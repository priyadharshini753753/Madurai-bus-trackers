import { fmtMinutes } from '../../shared/time.js'

export function buildTripMessage({ routeNo, operator, boarding, destination, departMin, arriveMin, location }) {
  const lines = [
    'My bus trip (Madurai Bus app):',
    `Bus ${routeNo}${operator ? ` · ${operator}` : ''}`,
    `Boarding: ${boarding}`,
    `Going to: ${destination}`,
    departMin != null ? `Scheduled departure: ${fmtMinutes(departMin)}` : 'Departure time: not available',
    arriveMin != null ? `Estimated arrival: ${fmtMinutes(arriveMin)} (estimate, not live)` : 'Estimated arrival: not available',
  ]
  if (location) lines.push(`My location: https://maps.google.com/?q=${location.lat.toFixed(5)},${location.lng.toFixed(5)}`)
  return lines.join('\n')
}

export function buildSosMessage({ location }) {
  return ['EMERGENCY – I need help. Please call me or contact the police (112).',
    location ? `My location: https://maps.google.com/?q=${location.lat.toFixed(5)},${location.lng.toFixed(5)}` : 'My location could not be shared.']
    .join('\n')
}

export const smsHref = (number, text) => `sms:${number}?&body=${encodeURIComponent(text)}`
export const whatsappHref = (number, text) => `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`

/** Uses the system share sheet when available. Never claims delivery: only what actually happened. */
export async function shareText(text, title = 'Madurai Bus') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return { ok: true, message: 'Share sheet closed after sharing. Check that the message was sent in the app you picked.' } }
    catch (e) { return e?.name === 'AbortError' ? { ok: false, message: 'Sharing was cancelled. Nothing was sent.' } : { ok: false, message: 'Sharing failed on this device. Use copy or the SMS/WhatsApp buttons.' } }
  }
  try { await navigator.clipboard.writeText(text); return { ok: true, message: 'This browser cannot open a share sheet. The message was copied. Paste it into a chat yourself.' } }
  catch { return { ok: false, message: 'Could not share or copy automatically. Select the message text and copy it.' } }
}

export function getLocation() {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, reason: 'unsupported', message: 'This device or browser does not support location.' })
    navigator.geolocation.getCurrentPosition(
      p => resolve({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude }),
      e => resolve({ ok: false, reason: e.code === 1 ? 'denied' : 'unavailable',
        message: e.code === 1 ? 'Location permission was denied, so no location is included.' : 'Could not get your location right now.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  })
}
