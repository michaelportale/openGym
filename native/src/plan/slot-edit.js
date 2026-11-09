// What the Plan tab's exercise sheet can change in one routine slot: sets, target, progression
// rule, position and exercise. Pure: every function returns new objects and leaves its input
// alone. The clamps restate ExConfig's save (frontend/src/sheets.jsx). Only sets, reps, repsMin,
// sec, min and prog are written, plus what the web's rule picker and save do beside them:
// setsMax, lastToFailure and repsMax, which are set or raised, never removed. Every other key of
// the slot is kept as it is.
import { exercises, history, progression, repRange, routines, pyramid } from '../shared/training.js'
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
  const draft = { mode, sets: slot.sets, reps: slot.reps, repsMin: slot.repsMin, sec: slot.sec, min: slot.min, prog: slot.prog || '', lastToFailure: slot.lastToFailure }
  const ranged = formRanged(draft, slot, routine)
  if (ranged) Object.assign(draft, repRange.normalizeRepRange(slot.reps, slot.repsMin, perSide ? 2 : 1))
  return { ...draft, ranged, perSide, pyramid: isPyramidSlot(slot, mode) }
}

// Picking a rule in the sheet (sheets.jsx:1771 setRule): Greyskull's final set is taken to
// failure by design, so picking it turns "Last set to failure" on unless the slot already decided
// it. The phone has no switch for it, so picking another rule after puts back what the slot had.
export function failureOnPick(prog, slot) {
  return prog === 'greyskull' && slot.lastToFailure == null ? true : slot.lastToFailure
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
  if (form.lastToFailure === true) out.lastToFailure = true
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
  // Triple progression adds sets up to setsMax; without one above the sets it runs as double
  // (progression.js tripleSetsOf). Under triple, a slot whose ceiling is missing or not above its
  // sets gets the web picker's default, room for two more (sheets.jsx:1774), written only when it
  // is above the sets (:1943). A ceiling already above them is kept as it is.
  if (progression.policyFor(out, routine, mode) === 'triple' && !(out.setsMax > out.sets)) {
    const top = Math.min(progression.MAX_TRIPLE_SETS, out.sets + 2)
    if (top > out.sets) out.setsMax = top
  }
  // Bodyweight work with no load climbs reps to repsMax, then adds a set: a ceiling below the
  // working reps would add a set on day one, so it is raised to the reps (sheets.jsx:1945).
  if (history.isBw(slot) && !(slot.weight > 0) && slot.repsMax > 0 && out.reps > slot.repsMax) out.repsMax = out.reps
  return out
}

// Whether Save is refused for the draft's Step (sheets.jsx:1727 progressionStepOf, :1730
// progressionStepIsValid, :1735 backoffOffered, as ExConfig checks them at :1863): any rule in
// force, or back-off sets where they are offered, needs a positive Step. The phone has no Step
// field; a slot's own `inc` of 0 is what makes one invalid (none, or a negative one, is the
// default increment).
export function stepInvalid(form, slot, routine) {
  const mode = modeOfSlot(slot)
  const policy = progression.policyFor({ ...slot, prog: form.prog || undefined }, routine, mode)
  const step = slot.inc >= 0 ? slot.inc : mode === 'time' ? 5 : exercises.defaultIncrement(slot.id, 'lb')
  const bw = mode !== 'cardio' && history.isBw(slot)
  const backoff = slot.backoff === true && mode === 'reps' && !bw && !exercises.isAssisted(slot) &&
    !(Array.isArray(slot.pyramid) && slot.pyramid.length) && slot.intensifier?.type !== 'restpause'
  return !((policy === 'off' && !backoff) || (Number.isFinite(step) && step > 0))
}

// "Follow the routine" first, naming the rule the routine gives this mode, then the mode's policies.
// Triple adds sets and then load: bodyweight work with no load has no load to finish the cycle
// with, so it is not offered there unless the slot is already on it (sheets.jsx:1748).
export function policyChoices(slot, routine) {
  const mode = modeOfSlot(slot)
  const inherited = progression.policyFor({ ...slot, prog: undefined }, routine, mode)
  const bw = mode !== 'cardio' && history.isBw(slot)
  return [
    { value: '', label: `Follow the routine (${progression.POLICY_NAME[inherited]})` },
    ...progression.POLICIES_FOR[mode]
      .filter(p => p !== 'triple' || !bw || slot.weight > 0 || slot.prog === 'triple')
      .map(p => ({ value: p, label: progression.POLICY_NAME[p] })),
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
