// Pure guard for edits waiting to sync (pending-edits.js rows): routines, custom exercises,
// nutrition days, settings, the routines' order and the schedule. For each pending edit it decides,
// against the server's copy, whether the edit is already there (done), is the phone's own landed
// push with newer edits on top (rebased), can go (applied), or was overtaken by a change on the web
// (superseded). A routine edit that would go but that the API would change on the way in
// (plan/server-put-back.js: a move or swap whose slots it pairs differently) is superseded as
// unsafe, never sent. A custom exercise edit is unsafe the same way, and also when it would drop
// or replace media the copy holds. Omitting url is a cleared link and is sent. A routine row can
// also create the routine (base 0) or
// delete it (its value ROUTINE_DELETED). A customEx row does the same for state.customEx, and a
// delete removes only that entry. A routineOrder row orders the routines. A schedule row replaces
// scheduleMode, rotation, queue, week and dayPlan together, and is done once dead routine pins are
// gone. No I/O.

import { customPutBackChanges, putBackChanges } from '../plan/server-put-back.js'
import { routines as routineLib } from '../shared/training.js'

const META = new Set(['_ts', '_f', '_u'])
const isObj = v => !!v && typeof v === 'object'
const isMap = v => isObj(v) && !Array.isArray(v)

// The value of a routine row that deletes the routine. pending-edits.js keeps values as JSON, so
// a row read back holds an equal object, not this one: test with isRoutineDeleted.
export const ROUTINE_DELETED = Object.freeze({ deleted: true })
export const isRoutineDeleted = v => isMap(v) && v.deleted === true && Object.keys(v).length === 1

