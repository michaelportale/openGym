import { dumbbells, exercises, history } from '../shared/training.js'
import { warmupPrompts } from '../science/warmup-prompt.js'
import { warmupRamp } from '../science/warmup-ramp.js'
import { carriedWeight, isDone, isWarmup, shownValues } from './workout-view.js'

// The warm-up prompt on an exercise card: decided here from the view, never in the component.

const started = slot => isDone(slot) || slot.row?.sides?.L?.done === true || slot.row?.sides?.R?.done === true

/**
 * The two suggested warm-up loads for `entry`, or null when none is offered: only the first
 * exercise of a body part (warmupPrompts), with no warm-up row yet and no work set started, and
 * a work weight above the bar. The load driver is the first work set's shown weight.
 * `floor` is the bar (history.barFloor, 0 for no bar); `step` and `owned` are the ramp's.
 */
export function warmupPromptFor({ entry, entryIndex, entries, unit = 'lb', floor = 0, step, owned } = {}) {
  if (!entry || !Array.isArray(entries)) return null
  // Offered to reps work on a load that adds weight: an assisted lift's lighter number is the
  // harder one, and a hold or cardio entry has no warm-up reps to write.
  if (exercises.isAssisted(entry) || history.modeOf({ id: entry.id, ...entry.target }) !== 'reps') return null
  if (!warmupPrompts(entries.map(e => e.id))[entryIndex]?.prompt) return null
  const slots = entry.sets ?? []
  if (slots.some(isWarmup)) return null
  const work = slots.filter(slot => !isWarmup(slot))
  if (work.length === 0 || work.some(started)) return null
  const first = work[0]
  const working = shownValues(first, null, carriedWeight(entry, first.setId)).w
  const ramp = warmupRamp({ working, step, floor, owned, id: entry.id, unit })
  if (ramp.length === 0 || !(ramp[0].w > 0)) return null
  return { sets: ramp.map(({ w, r }) => ({ w, r })) }
}

// "Warm-up: 30 × 6, 60 × 6", with "lb each" for a per-hand exercise as the table's heading says.
export function warmupPromptText(sets, perHand) {
  return `Warm-up: ${sets.map(s => `${s.w} × ${s.r}`).join(', ')}${perHand ? ' lb each' : ''}`
}

// The owned dumbbells that apply to this exercise in the way its sets are logged; null when none.
export function ownedFor(state, entry) {
  return dumbbells.ownedWeightsFor(state, { id: entry?.id, dbLoad: entry?.target?.dbLoad }) ?? undefined
}

// The prompt for one exercise in a view, in the profile's unit (state.unit, lb when unset): the
// bar, the load step and the owned bells all follow it. The screen and the write both call this.
export function promptForExercise(view, id, state) {
  const entries = view?.entries ?? []
  const at = entries.findIndex(e => e.id === id)
  if (at < 0) return null
  const entry = entries[at]
  const step = entry.target?.inc > 0 ? entry.target.inc : undefined
  const unit = state?.unit === 'kg' ? 'kg' : 'lb'
  return warmupPromptFor({ entry, entryIndex: at, entries, unit, floor: history.barFloor({ ...state, unit }, id), step, owned: ownedFor(state, entry) })
}
