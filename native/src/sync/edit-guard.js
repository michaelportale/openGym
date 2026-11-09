// Pure guard for edits waiting to sync (pending-edits.js rows): routines, nutrition days and
// settings. For each pending edit it decides, against the server's copy, whether the edit is
// already there (done), is the phone's own landed push with newer edits on top (rebased), can go
// (applied), or was overtaken by a change on the web (superseded). A routine edit that would go
// but that the API would change on the way in (plan/server-put-back.js: a move or swap whose
// slots it pairs differently) is superseded as unsafe, never sent. No I/O.

import { putBackChanges } from '../plan/server-put-back.js'

const META = new Set(['_ts', '_f', '_u'])
const isObj = v => !!v && typeof v === 'object'
const isMap = v => isObj(v) && !Array.isArray(v)

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

// How each kind reads from and writes into the server's document. read(state, key) gives the copy's
// entry { value, stamp } (value undefined when the copy has none), or null for a routine the copy
// does not have: deleted. content(value) is what counts for "the same". write(state, key, value,
// entry) is a new document with the edit's value in, on the entry's stamps. unsafe(entry, value) is
// the routine's alone.
const ADAPTERS = {
  // Matched by id, first routine wins. A routine whose id the list holds twice is malformed, and the
  // API would pair the last of them, not the first: an edit of it that would go is unsafe.
  routine: {
    read(state, key) {
      const list = Array.isArray(state.routines) ? state.routines : []
      const index = list.findIndex((r) => r && typeof r === 'object' && r.id === key)
      if (index < 0) return null
      const value = list[index]
      const twice = list.some((r, i) => i > index && r && typeof r === 'object' && r.id === key)
      return { value, stamp: value._ts ?? null, index, twice }
    },
    content: routineContent,
    write(state, key, value, entry) {
      const routines = state.routines.slice()
      routines[entry.index] = onCopyStamps(value, entry.value)
      return { ...state, routines }
    },
    unsafe: (entry, value) => entry.twice || putBackChanges(entry.value, value),
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
}

// state: the server's document. edits: from listPending(), of any kind (a kind with no adapter is
// left alone). Returns { state, done, rebased, applied, superseded }, each settled edit as
// { kind, key, t }, a rebased one with the copy's stamp as its new baseTs and a superseded one with
// its reason ('changed', 'deleted' or 'unsafe'). state is a new document only when something
// applies or rebases, and untouched parts keep their identity. Inputs are never mutated.
export function applyEdits(state, edits) {
  const doc = isMap(state) ? state : {}
  const done = []
  const rebased = []
  const applied = []
  const superseded = []
  let next = state
  for (const edit of Array.isArray(edits) ? edits : []) {
    const adapter = isMap(edit) && Object.hasOwn(ADAPTERS, edit.kind) ? ADAPTERS[edit.kind] : null
    if (!adapter) continue
    const entry = adapter.read(doc, edit.key)
    const held = !!entry && entry.value !== undefined
    const same = (a, b) => deepEqual(adapter.content(a), adapter.content(b))
    const ref = { kind: edit.kind, key: edit.key, t: edit.t }
    const rebase = held && !!edit.sent && same(entry.value, edit.sent)
    const apply = !!entry && entry.stamp === edit.baseTs
    if (held && same(entry.value, edit.value)) done.push(ref)
    else if ((rebase || apply) && adapter.unsafe?.(entry, edit.value)) superseded.push({ ...ref, reason: 'unsafe' })
    else if (rebase || apply) {
      if (rebase) rebased.push({ ...ref, baseTs: entry.stamp })
      else applied.push(ref)
      next = adapter.write(isMap(next) ? next : {}, edit.key, edit.value, entry)
    } else superseded.push({ ...ref, reason: entry ? 'changed' : 'deleted' })
  }
  return { state: next, done, rebased, applied, superseded }
}

// The routine edits among `edits` over a routines list (a non-array reads as empty), as the outbox,
// the engine and the screens read them until they take every kind: { next, done, rebased, applied,
// superseded }, next being the list itself when nothing applies or rebases.
export function applyRoutineEdits(routines, edits) {
  const list = Array.isArray(routines) ? routines : []
  const mine = (Array.isArray(edits) ? edits : []).filter((e) => e?.kind === 'routine')
  const { state, ...settled } = applyEdits({ routines: list }, mine)
  return { next: state.routines, ...settled }
}
