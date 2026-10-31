// Schedule-based ETA. No live GPS and no traffic data are used anywhere here.
//
// An "ETA provider" is any object with  estimate({ departureMin, boardOffset, alightOffset })
// returning { boardMin, alightMin, durationMin, available, basis }.
// A future live-GPS provider can implement the same interface and be passed
// to estimateArrival() without touching the planner or the UI.

export const scheduleEtaProvider = {
  name: 'schedule',
  basis: 'estimate-from-schedule',
  estimate({ departureMin, boardOffset, alightOffset }) {
    const hasDeparture = Number.isFinite(departureMin)
    const hasOffsets = Number.isFinite(boardOffset) && Number.isFinite(alightOffset) && alightOffset >= boardOffset
    return {
      boardMin: hasDeparture && Number.isFinite(boardOffset) ? departureMin + boardOffset : null,
      alightMin: hasDeparture && Number.isFinite(alightOffset) ? departureMin + alightOffset : null,
      durationMin: hasOffsets ? alightOffset - boardOffset : null,
      available: hasDeparture && hasOffsets,
      basis: 'estimate-from-schedule',
    }
  },
}

export function estimateArrival(input, provider = scheduleEtaProvider) {
  return provider.estimate(input)
}

// Offset of a route stop in minutes. The first stop is always 0; unknown = null.
export function stopOffset(route, idx) {
  if (idx < 0) return null
  const o = route.stops[idx]?.offsetMin
  if (Number.isFinite(o)) return o
  return idx === 0 ? 0 : null
}
