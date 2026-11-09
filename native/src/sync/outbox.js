import { applyDayOps } from '../body/day-ops.js'

// What to send: the server's document, untouched, plus the workouts it does not have yet and
// this phone's weigh-in changes by day (day-ops.js).
// Nothing else is changed, so keys this app does not know survive. The one addition: a document
// with no unit is sent as pounds, which this app logs in (the web, the carry-over and the MCP
// read a missing unit as kilograms).
export function buildPush(copy, pending, pendingWeighIns = []) {
  const held = Array.isArray(copy.state.workouts) ? copy.state.workouts : []
  const have = new Set(held.map(w => w?.id))
  const add = []
  for (const w of pending) {
    if (have.has(w.id)) continue
    have.add(w.id)
    add.push(w)
  }
  // Weigh-ins go in by day under the guards; nothing is pushed for ones that cannot apply, nor
  // for tidying the list alone, so `bodyweight` stays the copy's own unless one applies.
  const days = applyDayOps(copy.state.bodyweight, pendingWeighIns)
  if (!add.length && !days.applied.length) return null
  return {
    state: {
      ...copy.state,
      unit: copy.state.unit ?? 'lb',
      workouts: add.length ? [...held, ...add] : copy.state.workouts,
      ...(days.applied.length ? { bodyweight: days.next } : {}),
    },
    baseRev: copy.rev,
    baseWid: copy.wid,
  }
}
