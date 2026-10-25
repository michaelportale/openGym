// What Home's Today card says about the session it offers, before you start it: how many
// exercises it has, when you last did it, and which lifts the progression rules move today.
// Read-only. The prescriptions come from buildPlannedEntry, the same call Start makes, so the
// card cannot name a lift as moving up that the session then opens at the old number.
import { buildPlannedEntry } from './session-start.js'
import { workoutAt } from './history.js'

const routineIdsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : [w?.routineId]).filter(Boolean)

// The parts of the state todayPreview reads (through buildPlannedEntry), so a caller can redo it
// when one of them changes rather than on every state change. A test reads the state through a
// Proxy and fails if the preview touches a key that is not listed here.
export const PREVIEW_INPUTS = ['routines', 'workouts', 'unit', 'exWeights', 'startFrom', 'customEx', 'trainingMetadata',
  'equipProfiles', 'activeEquipId', 'loadKind', 'dbLoad', 'dumbbells', 'plates', 'barWeights', 'bodyweight']

/**
 * `ids`: the routines planned for `day` (effectiveRoutineIds). Returns
 * `{ exercises, last, up, lighter }`: `last` is the most recent saved workout before `day` that
 * ran any of them, or null; `up` and `lighter` list exercise ids whose prescription today is
 * 'up' or 'deload', in routine order, each id once. A routine excluded from progression, or an
 * exercise the builder cannot read, contributes to the count and to neither list.
 */
export function todayPreview(S, ids, day) {
  const routines = (ids || []).map(id => (S?.routines || []).find(r => r?.id === id)).filter(Boolean)
  let exercises = 0
  const up = [], lighter = [], seen = new Set()
  for (const routine of routines) {
    for (const cfg of Array.isArray(routine.ex) ? routine.ex : []) {
      if (!cfg?.id) continue
      exercises++
      if (routine.excludeFromProgression || seen.has(cfg.id)) continue
      seen.add(cfg.id)
      let kind = null
      try { kind = buildPlannedEntry(S, cfg, routine).plan?.kind ?? null } catch { kind = null }
      if (kind === 'up') up.push(cfg.id)
      else if (kind === 'deload') lighter.push(cfg.id)
    }
  }
  const want = new Set(routines.map(r => r.id))
  let last = null
  for (const w of S?.workouts || []) {
    if (!w?.d || w.d >= day || !routineIdsOf(w).some(id => want.has(id))) continue
    if (!last || workoutAt(w) > workoutAt(last)) last = w
  }
  return { exercises, last, up, lighter }
}
