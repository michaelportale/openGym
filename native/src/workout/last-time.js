import { workoutModel } from '../shared/training.js'
import { prescribedOpening } from './next-time.js'

const num = v => typeof v === 'number' && Number.isFinite(v)

// The set as "last time" shows it, or null when it cannot set an opening weight.
function usable(set) {
  if (!set || workoutModel.isWarmupRow(set)) return null
  if (workoutModel.isSideSet(set)) {
    const { L, R } = set.sides
    const done = [L, R].filter(s => s.done && num(s.w) && num(s.r))
    if (!done.length) return null
    return {
      top: Math.max(...done.map(s => s.w)),
      set: { sides: { L: { w: L.w, r: L.r }, R: { w: R.w, r: R.r } } },
    }
  }
  if (!set.done || !num(set.w) || !num(set.r)) return null
  return { top: set.w, set: { w: set.w, r: set.r } }
}

const newestFirst = (a, b) => String(b.d ?? '').localeCompare(String(a.d ?? '')) || (b.start ?? 0) - (a.start ?? 0)

const sameRoutine = (w, entry, routineId) => w.routineId === routineId ||
  (Array.isArray(w.routineIds) && w.routineIds.includes(routineId)) || entry.rid === routineId

// The most recent usable session of this routine, else of any routine (as history.lastEntryFor).
export function lastTime(state, exerciseId, routineId) {
  const found = []
  for (const w of state?.workouts ?? []) {
    const entry = (w.entries ?? []).find(e => e.id === exerciseId)
    // Deload/rehab sessions and no-progression entries must not seed the opening weight.
    if (!entry || w.excludeFromProgression === true || entry.noProg === true) continue
    const sets = (entry.sets ?? []).map(usable).filter(Boolean)
    if (sets.length) found.push({ w, same: sameRoutine(w, entry, routineId), sets })
  }
  found.sort((a, b) => newestFirst(a.w, b.w))
  const pick = found.find(f => f.same) ?? found[0]
  if (!pick) return null
  return {
    workoutId: pick.w.id,
    d: pick.w.d,
    top: Math.max(...pick.sets.map(s => s.top)),
    sets: pick.sets.map(s => s.set),
  }
}

// Every work row opens at the prescription's weight, and its reps when it sets them, when the
// routine's progression names one; else at last time's top weight, or blank, reps as built.
// Without a routine, last time decides. A per-side row's reps are both sides together, as the
// shared model stores them: each side gets half. Warm-ups are untouched. Returns new objects.
export function applyOpeningWeights(entries, state, routineId, routine) {
  return entries.map(entry => {
    const opening = prescribedOpening(state, routine, entry.id)
    const top = opening ? opening.weight : lastTime(state, entry.id, routineId)?.top ?? null
    const reps = opening?.reps ?? null
    const sets = (entry.sets ?? []).map(set => {
      if (workoutModel.isWarmupRow(set)) return set
      const next = { ...set, w: top }
      if (reps != null) next.r = reps
      if (workoutModel.isSideSet(set)) {
        const side = s => (reps == null ? { ...s, w: top } : { ...s, w: top, r: reps / 2 })
        next.sides = { L: side(set.sides.L), R: side(set.sides.R) }
      }
      return next
    })
    return { ...entry, sets }
  })
}
