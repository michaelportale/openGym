// What the Plan tab's exercise sheet can change in one routine slot: sets, target, progression
// rule, pyramid sets, position and exercise. Pure: every function returns new objects and leaves
// its input alone. The clamps restate ExConfig's save (frontend/src/sheets.jsx). Only sets, reps,
// repsMin, sec, min and prog are written, plus what the web's rule picker and save do beside them:
// setsMax, lastToFailure and repsMax, which are set or raised, never removed. A reps pyramid of
// numbers and 'max' is edited here too: off is pyramid: [], on writes the list plus backoff false
// and lastToFailure false, and setsMax is left as it was. Every other key of the slot is kept.
import { exercises, history, progression, repRange, routines, pyramid } from '../shared/training.js'
import { putBackChanges } from './server-put-back.js'

const climbsRange = policy => policy === 'double' || policy === 'triple'
const clone = value => JSON.parse(JSON.stringify(value))
// The web's `Math.max(1, Math.round(x) || fallback)`; strings and blanks come out as the fallback.
const whole = (x, fallback) => Math.max(1, Math.round(x) || fallback)
const REST_STEP = 15
const WEIGHT_STEP = 5

// Absent and [] are a flat slot. Numbers and 'max' are the pyramid the phone edits. Anything else
// (the put-back fixtures store { w, r } rows) is left unread, the way the sheet used to be.
function pyramidKind(list) {
  if (list == null) return 'absent'
  if (!Array.isArray(list)) return 'locked'
  if (!list.length) return 'empty'
  for (const v of list) {
    if (v === pyramid.PYRAMID_MAX) continue
    if (typeof v === 'number' && Number.isFinite(v)) continue
    return 'locked'
  }
  return 'numbers'
}

const strideOf = perSide => (perSide ? 2 : 1)

function restColumn(src, length) {
  const list = Array.isArray(src) ? src : []
  return Array.from({ length }, (_, i) => Math.max(0, Math.round(Number(list[i])) || 0))
}

function weightColumn(src, length) {
  const list = Array.isArray(src) ? src : []
  return Array.from({ length }, (_, i) => {
    const w = Number(list[i])
    return Number.isFinite(w) && w > 0 ? Math.round(w * 100) / 100 : 0
  })
}

// All zeros is the normalizer's "no field". A slot that already has the key keeps [] so the server
// does not put the old list back; a slot that never had it stays without the key.
function writeColumn(out, slot, key, normalized) {
  if (normalized.length) out[key] = normalized
  else if (Object.hasOwn(slot, key)) out[key] = []
  else delete out[key]
}

// Whether the policy in force for the draft climbs a rep range (reps mode only).
export function formRanged(form, slot, routine) {
  const mode = history.modeOf(slot)
  return mode === 'reps' && climbsRange(progression.policyFor({ ...slot, prog: form.prog }, routine, mode))
}

// The draft a sheet edits.
export function slotForm(slot, routine) {
  const mode = history.modeOf(slot)
  const perSide = history.isPerSide(slot)
  const draft = { mode, sets: slot.sets, reps: slot.reps, repsMin: slot.repsMin, sec: slot.sec, min: slot.min, prog: slot.prog || '', lastToFailure: slot.lastToFailure }
  const ranged = formRanged(draft, slot, routine)
  if (ranged) Object.assign(draft, repRange.normalizeRepRange(slot.reps, slot.repsMin, perSide ? 2 : 1))
  const kind = mode === 'reps' ? pyramidKind(slot.pyramid) : 'absent'
  const on = kind === 'numbers'
  const targets = on ? pyramid.normalizePyramid(slot.pyramid, strideOf(perSide)) : []
  return {
    ...draft,
    ranged,
    perSide,
    pyramid: on || kind === 'locked',
    pyramidLocked: kind === 'locked',
    targets,
    rests: on ? restColumn(slot.pyramidRest, targets.length) : [],
    weights: on ? weightColumn(slot.pyramidWeight, targets.length) : [],
  }
}

// The switch. On starts from the list already in the draft, or from the flat sets × reps. Off
// folds that list back into sets and reps and drops it from the draft, so a later sets edit is
// what Save writes.
export function withPyramid(form, on) {
  if (!form || form.pyramidLocked) return form
  const stride = strideOf(form.perSide)
  if (on) {
    if (form.pyramid && form.targets?.length) return form
    const targets = pyramid.normalizePyramid(form.targets?.length ? form.targets : pyramid.pyramidFromFlat(form), stride)
    return { ...form, pyramid: true, targets, rests: restColumn(form.rests, targets.length), weights: weightColumn(form.weights, targets.length) }
  }
  if (!form.pyramid) return form
  const list = form.targets?.length ? pyramid.normalizePyramid(form.targets, stride) : pyramid.normalizePyramid(pyramid.pyramidFromFlat(form), stride)
  const flat = pyramid.flatFromPyramid(list)
  return { ...form, pyramid: false, sets: flat.sets, reps: flat.reps, targets: [], rests: [], weights: [] }
}

