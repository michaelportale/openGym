import { workoutModel } from '../shared/training.js'
import { whyThis } from './rules.js'

// Warm-ups stay in the log. These four reads ignore them. The shared engine already
// does that; this is the science-layer check so a new reader cannot forget.
export const WARMUP_EXCLUDED_FROM = Object.freeze(['progression', 'prs', 'e1rm', 'volume'])

/** Same classification as the shared set model, including the legacy warmup flag. */
export function isWarmupSet(set) {
  return workoutModel.isWarmupRow(set)
}

/** Sets that count for one of the metrics warm-ups are excluded from. */
export function setsFor(metric, sets) {
  if (!WARMUP_EXCLUDED_FROM.includes(metric)) {
    throw new Error(`warm-up exclusion is not defined for "${metric}"`)
  }
  return (Array.isArray(sets) ? sets : []).filter(set => !isWarmupSet(set))
}

/** Why warm-ups are left out of progression, records, estimated 1RM, and volume. */
export function warmupExclusionWhy() {
  return whyThis('warmup-accounting')
}
