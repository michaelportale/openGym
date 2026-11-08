import { workoutModel } from '../shared/training.js'

const num = v => typeof v === 'number' && Number.isFinite(v)

// The set as "last time" shows it, or null when it cannot set an opening weight.
function usable(set) {
  if (!set || workoutModel.isWarmupRow(set)) return null
  if (workoutModel.isSideSet(set)) {
    const { L, R } = set.sides
    const done = [L, R].filter(s => s.done === true && num(s.w) && num(s.r))
    if (!done.length) return null
    return {
      top: Math.max(...done.map(s => s.w)),
      set: { sides: { L: { w: L.w, r: L.r }, R: { w: R.w, r: R.r } } },
    }
  }
  if (set.done !== true || !num(set.w) || !num(set.r)) return null
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
    if (!entry) continue
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

// Every work row opens at last time's top weight, or blank. Returns new objects.
export function applyOpeningWeights(entries, state, routineId) {
  return entries.map(entry => {
    const top = lastTime(state, entry.id, routineId)?.top ?? null
    const sets = (entry.sets ?? []).map(set => {
      if (workoutModel.isWarmupRow(set)) return set
      const next = { ...set, w: top }
      if (workoutModel.isSideSet(set)) {
        next.sides = { L: { ...set.sides.L, w: top }, R: { ...set.sides.R, w: top } }
      }
      return next
    })
    return { ...entry, sets }
  })
}
