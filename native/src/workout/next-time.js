import { dumbbells, history, workoutModel } from '../shared/training.js'
import { withEffortNote } from '../science/effort.js'
import { nativePrescription, nativeRepPolicy } from '../science/native-progression.js'
import { programRepRange } from '../science/rep-range.js'
import { setsFor } from '../science/warmup.js'
import { sessionState } from './history-state.js'

// What the progression engine says about the next session: the saved screen's "Next time"
// lines and the weights a new session opens at. Both read the same prescription.

const num = v => typeof v === 'number' && Number.isFinite(v)

// The profile's unit, lb when unset: the same rule as the warm-up prompt.
const unitOf = state => state?.unit ?? 'lb'

/**
 * The native prescription of an exercise in `routine` when it names a weight, else null. Only
 * double progression (named, or the native default when none is) has a register entry to
 * explain it, so any other policy, off, and timed work (never double) get none and open at last
 * time as before. A routine kept out of progression (deload, rehab) gets none, as the shared
 * session builder gives it none. The engine steps and words its load in the profile unit the
 * screen shows, and leaves warm-ups out. A first session has no weight.
 */
function weightedPrescription(state, routine, exerciseId) {
  const cfg = (routine?.ex ?? []).find(c => c?.id === exerciseId)
  if (!cfg || routine.excludeFromProgression === true || nativeRepPolicy(cfg, routine) !== 'double') return null
  // History read in the dumbbell meaning (each/total) the exercise is logged in now, as the
  // shared session builder reads it before it asks the engine.
  const st = { ...(state ?? {}), unit: unitOf(state) }
  const p = nativePrescription(dumbbells.historyAs(st, cfg.id, dumbbells.dbLoadFor(st, cfg)), cfg, routine)
  return p && p.kind !== 'off' && num(p.weight) ? { p, cfg } : null
}

/**
 * What a new session opens this exercise at from its prescription: `{ weight, reps }`, reps null
 * when the engine sets none. Null falls back to last time.
 */
export function prescribedOpening(state, routine, exerciseId) {
  const p = weightedPrescription(state, routine, exerciseId)?.p
  if (!p) return null
  return { weight: p.weight, reps: num(p.reps) && p.reps > 0 ? p.reps : null }
}

// The engine's own reason, its {0} slots filled in.
function reasonText(why) {
  if (!Array.isArray(why) || typeof why[0] !== 'string') return null
  const [template, ...args] = why
  return template.replace(/\{(\d+)\}/g, (slot, i) => (args[i] == null ? slot : String(args[i])))
}

// The reps after "×": the program's stored range, else the engine's aim, else the plan's reps. Per-side reps are stored for both sides together; shown per side.
function repsText(p, cfg) {
  const per = history.isPerSide(cfg) ? 2 : 1
  const side = per === 2 ? ' per side' : ''
  const { reps, repsMin } = programRepRange(cfg)
  if (num(repsMin) && num(reps) && repsMin > 0 && repsMin < reps) return `${repsMin / per}–${reps / per}${side}`
  const one = num(p.reps) && p.reps > 0 ? p.reps : num(reps) && reps > 0 ? reps : null
  return one == null ? null : `${one / per}${side}`
}

/**
 * One line per exercise in `entries` (the just-saved workout's) with a completed work set, that
 * the routine holds, and whose prescription has a weight: "Bench press — next time 85 lb × 8–12". `state` is the session's
 * history with that workout in it. Off, a first session, and timed work have no line. The effort
 * note reads that exercise's done work sets and never changes the weight. `whyId` is the
 * register entry that explains the line: the deload one for a deload, else double progression.
 */
export function nextTimeLines(state, routine, entries, names = {}) {
  const unit = unitOf(state)
  const seen = new Set()
  const lines = []
  for (const entry of entries ?? []) {
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    const found = weightedPrescription(state, routine, entry.id)
    if (!found) continue
    const { cfg } = found
    // Only an exercise trained today: a skipped one's line would describe an older session.
    const work = setsFor('progression', entry.sets).filter(workoutModel.hasCompletedWork)
    if (work.length === 0) continue
    const p = withEffortNote(found.p, work)
    const weight = p.weight
    const name = names?.[entry.id]?.name ?? `Unknown exercise (${entry.id})`
    // "each" as the next session's card will say it: the meaning the exercise is logged in now.
    const load = weight === 0 ? 'bodyweight' : `${weight} ${unit}${dumbbells.dbLoadFor(state, cfg) === 'each' ? ' each' : ''}`
    const reps = repsText(p, cfg)
    lines.push({
      exerciseId: entry.id,
      name,
      kind: p.kind,
      weight,
      unit,
      reps,
      text: `${name} — next time ${load}${reps ? ` × ${reps}` : ''}`,
      // The engine's sentences count per-side reps for both sides together ("back to 16 reps"),
      // which would contradict the per-side line, so a per-side exercise shows the line alone.
      reason: history.isPerSide(cfg) ? null : reasonText(p.why),
      effortNote: p.effortNote,
      whyId: p.kind === 'deload' ? 'deload-after-misses' : 'double-progression',
    })
  }
  return lines
}

/**
 * The saved screen's lines. `state` is the history the session opened with; the phone's
 * finished workouts, the just-saved one among them, are merged into it by id.
 */
export function savedNextTime({ state, base, phoneWorkouts, names }) {
  const merged = sessionState({ state }, phoneWorkouts)
  const saved = (phoneWorkouts ?? []).find(w => w?.id === base?.id)
  const routine = (merged.routines ?? []).find(r => r?.id === base?.routineIds?.[0])
  if (!saved || !routine) return []
  return nextTimeLines(merged, routine, saved.entries, names)
}
