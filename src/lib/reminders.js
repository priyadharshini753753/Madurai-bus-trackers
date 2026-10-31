// Last-bus reminders. Stored on device with a snapshot of the route so they work offline.
import { idb } from './idb'
import { lastBusAt } from '../../shared/planner.js'
import { nowIST } from '../../shared/time.js'
import { notify } from './notify'
import { fmtMinutes } from '../../shared/time.js'

export const listReminders = async () => (await idb.list('reminder:')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
export const saveReminder = async r => { await idb.set('reminder:' + r.id, r); window.dispatchEvent(new Event('mbt:reminders-changed')) }
export const deleteReminder = async id => { await idb.del('reminder:' + id); window.dispatchEvent(new Event('mbt:reminders-changed')) }

/** { lastMin, notifyAt } for today, or null when there is no scheduled bus today. */
export function reminderTimes(rem, now = nowIST()) {
  const lastMin = lastBusAt(rem.route, rem.stopId, now.dateStr)
  return lastMin == null ? null : { lastMin, notifyAt: lastMin - rem.leadMin }
}

export async function checkReminders() {
  const now = nowIST()
  for (const rem of await listReminders()) {
    if (!rem.enabled || rem.lastFired === now.dateStr) continue
    const t = reminderTimes(rem, now)
    if (!t || now.minutes < t.notifyAt || now.minutes > t.lastMin) continue
    await notify(`Last bus: route ${rem.route.routeNo}`,
      `Scheduled last bus from ${rem.stopName} is at ${fmtMinutes(t.lastMin)} (${rem.leadMin} min from the reminder). ` +
      `This is the timetable, not live status${rem.route.status === 'verified' ? '' : '. The timing is not verified'}.`)
    await saveReminder({ ...rem, lastFired: now.dateStr })
  }
}
