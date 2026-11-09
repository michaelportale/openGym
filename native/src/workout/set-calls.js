import { workoutModel } from '../shared/training.js'
import { isOvernight } from '../session/timing.js'
import { OVERNIGHT_NOTICE, failureText } from './failure-text.js'
import { completeFields, restEventId } from './rest-after.js'
import { carriedWeight, isDone, isWarmup, lockedWeight, shownValues } from './workout-view.js'

// Which engine call a tap makes, and with what. Each returns null when the tap must not write.

const { isSideSet } = workoutModel
const SIDES = ['L', 'R']

export { OVERNIGHT_NOTICE }

// A session left open overnight logs nothing until the owner picks Resume, Finish or Discard
// (the engine would take the set and fold it into last night's workout). The engine reads the
// clock only when an action runs, so a screen left open across midnight still holds a view drawn
// before it: overnight is checked again at `now`, the clock as the write runs, from the view's
// last activity in `timeZone`, the session's own (the view's; the engine decides in it, so a
// zone change mid-session reads as it does there). A view the engine already called overnight
// stays so. Without a clock, the real one: never only what the view said when it was drawn.
export function overnightNow(view, now = Date.now(), timeZone = view?.timeZone) {
  if (view?.disposition?.kind === 'overnight') return true
  return view?.status === 'active' && isOvernight(view.activityAt, now, timeZone)
}

export function overnightNotice(view, now) {
  return overnightNow(view, now) ? OVERNIGHT_NOTICE : null
}

// What a write refused at `now` returns: the overnight refusal (failureText's sentence for every
// tap), or null when the session is not overnight.
export function overnightRefusal(view, now) {
  return overnightNow(view, now) ? { ok: false, saved: false, error: { code: 'overnight' } } : null
}

export const PAST_MIDNIGHT = "It's past midnight."

// Finish opened before midnight carries no end, so the engine ends it "now"; saved after
// midnight, the engine refuses that ('overnight'). The sheet then takes the overnight end from
// the view the refusal reloaded (the last logged work, or the start), as the overnight dock
// does, and says why: the next Save is the overnight Finish. The refusal itself finishes nothing.
// Null when there is nothing to retarget.
export function finishRetarget(result, end, view) {
  if (end != null || result?.error?.code !== 'overnight') return null
  const target = view?.disposition?.suggestedEnd ?? view?.startedAt
  return Number.isFinite(target) ? { end: target, notice: PAST_MIDNIGHT } : null
}

export function findSet(view, setId) {
  for (const entry of view?.entries ?? []) {
    const slot = (entry.sets ?? []).find(s => s.setId === setId)
    if (slot) return { entry, slot }
  }
  return null
}

// The field the keypad opens on: the reps box opens on reps (the side being worked, per side).
export function keypadField(field, perSide, side) {
  if (field !== 'r') return 'w'
  return perSide ? `${side === 'R' ? 'R' : 'L'}.r` : 'r'
}

// Complete logs the current set only. A done set changes through editCall, never a second
// commit: that would move row.at and bring back a rest the owner skipped. A blank weight or
// blank reps (per side, the side being completed) is never logged. `now` is the clock as the
// write runs (overnightNow), as for every call below.
export function completeCall(view, { setId, side, values, eventId, now }) {
  if (overnightNow(view, now)) return null
  const found = findSet(view, setId)
  if (!found || isDone(found.slot)) return null
  const { entry, slot } = found
  const shown = values ?? shownValues(slot, side, carriedWeight(entry, setId))
  // A half-done per-side set logs the weight its first side was logged at (lockedWeight).
  const w = lockedWeight(slot.row)?.w ?? shown.w
  if (w == null) return null
  const call = fields => ({ eventId, exerciseId: entry.id, setId, fields })
  if (!isSideSet(slot.row)) {
    return shown.r == null ? null : call(completeFields(slot.row, null, { w, r: shown.r }))
  }
  if (!SIDES.includes(side) || slot.row.sides[side]?.done === true) return null
  const reps = shown.sides?.[side]?.r
  if (reps == null) return null
  // The commit clears the draft, so reps typed for the other side go into the row now.
  const other = side === 'L' ? 'R' : 'L'
  const typed = shown.sides?.[other]?.r
  const row = typed == null ? slot.row : { ...slot.row, sides: { ...slot.row.sides, [other]: { ...slot.row.sides[other], r: typed } } }
  return call(completeFields(row, side, { w, r: reps }))
}

// The rest a Complete earns, read from the view after the commit: only once the set is done
// (both sides, per side), named and timed by the commit's own `at` so a reopen rebuilds it.
// A warm-up earns none.
export function restAfterComplete(view, setId, restMsOf) {
  const found = findSet(view, setId)
  if (!found || !isDone(found.slot) || isWarmup(found.slot)) return null
  const at = found.slot.row.at
  if (!Number.isFinite(at)) return null
  return { eventId: restEventId(setId, at), deadline: at + restMsOf(found.entry) }
}