export function withPyramidPreset(form, list) {
  if (!form || form.pyramidLocked) return form
  const targets = pyramid.normalizePyramid(list, strideOf(form.perSide))
  if (!targets.length) return form
  return { ...form, pyramid: true, targets, rests: Array(targets.length).fill(0), weights: Array(targets.length).fill(0) }
}

export function setPyramidTarget(form, index, value) {
  if (!form?.targets || index < 0 || index >= form.targets.length) return form
  const targets = form.targets.map((t, i) => (i === index ? value : t))
  return { ...form, targets: pyramid.normalizePyramid(targets, strideOf(form.perSide)) }
}

export function addPyramidSet(form) {
  if (!form?.targets?.length || form.targets.length >= pyramid.MAX_PYRAMID_SETS) return form
  const last = form.targets.length - 1
  return {
    ...form,
    targets: [...form.targets, form.targets[last]],
    rests: [...(form.rests || []), (form.rests || [])[last] || 0],
    weights: [...(form.weights || []), (form.weights || [])[last] || 0],
  }
}

export function removePyramidSet(form) {
  if (!form?.targets || form.targets.length <= 1) return form
  return {
    ...form,
    targets: form.targets.slice(0, -1),
    rests: (form.rests || []).slice(0, -1),
    weights: (form.weights || []).slice(0, -1),
  }
}

// One press of a pyramid stepper. Reps step by 1, or by 2 per side; rest by 15 seconds; weight by
// 5. Each floors at 0, except reps, which floors at its stride. A Max target steps off Max.
export function stepPyramid(form, index, part, dir) {
  if (!form?.targets || index < 0 || index >= form.targets.length) return form
  if (part === 'reps') {
    const stride = strideOf(form.perSide)
    const cur = form.targets[index]
    const base = cur === pyramid.PYRAMID_MAX
      ? (form.targets.find(v => typeof v === 'number') ?? (Number(form.reps) || 10))
      : Number(cur)
    return setPyramidTarget(form, index, Math.max(stride, base + dir * stride))
  }
  if (part === 'rest') {
    const rests = (form.rests || []).slice()
    rests[index] = Math.max(0, (Number(rests[index]) || 0) + dir * REST_STEP)
    return { ...form, rests }
  }
  if (part === 'weight') {
    const weights = (form.weights || []).slice()
    weights[index] = Math.max(0, Math.round(((Number(weights[index]) || 0) + dir * WEIGHT_STEP) * 100) / 100)
    return { ...form, weights }
  }
  return form
}

// What the sheet renders for an open pyramid: preset buttons and one reps, rest and weight
// stepper per set. Null when the switch is off or the pyramid is locked.
export function pyramidControls(form) {
  if (!form?.pyramid || form.pyramidLocked) return null
  const stride = strideOf(form.perSide)
  const targets = form.targets || []
  return {
    presets: pyramid.PYRAMID_PRESETS.map(list => ({
      label: pyramid.pyramidLabel(list),
      accessibilityLabel: `Pyramid preset ${pyramid.pyramidLabel(list)}`,
      targets: list,
      selected: JSON.stringify(targets) === JSON.stringify(list),
    })),
    sets: targets.map((target, i) => ({
      reps: { label: `Set ${i + 1} reps`, value: target === pyramid.PYRAMID_MAX ? 'Max' : target, step: stride, min: stride },
      rest: { label: `Set ${i + 1} rest`, value: (form.rests || [])[i] || 0, step: REST_STEP, min: 0 },
      weight: { label: `Set ${i + 1} weight`, value: (form.weights || [])[i] || 0, step: WEIGHT_STEP, min: 0 },
      maxLabel: `Set ${i + 1} max`,
      isMax: target === pyramid.PYRAMID_MAX,
    })),
    canAdd: targets.length < pyramid.MAX_PYRAMID_SETS,
    canRemove: targets.length > 1,
    addLabel: 'Add a set',
    removeLabel: 'Remove a set',
  }
}

// Picking a rule in the sheet (sheets.jsx:1771 setRule): Greyskull's final set is taken to
// failure by design, so picking it turns "Last set to failure" on unless the slot already decided
// it. The phone has no switch for it, so picking another rule after puts back what the slot had.
export function failureOnPick(prog, slot) {
  return prog === 'greyskull' && slot.lastToFailure == null ? true : slot.lastToFailure
}

