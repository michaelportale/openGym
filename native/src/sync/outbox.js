import { applyDayOps } from '../body/day-ops.js'
import { applyRoutineEdits } from '../plan/routine-guard.js'

// What to send: the server's document, untouched, plus the workouts it does not have yet, this
// phone's weigh-in changes by day (day-ops.js) and its routine edits that can go
// (routine-guard.js), each replacing its own routine whole.
// Nothing else is changed, so keys this app does not know survive. The one addition: a document
// with no unit is sent as pounds, which this app logs in (the web, the carry-over and the MCP
// read a missing unit as kilograms).
// `routineEdits` lists the edits this push carries, as sent and with the base each was listed on,
// for the store's markSent.
export function buildPush(copy, pending, pendingWeighIns = [], pendingRoutineEdits = []) {
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
  const days = applyDayOps(copy.state.bodyweight, pendingWeighIns, copy.state.deleted?.bodyweight)
  // Routine edits the same way: `routines` stays the copy's own unless one applies or rebases;
  // one that is done or superseded is settled by the sync engine's reconcile, never sent.
  const plan = applyRoutineEdits(copy.state.routines, pendingRoutineEdits)
  const carried = [...plan.applied, ...plan.rebased]
  if (!add.length && !days.applied.length && !carried.length) return null
  return {
    state: {
      ...copy.state,
      unit: copy.state.unit ?? 'lb',
      // a list as sent for workouts, even when only weigh-ins go (a non-list reads as empty)
      workouts: add.length || !Array.isArray(copy.state.workouts) ? [...held, ...add] : copy.state.workouts,
      ...(days.applied.length ? { bodyweight: days.next } : {}),
      ...(carried.length ? { routines: plan.next } : {}),
    },
    baseRev: copy.rev,
    baseWid: copy.wid,
    // as it goes: the edit's content on the copy's stamps (routine-guard.js), and the listed row's
    // baseTs, so markSent passes over a row a fresh put started over since
    routineEdits: carried.map(({ rid, t }) => ({
      rid, t, baseTs: pendingRoutineEdits.find(e => e.rid === rid && e.t === t).baseTs, routine: plan.next.find(r => r?.id === rid),
    })),
  }
}
