// Personal strength v1 proposals. Existing automatic progression remains the selected policy;
// this helper only explains an editable alternative and never writes a prescription or history.
import { isAssisted } from './exercises.js'
import { entryDbLoad } from './dumbbells.js'
import { loggedRirOf } from './effort.js'
import { isSideSet, isWarmupRow, hasCompletedWork } from './workout-model.js'

const workSets = entry => (entry?.sets || []).filter(s => !isWarmupRow(s))
const limbs = row => isSideSet(row) ? [row.sides.L, row.sides.R] : [row]
const knownNumber = v => typeof v === 'number' && Number.isFinite(v)
const machine = convention => ['machine-total', 'machine-setting', 'plate-per-side'].includes(convention)
const sameIdentity = (a, b) => {
  const x = a?.equipmentSnapshot, y = b?.equipmentSnapshot
  if (!a?.id || a.id !== b?.id || !x?.loadConvention || !y?.loadConvention) return false
  if (!['barbell-total', 'db-per-hand', 'db-total', 'plate-per-side', 'machine-setting', 'machine-total'].includes(x.loadConvention)) return false
  if (x.loadConvention !== y.loadConvention || x.unit !== y.unit || x.stationId !== y.stationId) return false
  if (x.loadConvention !== 'machine-setting' && !['kg', 'lb'].includes(x.unit)) return false
  if (x.loadConvention.startsWith('db-')) {
    const meaning = x.loadConvention === 'db-per-hand' ? 'each' : 'total'
    if (entryDbLoad(a) !== meaning || entryDbLoad(b) !== meaning) return false
  }
  if (machine(x.loadConvention) && (!x.stationId || x.status !== 'exact' || y.status !== 'exact')) return false
  return true
}
const samePrescription = (entry, exercise, prescription) => {
  const previous = entry.planned || entry.target
  if (!previous) return false
  return ['reps', 'repsMin'].every(key => previous[key] === prescription[key])
    && ['variant', 'side', 'bodyweight', 'mode'].every(key => (entry.target?.[key] ?? null) === (exercise.target?.[key] ?? null))
}

/** Newest first; exact snapshots only. Includes comparable off-program work, without caches. */
export function comparableEntries({ exercise, history = [], prescription = exercise?.target || {} }) {
  const workouts = Array.isArray(history) ? history : history.workouts || []
  const seen = new Set()
  return workouts.flatMap(w => {
    const key = w.id || `${w.d}|${w.start}`
    if (seen.has(key)) return []
    seen.add(key)
    if (w.excludeFromProgression) return []
    return (w.entries || []).filter(e => !e.noProg && sameIdentity(exercise, e)
      && samePrescription(e, exercise, prescription) && workSets(e).some(hasCompletedWork))
      .map(e => ({ ...e, d: w.d, start: w.start }))
  }).sort((a, b) => String(b.d).localeCompare(String(a.d)) || (b.start || 0) - (a.start || 0))
}

export function suggestProgression({ exercise, history, prescription = exercise?.target || {}, policy }) {
  const result = { load: prescription.weight ?? null, reps: prescription.repsMin ?? prescription.reps ?? null,
    action: 'start', reasons: [], limitations: [], policyVersion: 'personal-strength-v1' }
  const out = (action, reason, limitation) => ({ ...result, action,
    reasons: reason ? [reason] : [], limitations: limitation ? [limitation] : [] })
  if (exercise?.noProg) return out('review', 'Progression excluded for this exercise')
  if (policy !== 'double' || isAssisted(exercise)) return out('existing-policy', 'Your selected progression policy remains in control')
  const previous = comparableEntries({ exercise, history, prescription })[0]
  if (!previous) return out('start', 'No comparable history')
  const rows = workSets(previous)
  const values = rows.flatMap(limbs)
  const first = values[0]
  if (knownNumber(first?.w)) result.load = first.w
  result.reps = prescription.reps
  const concern = [exercise, previous, prescription].flatMap(e => ['pain', 'techniqueProblem', 'safetyConcern', 'userOverride'].map(k => e?.[k])).find(Boolean)
  if (concern) return out('review', typeof concern === 'string' ? concern : 'Review safety, form or your override before increasing')
  const priorSets = previous.target?.sets ?? previous.planned?.sets
  if (!(knownNumber(priorSets) && priorSets > 0) || rows.length < priorSets || !(prescription.sets > 0) || rows.length < prescription.sets || !values.length
    || !values.every(s => s.done === true && knownNumber(s.w) && s.w >= 0 && knownNumber(s.r) && s.r > 0 && s.w === first.w))
    return out('hold', 'Complete every prescribed working set with a comparable load and reps')
  const stride = isSideSet(rows[0]) ? 2 : 1
  const upper = prescription.reps / stride
  const lower = prescription.repsMin / stride
  if (!(lower > 0) || !(upper >= lower)) return out('hold', 'Keep the prescribed rep range')
  const ratings = limbs(rows.at(-1)).map(loggedRirOf)
  const rir = ratings.every(v => v != null) ? Math.min(...ratings) : null
  if (rir != null && rir < 2) return out('hold', 'Final working set has less than 2 RIR; retain load')
  if (!values.every(s => s.r >= upper)) {
    result.reps = Math.min(prescription.reps, Math.max(prescription.repsMin, (Math.min(...values.map(s => s.r)) + 1) * stride))
    return out('increase-reps', 'Build reps within the prescribed range before adding load', rir == null ? 'Effort unknown' : null)
  }
  const available = prescription.availableLoads?.filter(v => knownNumber(v) && v > first.w).sort((a, b) => a - b)
  const next = Array.isArray(prescription.availableLoads) ? available?.[0]
    : knownNumber(prescription.inc) && prescription.inc > 0 ? Math.round((first.w + prescription.inc) * 1000) / 1000 : null
  if (!(next > first.w)) return out('hold', 'Keep load until an exact available step is known', 'Load increment unknown')
  result.load = next
  result.reps = prescription.repsMin
  result.percentChange = first.w > 0 ? Math.round((next - first.w) / first.w * 1000) / 10 : null
  return rir == null
    ? out('limited-load', 'Rep ceiling reached; editable load suggestion only', 'Effort unknown')
    : out('increase-load', 'All prescribed sets reached the rep ceiling and the final logged effort is at least 2 RIR')
}