// The list is the prescription. buildSets still lays out cfg.sets rows, so sets and reps follow
// the list (flatFromPyramid), the same way the web's save does.
function applyPyramidOn(slot, form, routine) {
  const stride = strideOf(history.isPerSide(slot))
  const fromForm = Array.isArray(form.targets) ? pyramid.normalizePyramid(form.targets, stride) : []
  const list = fromForm.length ? fromForm : pyramid.normalizePyramid(pyramid.pyramidFromFlat({ sets: form.sets, reps: form.reps }), stride)
  const flat = pyramid.flatFromPyramid(list)
  // Turning a flat slot on writes the two flags the web clears. A pyramid that never had them
  // stays without them, so opening it and saving is not a change the server would then put back.
  const turningOn = pyramidKind(slot.pyramid) !== 'numbers'
  const out = { ...slot, pyramid: list, sets: flat.sets, reps: flat.reps }
  if (turningOn || Object.hasOwn(slot, 'backoff')) out.backoff = false
  if (turningOn || Object.hasOwn(slot, 'lastToFailure')) out.lastToFailure = false
  // A rule the draft actually changed. An unchanged pyramid keeps a leftover repsMin, so opening
  // it and saving is not a change. repsMin is written only for a range rule, as the flat save does.
  if ((form.prog || '') !== (slot.prog || '')) {
    if (form.prog) out.prog = form.prog
    else delete out.prog
    if (formRanged(form, slot, routine)) out.repsMin = repRange.normalizeRepRange(out.reps, form.repsMin, stride).repsMin
    else delete out.repsMin
  }
  if (Object.hasOwn(slot, 'setsMax')) out.setsMax = slot.setsMax
  else delete out.setsMax
  writeColumn(out, slot, 'pyramidRest', pyramid.normalizePyramidRest(form.rests, list.length))
  writeColumn(out, slot, 'pyramidWeight', pyramid.normalizePyramidWeight(form.weights, list.length))
  return out
}

// The slot after the draft is saved. An object pyramid is returned unchanged, as a new object.
export function applySlotForm(slot, form, routine) {
  const mode = history.modeOf(slot)
  if (mode === 'reps' && pyramidKind(slot.pyramid) === 'locked') return { ...slot }
  if (mode === 'reps' && form?.pyramid && !form?.pyramidLocked) return applyPyramidOn(slot, form, routine)
  const out = { ...slot }
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
  // Turning a number pyramid off. The list still on the draft is the one being turned off; once
  // withPyramid has folded it into sets and reps, a later edit of those fields is what lands.
  // setsMax is put back to the slot's own: the flat save above may have raised it for triple.
  if (pyramidKind(slot.pyramid) === 'numbers') {
    out.pyramid = []
    if (Array.isArray(form.targets) && form.targets.length) {
      const flat = pyramid.flatFromPyramid(pyramid.normalizePyramid(form.targets, strideOf(history.isPerSide(slot))))
      out.sets = flat.sets
      out.reps = flat.reps
    }
    if (Object.hasOwn(slot, 'setsMax')) out.setsMax = slot.setsMax
    else delete out.setsMax
  }
  return out
}

// Whether Save is refused for the draft's Step (sheets.jsx:1727 progressionStepOf, :1730
// progressionStepIsValid, :1735 backoffOffered, as ExConfig checks them at :1863): any rule in
// force, or back-off sets where they are offered, needs a positive Step. The phone has no Step
// field; a slot's own `inc` of 0 is what makes one invalid (none, or a negative one, is the
// default increment).
export function stepInvalid(form, slot, routine) {
  const mode = history.modeOf(slot)
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
  const mode = history.modeOf(slot)
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

// One press of the editor's up/down arrow, or null when it would do nothing. `at`: where the moved
// slot is now (moveRoutineEntry keeps the slot objects it moves; one that only left a superset is
// rebuilt where it was).
export function moveSlot(routine, index, dir, base) {
  const ex = history.moveRoutineEntry(routine.ex, index, dir)
  if (!ex) return null
  const at = ex.indexOf(routine.ex[index])
  return { ...result(clone({ ...routine, ex }), base), at: at < 0 ? index : at }
}

// The slot at `index` becomes exId (replaceSlotExercise), or null when nothing would change.
export function swapSlot(routine, index, exId, state, base) {
  const slot = Number.isInteger(index) ? routine.ex?.[index] : null
  if (!slot || slot.id === exId) return null
  const ex = routine.ex.map((s, i) => (i === index ? routines.replaceSlotExercise(slot, exId, state, routine.id) : s))
  return result(clone({ ...routine, ex }), base)
}
