// Pure journey planner: direct routes + one-transfer journeys. No I/O.
import { estimateArrival, stopOffset } from './eta.js'
import { isoDow } from './time.js'

export const MIN_TRANSFER_MIN = 5
const MAX_UPCOMING = 3

/** Departure minutes (from the route's first stop) that run on dateStr, sorted. */
export function tripsOn(route, dateStr) {
  const dow = isoDow(dateStr)
  return route.trips
    .filter(t => t.days.includes(dow) &&
      (!t.validFrom || t.validFrom <= dateStr) && (!t.validTo || t.validTo >= dateStr))
    .map(t => t.depMin)
    .sort((a, b) => a - b)
}

const idx = (route, stopId) => route.stops.findIndex(s => s.stopId === stopId)

/** One bus leg from fromId to toId on `route`, or null if the route cannot do it. */
export function buildLeg(route, fromId, toId, dateStr, afterMin = 0) {
  const fi = idx(route, fromId), ti = idx(route, toId)
  if (fi < 0 || ti < 0 || fi >= ti) return null
  const boardOffset = stopOffset(route, fi), alightOffset = stopOffset(route, ti)
  const deps = tripsOn(route, dateStr)
  const all = deps.map(d => estimateArrival({ departureMin: d, boardOffset, alightOffset }))
  const timed = all.filter(e => e.boardMin != null)
  const upcoming = timed.filter(e => e.boardMin >= afterMin).slice(0, MAX_UPCOMING)
  const base = estimateArrival({ departureMin: 0, boardOffset, alightOffset })
  return {
    routeId: route.id,
    routeNo: route.routeNo,
    operator: route.operator,
    busType: route.busType,
    color: route.color,
    status: route.status,
    isSample: route.isSample,
    verifiedAt: route.verifiedAt,
    source: route.source,
    fromStopId: fromId, toStopId: toId,
    boardingStop: route.stops[fi].name,
    destinationStop: route.stops[ti].name,
    intermediateStops: route.stops.slice(fi + 1, ti).map(s => s.name),
    stopCount: ti - fi,
    durationMin: base.durationMin,                       // null → "duration unavailable"
    scheduleAvailable: deps.length > 0,
    timingAvailable: timed.length > 0,
    upcoming: upcoming.map(e => ({ boardMin: e.boardMin, alightMin: e.alightMin })),
    firstBoardMin: timed[0]?.boardMin ?? null,
    lastBoardMin: timed[timed.length - 1]?.boardMin ?? null,
    tripsToday: deps.length,
    estimateBasis: 'estimate-from-schedule',
  }
}

/** Last scheduled boarding time (minutes) at a stop on a date, or null. */
export function lastBusAt(route, stopId, dateStr) {
  const leg = buildLeg(route, stopId, route.stops[route.stops.length - 1].stopId, dateStr, 0)
  return leg ? leg.lastBoardMin : null
}

const typeOk = (route, type) => !type || type === 'all' || route.operator.type === type

export function planJourneys({ routes, fromId, toId, dateStr, afterMin = 0, type = 'all' }) {
  const pool = routes.filter(r => typeOk(r, type))

  const direct = pool
    .map(r => buildLeg(r, fromId, toId, dateStr, afterMin))
    .filter(Boolean)
    .sort((a, b) => (a.upcoming[0]?.boardMin ?? Infinity) - (b.upcoming[0]?.boardMin ?? Infinity))

  const transfers = []
  for (const a of pool) {
    const fi = idx(a, fromId)
    if (fi < 0) continue
    for (let k = fi + 1; k < a.stops.length; k++) {
      const viaId = a.stops[k].stopId
      if (viaId === toId) continue
      for (const b of pool) {
        if (b.id === a.id) continue
        const m = idx(b, viaId), j = idx(b, toId)
        if (m < 0 || j < 0 || m >= j) continue
        const leg1 = buildLeg(a, fromId, viaId, dateStr, afterMin)
        if (!leg1 || !leg1.timingAvailable || leg1.durationMin == null) continue
        const bBoardOffset = stopOffset(b, m), bAlightOffset = stopOffset(b, j)
        if (bBoardOffset == null || bAlightOffset == null) continue
        const bDeps = tripsOn(b, dateStr)
        const aDeps = tripsOn(a, dateStr)
        const aBoardOffset = stopOffset(a, fi)
        for (const d of aDeps) {
          const boardMin = d + aBoardOffset
          if (boardMin < afterMin) continue
          const arriveVia = d + stopOffset(a, k)
          const bDep = bDeps.find(x => x + bBoardOffset >= arriveVia + MIN_TRANSFER_MIN)
          if (bDep == null) continue
          transfers.push({
            transferStop: a.stops[k].name,
            transferStopId: viaId,
            waitMin: bDep + bBoardOffset - arriveVia,
            departMin: boardMin,
            arriveMin: bDep + bAlightOffset,
            legs: [
              { ...leg1, upcoming: [{ boardMin, alightMin: arriveVia }] },
              { ...buildLeg(b, viaId, toId, dateStr, bDep + bBoardOffset),
                upcoming: [{ boardMin: bDep + bBoardOffset, alightMin: bDep + bAlightOffset }] },
            ],
          })
          break // earliest workable connection for this A/B/via
        }
      }
    }
  }
  transfers.sort((x, y) => x.arriveMin - y.arriveMin)
  // Keep the best option per pair of routes.
  const seen = new Set()
  const bestTransfers = transfers.filter(t => {
    const key = `${t.legs[0].routeId}-${t.legs[1].routeId}`
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, 5)

  return { direct, transfers: bestTransfers }
}