// A blank field keeps the logged number: a null field would delete it from the row.
const kept = (value, logged) => value ?? logged

// editSet keeps row.at and done. A per-side edit writes both sides in full (sides replaces).
export function editCall(view, { setId, values, eventId, now }) {
  if (overnightNow(view, now)) return null
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

export function undoCall(view, { setId, eventId, now }) {
  if (overnightNow(view, now)) return null
  const found = findSet(view, setId)
  if (!found || !isDone(found.slot)) return null
  return { eventId, exerciseId: found.entry.id, setId }
}

// The sheet's Undo, run inside the gate on the engine's latest view with the hook's `session`
// (putDraft, undoSet). A draft on a done set is one a failed clear left after its commit (a done
// set takes none): undone, the set would show it and one-tap Complete would log it. So it is
// cleared first, in the same gated write, and a clear that fails undoes nothing: that refusal is
// the result, and the set stays done, showing what was logged. Null when there is nothing to undo.
export async function undoWrite(session, view, { setId, eventId, now }) {
  const call = undoCall(view, { setId, eventId, now })
  if (!call) return null
  if (findSet(view, setId).slot.draft != null) {
    const cleared = await session.putDraft(setId, null)
    if (cleared?.saved !== true) return cleared
  }
  return session.undoSet(call)
}

// A draft (Save, or typed numbers kept on close) is for a set not done yet; a done set changes
// only through editCall. A half-done per-side set's draft keeps the weight its first side was
// logged at (lockedWeight), so what is stored is what the set shows.
export function draftCall(view, { setId, values, now }) {
  if (overnightNow(view, now)) return null
  const found = findSet(view, setId)
  if (!found || isDone(found.slot)) return null
  const locked = lockedWeight(found.slot.row)
  return { setId, values: locked ? { ...values, w: locked.w } : values }
}

// One more set like the last work set, as the web's Add set does; per side stays per side.
export function addSetCall(view, exerciseId, eventId, now) {
  if (overnightNow(view, now)) return null
  const entry = (view?.entries ?? []).find(e => e.id === exerciseId)
  if (!entry) return null
  const work = (entry.sets ?? []).filter(s => !isWarmup(s))
  const last = work.length ? work[work.length - 1].row : {}
  const fields = {}
  if (last.w != null) fields.w = last.w
  if (last.r != null) fields.r = last.r
  if (isSideSet(last)) {
    fields.sides = { L: { w: last.sides.L.w, r: last.sides.L.r }, R: { w: last.sides.R.w, r: last.sides.R.r } }
  }
  return { eventId, exerciseId: entry.id, setId: `add:${entry.id}:${eventId}`, fields }
}

// A blank warm-up row of its own: phase 'warmup' (and the old flag, for older readers) keeps it
// out of every count. One plain row even on a per-side exercise. The owner types its numbers in
// the keypad; nulls leave the row without a weight or reps.
export function addWarmupCall(view, exerciseId, eventId, now) {
  if (overnightNow(view, now)) return null
  const entry = (view?.entries ?? []).find(e => e.id === exerciseId)
  if (!entry) return null
  return { eventId, exerciseId: entry.id, setId: `warm:${entry.id}:${eventId}`, fields: { phase: 'warmup', warmup: true, w: null, r: null } }
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

// Swiping the sheet away (or Close) after typing keeps a draft for any set not done yet, as its
// Save would. On a done set it cancels: only Update edits a logged set.
export function sheetCloseCall(mode, changed) {
  return changed && mode !== 'done' ? 'draft' : 'none'
}

const LEAVING = ['background', 'inactive']

// The app leaving the front with the sheet open keeps the typed numbers as a swipe would, so a
// kill from the app switcher loses nothing (iOS sends 'inactive' first; a kill from the switcher
// may follow with no 'background'). The sheet stays open. Numbers the set already holds as its
// draft (`stored`, the set's draft in the engine's latest view) are not written again, so the
// 'background' after an 'inactive' writes nothing.
export function sheetBackgroundCall(appState, mode, changed, { values, stored } = {}) {
  if (!LEAVING.includes(appState)) return 'none'
  if (stored != null && JSON.stringify(stored) === JSON.stringify(values)) return 'none'
  return sheetCloseCall(mode, changed)
}

export const SAVED_REST_FAILED = "Saved. Rest didn't start."
const DRAFT_NOT_CLEARED = "The typed numbers for this set couldn't be cleared."
const TIME_NOT_UPDATED = "The workout time couldn't be updated, so it may be off after a restart."
const NOT_CLOSED = "The workout isn't closed yet. Tap Save workout again."
const REST_RAN_OUT = 'That rest has already run out.'

// A Complete is two writes: the set, then its rest. The set's result is what the Complete
// reports; a rest refused after the set saved is `restFailed` on it, never a "not saved", and a
// timer checkpoint that failed on the rest is carried. A set that did not save stays not saved
// whatever the rest did.
export function completeResult(commit, started) {
  if (commit?.saved !== true || started == null) return commit
  const checkpoint = started.checkpointError && !commit.checkpointError ? { checkpointError: started.checkpointError } : null
  if (started.ok === false) return { ...commit, restFailed: true, ...checkpoint }
  return checkpoint ? { ...commit, ...checkpoint } : commit
}

// What a write's result means for the owner, or null when there is nothing to say (a save, a
// repeat, no change, a dropped tap). `action` is what was tapped (failureText's). Kinds:
// 'failed' (nothing saved; or a workout saved but not closed), 'saved-rest-failed' (the set
// saved, its rest did not start) and 'warning' (saved, but its draft did not clear or the timer
// checkpoint failed). A result that did not save is never shown as saved, whatever it carries.
// Saved but not ok is Finish's "sent, but not closed"; from any other write it reads as refused.
export function writeOutcome(result, action) {
  if (!result || result.ignored) return null
  const refused = () => ({ kind: 'failed', text: failureText(result.error?.code, { action }) })
  if (result.saved !== true) {
    if (result.ok !== true) return refused()
    return result.checkpointError ? { kind: 'warning', text: TIME_NOT_UPDATED } : null
  }
  if (result.ok === false) return action === 'finish' ? { kind: 'failed', text: NOT_CLOSED } : refused()
  const warnings = [result.draftError ? DRAFT_NOT_CLEARED : null, result.checkpointError ? TIME_NOT_UPDATED : null].filter(Boolean)
  if (result.restFailed) return { kind: 'saved-rest-failed', text: [SAVED_REST_FAILED, ...warnings].join(' ') }
  return warnings.length ? { kind: 'warning', text: ['Saved.', ...warnings].join(' ') } : null
}

// What the screen says after a write, as text.
export function resultNotice(result, action) {
  return writeOutcome(result, action)?.text ?? null
}

export const NO_NOTICES = { notice: null, rest: null }

// The screen's two notices after a write. `notice` is what the last write said (null clears
// it). `rest` is the line that carries the Start rest button: set by a Complete whose set saved
// but whose rest was refused (or by a rest that failed to start), gone once a rest runs, another
// set is completed or a set is undone (its "Saved." would no longer hold), and kept through every
// other write. 'rest' is the rest restored on open, 'start-rest' the Start rest tap; `result`
// null there means no rest was left to start. A rest refused overnight says so as the notice and
// leaves the line as it was: its Start rest works again after Resume. A dropped tap changes nothing.
export function noticesAfter(notices, result, action) {
  if (result?.ignored) return notices
  const outcome = writeOutcome(result, action)
  if (action === 'rest' || action === 'start-rest') {
    if (outcome?.kind === 'failed' && result?.error?.code === 'overnight') return { notice: outcome.text, rest: notices.rest }
    if (outcome?.kind === 'failed') return { notice: notices.notice, rest: outcome.text }
    // The tap found that rest already over: say so rather than let the line just vanish.
    if (result == null && action === 'start-rest') return { notice: REST_RAN_OUT, rest: null }
    return { notice: outcome?.text ?? notices.notice, rest: null }
  }
  if (outcome?.kind === 'saved-rest-failed') return { notice: null, rest: outcome.text }
  const moved = result?.saved === true && (action === 'complete' || action === 'undo')
  return { notice: outcome?.text ?? null, rest: moved ? null : notices.rest }
}

// What VoiceOver says when the notices change (iOS speaks neither live regions nor the alert
// role): each one in `after` that appeared or whose words changed, in its order (the screen's
// notice, its rest line, then the keypad's and Finish's); nothing for one that went away or stayed
// the same, so a re-render never repeats it.
export function noticeAnnouncement(before, after) {
  const fresh = Object.keys(after ?? {}).map(key => (after[key] && after[key] !== before?.[key] ? after[key] : null)).filter(Boolean)
  return fresh.length ? fresh.join(' ') : null
}

// Where a sheet write's outcome shows. A refusal stays in the sheet, with the typed numbers, only
// while that same sheet is still open; once it has closed the screen shows it, so a failed write
// is never hidden. A set saved with a refused rest closes the sheet and shows on the screen.
// `screen` false leaves the screen's notices as they are; true hands the result to noticesAfter.
export function sheetOutcome(result, stillOpen, action) {
  if (result?.ignored) return null
  const outcome = writeOutcome(result, action)
  if (outcome?.kind === 'failed' && stillOpen) return { close: false, sheet: outcome.text, screen: false }
  return { close: stillOpen, sheet: null, screen: true }
}
