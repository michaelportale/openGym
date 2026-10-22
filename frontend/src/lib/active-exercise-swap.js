import { supersetUnits, unitOf } from './history.js'
import { hasCompletedWork } from './workout-model.js'

function hasLoggedSet(entry) {
  return Array.isArray(entry?.sets) && entry.sets.some(hasCompletedWork)
}

/**
 * Swap one exact active-workout occurrence.
 *
 * Unlogged occurrences are replaced in place. Logged results are never relabelled: after explicit
 * confirmation, the replacement is inserted beside the original. A logged group member also
 * requires an explicit choice to keep the replacement in the group or detach it after the group.
 */
export function swapActiveExercise(active, index, replacement, {
  loggedConfirmed = false,
  groupDisposition
} = {}) {
  if (!active || !Array.isArray(active.entries) || !replacement || index < 0 || index >= active.entries.length) return null

  const current = active.entries[index]
  if (!hasLoggedSet(current)) {
    const metadata = Object.fromEntries(Object.entries(current).filter(([key]) => (
      !['id', 'target', 'plan', 'planned', 'carried', 'sets', 'sg'].includes(key)
    )))
    active.entries[index] = { ...metadata, ...replacement, ...(current.sg ? { sg: current.sg } : {}) }
    active.cur = index
    return { inserted: false, index }
  }

  if (!loggedConfirmed) return { needsConfirmation: true, grouped: !!current.sg, index }
  if (current.sg && !['keep', 'detach'].includes(groupDisposition)) {
    return { needsConfirmation: true, grouped: true, index }
  }

  const unit = unitOf(supersetUnits(active.entries), index)
  const keepGroup = current.sg && groupDisposition === 'keep'
  const insertAt = keepGroup ? index + 1 : (unit.length > 1 ? unit.at(-1) + 1 : index + 1)
  active.entries.splice(insertAt, 0, {
    ...replacement,
    // A swap does not change which routine the slot belongs to — carry its `rid` the same
    // way `sg` is carried, so a combined session's WorkoutDetail groups stay contiguous.
    ...(current.rid ? { rid: current.rid } : {}),
    ...(keepGroup ? { sg: current.sg } : {})
  })
  active.cur = insertAt
  return { inserted: true, index: insertAt }
}

/** A unique source slot is required: session additions/reorders cannot prove duplicate ancestry. */
export function previewRoutineSwap(active, routines, index, config) {
  const current = active?.entries?.[index]
  const rid = current?.rid || active?.routineId
  const routine = rid && routines.find(r => r.id === rid)
  const matches = routine?.ex.map((cfg, i) => cfg.id === current?.id ? i : -1).filter(i => i >= 0) || []
  if (matches.length !== 1) return null
  const slot = matches[0]
  const before = structuredClone(routine.ex[slot])
  return { routineId: rid, routineName: routine.name, index: slot, before,
    after: { ...structuredClone(config), ...(before.sg ? { sg: before.sg } : {}) } }
}

/** Apply only the exact preview the user saw; stale or already accepted previews do nothing. */
export function applyRoutineSwap(routines, preview) {
  const routine = routines.find(r => r.id === preview?.routineId)
  if (!routine || JSON.stringify(routine.ex[preview.index]) !== JSON.stringify(preview.before)) return false
  routine.ex[preview.index] = structuredClone(preview.after)
  return true
}
