// The models behind the Plan tab, a routine's screen and its exercise sheet. Pure: the screens
// render what these return. Read-only over the state the screens are given (the screen source,
// with this phone's pending routine edits already laid over it).
import { format, history, progression, queue, repRange, rotation } from '../shared/training.js'
import { findExercise } from '../exercises/detail-view.js'
import { cap } from '../sync/source.js'
import { ROUTINE_DELETED, isRoutineDeleted, sameRoutine, stampOf } from '../sync/edit-guard.js'
import { routinesMoved } from './routine-edit.js'
import { applySlotForm, failureOnPick, formRanged, moveSlot, policyChoices, pyramidControls, stepInvalid } from './slot-edit.js'

export const UNSAFE_EDIT = 'This move or swap has to be made on the web.'
export const REFUSED_SUPERSET = "It's linked in a superset. Keep it, or delete the whole routine."
export const REFUSED_TWIN = UNSAFE_EDIT
export const NAME_BLANK = 'Enter a name.'
export const PAIR_TO_AUTHOR = 'Pair with your server to add, delete or reorder routines.'
// The web's own words for the routine's deload switch (RoutineEdit.jsx).
export const DELOAD_TITLE = 'Deload routine'
export const DELOAD_SUBTITLE = 'Its workouts do not count toward progression. They still show in history and statistics.'
export const MISSING_ROUTINE = "This routine isn't in your plan any more."
// The routine screen's delete confirm (title is deleteTitle). History keeps the workouts.
export const DELETE_BODY = "It's removed from your plan and your week. Your history keeps its workouts."
export const deleteTitle = name => `Delete ${name}?`
export const removeTitle = name => `Remove ${name}?`

// After a delete lands, leave the routine screens for the Plan tab. dismissAll is POP_TO_TOP:
// it clears every routine pushed above the root tabs, including a duplicate sitting on the
// source routine. navigate then selects Plan. With nothing to dismiss, replace opens Plan.
export function leaveForPlan(router) {
  if (router.canDismiss()) {
    router.dismissAll()
    router.navigate('/(tabs)/plan')
    return
  }
  router.replace('/(tabs)/plan')
}

// The web's own words (sheets.jsx:1808) for a rule whose Step is not positive (slot-edit.js stepInvalid).
export const STEP_INVALID = 'Enter a positive step to use this progression rule.'
// An object pyramid (rows of { w, r }) is still edited on the web. A list of numbers and 'max' is not.
export const PYRAMID_ON_WEB = 'Pyramid sets: edit them on the web'

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

// Monday-first weekdays. `day` is getDay()'s number, as S.week is keyed. `names` is null when that
// weekday has no known routine. The read-only schedule drops `day` and is null when every day is.
function weekTable(state) {
  const week = isObj(state.week) || Array.isArray(state.week) ? state.week : {}
  const byId = id => findRoutine(state, id)
  return WEEK.map(([day, label]) => {
    const names = [].concat(week[day] || []).map(byId).filter(Boolean).map(nameOf)
    return { day, label, names: names.length ? names : null }
  })
}

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
  const days = weekTable(state).map(({ label, names }) => ({ label, names }))
  return days.some(d => d.names) ? { kind: 'week', days } : null
}

// The editor's model: the seven weekdays, and today through the 13th local day after. Null when
// there is no state object. A date's value is the dayPlan pin, or null when that day has none;
// its name is the routine's, Rest for a rest pin, or null when nothing is pinned.
export function schedulePlan(state, now) {
  if (!isObj(state)) return null
  const dayPlan = isObj(state.dayPlan) ? state.dayPlan : {}
  const start = new Date(now)
  const year = start.getFullYear()
  const month = start.getMonth()
  const date = start.getDate()
  const dates = Array.from({ length: 14 }, (_, i) => {
    const iso = format.isoOf(new Date(year, month, date + i))
    const raw = dayPlan[iso]
    const value = raw == null ? null : raw
    let name = null
    if (value === 'rest') name = 'Rest'
    else if (value != null) {
      const found = findRoutine(state, value)
      name = found ? nameOf(found) : null
    }
    return { iso, label: format.fmtDate(iso), value, name }
  })
  return { days: weekTable(state), dates }
}

