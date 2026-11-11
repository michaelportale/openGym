import { applyDayOps } from '../body/day-ops.js'
import { applyMeasurementOps } from '../body/measurement-ops.js'
import { applyEdits, entryValue } from './edit-guard.js'

// What to send: the server's document, untouched, plus the workouts it does not have yet, this
// phone's weigh-in and body-measurement changes by day (day-ops.js, measurement-ops.js) and its
// pending edits that can go (edit-guard.js):
// a routine replacing its own routine whole (a new one added at the end; a deleted one left out,
// with its week and dayPlan places), the routines' order only their order in the list, a nutrition
// day its own day, a setting its own key.
// Nothing else is changed, so keys this app does not know survive. The one addition: a document
// with no unit is sent as pounds, which this app logs in (the web, the carry-over and the MCP
// read a missing unit as kilograms).
// `edits` lists the edits this push carries, as sent and with the base each was listed on, for
// the store's markSent.
export function buildPush(copy, pending, pendingWeighIns = [], pendingEdits = [], pendingMeasurements = []) {
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
  // Measurements the same way, under the same typed guard. A removal goes as the day left out:
  // the server records it in deleted.measurements (sync-stamps.js stampUnstamped).
  const measured = applyMeasurementOps(copy.state.measurements, pendingMeasurements, copy.state.deleted?.measurements)
  // Pending edits the same way: the document stays the copy's own unless one applies or rebases,
  // and then only its own routine (with a deleted one's week and dayPlan places), the order of the
  // routines, day or setting moves; one that is done or superseded is settled by the sync engine's
  // reconcile, never sent.
  // A queued workout must keep its custom exercises, even if the delete was queued first.
  const withWorkouts = add.length ? { ...copy.state, workouts: [...held, ...add] } : copy.state
  const plan = applyEdits(withWorkouts, pendingEdits)
  const carried = [...plan.applied, ...plan.rebased]
  if (!add.length && !days.applied.length && !measured.applied.length && !carried.length) return null
  return {
    state: {
      ...plan.state, // the copy's own document when nothing is carried
      unit: copy.state.unit ?? 'lb',
      // a list as sent for workouts, even when only weigh-ins go (a non-list reads as empty)
      workouts: add.length || !Array.isArray(copy.state.workouts) ? [...held, ...add] : copy.state.workouts,
      ...(days.applied.length ? { bodyweight: days.next } : {}),
      ...(measured.applied.length ? { measurements: measured.next } : {}),
    },
    baseRev: copy.rev,
    baseWid: copy.wid,
    // as it goes: the edit's content on the copy's stamps (edit-guard.js), and the listed row's
    // baseTs, so markSent passes over a row a fresh put started over since
    edits: carried.map(({ kind, key, t }) => ({
      kind, key, t, baseTs: pendingEdits.find(e => e.kind === kind && e.key === key && e.t === t).baseTs, value: entryValue(plan.state, kind, key),
    })),
  }
}
