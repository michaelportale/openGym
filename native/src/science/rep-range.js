import { whyThis } from './rules.js'

// The PRD does not name an optimal range. Empty stays empty.
export const OPTIMAL_REP_RANGE = null

function stored(value) {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

/**
 * The range already stored on the program. A missing bound stays missing.
 * This does not substitute 8-12, and it does not call that range optimal.
 */
export function programRepRange(cfg = {}) {
  return { reps: stored(cfg.reps), repsMin: stored(cfg.repsMin) }
}

export function repRangeWhy() {
  return whyThis('rep-ranges')
}