// A notice's sentence by what the edit was (planNotices `op`) and why it was not sent (the guard's
// reason). An unknown reason reads as 'changed', as 7C's do. A create superseded as 'changed' had
// landed (its id is on the server): what was lost is a change made after, so it is worded as an
// edit. A delete is superseded only as 'changed' and an order only as 'changed' (edit-guard.js: a
// routine the copy lacks is a done delete, a delete is never unsafe, an order is never absent).
const EDIT_NOTICE = {
  changed: name => `Your change to ${name} wasn't sent: it was changed on the web first. This shows the web's version.`,
  deleted: name => `Your change to ${name} wasn't sent: it was deleted on the web.`,
  unsafe: name => `Your change to ${name} wasn't sent: this move or swap has to be made on the web.`,
}
const NOTICE = {
  edit: EDIT_NOTICE,
  create: {
    changed: EDIT_NOTICE.changed,
    deleted: (name, Name) => `${Name} wasn't added: a routine with that id was deleted on your server.`,
    unsafe: (name, Name) => `${Name} wasn't added: it couldn't be sent safely. Try adding it again.`,
  },
  delete: {
    changed: (name, Name) => `${Name} changed on the web, so it wasn't deleted.`,
  },
  order: {
    changed: () => "Your routine order wasn't sent: it changed on the web first.",
  },
}
const SCHEDULE_CHANGED = "Your schedule wasn't sent: it changed on the web first."

const named = name => typeof name === 'string' && name.trim()
const noticeName = name => (named(name) ? name : 'this routine')
// The same name opening a sentence.
const NoticeName = name => (named(name) ? name : 'This routine')

// The Plan's rows of pending-edits.js listNotices() (its routine, routineOrder and schedule
// notices) as the lines the screens show, each with its Dismiss button's VoiceOver label. `op`
// (planNotices) picks a routine's wording; a notice without one is an edit's. The order's line
// and the schedule's line are dismissed as their own kind (`kind`); a routine's line carries none.
export function noticeLines(notices) {
  return (notices ?? []).map(n => {
    if (n.kind === 'routineOrder') {
      const text = (NOTICE.order[n.reason] ?? NOTICE.order.changed)()
      return { rid: n.key, kind: n.kind, text, dismissLabel: 'Dismiss notice about your routine order' }
    }
    if (n.kind === 'schedule') {
      return { rid: n.key, kind: n.kind, text: SCHEDULE_CHANGED, dismissLabel: 'Dismiss notice about your schedule' }
    }
    const lines = NOTICE[n.op] ?? NOTICE.edit
    const name = noticeName(n.name)
    return { rid: n.key, text: (lines[n.reason] ?? lines.changed)(name, NoticeName(n.name)), dismissLabel: `Dismiss notice about ${name}` }
  })
}

// The kinds usePlan keeps from listNotices. A schedule notice is one of them, so it reaches planNotices.
export const PLAN_NOTICE_KINDS = ['routine', 'routineOrder', 'schedule']
const isPlanNotice = n => PLAN_NOTICE_KINDS.includes(n?.kind)

// The Plan's notices (pending-edits.js listNotices: its routine, routineOrder and schedule rows,
// in the store's order), each with what the edit was, read from its stored row (pending-edits.js
// get, matched by kind and key; `rows` may hold nulls): `op` is 'order', 'delete' (ROUTINE_DELETED),
// 'create' (a routine row on base 0) or 'edit'. A schedule row is one edit of the whole schedule;
// it has no op. A delete's marker has no name, so it is named from `state`, the screen's, where
// the routine the web kept still is.
export function planNotices(notices, rows, state) {
  const stored = (Array.isArray(rows) ? rows : []).filter(isObj)
  return (Array.isArray(notices) ? notices : []).filter(isPlanNotice).map(n => {
    if (n.kind === 'routineOrder') return { ...n, op: 'order' }
    if (n.kind === 'schedule') return { ...n }
    const row = stored.find(r => r.kind === n.kind && r.key === n.key)
    if (row && isRoutineDeleted(row.value)) return { ...n, op: 'delete', name: nameOf(findRoutine(state, n.key) ?? {}) || n.name }
    return { ...n, op: row?.baseTs === 0 ? 'create' : 'edit' }
  })
}

