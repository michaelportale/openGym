import { workoutModel } from '../shared/training.js'
import { completeFields, restEventId } from './rest-after.js'
import { isDone } from './workout-view.js'

// Which engine call a tap makes, and with what. Each returns null when the tap must not write.

const { isSideSet } = workoutModel
const SIDES = ['L', 'R']

export function findSet(view, setId) {
  for (const entry of view?.entries ?? []) {
    const slot = (entry.sets ?? []).find(s => s.setId === setId)
    if (slot) return { entry, slot }
  }
  return null
}

// What the screen shows for a set (the draft over the row, as workoutScreen reads it), in the
// keypad's shape: { w, r }, or per side { w, sides: { L: { r }, R: { r } } }.
export function shownValues(slot, side) {
  const { row } = slot
  const d = slot.draft || {}
  if (!isSideSet(row)) return { w: d.w ?? row.w ?? null, r: d.r ?? row.r ?? null }
  const own = row.sides[side === 'R' ? 'R' : 'L']
  const reps = s => d.sides?.[s]?.r ?? d.r ?? row.sides[s].r ?? null
  return { w: d.w ?? own.w ?? row.w ?? null, sides: { L: { r: reps('L') }, R: { r: reps('R') } } }
}

// The field the keypad opens on: the reps box opens on reps (the side being worked, per side).
export function keypadField(field, perSide, side) {
  if (field !== 'r') return 'w'
  return perSide ? `${side === 'R' ? 'R' : 'L'}.r` : 'r'
}

// Complete logs the current set only. A done set changes through editCall, never a second
// commit: that would move row.at and bring back a rest the owner skipped. A blank weight or
// blank reps (per side, the side being completed) is never logged.
export function completeCall(view, { setId, side, values, eventId }) {
  const found = findSet(view, setId)
  if (!found || isDone(found.slot)) return null
  const { entry, slot } = found
  const shown = values ?? shownValues(slot, side)
  if (shown.w == null) return null
  const call = fields => ({ eventId, exerciseId: entry.id, setId, fields })
  if (!isSideSet(slot.row)) {
    return shown.r == null ? null : call(completeFields(slot.row, null, { w: shown.w, r: shown.r }))
  }
  if (!SIDES.includes(side) || slot.row.sides[side]?.done === true) return null
  const reps = shown.sides?.[side]?.r
  if (reps == null) return null
  // The commit clears the draft, so reps typed for the other side go into the row now.
  const other = side === 'L' ? 'R' : 'L'
  const typed = shown.sides?.[other]?.r
  const row = typed == null ? slot.row : { ...slot.row, sides: { ...slot.row.sides, [other]: { ...slot.row.sides[other], r: typed } } }
  return call(completeFields(row, side, { w: shown.w, r: reps }))
}

// The rest a Complete earns, read from the view after the commit: only once the set is done
// (both sides, per side), named and timed by the commit's own `at` so a reopen rebuilds it.
export function restAfterComplete(view, setId, restMsOf) {
  const found = findSet(view, setId)
  if (!found || !isDone(found.slot)) return null
  const at = found.slot.row.at
  if (!Number.isFinite(at)) return null
  return { eventId: restEventId(setId, at), deadline: at + restMsOf(found.entry) }
}

// A blank field keeps the logged number: a null field would delete it from the row.
const kept = (value, logged) => value ?? logged

// editSet keeps row.at and done. A per-side edit writes both sides in full (sides replaces).
export function editCall(view, { setId, values, eventId }) {
  const found = findSet(view, setId)
  if (!found || !isDone(found.slot)) return null
  const { entry, slot: { row } } = found
  const fields = {}
  const w = kept(values.w, row.w)
  if (w != null) fields.w = w
  if (!isSideSet(row)) {
    const r = kept(values.r, row.r)
    if (r != null) fields.r = r
  } else {
    const side = s => ({ ...row.sides[s], ...(w != null ? { w } : {}), r: kept(values.sides?.[s]?.r, row.sides[s].r) })
    fields.sides = { L: side('L'), R: side('R') }
  }
  return { eventId, exerciseId: entry.id, setId, fields }
}

export function undoCall(view, { setId, eventId }) {
  const found = findSet(view, setId)
  if (!found || !isDone(found.slot)) return null
  return { eventId, exerciseId: found.entry.id, setId }
}

// One more set like the last work set, as the web's Add set does; per side stays per side.
export function addSetCall(entry, eventId) {
  const work = (entry.sets ?? []).filter(s => !s.warmup)
  const last = work.length ? work[work.length - 1].row : {}
  const fields = {}
  if (last.w != null) fields.w = last.w
  if (last.r != null) fields.r = last.r
  if (isSideSet(last)) {
    fields.sides = { L: { w: last.sides.L.w, r: last.sides.L.r }, R: { w: last.sides.R.w, r: last.sides.R.r } }
  }
  return { eventId, exerciseId: entry.id, setId: `add:${entry.id}:${eventId}`, fields }
}

const PRIMARY = { ready: 'complete', 'enter-weight': 'keypad', 'enter-reps': 'keypad', 'exercise-done': 'follow', 'all-done': 'finish' }

// What the dock's primary button does in each mode. Ready logs the set as shown with no sheet;
// a blank weight or blank reps opens the keypad; 'follow' shows the first exercise with a set left.
export function primaryAction(mode) {
  return PRIMARY[mode] ?? 'none'
}

// The field the dock opens the keypad on (the primary button or the lead figure): reps when they
// are what is missing, else weight. keypadField then picks the side being worked.
export function dockKeypadField(mode) {
  return mode === 'enter-reps' ? 'r' : 'w'
}

// The keypad's mode for a tapped row. Only the current set can be completed (ruling: Complete
// applies to the current, not-done set); a done set is edited or undone; a later one takes a draft.
export function sheetMode(status) {
  return status === 'done' || status === 'current' ? status : 'pending'
}

// Swiping the sheet away (or Close) after typing keeps a draft for the current set only, as its
// Save would. On a done set it cancels: only Update edits a logged set. On a later set it cancels.
export function sheetCloseCall(mode, changed) {
  return changed && mode === 'current' ? 'draft' : 'none'
}

const reason = error => error?.message || error?.code || 'unknown error'

// Where a sheet write's outcome shows. A refusal stays in the sheet, with the typed numbers, only
// while that same sheet is still open; once it has closed the screen shows it, so a failed write
// is never hidden. A set saved with a refused rest closes the sheet and shows on the screen.
// `screen` undefined leaves the screen's notice as it is.
export function sheetOutcome(result, stillOpen) {
  if (result?.ignored) return null
  const text = resultNotice(result)
  if (text && stillOpen && !result.committed) return { close: false, sheet: text, screen: undefined }
  return { close: stillOpen, sheet: null, screen: text }
}

// What the screen says after a write. Nothing for a save, a repeat, no change, or a dropped tap.
export function resultNotice(result) {
  if (!result || result.ignored) return null
  if (result.saved === false && result.ok !== true) return `Not saved: ${reason(result.error)}`
  if (result.saved === true && result.ok === false) return `Saved, but the workout did not close: ${reason(result.error)}`
  return null
}
