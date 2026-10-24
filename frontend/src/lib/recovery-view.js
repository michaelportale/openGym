import { FATIGUE_STATES, LB_TO_KG } from './recovery.js'

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}

/**
 * The profile's latest logged bodyweight in kg, or null. Fatigue and strength scoring use it to
 * load bodyweight exercises; Stats and Home's Today card pass the same value so they agree.
 */
export function profileBodyweightKg(S) {
  const entries = S?.bodyweight || []
  if (!entries.length) return null
  const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last || !(last.w > 0)) return null
  return S.unit === 'lb' ? last.w * LB_TO_KG : last.w
}
