import { dumbbells, progression } from '../shared/training.js'
import { whyThis } from './rules.js'

// PRD warm-up loads. The shared helper still closes half the gap; this one does not call it.
export const WARMUP_PERCENTS = Object.freeze([0.4, 0.8])
export const WARMUP_REPS = 6

function roundDown(raw, grid) {
  if (Array.isArray(grid)) return dumbbells.ownedFloor(grid, raw)
  if (!(grid > 0)) return raw
  const steps = Math.floor((raw + 1e-9) / grid)
  return Math.round(steps * grid * 1000) / 1000
}

function gridOf({ step, owned, id, unit }) {
  if (Array.isArray(owned) && owned.length) return owned
  const n = Number(step)
  if (n > 0) return n
  return progression.defaultIncrement(id, unit)
}

/**
 * Two warm-up sets at 40% and 80% of `working`, rounded down to a loadable weight.
 * `owned` is the bells you have; otherwise `step` is the load increment.
 * Never under `floor` (the bar), and never over the work weight.
 * Work at or under the bar returns no sets, so a screen can render the list as-is.
 */
export function warmupRamp({ working, step, floor = 0, owned, id, unit } = {}) {
  const work = Number(working)
  if (!(work > 0)) return []
  const bar = Math.max(0, Number(floor) || 0)
  if (!(work > bar)) return []
  const grid = gridOf({ step, owned, id, unit })
  return WARMUP_PERCENTS.map(pct => {
    const w = Math.min(work, Math.max(bar, roundDown(work * pct, grid)))
    return { w, r: WARMUP_REPS, done: false, phase: 'warmup', warmup: true }
  })
}

export function warmupRampWhy() {
  return whyThis('warmup-loads')
}
