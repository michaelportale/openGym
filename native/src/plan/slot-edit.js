// What the Plan tab's exercise sheet can change in one routine slot: sets, target, progression
// rule, position and exercise. Pure: every function returns new objects and leaves its input
// alone. The clamps restate ExConfig's save (frontend/src/sheets.jsx), and only sets, reps,
// repsMin, sec, min and prog are ever written; every other key of the slot is kept as it is.
import { history, progression, repRange, routines, pyramid } from '../shared/training.js'
import { putBackChanges } from './server-put-back.js'

const climbsRange = policy => policy === 'double' || policy === 'triple'
const clone = value => JSON.parse(JSON.stringify(value))
// The web's `Math.max(1, Math.round(x) || fallback)`; strings and blanks come out as the fallback.
const whole = (x, fallback) => Math.max(1, Math.round(x) || fallback)

function modeOfSlot(slot) {
  return history.modeOf(slot)
}

function isPyramidSlot(slot, mode) {
  return mode === 'reps' && pyramid.isPyramid({ ...slot, mode })
}

// Whether the policy in force for the draft climbs a rep range (reps mode only).
export function formRanged(form, slot, routine) {
  const mode = modeOfSlot(slot)
  return mode === 'reps' && climbsRange(progression.policyFor({ ...slot, prog: form.prog }, routine, mode))
}

// The draft a sheet edits.
export function slotForm(slot, routine) {
  const mode = modeOfSlot(slot)
  const perSide = history.isPerSide(slot)
  const draft = { mode, sets: slot.sets, reps: slot.reps, repsMin: slot.repsMin, sec: slot.sec, min: slot.min, prog: slot.prog || '' }
  const ranged = formRanged(draft, slot, routine)
  if (ranged) Object.assign(draft, repRange.normalizeRepRange(slot.reps, slot.repsMin, perSide ? 2 : 1))
  return { ...draft, ranged, perSide, pyramid: isPyramidSlot(slot, mode) }
}

// The slot after the draft is saved. Pyramid slots are left as they are.
export function applySlotForm(slot, form, routine) {
  const mode = modeOfSlot(slot)
  const out = { ...slot }
  if (isPyramidSlot(slot, mode)) return out
  if (mode === 'cardio') {
    out.sets = whole(form.sets, 1)
    out.min = whole(form.min, 20)
    return out
  }
  out.sets = whole(form.sets, 3)
  if (form.prog) out.prog = form.prog
  else delete out.prog
  if (mode === 'time') {
    out.sec = whole(form.sec, 45)
    return out
  }
  const stride = history.isPerSide(slot) ? 2 : 1
  const typed = whole(form.reps, 10)
  out.reps = Math.ceil(typed / stride) * stride
  if (formRanged(form, slot, routine)) {
    const range = repRange.normalizeRepRange(out.reps, form.repsMin, stride)
    out.reps = range.reps
    out.repsMin = range.repsMin
  } else delete out.repsMin
  return out
}

// "Follow the routine" first, naming the rule the routine gives this mode, then the mode's policies.
export function policyChoices(slot, routine) {
  const mode = modeOfSlot(slot)
  const inherited = progression.policyFor({ ...slot, prog: undefined }, routine, mode)
  return [
    { value: '', label: `Follow the routine (${progression.POLICY_NAME[inherited]})` },
    ...progression.POLICIES_FOR[mode].map(p => ({ value: p, label: progression.POLICY_NAME[p] })),
  ]
}

function result(next, base) {
  return { routine: next, unsafe: base ? putBackChanges(base, next) : false }
}

// One press of the editor's up/down arrow, or null when it would do nothing.
export function moveSlot(routine, index, dir, base) {
  const ex = history.moveRoutineEntry(routine.ex, index, dir)
  if (!ex) return null
  return result(clone({ ...routine, ex }), base)
}

// The slot at `index` becomes exId (replaceSlotExercise), or null when nothing would change.
export function swapSlot(routine, index, exId, state, base) {
  const slot = Number.isInteger(index) ? routine.ex?.[index] : null
  if (!slot || slot.id === exId) return null
  const ex = routine.ex.map((s, i) => (i === index ? routines.replaceSlotExercise(slot, exId, state, routine.id) : s))
  return result(clone({ ...routine, ex }), base)
}
