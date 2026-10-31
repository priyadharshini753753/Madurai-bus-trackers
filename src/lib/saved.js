// Offline favourites: full route snapshot (stops, schedule, fares, alerts) kept on this device.
import { api } from './api'
import { idb } from './idb'

export const listSaved = async () => (await idb.list('saved:')).sort((a, b) => a.route.routeNo.localeCompare(b.route.routeNo, undefined, { numeric: true }))
export const getSaved = id => idb.get('saved:' + id)
export const isSaved = async id => !!(await getSaved(id))
export const getLastSync = async () => (await idb.get('lastSync')) || null

export async function saveRoute(detail) {
  const now = new Date().toISOString()
  await idb.set('saved:' + detail.route.id, { ...detail, savedAt: now, syncedAt: now })
  await idb.set('lastSync', now)
  window.dispatchEvent(new Event('mbt:saved-changed'))
}
export async function removeSaved(id) {
  await idb.del('saved:' + id)
  window.dispatchEvent(new Event('mbt:saved-changed'))
}

/** Re-downloads every saved route. Returns per-route results; never throws. */
export async function refreshAll() {
  const items = await listSaved()
  const results = []
  for (const it of items) {
    try {
      const fresh = await api.get('/routes/' + it.route.id)
      const now = new Date().toISOString()
      await idb.set('saved:' + it.route.id, { ...fresh, savedAt: it.savedAt, syncedAt: now })
      results.push({ id: it.route.id, ok: true })
    } catch (e) {
      if (e.status === 404) {
        await idb.set('saved:' + it.route.id, { ...it, removedFromServer: true })
        results.push({ id: it.route.id, ok: false, reason: 'Route is no longer in the system' })
      } else results.push({ id: it.route.id, ok: false, reason: e.message })
    }
  }
  if (results.some(r => r.ok)) await idb.set('lastSync', new Date().toISOString())
  window.dispatchEvent(new Event('mbt:saved-changed'))
  return results
}

/** Route detail from the server, or from the saved copy when offline. */
export async function loadRouteDetail(id) {
  try { return { ...(await api.get('/routes/' + id)), offline: false } }
  catch (e) {
    if (e.status === 0) { const s = await getSaved(id); if (s) return { ...s, offline: true } }
    throw e
  }
}
