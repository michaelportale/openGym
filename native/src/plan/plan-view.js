// The models behind the Plan tab, a routine's screen and its exercise sheet. Pure: the screens
// render what these return. Read-only over the state the screens are given (the screen source,
// with this phone's pending routine edits already laid over it).
import { history, progression, queue, repRange, rotation } from '../shared/training.js'
import { findExercise } from '../exercises/detail-view.js'
import { cap } from '../sync/source.js'
import { sameRoutine } from './routine-guard.js'
import { applySlotForm, failureOnPick, formRanged, moveSlot, policyChoices, stepInvalid } from './slot-edit.js'

export const UNSAFE_EDIT = 'This move or swap has to be made on the web.'
export const MISSING_ROUTINE = "This routine isn't in your plan any more."
// The web's own words (sheets.jsx:1808) for a rule whose Step is not positive (slot-edit.js stepInvalid).
export const STEP_INVALID = 'Enter a positive step to use this progression rule.'

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const routinesOf = state => (Array.isArray(state?.routines) ? state.routines.filter(isObj) : [])
const exOf = routine => (Array.isArray(routine?.ex) ? routine.ex : [])
const nameOf = routine => (typeof routine.name === 'string' ? routine.name : '')

// The first routine with the id, as the guard matches one.
export function findRoutine(state, id) {
  return routinesOf(state).find(r => r.id === id) ?? null
}

// Monday first. getDay() numbering, as S.week is keyed.
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]

// How you train, read-only. Rotation: the loop as the web's Plan shows it (the live queue, else
// the saved sequence), with `next` on the routine the Workout tab would start. Fixed week: S.week
// per weekday, as the web's Plan lists it (effectiveRoutineIds is one date's plan, with its
// one-off overrides, so it is not the week's shape). Null when nothing is planned.
function scheduleOf(state, nextId) {
  if (!isObj(state)) return null
  const byId = id => findRoutine(state, id)
  if (rotation.scheduleModeOf(state) === 'rotation') {
    const ids = queue.queueOf(state)?.ids ?? rotation.rotationIds(state)
    const items = ids.map(byId).filter(Boolean).map(r => ({ id: r.id, name: nameOf(r), next: r.id === nextId }))
    return items.length ? { kind: 'rotation', items } : null
  }
  const week = isObj(state.week) || Array.isArray(state.week) ? state.week : {}
  const days = WEEK.map(([d, label]) => {
    const names = [].concat(week[d] || []).map(byId).filter(Boolean).map(nameOf)
    return { label, names: names.length ? names : null }
  })
  return days.some(d => d.names) ? { kind: 'week', days } : null
}

const NOTICE = {
  changed: name => `Your change to ${name} wasn't sent: it was changed on the web first. This shows the web's version.`,
  deleted: name => `Your change to ${name} wasn't sent: it was deleted on the web.`,
  unsafe: name => `Your change to ${name} wasn't sent: this move or swap has to be made on the web.`,
}

const noticeName = name => (typeof name === 'string' && name.trim() ? name : 'this routine')

// routineEdits.listNotices() rows as the lines the screens show, each with its Dismiss button's
// VoiceOver label.
export function noticeLines(notices) {
  return (notices ?? []).map(n => {
    const name = noticeName(n.name)
    return { rid: n.rid, text: (NOTICE[n.kind] ?? NOTICE.changed)(name), dismissLabel: `Dismiss notice about ${name}` }
  })
}

export function planView(state, { nextId = null, notices = [] } = {}) {
  return {
    schedule: scheduleOf(state, nextId),
    routines: routinesOf(state).map(r => ({ id: r.id, name: nameOf(r), count: exOf(r).length })),
    notices: noticeLines(notices),
  }
}

// The web's speedUnitOf for a pounds profile: mph unless the profile chose km/h.
const speedUnitOf = state => (state?.speedUnit === 'kmh' ? 'kmh' : 'mph')

// The Workout tab's name, else the catalogue's (an exercise a swap brought in before the source
// that names it is read back), else what the Workout tab says for an unknown one.
function exerciseName(state, names, id) {
  if (names?.[id]?.name) return names[id].name
  const ex = findExercise(state, id)
  return ex?.n ? cap(ex.n) : `Unknown exercise (${id})`
}

// A row's key: its slot's exercise id, and which of that exercise it is (twins: #0, #1, …). Rows
// are keyed by it, and a row's buttons find their slot by it when tapped (indexOfKey), not by the
// index it had when drawn.
function slotKeys(ex) {
  const seen = new Map()
  return ex.map(slot => {
    if (!isObj(slot)) return null
    const n = seen.get(slot.id) ?? 0
    seen.set(slot.id, n + 1)
    return `${slot.id}#${n}`
  })
}

// Where the slot with this row key is in the routine now, or -1 when it is gone.
export function indexOfKey(routine, key) {
  return slotKeys(exOf(routine)).indexOf(key)
}

// What VoiceOver says after a move: the new place, or that the exercise only left its superset.
export function movedText(name, from, to, count) {
  return to === from ? `${name} left the superset, ${to + 1} of ${count}` : `${name} moved to ${to + 1} of ${count}`
}

