import { dumbbells, exercises } from '../shared/training.js'
import { warmupPrompts } from '../science/warmup-prompt.js'
import { warmupRamp } from '../science/warmup-ramp.js'
import { carriedWeight, isDone, isWarmup, shownValues } from './workout-view.js'

// The warm-up prompt on an exercise card: decided here from the view, never in the component.
export const WARMUP_WHY_IDS = Object.freeze(['warmup-loads', 'warmup-prompt'])

// The bar a barbell lift starts from; anything else has none. Same figures as the shared bar.
const BAR = { lb: 45, kg: 20 }
export const barFor = (equipment, unit) => (equipment === 'barbell' ? BAR[unit === 'kg' ? 'kg' : 'lb'] : 0)

const started = slot => isDone(slot) || slot.row?.sides?.L?.done === true || slot.row?.sides?.R?.done === true

/**
 * The two suggested warm-up loads for `entry`, or null when none is offered: only the first
 * exercise of a body part (warmupPrompts), with no warm-up row yet and no work set started, and
 * a work weight above the bar. The load driver is the first work set's shown weight.
 * `equipment` is the catalogue's eq string; `step` and `owned` are the ramp's.
 */
export function warmupPromptFor({ entry, entryIndex, entries, unit = 'lb', equipment, step, owned } = {}) {
  if (!entry || !Array.isArray(entries)) return null
  if (!warmupPrompts(entries.map(e => e.id))[entryIndex]?.prompt) return null
  const slots = entry.sets ?? []
  if (slots.some(isWarmup)) return null
  const work = slots.filter(slot => !isWarmup(slot))
  if (work.length === 0 || work.some(started)) return null
  const first = work[0]
  const working = shownValues(first, null, carriedWeight(entry, first.setId)).w
  const ramp = warmupRamp({ working, step, floor: barFor(equipment, unit), owned, id: entry.id, unit })
  if (ramp.length === 0) return null
  return { sets: ramp.map(({ w, r }) => ({ w, r })), whyIds: [...WARMUP_WHY_IDS] }
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
  return warmupPromptFor({ entry, entryIndex: at, entries, unit, equipment: exercises.EXIDX[id]?.eq, step, owned: ownedFor(state, entry) })
}
