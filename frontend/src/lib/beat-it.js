// The set to beat, per row, and the one-tap "Beat it" target.
//
// A row's ghost is what the same work set was last time (lastEntryFor, which already skips
// deloads and other entries that do not count). It is read when the row is drawn and never
// stored on the set, so a saved workout carries nothing extra.
import { isWarmupRow } from './workout-model.js'

/** The last session's work sets, in order. */
const workOf = last => (last?.sets || []).filter(s => !isWarmupRow(s))

/**
 * The ghost for the work row at `workIndex` (0-based among work rows): the same set last time,
 * or the last one logged when today has more sets. Null without history in a mode that matches.
 */
export function ghostFor(last, workIndex, mode) {
  const work = workOf(last)
  if (!work.length || workIndex < 0) return null
  const g = work[workIndex] || work[work.length - 1]
  if (mode === 'time') return g.sec > 0 ? { sec: g.sec, w: g.w || 0 } : null
  if (mode === 'reps') return g.r > 0 ? { w: g.w || 0, r: g.r } : null
  return null
}

/**
 * What "Beat it" fills in, from the ghost and the plan, in this order:
 *   1. a timed hold: five seconds longer;
 *   2. a bodyweight set (no added weight): one more rep;
 *   3. a weighted rep range (`repsMin`..`reps`, double progression's) whose top was not reached
 *      last time: one more rep (`repStep`, two for a per-side total) at the same weight;
 *   4. otherwise: the next weight step, at the bottom of the range, or at the plan's reps (last
 *      time's when the plan has none) without one.
 * `step(w, dir)` returns the next weight in direction `dir` (the plate or dumbbell step the row's
 * + and − use). On an assistance machine the next step is less help, so it steps down.
 * `repsMax` is the bodyweight ceiling (it adds sets, not reps) and plays no part here.
 */
export function beatTarget(ghost, { mode, reps, repsMin, step, repStep = 1, assisted = false }) {
  if (!ghost) return null
  if (mode === 'time') return { sec: ghost.sec + 5 }
  if (!(ghost.w > 0)) return { r: ghost.r + 1 }
  const range = repsMin > 0 && repsMin < reps
  if (range && ghost.r < reps) return { w: ghost.w, r: Math.min(reps, ghost.r + repStep) }
  return { w: step(ghost.w, assisted ? -1 : 1), r: range ? repsMin : reps > 0 ? reps : ghost.r }
}

/**
 * Whether a row's values already beat its ghost: more reps at the same or a better weight, or a
 * better weight. Better is more weight, or less help on an assistance machine (`assisted`).
 */
export function aheadOf(ghost, s, mode, assisted = false) {
  if (!ghost || !s) return false
  if (mode === 'time') return (s.sec || 0) > ghost.sec
  const w = s.w || 0, r = s.r || 0
  const better = assisted ? w < ghost.w : w > ghost.w
  return (better && r > 0) || ((better || w === ghost.w) && r > ghost.r)
}
