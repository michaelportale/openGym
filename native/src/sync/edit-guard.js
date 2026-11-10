// Pure guard for edits waiting to sync (pending-edits.js rows): routines, nutrition days and
// settings. For each pending edit it decides, against the server's copy, whether the edit is
// already there (done), is the phone's own landed push with newer edits on top (rebased), can go
// (applied), or was overtaken by a change on the web (superseded). A routine edit that would go
// but that the API would change on the way in (plan/server-put-back.js: a move or swap whose
// slots it pairs differently) is superseded as unsafe, never sent. A routine row can also create
// the routine (base 0) or delete it (its value ROUTINE_DELETED). A routineOrder row orders the
// routines. No I/O.

import { putBackChanges } from '../plan/server-put-back.js'
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

// The document with routine `key` deleted as the web deletes it (routines.js deleteRoutine): out of
// routines, out of every weekday that names it (a weekday left empty goes) and its dayPlan pins
// gone. The loop and the queue keep its id; their readers skip one that no longer resolves. It
// runs on a clone, so the copy is never changed. deleteRoutine reads every entry's id, which a
// null has not: it sees the list without them, and they stay where they were.
function withoutRoutine(state, key) {
  const draft = structuredClone(state)
  const list = draft.routines
  draft.routines = list.filter((r) => r != null)
  routineLib.deleteRoutine(draft, key)
  const kept = new Set(draft.routines)
  draft.routines = list.filter((r) => r == null || kept.has(r))
  return draft
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

// How each kind reads from and writes into the server's document. read(state, key) gives the copy's
// entry { value, stamp } (value undefined when the copy has none); a routine the copy lacks is
// `absent`, and `tombstoned` when the server deleted it. content(value) is what counts for "the
// same". write(state, key, value, entry) is a new document with the edit's value in, on the
// entry's stamps. unsafe(entry, value) is the routine's alone. same(a, b), when a kind has one,
// replaces comparing content. A `late` kind settles after every other row, on the document they
// leave.
const ADAPTERS = {
  // Matched by id, first routine wins. A routine whose id the list holds twice is malformed, and the
  // API would pair the last of them, not the first: an edit of it that would go is unsafe.
  // A routine the copy lacks reads as ROUTINE_DELETED on stamp 0: a delete of it is done, and a
  // create (base 0) goes unless the id is tombstoned. Neither is unsafe: the API pairs only a
  // routine both sides hold.
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
    // settled before it in the same call may have moved it up.
    write(state, key, value, entry) {
      if (isRoutineDeleted(value)) return withoutRoutine(state, key)
      const routines = Array.isArray(state.routines) ? state.routines.slice() : []
      if (entry.absent) routines.push(routineContent(value))
      else routines[routineAt(routines, key)] = onCopyStamps(value, entry.value)
      return { ...state, routines }
    },
    unsafe: (entry, value) => !entry.absent && !isRoutineDeleted(value) && (entry.twice || putBackChanges(entry.value, value)),
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
}

// state: the server's document. edits: from listPending(), of any kind (a kind with no adapter is
// left alone), settled in their order, a routineOrder row after all the others: it is judged on
// the document the others leave, a routine created or deleted there included, where every other
// row is judged on the server's document as it came. Returns { state, done, rebased, applied,
// superseded }, each settled edit as
// { kind, key, t }, a rebased one with the copy's stamp as its new baseTs and a superseded one with
// its reason ('changed', 'deleted' or 'unsafe'). state is a new document only when something
// applies or rebases, and untouched parts keep their identity (all but a routine delete, which
// works on a clone of the whole document). Inputs are never mutated.
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
    const entry = adapter.read(adapter.late && isMap(next) ? next : doc, edit.key)
    const held = !!entry && entry.value !== undefined
    const same = adapter.same ?? ((a, b) => deepEqual(adapter.content(a), adapter.content(b)))
    const ref = { kind: edit.kind, key: edit.key, t: edit.t }
    const rebase = held && !!edit.sent && same(entry.value, edit.sent)
    // nothing applies to an entry the server deleted, a create included
    const apply = !!entry && !entry.tombstoned && entry.stamp === edit.baseTs
    if (held && same(entry.value, edit.value)) done.push(ref)
    else if ((rebase || apply) && adapter.unsafe?.(entry, edit.value)) superseded.push({ ...ref, reason: 'unsafe' })
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
// holds none, ROUTINE_DELETED for a routine it lacks, every routine id for routineOrder): after
// applyEdits, the value as it goes, on the copy's stamps. Never undefined for a routine, so a
// delete's markSent has a value to store.
export function entryValue(state, kind, key) {
  if (!Object.hasOwn(ADAPTERS, kind)) return undefined
  return ADAPTERS[kind].read(isMap(state) ? state : {}, key)?.value
}