// One routine's screen, or null when it is missing. `routine`, when given, is shown in place of
// the state's (this screen's own writes, before they are read back). `index` is the slot's place
// in routine.ex (a non-object slot shows no row but keeps its place), `key` its slotKeys key.
// `up` / `down`: whether Move up / Move down would move the row (moveSlot is not null); none when
// a slot is not an object, since the shared move reads every slot.
export function routineView(state, id, { unit = 'lb', names = {}, routine: given = null } = {}) {
  const found = findRoutine(state, id)
  if (!found) return null
  const routine = given ?? found
  const ex = exOf(routine)
  const linked = new Set(history.supersetUnits(ex.map(s => (isObj(s) ? s : {}))).filter(u => u.length > 1).flat())
  const movable = ex.every(isObj)
  const speed = speedUnitOf(state)
  const keys = slotKeys(ex)
  const rows = []
  ex.forEach((slot, index) => {
    if (!isObj(slot)) return
    rows.push({
      index,
      key: keys[index],
      id: slot.id,
      name: exerciseName(state, names, slot.id),
      line: history.exLine(slot, unit, speed),
      superset: linked.has(index),
      up: movable && moveSlot(routine, index, -1, null) !== null,
      down: movable && moveSlot(routine, index, 1, null) !== null,
    })
  })
  const rule = progression.policyFor({}, routine, 'reps')
  return { id: routine.id, name: nameOf(routine), progLabel: `Progression: ${progression.POLICY_NAME[rule]}`, rows }
}

// The routine an edit is made on, as the server holds it: the copy's (paired) or the bundled
// snapshot's (unpaired), never with this phone's edits laid over it. Its _ts is the edit's base.
export function baseRoutine({ copy, bundled }, rid) {
  const list = copy ? copy.state?.routines : bundled?.state?.routines
  return (Array.isArray(list) ? list : []).find(r => isObj(r) && r.id === rid) ?? null
}

// An edit's base routine, and whether the edit starts its row fresh: made with no server copy held
// (on the bundled snapshot), it is measured against the snapshot's base alone. A row kept from a
// paired edit (its base, or an ack's sent) would let the snapshot's routine over the server's.
export function editBase({ copy, bundled }, rid) {
  return { base: baseRoutine({ copy, bundled }, rid), fresh: !copy }
}

// What Save writes: the routine with the draft applied to slot `index`, or null when that changes
// nothing (or there is no slot there). Every other slot keeps its identity.
export function savedRoutine(routine, index, form) {
  const ex = exOf(routine)
  const slot = ex[index]
  if (!isObj(slot)) return null
  const next = { ...routine, ex: ex.map((s, i) => (i === index ? applySlotForm(slot, form, routine) : s)) }
  return sameRoutine(routine, next) ? null : next
}

// Whether Save would now write something other than it would have when the sheet opened. A rule
// picked and picked back, or a value stepped away and back, is no change.
export function draftChanged(slot, routine, opened, form) {
  return JSON.stringify(applySlotForm(slot, form, routine)) !== JSON.stringify(applySlotForm(slot, opened, routine))
}

// The value a stepper shows: what Save would write for a blank or odd value (slot-edit.js clamps).
const shown = (value, floor, fallback) => Math.max(floor, Math.round(value) || fallback)

function fieldsOf(form) {
  if (form.pyramid) return []
  const field = (key, label, step, min, fallback) => ({ key, label, value: shown(form[key], min, fallback), step, min })
  if (form.mode === 'cardio') return [field('sets', 'Intervals', 1, 1, 1), field('min', 'Minutes', 1, 1, 20)]
  const sets = field('sets', 'Sets', 1, 1, 3)
  if (form.mode === 'time') return [sets, field('sec', 'Seconds', 5, 1, 45)]
  const stride = form.perSide ? 2 : 1
  if (form.ranged) return [sets, field('repsMin', 'Reps from', stride, stride, 8), field('reps', 'Reps up to', stride, stride, 10)]
  return [sets, field('reps', 'Reps', stride, stride, 10)]
}

// The sheet's controls for a draft (slotForm). A pyramid is read-only; cardio has no rule to pick
// (applySlotForm writes none for it). `invalid`: the message while Save is refused (STEP_INVALID).
export function sheetView(form, slot, routine) {
  const choices = form.pyramid || form.mode === 'cardio'
    ? null
    : policyChoices(slot, routine).map(c => ({ ...c, selected: c.value === (form.prog || '') }))
  const invalid = !form.pyramid && stepInvalid(form, slot, routine) ? STEP_INVALID : null
  return { editable: !form.pyramid, pyramid: !!form.pyramid, fields: fieldsOf(form), choices, invalid }
}

// One press of a stepper's + (dir 1) or − (dir -1), never below the field's floor.
export function stepForm(form, key, dir) {
  const field = fieldsOf(form).find(f => f.key === key)
  if (!field) return form
  return { ...form, [key]: Math.max(field.min, field.value + dir * field.step) }
}

// The draft with another rule picked. Moving onto a range rule fills the range from the reps, as
// the web's sheet does; between range rules the typed range stays; off one, Save drops repsMin.
// Picking Greyskull turns Last set to failure on (failureOnPick).
export function withProg(form, prog, slot, routine) {
  const next = { ...form, prog, lastToFailure: failureOnPick(prog, slot) }
  next.ranged = formRanged(next, slot, routine)
  if (next.ranged && !form.ranged) Object.assign(next, repRange.normalizeRepRange(form.reps, form.repsMin, form.perSide ? 2 : 1))
  return next
}