// The routine without its top-level sync stamps, for comparison.
export function routineContent(r) {
  const out = {}
  if (!r || typeof r !== 'object') return out
  for (const key of Object.keys(r)) if (!META.has(key)) out[key] = r[key]
  return out
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b)
  const arr = Array.isArray(a)
  if (arr !== Array.isArray(b)) return false
  if (arr) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  const kb = Object.keys(b).filter((k) => b[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
}

// Deep equality of routineContent: key order does not count, array order does.
export function sameRoutine(a, b) {
  return deepEqual(routineContent(a), routineContent(b))
}

// The routine that goes in for an edit: its content on the copy's own _ts, _f and _u (each taken
// off when the copy has none). The copy is the edit's base or the phone's own landed push, and the
// API reads a routine's _f as the version its writer worked on (sync-stamps.js stampUnstamped):
// older stamps could have it put an earlier value back. Stamps already there keep their place.
function onCopyStamps(routine, copy) {
  const out = { ...routine }
  for (const key of META) {
    if (Object.hasOwn(copy, key)) out[key] = copy[key]
    else delete out[key]
  }
  return out
}

const own = (map, key) => (isMap(map) && Object.hasOwn(map, key) ? map[key] : undefined)
const routineAt = (list, key) => list.findIndex((r) => r && typeof r === 'object' && r.id === key)

// Whether the server has the routine's id on record as deleted (deleted.routines, either sign) or
// as wiped by "Reset everything" (resetIds.routines): a create of it would bring back what the web
// removed.
function tombstoned(state, key) {
  const wiped = isMap(state.resetIds) && Array.isArray(state.resetIds.routines) ? state.resetIds.routines : []
  return own(isMap(state.deleted) ? state.deleted.routines : undefined, key) !== undefined || wiped.some((id) => String(id) === key)
}

// The same record for a custom exercise: deleted.customEx or resetIds.customEx. A routine
// tombstone does not count, and the other way around.
function customTombstoned(state, key) {
  const wiped = isMap(state.resetIds) && Array.isArray(state.resetIds.customEx) ? state.resetIds.customEx : []
  return own(isMap(state.deleted) ? state.deleted.customEx : undefined, key) !== undefined || wiped.some((id) => String(id) === key)
}

const customAt = (list, key) => list.findIndex((ex) => ex && typeof ex === 'object' && ex.id === key)

// Out of customEx only. Routines, workouts, exWeights and favEx stay as they are, including a
// routine slot that still names the id. No shared delete helper: those rewrite logged workouts.
function withoutCustomEx(state, key) {
  const list = Array.isArray(state.customEx) ? state.customEx : []
  return { ...state, customEx: list.filter((ex) => !(ex && typeof ex === 'object' && ex.id === key)) }
}

// True when the copy has no `key`, or the edit carries the same value (key order does not count).
// A missing key on the edit is not the same. The API would store a dropped photo.
function carried(copy, edit, key) {
  if (!isMap(copy) || !Object.hasOwn(copy, key)) return true
  return isMap(edit) && Object.hasOwn(edit, key) && deepEqual(copy[key], edit[key])
}

// The document with routine `key` deleted as the web deletes it (routines.js deleteRoutine): out of
// routines, out of every weekday that names it (a weekday left empty goes) and its dayPlan pins
// gone. The loop and the queue keep its id; their readers skip one that no longer resolves. It
// runs on a clone of the three keys deleteRoutine cleans, so the copy is never changed and every
// other key, the workouts included, keeps its identity. deleteRoutine reads every entry's id,
// which a null has not: it sees the list without them, and they stay where they were.
function withoutRoutine(state, key) {
  const draft = structuredClone({ routines: state.routines, week: state.week, dayPlan: state.dayPlan })
  const list = draft.routines
  draft.routines = list.filter((r) => r != null)
  routineLib.deleteRoutine(draft, key)
  const kept = new Set(draft.routines)
  const out = { ...state, routines: list.filter((r) => r == null || kept.has(r)) }
  for (const k of ['week', 'dayPlan']) if (Object.hasOwn(state, k)) out[k] = draft[k]
  return out
}

// The routine ids of a document, in its order (an entry with no id left out).
const routineIds = (state) => (Array.isArray(state.routines) ? state.routines : []).filter((r) => isObj(r) && r.id != null).map((r) => r.id)

// `ids` in their order, only those `of` also holds, each once.
function orderWithin(ids, of) {
  const keep = new Set(Array.isArray(of) ? of : [])
  const seen = new Set()
  const out = []
  for (const id of Array.isArray(ids) ? ids : []) {
    if (keep.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// Whether two id lists put the ids both hold in the same order, as the server reads a reorder
// (sync-stamps.js orderMoved): an id only one of them holds does not count. An id held twice
// counts where it first stands, which is where the write below puts every copy of it.
const sameOrder = (a, b) => deepEqual(orderWithin(a, b), orderWithin(b, a))

const SCHEDULE_KEYS = ['scheduleMode', 'rotation', 'queue', 'week', 'dayPlan']

// The five keys a schedule row carries, taken off a document or off an edit value. A missing key
// stays missing (undefined): null is a clear, and the two are not the same.
function scheduleFields(source) {
  const out = {}
  for (const key of SCHEDULE_KEYS) out[key] = isMap(source) ? source[key] : undefined
  return out
}

// edited.scheduleMode, edited.rotation, edited.queue, and every edited['week.*'] / edited['dayPlan.*'].
// The greatest number among them, or null when none of those is a finite number. A stamp on `week`
// or `dayPlan` itself, or on any other key, does not count.
function scheduleStamp(edited) {
  if (!isMap(edited)) return null
  let best = null
  for (const [key, value] of Object.entries(edited)) {
    const sub = key.startsWith('week.') || key.startsWith('dayPlan.')
    if (!(key === 'scheduleMode' || key === 'rotation' || key === 'queue' || sub)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (best === null || value > best) best = value
  }
  return best
}

// A pin is a routine id in a week array, or a dayPlan value. The string 'rest' stays in either.
const keptPin = (pin, ids) => pin === 'rest' || ids.has(pin)

// Weekdays the edit still wants, without a pin the document does not hold. An emptied day is left
// out: a clear is the absence of the key, never [].
function weekPins(week, ids) {
  const out = {}
  if (!isMap(week)) return out
  for (const [day, pins] of Object.entries(week)) {
    if (!Array.isArray(pins)) continue
    const kept = pins.filter((pin) => keptPin(pin, ids))
    if (kept.length) out[day] = kept
  }
  return out
}

function dayPlanPins(dayPlan, ids) {
  const out = {}
  if (!isMap(dayPlan)) return out
  for (const [date, pin] of Object.entries(dayPlan)) if (keptPin(pin, ids)) out[date] = pin
  return out
}

// The five keys with dead pins removed: a pin whose routine `ids` does not hold is gone, and
// 'rest' stays. A week or a dayPlan that is not a map is left alone, so a missing key stays
// missing. weekPins still skips a weekday that is not an array.
function scheduleHeld(value, ids) {
  const fields = scheduleFields(value)
  if (isMap(fields.week)) fields.week = weekPins(fields.week, ids)
  if (isMap(fields.dayPlan)) fields.dayPlan = dayPlanPins(fields.dayPlan, ids)
  return fields
}

// How each kind reads from and writes into the server's document. read(state, key) gives the copy's
// entry { value, stamp } (value undefined when the copy has none); a routine the copy lacks is
// `absent`, and `tombstoned` when the server deleted it. content(value) is what counts for "the
// same". write(state, key, value, entry) is a new document with the edit's value in, on the
// entry's stamps. unsafe(entry, value, key), when a kind has one, holds the edit back. same(a, b), when a kind has
// one, replaces comparing content. sameOn(held, value, state), when a kind has one, compares on
// the document that held was read from; every other kind keeps same. A `late` kind settles after
// every other row, on the document they leave.
const ADAPTERS = {
  // Matched by id, first routine wins. A routine whose id the list holds twice is malformed, and the
  // API would pair the last of them, not the first: an edit of it that would go is unsafe.
  // A routine the copy lacks reads as ROUTINE_DELETED on stamp 0: a delete of it is done, and a
  // create (base 0) goes unless the id is tombstoned. Neither is unsafe for its slots: the API
  // pairs only a routine both sides hold. Any routine whose id is not its row's key is unsafe,
  // create or edit: the row is read by its key, so a create of it would read as absent and go
  // again on every sync, and an edit would take the keyed routine out of the list, which the
  // server records as a delete.
  routine: {
    read(state, key) {
      const list = Array.isArray(state.routines) ? state.routines : []
      const index = routineAt(list, key)
      if (index < 0) return { value: ROUTINE_DELETED, stamp: 0, absent: true, tombstoned: tombstoned(state, key) }
      const value = list[index]
      const twice = list.some((r, i) => i > index && r && typeof r === 'object' && r.id === key)
      return { value, stamp: value._ts ?? null, twice }
    },
    content: routineContent,
    // A create goes at the end, its stamps taken off: the server stamps a new routine itself. An
    // edit goes in its routine's place in `state`, found again by id there, since a delete
    // settled before it in the same call may have moved it up; one `state` no longer holds is not
    // written.
    write(state, key, value, entry) {
      if (isRoutineDeleted(value)) return withoutRoutine(state, key)
      const routines = Array.isArray(state.routines) ? state.routines.slice() : []
      if (entry.absent) routines.push(routineContent(value))
      else {
        const index = routineAt(routines, key)
        if (index < 0) return state
        routines[index] = onCopyStamps(value, entry.value)
      }
      return { ...state, routines }
    },
    unsafe: (entry, value, key) =>
      !isRoutineDeleted(value) && (value?.id !== key || (!entry.absent && (entry.twice || putBackChanges(entry.value, value)))),
  },
  // state.customEx, matched by id, first wins. An id the list holds twice is malformed, and an edit
  // of it that would go is unsafe. One the copy lacks reads as the delete marker on stamp 0: a
  // delete of it is done, and a create (base 0) goes unless the id is tombstoned. A create appends,
  // its stamps taken off. An edit replaces that id on the copy's stamps. A delete filters that id
  // out of customEx and nothing else. Unsafe, besides a value whose id is not the row key: the id
  // twice, customPutBack changing the value, or media the copy holds and the edit does not carry.
  // Clearing the link omits url; the server allows that drop. A create is not checked for media.
  // A delete is not unsafe.
  customEx: {
    read(state, key) {
      const list = Array.isArray(state.customEx) ? state.customEx : []
      const index = customAt(list, key)
      if (index < 0) return { value: ROUTINE_DELETED, stamp: 0, absent: true, tombstoned: customTombstoned(state, key) }
      const value = list[index]
      const twice = list.some((ex, i) => i > index && ex && typeof ex === 'object' && ex.id === key)
      return { value, stamp: value._ts ?? null, twice }
    },
    content: routineContent,
    write(state, key, value, entry) {
      if (isRoutineDeleted(value)) return withoutCustomEx(state, key)
      const customEx = Array.isArray(state.customEx) ? state.customEx.slice() : []
      if (entry.absent) customEx.push(routineContent(value))
      else {
        const index = customAt(customEx, key)
        if (index < 0) return state
        customEx[index] = onCopyStamps(value, entry.value)
      }
      return { ...state, customEx }
    },
    unsafe: (entry, value, key) =>
      !isRoutineDeleted(value) && (value?.id !== key || (!entry.absent && (
        entry.twice || customPutBackChanges(entry.value, value) || !carried(entry.value, value, 'media')
      ))),
  },
  // state.nutritionDays[key], stamped by its _ts (the server stamps a day it changed). A day the copy
  // lacks is not deleted: it is a day with no stamp.
  nutritionDay: {
    read(state, key) {
      const value = own(state.nutritionDays, key)
      return { value, stamp: (isMap(value) ? value._ts : null) ?? null }
    },
    content: (day) => {
      if (!isMap(day)) return day
      const { _ts, ...rest } = day
      return rest
    },
    // The day on the copy's _ts, if it has one. A nutritionDays that is not a map reads as empty,
    // as the web's withNutritionDay reads it.
    write(state, key, value, entry) {
      const { _ts, ...day } = value
      if (isMap(entry.value) && Object.hasOwn(entry.value, '_ts')) day._ts = entry.value._ts
      return { ...state, nutritionDays: { ...(isMap(state.nutritionDays) ? state.nutritionDays : {}), [key]: day } }
    },
  },
  // state[key] as a whole, stamped by state.edited[key]: the server moves that stamp when the value
  // changes, so the push leaves `edited` as the copy has it.
  setting: {
    read: (state, key) => ({ value: own(state, key), stamp: own(state.edited, key) ?? null }),
    content: (value) => value,
    write: (state, key, value) => ({ ...state, [key]: value }),
  },
  // The routines' order, keyed routineOrder: its value is every routine id as the phone lists
  // them, stamped by edited.routineOrder (the server moves it when the routines both sides hold
  // change order, never for an add or a removal alone). It settles after the routine rows, so a
  // routine created in the same push is there to be placed. Each routine goes as it is: listed
  // ones in the listed order (an id the document lacks is skipped), then every other entry in the
  // document's order.
  routineOrder: {
    late: true,
    read: (state) => ({ value: routineIds(state), stamp: own(state.edited, 'routineOrder') ?? null }),
    same: sameOrder,
    write(state, key, value) {
      const list = Array.isArray(state.routines) ? state.routines : []
      const rank = new Map()
      value.forEach((id, i) => {
        if (!rank.has(id)) rank.set(id, i)
      })
      const placed = (r) => isObj(r) && r.id != null && rank.has(r.id)
      // a stable sort: an id held twice keeps its copies in the document's order
      const listed = list.filter(placed).sort((a, b) => rank.get(a.id) - rank.get(b.id))
      return { ...state, routines: [...listed, ...list.filter((r) => !placed(r))] }
    },
  },
  // The schedule, keyed schedule: all five keys in one row, so a push cannot send a new
  // scheduleMode beside an old queue. Its stamp is the newest of those keys (a weekday and a date
  // are stamped on their own). It settles after the routine rows, on the document they leave, and
  // is done or rebased only when the server's document holds the same five values. sameOn is that
  // comparison: dead pins are removed first, using the routine ids of the document that side was
  // read from. The late entry comes from the document earlier rows left; the server's own document
  // is the other half and has its own ids. 'rest' stays. A row the write would only clean is done,
  // so it is not sent again. rotation, queue and scheduleMode are written even when null: omitting
  // one is how the server puts the old value back. A weekday or a date is cleared by leaving it
  // out, never as []. A pin to a routine the document does not hold is dropped. Nothing here is
  // unsafe, and the write adds no _ts, _f or edited.
  schedule: {
    late: true,
    read: (state) => ({ value: scheduleFields(state), stamp: scheduleStamp(state.edited) }),
    content: scheduleFields,
    sameOn(held, value, source) {
      const ids = new Set(routineIds(isMap(source) ? source : {}))
      return deepEqual(scheduleHeld(held, ids), scheduleHeld(value, ids))
    },
    write(state, key, value) {
      const ids = new Set(routineIds(state))
      const scalar = (name) => {
        const held = isMap(value) ? value[name] : undefined
        return held === undefined ? null : held
      }
      return {
        ...state,
        scheduleMode: scalar('scheduleMode'),
        rotation: scalar('rotation'),
        queue: scalar('queue'),
        week: weekPins(isMap(value) ? value.week : undefined, ids),
        dayPlan: dayPlanPins(isMap(value) ? value.dayPlan : undefined, ids),
      }
    },
  },
}

// state: the server's document. edits: from listPending(), of any kind (a kind with no adapter is
// left alone), settled in their order, a late row (routineOrder, schedule) after all the others:
// it is judged on the document the others leave, a routine created or deleted there included (and
// is done or rebased only when the server's document holds it as well), where every other row is
// judged on the server's document as it came. Returns { state, done, rebased, applied,
// superseded }, each settled edit as
// { kind, key, t }, a rebased one with the copy's stamp as its new baseTs and a superseded one with
// its reason ('changed', 'deleted' or 'unsafe'). state is a new document only when something
// applies or rebases, and untouched parts keep their identity (a routine delete clones the
// routines, week and dayPlan it cleans). Inputs are never mutated.
export function applyEdits(state, edits) {
  const doc = isMap(state) ? state : {}
  const done = []
  const rebased = []
  const applied = []
  const superseded = []
  let next = state
  const adapterOf = (edit) => (isMap(edit) && Object.hasOwn(ADAPTERS, edit.kind) ? ADAPTERS[edit.kind] : null)
  const rows = Array.isArray(edits) ? edits : []
  for (const edit of [...rows.filter((e) => !adapterOf(e)?.late), ...rows.filter((e) => adapterOf(e)?.late)]) {
    const adapter = adapterOf(edit)
    if (!adapter) continue
    const entryState = adapter.late && isMap(next) ? next : doc
    const entry = adapter.read(entryState, edit.key)
    const held = !!entry && entry.value !== undefined
    const same = adapter.same ?? ((a, b) => deepEqual(adapter.content(a), adapter.content(b)))
    const sameOn = adapter.sameOn ?? ((a, b) => same(a, b))
    const ref = { kind: edit.kind, key: edit.key, t: edit.t }
    // A late row is done or rebased only when the server's document holds the value too: one that
    // holds only on what the other rows leave goes with them, as they may not land (and `sent` is
    // recorded before a push goes, so it may never have landed). Each side is compared on the
    // document it was read from, so a schedule's dead pins are the ones that document lacks.
    const stored = adapter.late ? adapter.read(doc, edit.key) : entry
    const holds = (v) => held && sameOn(entry.value, v, entryState) && (stored === entry || sameOn(stored.value, v, doc))
    // never onto a routine the copy lacks: that would bring back one this phone deleted
    const rebase = held && !entry.absent && !!edit.sent && holds(edit.sent)
    // nothing applies to an entry the server deleted, a create included
    const apply = !!entry && !entry.tombstoned && entry.stamp === edit.baseTs
    if (holds(edit.value)) done.push(ref)
    else if ((rebase || apply) && adapter.unsafe?.(entry, edit.value, edit.key)) superseded.push({ ...ref, reason: 'unsafe' })
    else if (rebase || apply) {
      if (rebase) rebased.push({ ...ref, baseTs: entry.stamp })
      else applied.push(ref)
      next = adapter.write(isMap(next) ? next : {}, edit.key, edit.value, entry)
    } else superseded.push({ ...ref, reason: !entry || entry.absent ? 'deleted' : 'changed' })
  }
  return { state: next, done, rebased, applied, superseded }
}

// The stamp the guard compares an edit's baseTs with, for one kind and key of a document (null when
// it holds none, or for a kind with no adapter). A save takes its base from here, so the two can
// never read the stamp differently.
export function stampOf(state, kind, key) {
  if (!Object.hasOwn(ADAPTERS, kind)) return null
  return ADAPTERS[kind].read(isMap(state) ? state : {}, key)?.stamp ?? null
}

// What a document holds for one edit's kind and key, as the adapter reads it (undefined when it
// holds none, ROUTINE_DELETED for a routine or custom exercise it lacks, every routine id for
// routineOrder, the five schedule keys for schedule): after applyEdits, the value as it goes, on
// the copy's stamps. Never undefined for a routine or a custom exercise, so a delete's markSent
// has a value to store.
export function entryValue(state, kind, key) {
  if (!Object.hasOwn(ADAPTERS, kind)) return undefined
  return ADAPTERS[kind].read(isMap(state) ? state : {}, key)?.value
}
