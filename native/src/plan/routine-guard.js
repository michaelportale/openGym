// Pure guard for routine edits waiting to sync. For each pending edit it decides, against the
// server's copy of the routine, whether the edit is already there (done), is the phone's own
// landed push with newer edits on top (rebased), can go (applied), or was overtaken by a
// change on the web (superseded). An edit that would go but moves or swaps exercises in a
// routine holding the same exercise twice is superseded as unsafe, never sent. No I/O.

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

// The API pairs the slots of a routine holding the same exercise twice by position, not by
// which slot is which (api/sync-stamps.js pairItems, for a writer that does not stamp, as this
// phone is): after a move or swap there it could put one twin's keys (a pyramid, a station) on
// the other. Moving one twin past the other keeps the id sequence, so the ids alone cannot tell.
// What goes in such a routine is a field edit only: every slot keeps its exercise id and every
// key but the ones an edit changes, which are also ones the API never puts back (V139_DROPS).
const FIELDS = new Set(['sets', 'reps', 'repsMin', 'sec', 'min', 'prog'])
const slotsOf = r => (Array.isArray(r?.ex) ? r.ex : [])
const repeats = slots => new Set(slots.map((s) => s?.id)).size !== slots.length
const fixedPart = s => (s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([k]) => !FIELDS.has(k))) : s)
function movesTwins(copy, routine) {
  const a = slotsOf(copy)
  const b = slotsOf(routine)
  if (!repeats(a) && !repeats(b)) return false
  return a.length !== b.length || a.some((s, i) => !deepEqual(fixedPart(s), fixedPart(b[i])))
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
    else if ((rebase || apply) && movesTwins(copy, edit.routine)) superseded.push({ ...ref, kind: 'unsafe' })
    else if (rebase) {
      rebased.push({ ...ref, baseTs: copy._ts ?? null })
      swap(index, edit.routine)
    } else if (apply) {
      applied.push(ref)
      swap(index, edit.routine)
    } else superseded.push({ ...ref, kind: copy ? 'changed' : 'deleted' })
  }
  return { next, done, rebased, applied, superseded }
}
