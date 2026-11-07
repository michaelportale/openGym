import { effort } from '../shared/training.js'
import { isWarmupSet } from './warmup.js'
import { whyThis } from './rules.js'

// The phrase the PRD asks for when a lifter reports many reps left.
export const FAR_FROM_FAILURE = 'This looks far from failure.'

/**
 * A new reps-left log. Empty is allowed because the field is optional.
 * A hand-entered value has to be a whole number from 0 to 10.
 */
export function validateRir(value) {
  if (value == null) return { ok: true, rir: null }
  const text = typeof value === 'string' ? value.trim() : value
  if (text === '') return { ok: true, rir: null }
  const whole = typeof text === 'string' && /^-?\d+$/.test(text)
  const n = whole ? Number(text) : text
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) {
    return { ok: false, rir: null, error: 'Reps left must be a whole number from 0 to 10.' }
  }
  return { ok: true, rir: n }
}

/**
 * The progression note for one set. Warm-ups and unrated sets say nothing.
 * A rating above the shared HARD_RIR line is the "many reps left" case.
 * An existing RPE is read through the shared scale and is not rewritten.
 */
export function effortProgressionNote(set) {
  if (isWarmupSet(set)) return null
  const rir = effort.loggedRirOf(set)
  if (rir == null || !(rir > effort.HARD_RIR)) return null
  return FAR_FROM_FAILURE
}

/**
 * Attach that note to a prescription the journal already computed.
 * The weight, reps, and kind are copied through. Effort never changes the load.
 */
export function withEffortNote(prescription, sets) {
  const note = (Array.isArray(sets) ? sets : []).map(effortProgressionNote).find(Boolean) || null
  return { ...(prescription || {}), effortNote: note, changesLoad: false }
}

export function effortWhy() {
  return whyThis('effort-proximity')
}
