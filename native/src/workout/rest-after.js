import { workoutModel } from '../shared/training.js'
import { isWarmup } from './workout-view.js'

// Completing a set and starting its rest are two journal writes. These helpers rebuild the second
// one from the first, so a kill between them loses nothing.

// Derived from the set and its commit time, so the same completion always names the same rest
// and a skipped rest is not started again after a reopen.
export const restEventId = (setId, at) => `rest:${setId}:${at}`

// The view marks a per-side row completed once either limb is done (it counts toward totals),
// but rest starts only when both are.
const bothDone = row => !workoutModel.isSideSet(row) || (row.sides.L.done === true && row.sides.R.done === true)

// The rest that the latest completed work set should have started, or null when there is none or
// it has already run out. A warm-up starts no rest, so it is never the one to restore.
export function pendingRest(view, now, restMsOf) {
  let latest = null
  for (const entry of view?.entries ?? []) {
    for (const set of entry.sets ?? []) {
      if (!set.completed || isWarmup(set) || !Number.isFinite(set.row?.at) || !bothDone(set.row)) continue
      if (!latest || set.row.at > latest.at) latest = { at: set.row.at, setId: set.setId, exerciseId: entry.id }
    }
  }
  if (!latest) return null
  const deadline = latest.at + restMsOf(latest.exerciseId)
  if (!(deadline > now)) return null
  return { eventId: restEventId(latest.setId, latest.at), deadline }
}

const has = (obj, key) => obj[key] !== undefined

// The fields for commitSet. A commit's fields.sides replaces the row's sides, so both sides are
// written out in full. Never mutates row.
export function completeFields(row, side, values) {
  if (side == null) {
    const fields = {}
    if (has(values, 'w')) fields.w = values.w
    if (has(values, 'r')) fields.r = values.r
    return fields
  }
  const other = side === 'L' ? 'R' : 'L'
  const shared = has(values, 'w')
  const sideOf = key => (shared ? { ...row.sides[key], w: values.w } : { ...row.sides[key] })
  const done = sideOf(side)
  done.done = true
  if (has(values, 'r')) done.r = values.r
  const fields = { sides: { [side]: done, [other]: sideOf(other) } }
  const w = shared ? values.w : row.w
  if (w !== undefined) fields.w = w
  return fields
}

// Rest length in ms: the exercise's own, else the profile's. An own rest of 0 means "Default"
// on the web (supersetFlow.restSecFor), not a rest of no length.
export function restMsFor(entry, profileRestSec) {
  const own = entry?.target?.restSec
  return (Number.isFinite(own) && own > 0 ? own : profileRestSec) * 1000
}
