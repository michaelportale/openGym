// Pure guard for routine edits waiting to sync. For each pending edit it decides, against the
// server's copy of the routine, whether the edit is already there (done), is the phone's own
// landed push with newer edits on top (rebased), can go (applied), or was overtaken by a
// change on the web (superseded). An edit that would go but that the API would change on the
// way in (server-put-back.js: a move or swap whose slots it pairs differently) is superseded as
// unsafe, never sent. No I/O.

import { putBackChanges } from './server-put-back.js'

const META = new Set(['_ts', '_f', '_u'])

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

// routines: the server's list (a non-array reads as empty). edits: from listPending().
// Matched by id, first routine wins. Returns { next, done, rebased, applied, superseded };
// next is a new array only when something applies or rebases, and untouched routines keep
// their identity. Inputs are never mutated.
export function applyRoutineEdits(routines, edits) {
  const list = Array.isArray(routines) ? routines : []
  const done = []
  const rebased = []
  const applied = []
  const superseded = []
  let next = list
  const swap = (index, value) => {
    if (next === list) next = list.slice()
    next[index] = value
  }
  for (const edit of Array.isArray(edits) ? edits : []) {
    const index = list.findIndex((r) => r && typeof r === 'object' && r.id === edit.rid)
    const copy = index < 0 ? null : list[index]
    const ref = { rid: edit.rid, t: edit.t }
    const rebase = !!copy && !!edit.sent && sameRoutine(copy, edit.sent)
    const apply = !!copy && (copy._ts ?? null) === edit.baseTs
    if (copy && sameRoutine(copy, edit.routine)) done.push(ref)
    else if ((rebase || apply) && putBackChanges(copy, edit.routine)) superseded.push({ ...ref, kind: 'unsafe' })
    else if (rebase) {
      rebased.push({ ...ref, baseTs: copy._ts ?? null })
      swap(index, onCopyStamps(edit.routine, copy))
    } else if (apply) {
      applied.push(ref)
      swap(index, onCopyStamps(edit.routine, copy))
    } else superseded.push({ ...ref, kind: copy ? 'changed' : 'deleted' })
  }
  return { next, done, rebased, applied, superseded }
}
