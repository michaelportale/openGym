// What Home's Today card says about the session it offers, before you start it: how many
// exercises it has, when you last did it, and which lifts the progression rules move today.
// Read-only. The prescriptions come from buildPlannedEntry, the same call Start makes, so the
// card cannot name a lift as moving up that the session then opens at the old number.
// It also names the muscles the session works hard that are still fatigued from recent
// training, read from the same fatigue scoring as the Stats body map (lib/recovery.js).
import { buildPlannedEntry } from './session-start.js'
import { workoutAt, lastEntryFor } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { exOr } from './exercises.js'
import { dbLoadFor, historyAs } from './dumbbells.js'
import { historyForLoad } from './load-identity.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { fatigueOf } from './recovery.js'
import { fatigueStateOf, profileBodyweightKg } from './recovery-view.js'

// A muscle counts as worked by the session when an exercise trains it as a primary mover;
// supporting muscles score 0.4 (lib/muscles.js) and would name half the body.
const PRIMARY_MIN = 0.5

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
 * `recovering` lists the muscle slugs the session trains as a primary mover whose fatigue at
 * `now` reads 'fatigued' on the Stats map, in body-map order (empty without history).
 * `toBeat` is the top set of the session's first lift last time, `{ id, w, r }` (the heaviest
 * work set, more reps breaking a tie), or null when that lift has no loaded set logged.
 */
export function todayPreview(S, ids, day, now = Date.now()) {
  const routines = (ids || []).map(id => (S?.routines || []).find(r => r?.id === id)).filter(Boolean)
  let exercises = 0
  const up = [], lighter = [], seen = new Set(), worked = new Set()
  for (const routine of routines) {
    for (const cfg of Array.isArray(routine.ex) ? routine.ex : []) {
      if (!cfg?.id) continue
      exercises++
      for (const [m, w] of Object.entries(musclesOf(exOr(cfg.id)))) if (w >= PRIMARY_MIN) worked.add(m)
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
  let recovering = []
  if (worked.size && (S?.workouts || []).length) {
    const fatigue = fatigueOf(S.workouts, now, { bodyweightKg: profileBodyweightKg(S), unit: S.unit })
    recovering = MUSCLES.filter(m => worked.has(m) && fatigueStateOf(fatigue[m]) === 'fatigued')
  }
  return { exercises, last, up, lighter, recovering, toBeat: topSetToBeat(S, routines) }
}

function topSetToBeat(S, routines) {
  const routine = routines[0]
  const cfg = (Array.isArray(routine?.ex) ? routine.ex : []).find(c => c?.id)
  if (!cfg) return null
  // The history Start builds the session from (buildPlannedEntry, buildSets): dumbbell weights
  // read in today's meaning, and nothing from across a station or load-convention boundary.
  let entry = null
  try { entry = lastEntryFor(historyForLoad(historyAs(S, cfg.id, dbLoadFor(S, cfg)), cfg), cfg.id, routine.id) } catch { entry = null }
  let top = null
  for (const s of entry?.sets || []) {
    if (isWarmupRow(s) || !(s.w > 0) || !(s.r > 0)) continue
    if (!top || s.w > top.w || (s.w === top.w && s.r > top.r)) top = s
  }
  return top ? { id: cfg.id, w: top.w, r: top.r } : null
}