// `canAuthor`: whether New and the routines' Move up / Move down are offered. Adding, deleting and
// reordering need a server copy (PAIR_TO_AUTHOR): made on the snapshot, they would be sent into
// the real record at pairing. `canEditSchedule` is that same gate for the week, the loop and the
// next 14 days. The sentence stays on the routines card; the schedule card does not repeat it.
export function planView(state, { nextId = null, notices = [], copy = null } = {}) {
  const paired = copy != null
  return {
    schedule: scheduleOf(state, nextId),
    routines: routinesOf(state).map(r => ({ id: r.id, name: nameOf(r), count: exOf(r).length })),
    notices: noticeLines(notices),
    canAuthor: paired,
    canEditSchedule: paired,
  }
}

// Duplicate, delete and add exercise need a server copy (PAIR_TO_AUTHOR). Rename, removing an
// exercise, the routine's rule and deload do not: they are whole-routine edits, as a slot edit is.
export function routineAuthoring(copy) {
  const paired = copy != null
  return { canDuplicate: paired, canDelete: paired, canAdd: paired }
}

// The order a Move up (-1) or Move down (+1) on routine `id` saves: every id of `routines` (the
// Plan's rows, as on screen) with that one moved a place. Null at an edge, for an id not listed,
// and for a list whose ids are not all distinct strings: the store holds string ids only, and a
// tap finds its routine by id.
export function orderMoved(routines, id, dir) {
  const list = Array.isArray(routines) ? routines : []
  const ids = list.map(r => r?.id)
  if (!ids.every(x => typeof x === 'string') || new Set(ids).size !== ids.length) return null
  return routinesMoved(list, ids.indexOf(id), dir)
}

// What the Plan's authoring saves put in the pending-edits store, without the time. A create is
// the routine on base 0, which the guard adds only while the server has no routine with its id and
// never deleted one. A delete is ROUTINE_DELETED on the copy's routine's _ts, and fresh, so the
// put replaces a pending row's base. Over a create still pending, with no copy routine, that base
// becomes null; the guard still reads the row as done (a routine the copy lacks is the marker,
// checked before the stamp) and nothing is sent. An order is every routine id, on the stamp the
// guard reads (edited.routineOrder).
export const routineCreateEdit = routine => ({ kind: 'routine', key: routine.id, baseTs: 0, value: routine })
export const routineDeleteEdit = (rid, copyRoutine) => ({ kind: 'routine', key: rid, baseTs: copyRoutine?._ts ?? null, value: ROUTINE_DELETED, fresh: true })
export const routineOrderEdit = (ids, copy) => ({ kind: 'routineOrder', key: 'routineOrder', baseTs: stampOf(copy?.state, 'routineOrder', 'routineOrder'), value: ids })
// The whole schedule on the stamp the guard reads (edited schedule keys). Not fresh: a later save
// keeps a pending row's base, as an order does.
export const scheduleEdit = (value, copy) => ({ kind: 'schedule', key: 'schedule', baseTs: stampOf(copy?.state, 'schedule', 'schedule'), value })

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

// Every reps policy as a row. The selected one is the rule the routine uses (linear when prog is
// unset). Picking one writes that rule; nothing here clears prog.
export function routineProgChoices(routine) {
  const selected = progression.policyFor({}, routine, 'reps')
  return progression.POLICIES_FOR.reps.map(value => ({
    value,
    label: progression.POLICY_NAME[value],
    selected: value === selected,
  }))
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

// The sheet's controls for a draft (slotForm). A number pyramid hides sets, reps and the rule
// picker; an object pyramid stays read-only (PYRAMID_ON_WEB). Cardio has no rule to pick.
// `invalid`: the message while Save is refused (STEP_INVALID).
export function sheetView(form, slot, routine) {
  const locked = !!form.pyramidLocked
  const on = !!form.pyramid && !locked
  const choices = on || locked || form.mode === 'cardio'
    ? null
    : policyChoices(slot, routine).map(c => ({ ...c, selected: c.value === (form.prog || '') }))
  const invalid = locked || !stepInvalid(form, slot, routine) ? null : STEP_INVALID
  return {
    editable: !locked,
    pyramid: !!form.pyramid,
    showSwitch: form.mode === 'reps' && !locked,
    switchLabel: 'Pyramid sets',
    sentence: locked ? PYRAMID_ON_WEB : null,
    controls: on ? pyramidControls(form) : null,
    fields: fieldsOf(form),
    choices,
    invalid,
  }
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
