import { describe, expect, test } from 'vitest'
import { NO_NOTICES, OVERNIGHT_NOTICE, PAST_MIDNIGHT, addSetCall, addWarmupCall, completeCall, completeResult, dockKeypadField, draftCall, editCall, finishRetarget, keypadField, noticeAnnouncement, noticesAfter, overnightNotice, overnightNow, overnightRefusal, primaryAction, restAfterComplete, resultNotice, sheetBackgroundCall, sheetCloseCall, sheetMode, sheetOutcome, undoCall, undoWrite, writeOutcome, findSet } from './set-calls.js'
import { shownValues, workoutScreen } from './workout-view.js'
import { pendingRest, restEventId, restMsFor } from './rest-after.js'
import { withTargets } from './session-screen.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSessionController } from '../session/session-controller.js'
import { sessionActions, sessionOptionsFrom } from '../session/use-active-session.js'
import { plannedSetId } from '../session/ids.js'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'

const slot = (setId, row, extra = {}) => ({ setId, completed: row.done === true, warmup: false, draft: null, row, ...extra })
const todo = (w, r) => ({ w, r, done: false })
const done = (w, r, at = 1000) => ({ w, r, done: true, at })
const sided = (w, L, R, extra = {}) => ({
  w, r: L.r + R.r, done: L.done && R.done,
  sides: { L: { w, r: L.r, done: L.done }, R: { w, r: R.r, done: R.done } },
  ...extra,
})
const view = entries => ({ status: 'active', entries, rest: null })
const bench = sets => ({ id: '0289', target: { restSec: 120 }, sets })
const lateral = sets => ({ id: '0300', target: {}, sets })
// A warm-up as the engine holds it after addWarmupCall: its own row, phase 'warmup'.
const warm = (setId, row) => slot(setId, { ...row, phase: 'warmup', warmup: true }, { warmup: true })

describe('shownValues', () => {
  test('the draft over the row', () => {
    expect(shownValues(slot('a', todo(75, 8)), null)).toEqual({ w: 75, r: 8 })
    expect(shownValues(slot('a', todo(75, 8), { draft: { w: 80 } }), null)).toEqual({ w: 80, r: 8 })
    expect(shownValues(slot('a', todo(null, 12)), null)).toEqual({ w: null, r: 12 })
  })
  test('a carried weight sits under the draft and over the row', () => {
    expect(shownValues(slot('a', todo(75, 8)), null, 80)).toEqual({ w: 80, r: 8 })
    expect(shownValues(slot('a', todo(75, 8), { draft: { w: 77.5 } }), null, 80)).toEqual({ w: 77.5, r: 8 })
    expect(shownValues(slot('a', todo(75, 8)), null, undefined)).toEqual({ w: 75, r: 8 })
    const row = sided(7.5, { r: 10, done: false }, { r: 10, done: false })
    expect(shownValues(slot('s', row), 'L', 10)).toEqual({ w: 10, sides: { L: { r: 10 }, R: { r: 10 } } })
  })
  test('per side: one weight, reps for each side, the draft over the row', () => {
    const row = sided(7.5, { r: 10, done: false }, { r: 10, done: false })
    expect(shownValues(slot('s', row), 'L')).toEqual({ w: 7.5, sides: { L: { r: 10 }, R: { r: 10 } } })
    const draft = { w: 10, sides: { L: { r: 12 }, R: { r: null } } }
    expect(shownValues(slot('s', row, { draft }), 'L')).toEqual({ w: 10, sides: { L: { r: 12 }, R: { r: 10 } } })
  })
})

describe('keypadField', () => {
  test('the reps box opens on reps, the side being worked for a per-side set', () => {
    expect(keypadField('r', false, null)).toBe('r')
    expect(keypadField('r', true, 'L')).toBe('L.r')
    expect(keypadField('r', true, 'R')).toBe('R.r')
  })
  test('everything else opens on weight', () => {
    expect(keypadField('w', false, null)).toBe('w')
    expect(keypadField('w', true, 'R')).toBe('w')
    expect(keypadField(undefined, true, 'L')).toBe('w')
  })
})

describe('completeCall', () => {
  test('logs the current set as shown', () => {
    const v = view([bench([slot('b0', done(75, 10)), slot('b1', todo(75, 8), { draft: { w: 80 } })])])
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' })).toEqual({
      eventId: 'e1', exerciseId: '0289', setId: 'b1', fields: { w: 80, r: 8 },
    })
  })
  test('logs the weight carried from the set before it, as the screen shows it', () => {
    const v = view([bench([slot('b0', done(80, 10)), slot('b1', todo(75, 8)), slot('b2', todo(null, 8))])])
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' }).fields).toEqual({ w: 80, r: 8 })
    const next = view([bench([slot('b0', done(80, 10)), slot('b1', done(80, 8)), slot('b2', todo(null, 8))])])
    expect(completeCall(next, { setId: 'b2', side: null, eventId: 'e2' }).fields).toEqual({ w: 80, r: 8 })
  })
  test('a draft weight beats the carried one', () => {
    const v = view([bench([slot('b0', done(80, 10)), slot('b1', todo(75, 8), { draft: { w: 77.5 } })])])
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' }).fields).toEqual({ w: 77.5, r: 8 })
  })
  test('per side: the carried weight is logged on both sides', () => {
    const v = view([lateral([
      slot('s0', sided(10, { r: 12, done: true }, { r: 12, done: true })),
      slot('s1', sided(7.5, { r: 12, done: false }, { r: 12, done: false })),
    ])])
    expect(completeCall(v, { setId: 's1', side: 'L', eventId: 'e1' }).fields).toEqual({
      w: 10, sides: { L: { w: 10, r: 12, done: true }, R: { w: 10, r: 12, done: false } },
    })
  })
  test('per side: the second side keeps the weight its first side was logged at', () => {
    const v = view([lateral([
      slot('s0', sided(10, { r: 12, done: true }, { r: 12, done: true })),
      slot('s1', sided(12.5, { r: 12, done: true }, { r: 12, done: false }), { completed: true }),
    ])])
    expect(completeCall(v, { setId: 's1', side: 'R', eventId: 'e1' }).fields.w).toBe(12.5)
  })
  test('logs what the sheet hands over', () => {
    const v = view([bench([slot('b0', todo(75, 8))])])
    expect(completeCall(v, { setId: 'b0', side: null, values: { w: 77.5, r: 6 }, eventId: 'e1' }).fields).toEqual({ w: 77.5, r: 6 })
  })
  test('a blank weight is never logged', () => {
    const v = view([bench([slot('b0', todo(null, 8))])])
    expect(completeCall(v, { setId: 'b0', side: null, eventId: 'e1' })).toBeNull()
    expect(completeCall(view([bench([slot('b0', todo(75, 8))])]), { setId: 'b0', side: null, values: { w: null, r: 8 }, eventId: 'e1' })).toBeNull()
  })
  test('blank reps are never logged, from the dock or the sheet', () => {
    const v = view([bench([slot('b0', todo(75, null))])])
    expect(completeCall(v, { setId: 'b0', side: null, eventId: 'e1' })).toBeNull()
    const ready = view([bench([slot('b0', todo(75, 8))])])
    expect(completeCall(ready, { setId: 'b0', side: null, values: { w: 75, r: null }, eventId: 'e1' })).toBeNull()
  })
  test('per side: blank reps on the side being completed are never logged', () => {
    const blankL = { w: 7.5, done: false, sides: { L: { w: 7.5, r: null, done: false }, R: { w: 7.5, r: 10, done: false } } }
    const v = view([lateral([slot('s', blankL)])])
    expect(completeCall(v, { setId: 's', side: 'L', eventId: 'e1' })).toBeNull()
    expect(completeCall(v, { setId: 's', side: 'L', values: { w: 7.5, sides: { L: { r: null }, R: { r: 10 } } }, eventId: 'e1' })).toBeNull()
    expect(completeCall(v, { setId: 's', side: 'L', values: { w: 7.5, sides: { L: { r: 9 }, R: { r: null } } }, eventId: 'e1' }).fields.sides.L).toEqual({ w: 7.5, r: 9, done: true })
  })
  test('a done set is never completed again, and an unknown set is not either', () => {
    const v = view([bench([slot('b0', done(75, 10))])])
    expect(completeCall(v, { setId: 'b0', side: null, eventId: 'e1' })).toBeNull()
    expect(completeCall(v, { setId: 'nope', side: null, eventId: 'e1' })).toBeNull()
  })
  test('per side: completes only the side being worked', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 10, done: false }))])])
    expect(completeCall(v, { setId: 's', side: 'L', eventId: 'e1' }).fields).toEqual({
      w: 7.5,
      sides: { L: { w: 7.5, r: 10, done: true }, R: { w: 7.5, r: 10, done: false } },
    })
  })
  test('per side: the other side keeps reps typed in the sheet, since the commit clears the draft', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 10, done: false }))])])
    const values = { w: 10, sides: { L: { r: 12 }, R: { r: 11 } } }
    expect(completeCall(v, { setId: 's', side: 'L', values, eventId: 'e1' }).fields).toEqual({
      w: 10,
      sides: { L: { w: 10, r: 12, done: true }, R: { w: 10, r: 11, done: false } },
    })
  })
  // Both sides share one weight: on a half-done set it is the one the first side was logged at,
  // whatever the sheet hands over.
  test('per side: the second side logs the first side\'s weight even if the sheet sends another', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: true }, { r: 10, done: false }), { completed: true })])])
    const call = completeCall(v, { setId: 's', side: 'R', values: { w: 10, sides: { L: { r: 10 }, R: { r: 9 } } }, eventId: 'e2' })
    expect(call.fields).toEqual({ w: 7.5, sides: { L: { w: 7.5, r: 10, done: true }, R: { w: 7.5, r: 9, done: true } } })
  })
  test('per side: the right side after the left keeps the left done', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: true }, { r: 10, done: false }), { completed: true })])])
    expect(completeCall(v, { setId: 's', side: 'R', eventId: 'e2' }).fields.sides).toEqual({
      L: { w: 7.5, r: 10, done: true }, R: { w: 7.5, r: 10, done: true },
    })
  })
  test('per side: a side already done is not completed again (a stale second tap)', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: true }, { r: 10, done: false }), { completed: true })])])
    expect(completeCall(v, { setId: 's', side: 'L', eventId: 'e2' })).toBeNull()
  })
  test('per side: no side means nothing to complete', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 10, done: false }))])])
    expect(completeCall(v, { setId: 's', side: null, eventId: 'e1' })).toBeNull()
  })
})

describe('completeCall on a warm-up', () => {
  test('logs the warm-up as shown, never the weight the work sets carry', () => {
    const v = view([bench([slot('b0', done(80, 10)), warm('w', todo(45, 10))])])
    expect(completeCall(v, { setId: 'w', side: null, eventId: 'e1' })).toEqual({
      eventId: 'e1', exerciseId: '0289', setId: 'w', fields: { w: 45, r: 10 },
    })
    expect(completeCall(view([bench([slot('b0', done(80, 10)), warm('w', todo(null, 10))])]), { setId: 'w', side: null, eventId: 'e1' })).toBeNull()
  })
  test('logs what the sheet hands over', () => {
    const v = view([bench([warm('w', todo(null, null))])])
    expect(completeCall(v, { setId: 'w', side: null, values: { w: 45, r: 10 }, eventId: 'e1' }).fields).toEqual({ w: 45, r: 10 })
  })
})

describe('restAfterComplete', () => {
  const restMsOf = entry => (entry.target?.restSec ?? 90) * 1000
  test('a done set starts the rest named by its own commit time', () => {
    const v = view([bench([slot('b0', done(75, 10, 5000))])])
    expect(restAfterComplete(v, 'b0', restMsOf)).toEqual({ eventId: restEventId('b0', 5000), deadline: 5000 + 120_000 })
  })
  test('one side done is not a done set, so no rest yet', () => {
    const half = sided(7.5, { r: 10, done: true }, { r: 10, done: false }, { at: 5000 })
    expect(restAfterComplete(view([lateral([slot('s', half, { completed: true })])]), 's', restMsOf)).toBeNull()
    const both = sided(7.5, { r: 10, done: true }, { r: 10, done: true }, { at: 6000 })
    expect(restAfterComplete(view([lateral([slot('s', both)])]), 's', restMsOf)).toEqual({ eventId: restEventId('s', 6000), deadline: 6000 + 90_000 })
  })
  test('a done warm-up starts no rest', () => {
    expect(restAfterComplete(view([bench([warm('w', done(45, 10, 5000))])]), 'w', restMsOf)).toBeNull()
  })
  test('nothing when the set is not done, has no time, or is gone', () => {
    expect(restAfterComplete(view([bench([slot('b0', todo(75, 8))])]), 'b0', restMsOf)).toBeNull()
    expect(restAfterComplete(view([bench([slot('b0', { w: 75, r: 8, done: true })])]), 'b0', restMsOf)).toBeNull()
    expect(restAfterComplete(view([]), 'b0', restMsOf)).toBeNull()
  })
})

describe('editCall and undoCall', () => {
  test('an edit writes the new numbers and never touches done or the time', () => {
    const v = view([bench([slot('b0', done(75, 10, 5000))])])
    const call = editCall(v, { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1' })
    expect(call).toEqual({ eventId: 'e1', exerciseId: '0289', setId: 'b0', fields: { w: 80, r: 9 } })
  })
  test('a blank in the sheet keeps the logged number rather than deleting it', () => {
    const v = view([bench([slot('b0', done(75, 10))])])
    expect(editCall(v, { setId: 'b0', values: { w: null, r: 9 }, eventId: 'e1' }).fields).toEqual({ w: 75, r: 9 })
  })
  test('a per-side edit writes both sides in full and keeps them done', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: true }, { r: 9, done: true }, { at: 5000 }))])])
    expect(editCall(v, { setId: 's', values: { w: 10, sides: { L: { r: 11 }, R: { r: null } } }, eventId: 'e1' }).fields).toEqual({
      w: 10,
      sides: { L: { w: 10, r: 11, done: true }, R: { w: 10, r: 9, done: true } },
    })
  })
  test('only a done set is edited or undone', () => {
    const v = view([bench([slot('b0', todo(75, 8))])])
    expect(editCall(v, { setId: 'b0', values: { w: 80, r: 8 }, eventId: 'e1' })).toBeNull()
    expect(undoCall(v, { setId: 'b0', eventId: 'e1' })).toBeNull()
    const d = view([bench([slot('b0', done(75, 8))])])
    expect(undoCall(d, { setId: 'b0', eventId: 'e1' })).toEqual({ eventId: 'e1', exerciseId: '0289', setId: 'b0' })
  })
})

describe('addSetCall', () => {
  test('a new set copies the last work set, as the web does', () => {
    const v = view([bench([slot('b0', done(75, 10)), slot('b1', done(75, 7))])])
    expect(addSetCall(v, '0289', 'e9')).toEqual({ eventId: 'e9', exerciseId: '0289', setId: 'add:0289:e9', fields: { w: 75, r: 7 } })
  })
  test('a blank weight stays blank', () => {
    expect(addSetCall(view([bench([slot('b0', todo(null, 12))])]), '0289', 'e9').fields).toEqual({ r: 12 })
  })
  test('a per-side exercise adds a per-side set', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: true }, { r: 9, done: true }))])])
    expect(addSetCall(v, '0300', 'e9').fields).toEqual({
      w: 7.5, r: 19, sides: { L: { w: 7.5, r: 10 }, R: { w: 7.5, r: 9 } },
    })
  })
  test('an exercise not in the view adds nothing', () => {
    expect(addSetCall(view([]), '0289', 'e9')).toBeNull()
  })
  test('a warm-up added after the work sets is not what a new set copies', () => {
    const v = view([bench([slot('b0', done(75, 7)), warm('w', done(45, 10))])])
    expect(addSetCall(v, '0289', 'e9').fields).toEqual({ w: 75, r: 7 })
  })
})

describe('addWarmupCall', () => {
  test('a blank warm-up row of its own, named by the tap', () => {
    const v = view([bench([slot('b0', done(75, 10))])])
    expect(addWarmupCall(v, '0289', 'e9')).toEqual({
      eventId: 'e9', exerciseId: '0289', setId: 'warm:0289:e9', fields: { phase: 'warmup', warmup: true, w: null, r: null },
    })
  })
  test('a per-side exercise still adds one plain row', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 10, done: false }))])])
    expect(addWarmupCall(v, '0300', 'e9').fields).toEqual({ phase: 'warmup', warmup: true, w: null, r: null })
  })
  test('an exercise not in the view adds nothing', () => {
    expect(addWarmupCall(view([]), '0289', 'e9')).toBeNull()
    expect(addWarmupCall(null, '0289', 'e9')).toBeNull()
  })
})

describe('draftCall', () => {
  test('a draft for a set not done yet', () => {
    const v = view([bench([slot('b0', done(75, 10)), slot('b1', todo(75, 8)), slot('b2', todo(75, 8))])])
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).toEqual({ setId: 'b1', values: { w: 80, r: 8 } })
    expect(draftCall(v, { setId: 'b2', values: { w: 80, r: 6 } })).toEqual({ setId: 'b2', values: { w: 80, r: 6 } })
  })
  // What is stored is what the set shows: a half-done set's weight is the first side's.
  test('per side, one side done: the draft keeps the logged weight, never a typed one', () => {
    const v = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 8, done: true }), { completed: true })])])
    expect(draftCall(v, { setId: 's', values: { w: 10, sides: { L: { r: 9 }, R: { r: 8 } } } }))
      .toEqual({ setId: 's', values: { w: 7.5, sides: { L: { r: 9 }, R: { r: 8 } } } })
    const fresh = view([lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 8, done: false }))])])
    expect(draftCall(fresh, { setId: 's', values: { w: 10, sides: { L: { r: 9 }, R: { r: 8 } } } }).values.w).toBe(10)
  })
  test('never on a done set (only Update changes it) or an unknown one', () => {
    const v = view([bench([slot('b0', done(75, 10))])])
    expect(draftCall(v, { setId: 'b0', values: { w: 80, r: 8 } })).toBeNull()
    expect(draftCall(v, { setId: 'nope', values: { w: 80, r: 8 } })).toBeNull()
  })
})

// While the engine says the session was left open overnight, nothing is logged until the owner
// picks Resume, Finish or Discard.
describe('overnight', () => {
  const night = entries => ({ ...view(entries), disposition: { kind: 'overnight', actions: ['resume', 'finish', 'discard'], suggestedEnd: 5000 } })
  const sets = () => [bench([slot('b0', done(75, 10, 5000)), slot('b1', todo(75, 8))]), lateral([slot('s', sided(7.5, { r: 10, done: false }, { r: 10, done: false }))])]
  test('the notice names the three choices; an active session has none', () => {
    expect(OVERNIGHT_NOTICE).toBe('Choose Resume, Finish or Discard first.')
    expect(overnightNotice(night(sets()))).toBe(OVERNIGHT_NOTICE)
    expect(overnightNotice({ ...view(sets()), disposition: { kind: 'active', actions: [], suggestedEnd: null } })).toBeNull()
    expect(overnightNotice(view(sets()))).toBeNull()
    expect(overnightNotice(null)).toBeNull()
  })
  test('complete, add, edit, undo and draft all refuse', () => {
    const v = night(sets())
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' })).toBeNull()
    expect(completeCall(v, { setId: 'b1', side: null, values: { w: 80, r: 8 }, eventId: 'e1' })).toBeNull()
    expect(completeCall(v, { setId: 's', side: 'L', eventId: 'e1' })).toBeNull()
    expect(addSetCall(v, '0289', 'e1')).toBeNull()
    expect(addWarmupCall(v, '0289', 'e1')).toBeNull()
    expect(editCall(v, { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1' })).toBeNull()
    expect(undoCall(v, { setId: 'b0', eventId: 'e1' })).toBeNull()
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).toBeNull()
  })
  test('the same calls go through once the session is active again', () => {
    const v = view(sets())
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' })).not.toBeNull()
    expect(addSetCall(v, '0289', 'e1')).not.toBeNull()
    expect(addWarmupCall(v, '0289', 'e1')).not.toBeNull()
    expect(editCall(v, { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1' })).not.toBeNull()
    expect(undoCall(v, { setId: 'b0', eventId: 'e1' })).not.toBeNull()
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).not.toBeNull()
  })
})

// The engine reads the clock only when an action runs, so a screen left open across midnight
// still holds the view it drew before. Each write checks overnight against the clock as it runs,
// in the session's own zone (the view's, the one the engine decides in), not the device's.
describe('overnight at write time', () => {
  const zone = 'America/New_York'
  const at2350 = Date.parse('2026-11-09T23:50:00-05:00')
  const at2359 = Date.parse('2026-11-09T23:59:59-05:00')
  const at0010 = Date.parse('2026-11-10T00:10:00-05:00')
  const active = { kind: 'active', actions: [], suggestedEnd: null }
  // Drawn at 23:50, right after a set logged then.
  const drawn = (extra = {}) => ({
    ...view([bench([slot('b0', done(75, 10, at2350)), slot('b1', todo(75, 8))])]),
    disposition: active, activityAt: at2350, timeZone: zone, ...extra,
  })
  test('a view drawn at 23:50 is not overnight then or at 23:59; the same view at 00:10 the next local day is', () => {
    expect(overnightNow(drawn(), at2350)).toBe(false)
    expect(overnightNow(drawn(), at2359)).toBe(false)
    expect(overnightNow(drawn(), at0010)).toBe(true)
  })
  test("the day is the session's zone, not the device's", () => {
    // 23:50 and 00:10 in New York are 04:50 and 05:10 the same UTC day.
    expect(overnightNow(drawn(), at0010, 'UTC')).toBe(false)
    expect(overnightNow(drawn({ timeZone: 'UTC' }), at0010)).toBe(false)
    // 18:50 and 19:10 in New York straddle midnight in UTC, but not in the session's zone.
    const evening = drawn({ activityAt: Date.parse('2026-11-09T18:50:00-05:00') })
    const later = Date.parse('2026-11-09T19:10:00-05:00')
    expect(overnightNow(evening, later)).toBe(false)
    expect(overnightNow(evening, later, 'UTC')).toBe(true)
  })
  test('a view the engine already called overnight stays so; a finished or discarded one never is', () => {
    expect(overnightNow(drawn({ disposition: { kind: 'overnight', actions: ['resume', 'finish', 'discard'], suggestedEnd: at2350 } }), at2350)).toBe(true)
    expect(overnightNow(drawn({ status: 'finished', disposition: { kind: 'finished', actions: [], suggestedEnd: null } }), at0010)).toBe(false)
    expect(overnightNow(drawn({ status: 'discarded', disposition: { kind: 'discarded', actions: [], suggestedEnd: null }, activityAt: null }), at0010)).toBe(false)
    expect(overnightNow(drawn({ activityAt: null }), at0010)).toBe(false)
    expect(overnightNow(null, at0010)).toBe(false)
  })
  // Any real date between these two: no test here depends on what day it is.
  test('without a clock, the real one: a call never falls back to what the view said when drawn', () => {
    const longAgo = drawn({ activityAt: Date.parse('2000-01-01T12:00:00Z') })
    const ahead = drawn({ activityAt: Date.parse('2100-01-01T12:00:00Z') })
    expect(overnightNow(longAgo)).toBe(true)
    expect(overnightNow(ahead)).toBe(false)
    expect(completeCall(longAgo, { setId: 'b1', side: null, eventId: 'e1' })).toBeNull()
    expect(draftCall(longAgo, { setId: 'b1', values: { w: 80, r: 8 } })).toBeNull()
    expect(addSetCall(longAgo, '0289', 'e1')).toBeNull()
    expect(overnightRefusal(longAgo)).toEqual({ ok: false, saved: false, error: { code: 'overnight' } })
  })
  test('at 00:10 complete, add, add warm-up, edit, undo and draft all refuse; at 23:55 they go through', () => {
    const calls = now => [
      completeCall(drawn(), { setId: 'b1', side: null, eventId: 'e1', now }),
      completeCall(drawn(), { setId: 'b1', side: null, values: { w: 80, r: 8 }, eventId: 'e1', now }),
      addSetCall(drawn(), '0289', 'e1', now),
      addWarmupCall(drawn(), '0289', 'e1', now),
      editCall(drawn(), { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1', now }),
      undoCall(drawn(), { setId: 'b0', eventId: 'e1', now }),
      draftCall(drawn(), { setId: 'b1', values: { w: 80, r: 8 }, now }),
    ]
    expect(calls(at0010)).toEqual([null, null, null, null, null, null, null])
    for (const call of calls(at2350 + 5 * 60_000)) expect(call).not.toBeNull()
  })
  test('the notice reads the clock too', () => {
    expect(overnightNotice(drawn(), at0010)).toBe(OVERNIGHT_NOTICE)
    expect(overnightNotice(drawn(), at2359)).toBeNull()
  })
  test('a write refused overnight is a refusal that says the one sentence, whatever was tapped', () => {
    expect(overnightRefusal(drawn(), at0010)).toEqual({ ok: false, saved: false, error: { code: 'overnight' } })
    expect(overnightRefusal(drawn(), at2359)).toBeNull()
    for (const action of ['complete', 'draft', 'edit', 'undo', 'add-set', 'add-warmup', 'add-time', 'skip-rest', 'rest', 'start-rest']) {
      expect(resultNotice(overnightRefusal(drawn(), at0010), action), action).toBe(OVERNIGHT_NOTICE)
    }
  })
  test('a rest refused overnight says so in the notice and leaves the Start rest line as it was', () => {
    const refusal = overnightRefusal(drawn(), at0010)
    expect(noticesAfter({ notice: null, rest: SAVED_REST }, refusal, 'start-rest')).toEqual({ notice: OVERNIGHT_NOTICE, rest: SAVED_REST })
    expect(noticesAfter(NO_NOTICES, refusal, 'rest')).toEqual({ notice: OVERNIGHT_NOTICE, rest: null })
    expect(noticesAfter({ notice: null, rest: SAVED_REST }, refusal, 'complete')).toEqual({ notice: OVERNIGHT_NOTICE, rest: SAVED_REST })
  })
  test("a set saved just before midnight whose rest is refused just after reads as saved, rest didn't start", () => {
    const result = completeResult({ ok: true, saved: true }, overnightRefusal(drawn(), at0010))
    expect(result).toEqual({ ok: true, saved: true, restFailed: true })
    expect(noticesAfter(NO_NOTICES, result, 'complete')).toEqual({ notice: null, rest: SAVED_REST })
  })
})

// Finish opened before midnight carries no end (the engine ends it "now"); saved after midnight,
// the engine refuses that. The sheet then takes the overnight end, from the view reloaded by the
// refusal, and the next Save is the overnight Finish. The refusal itself finishes nothing.
describe('finishRetarget', () => {
  const night = { status: 'active', startedAt: 1000, disposition: { kind: 'overnight', actions: ['resume', 'finish', 'discard'], suggestedEnd: 5000 } }
  const overnight = { ok: false, saved: false, error: { code: 'overnight' } }
  test('a Finish with no end refused overnight takes the overnight end and says why', () => {
    expect(finishRetarget(overnight, null, night)).toEqual({ end: 5000, notice: PAST_MIDNIGHT })
    expect(finishRetarget(overnight, undefined, night)).toEqual({ end: 5000, notice: PAST_MIDNIGHT })
    expect(PAST_MIDNIGHT).toBe("It's past midnight.")
  })
  test('with no logged work it ends at the start, as the overnight dock does', () => {
    const empty = { ...night, disposition: { ...night.disposition, suggestedEnd: null } }
    expect(finishRetarget(overnight, null, empty)).toEqual({ end: 1000, notice: PAST_MIDNIGHT })
  })
  test('a Finish that already has an end, any other result, or no end to give is left as it is', () => {
    expect(finishRetarget(overnight, 5000, night)).toBeNull()
    expect(finishRetarget(refused, null, night)).toBeNull()
    expect(finishRetarget({ ok: true, saved: true }, null, night)).toBeNull()
    expect(finishRetarget({ ignored: true }, null, night)).toBeNull()
    expect(finishRetarget(null, null, night)).toBeNull()
    expect(finishRetarget(overnight, null, { ...night, startedAt: null, disposition: { ...night.disposition, suggestedEnd: null } })).toBeNull()
    expect(finishRetarget(overnight, null, null)).toBeNull()
  })
})

describe('sheetCloseCall', () => {
  test('closing after typing keeps a draft for the current set', () => {
    expect(sheetCloseCall('current', true)).toBe('draft')
  })
  test('closing a done set cancels: only Update edits a logged set', () => {
    expect(sheetCloseCall('done', true)).toBe('none')
  })
  test('closing a later set after typing keeps a draft too, as its Save would', () => {
    expect(sheetCloseCall('pending', true)).toBe('draft')
  })
  test('closing unchanged writes nothing', () => {
    expect(sheetCloseCall('current', false)).toBe('none')
    expect(sheetCloseCall('pending', false)).toBe('none')
    expect(sheetCloseCall('done', false)).toBe('none')
  })
})

// The app going to the background with the sheet open keeps the typed numbers, as a swipe would,
// so a kill from the app switcher loses nothing.
describe('sheetBackgroundCall', () => {
  test('background or inactive with changed numbers on a set not done keeps a draft', () => {
    for (const appState of ['background', 'inactive']) {
      expect(sheetBackgroundCall(appState, 'current', true)).toBe('draft')
      expect(sheetBackgroundCall(appState, 'pending', true)).toBe('draft')
    }
  })
  test('never edits a done set, and unchanged numbers write nothing', () => {
    expect(sheetBackgroundCall('background', 'done', true)).toBe('none')
    expect(sheetBackgroundCall('background', 'current', false)).toBe('none')
  })
  test('coming back to the front writes nothing', () => {
    expect(sheetBackgroundCall('active', 'current', true)).toBe('none')
    expect(sheetBackgroundCall(undefined, 'current', true)).toBe('none')
  })
  // iOS sends 'inactive' then 'background' on the way out: the second finds the numbers kept by
  // the first and writes nothing, so leaving takes the gate for one write.
  test('numbers the set already holds as its draft are not written again', () => {
    const values = { w: 80, r: 5 }
    expect(sheetBackgroundCall('background', 'current', true, { values, stored: { w: 80, r: 5 } })).toBe('none')
    expect(sheetBackgroundCall('inactive', 'pending', true, { values, stored: { w: 80, r: 6 } })).toBe('draft')
    expect(sheetBackgroundCall('inactive', 'current', true, { values, stored: null })).toBe('draft')
    const sides = { w: 7.5, sides: { L: { r: 10 }, R: { r: null } } }
    expect(sheetBackgroundCall('background', 'current', true, { values: sides, stored: { w: 7.5, sides: { L: { r: 10 }, R: { r: null } } } })).toBe('none')
    expect(sheetBackgroundCall('background', 'current', true, { values: sides, stored: { w: 7.5, sides: { L: { r: 10 }, R: { r: 9 } } } })).toBe('draft')
  })
})

const STORAGE = { code: 'storage', message: 'disk full' }
const refused = { ok: false, saved: false, error: STORAGE }
const SAVED_REST = "Saved. Rest didn't start."

// `screen: true` hands the result to noticesAfter; false leaves the screen's notices alone.
describe('sheetOutcome', () => {
  test('a refusal stays in the sheet, with the typed numbers, while that sheet is open', () => {
    expect(sheetOutcome(refused, true, 'draft')).toEqual({ close: false, sheet: "Numbers not saved. The phone couldn't write it. Try again.", screen: false })
  })
  test('a refusal that arrives after the sheet closed shows on the screen', () => {
    expect(sheetOutcome(refused, false, 'draft')).toEqual({ close: false, sheet: null, screen: true })
    expect(noticesAfter(NO_NOTICES, refused, 'draft').notice).toBe("Numbers not saved. The phone couldn't write it. Try again.")
  })
  test('a save closes the open sheet and clears the screen notice', () => {
    expect(sheetOutcome({ ok: true, saved: true }, true, 'draft')).toEqual({ close: true, sheet: null, screen: true })
    expect(sheetOutcome(null, true, 'complete')).toEqual({ close: true, sheet: null, screen: true })
    expect(noticesAfter({ notice: 'old', rest: null }, { ok: true, saved: true }, 'draft').notice).toBeNull()
  })
  test('a save after the sheet closed does not close another one', () => {
    expect(sheetOutcome({ ok: true, saved: true }, false, 'edit')).toEqual({ close: false, sheet: null, screen: true })
  })
  test('a set saved with a refused rest closes the sheet and shows on the screen', () => {
    expect(sheetOutcome({ ok: true, saved: true, restFailed: true }, true, 'complete')).toEqual({ close: true, sheet: null, screen: true })
  })
  test('a set saved whose typed numbers did not clear closes the sheet; the screen says so', () => {
    expect(sheetOutcome({ ok: true, saved: true, draftError: STORAGE }, true, 'complete')).toEqual({ close: true, sheet: null, screen: true })
  })
  test('a set saved with the old committed flag but saved: false stays a refusal in the sheet', () => {
    expect(sheetOutcome({ ...refused, committed: true, restFailed: true }, true, 'complete')).toEqual({ close: false, sheet: "Set not saved. The phone couldn't write it. Try again.", screen: false })
  })
  test('a tap the gate dropped changes nothing', () => {
    expect(sheetOutcome({ ignored: true }, true, 'complete')).toBeNull()
  })
})

describe('writeOutcome', () => {
  test('a refused write says what was not done and why, in words, never the code or the raw message', () => {
    const out = writeOutcome(refused, 'complete')
    expect(out).toEqual({ kind: 'failed', text: "Set not saved. The phone couldn't write it. Try again." })
    expect(out.text).not.toContain('storage')
    expect(out.text).not.toContain('disk full')
    expect(writeOutcome({ ok: false, saved: false, error: { code: 'no-rest' } }, 'skip-rest')).toEqual({ kind: 'failed', text: 'Rest not skipped. No rest is running.' })
    expect(writeOutcome({ ok: false, saved: false }, 'add-set')).toEqual({ kind: 'failed', text: 'Set not added. Something went wrong. Try again.' })
  })

  test('a set saved but whose rest did not start is saved-rest-failed, not a "not saved"', () => {
    expect(writeOutcome({ ok: true, saved: true, restFailed: true }, 'complete')).toEqual({ kind: 'saved-rest-failed', text: SAVED_REST })
  })

  test('a saved: false result is never shown as saved, whatever else it carries', () => {
    const extras = { restFailed: true, committed: true, draftError: STORAGE, checkpointError: STORAGE }
    for (const result of [{ ...refused, ...extras }, { saved: false, error: STORAGE, ...extras }, { ok: undefined, saved: false, error: STORAGE, ...extras }]) {
      const out = writeOutcome(result, 'complete')
      expect(out.kind).toBe('failed')
      expect(out.text).toBe("Set not saved. The phone couldn't write it. Try again.")
    }
    // A repeat or no change saved nothing new: no "Saved", no rest line.
    expect(writeOutcome({ ok: true, saved: false, duplicate: true, restFailed: true, draftError: STORAGE }, 'complete')).toBeNull()
    expect(writeOutcome({ ok: true, saved: false, duplicate: true, checkpointError: STORAGE }, 'complete'))
      .toEqual({ kind: 'warning', text: "The workout time couldn't be updated, so it may be off after a restart." })
  })

  test('a draft that did not clear or a timer checkpoint that failed on a saved result is shown', () => {
    expect(writeOutcome({ ok: true, saved: true, draftError: STORAGE }, 'complete'))
      .toEqual({ kind: 'warning', text: "Saved. The typed numbers for this set couldn't be cleared." })
    expect(writeOutcome({ ok: true, saved: true, checkpointError: STORAGE }, 'draft'))
      .toEqual({ kind: 'warning', text: "Saved. The workout time couldn't be updated, so it may be off after a restart." })
    expect(writeOutcome({ ok: true, saved: true, draftError: STORAGE, checkpointError: STORAGE }, 'complete')).toEqual({
      kind: 'warning',
      text: "Saved. The typed numbers for this set couldn't be cleared. The workout time couldn't be updated, so it may be off after a restart.",
    })
    expect(writeOutcome({ ok: true, saved: true, restFailed: true, draftError: STORAGE }, 'complete'))
      .toEqual({ kind: 'saved-rest-failed', text: `${SAVED_REST} The typed numbers for this set couldn't be cleared.` })
  })

  test('a workout saved but not closed says to tap Save again, never "saved" alone', () => {
    expect(writeOutcome({ ok: false, saved: true, error: { code: 'storage', message: 'clear failed' } }, 'finish'))
      .toEqual({ kind: 'failed', text: "The workout isn't closed yet. Tap Save workout again." })
  })
  test('saved but not ok from anything but Finish is never "tap Save workout": its own words', () => {
    expect(writeOutcome({ ok: false, saved: true, error: STORAGE }, 'complete'))
      .toEqual({ kind: 'failed', text: "Set not saved. The phone couldn't write it. Try again." })
    expect(writeOutcome({ ok: false, saved: true, error: { code: 'no-rest' } }, 'skip-rest'))
      .toEqual({ kind: 'failed', text: 'Rest not skipped. No rest is running.' })
    expect(writeOutcome({ ok: false, saved: true }, undefined)).toEqual({ kind: 'failed', text: 'Not saved. Something went wrong. Try again.' })
  })

  test('a save, a repeat, no change, or a tap the gate dropped say nothing', () => {
    expect(writeOutcome({ ok: true, saved: true }, 'complete')).toBeNull()
    expect(writeOutcome({ ok: true, saved: false, duplicate: true }, 'complete')).toBeNull()
    expect(writeOutcome({ ok: true, saved: false, unchanged: true }, 'edit')).toBeNull()
    expect(writeOutcome({ ignored: true }, 'complete')).toBeNull()
    expect(writeOutcome(null, 'complete')).toBeNull()
  })
})

describe('completeResult', () => {
  const saved = { ok: true, saved: true }
  test('a refused rest after a saved set is restFailed on the set\'s own result', () => {
    expect(completeResult(saved, refused)).toEqual({ ok: true, saved: true, restFailed: true })
    expect(completeResult({ ...saved, draftError: STORAGE }, refused)).toEqual({ ok: true, saved: true, draftError: STORAGE, restFailed: true })
  })
  test('a rest that started, or was already running, leaves the set\'s result as it is', () => {
    expect(completeResult(saved, { ok: true, saved: true })).toBe(saved)
    expect(completeResult(saved, { ok: true, saved: false, duplicate: true })).toBe(saved)
    expect(completeResult(saved, null)).toBe(saved)
  })
  test('a timer checkpoint that failed on the rest is carried, not dropped', () => {
    expect(completeResult(saved, { ok: true, saved: true, checkpointError: STORAGE })).toEqual({ ok: true, saved: true, checkpointError: STORAGE })
  })
  test('a refused rest whose timer checkpoint failed too carries both', () => {
    const result = completeResult(saved, { ...refused, checkpointError: STORAGE })
    expect(result).toEqual({ ok: true, saved: true, restFailed: true, checkpointError: STORAGE })
    expect(writeOutcome(result, 'complete')).toEqual({
      kind: 'saved-rest-failed',
      text: "Saved. Rest didn't start. The workout time couldn't be updated, so it may be off after a restart.",
    })
    // The set's own checkpoint error stands; the rest's does not replace it.
    const own = { code: 'storage', message: 'own' }
    expect(completeResult({ ...saved, checkpointError: own }, { ...refused, checkpointError: STORAGE }).checkpointError).toBe(own)
  })
  test('a set that did not save stays not saved whatever the rest did', () => {
    expect(completeResult(refused, { ok: true, saved: true })).toBe(refused)
    expect(completeResult(refused, refused)).toBe(refused)
    const repeat = { ok: true, saved: false, duplicate: true }
    expect(completeResult(repeat, refused)).toBe(repeat)
    expect(completeResult(null, refused)).toBeNull()
  })
})

// The rest line ("Saved. Rest didn't start." with its Start rest button) lives beside the
// screen's notice: it stays until its rest runs or another set is completed.
describe('noticesAfter', () => {
  const restLine = { notice: null, rest: SAVED_REST }
  const restFailed = { ok: true, saved: true, restFailed: true }
  test('a set saved with a refused rest sets the rest line and clears the notice', () => {
    expect(noticesAfter({ notice: 'old', rest: null }, restFailed, 'complete')).toEqual(restLine)
  })
  test('the rest line stays through every other write, saved or refused', () => {
    for (const action of ['draft', 'edit', 'add-set', 'add-warmup', 'add-time', 'skip-rest', 'resume']) {
      expect(noticesAfter(restLine, { ok: true, saved: true }, action), action).toEqual(restLine)
      expect(noticesAfter(restLine, refused, action).rest, action).toBe(SAVED_REST)
    }
    expect(noticesAfter(restLine, refused, 'draft').notice).toBe("Numbers not saved. The phone couldn't write it. Try again.")
  })
  test('the next completed set takes it away; one that did not save keeps it', () => {
    expect(noticesAfter(restLine, { ok: true, saved: true }, 'complete')).toEqual(NO_NOTICES)
    expect(noticesAfter(restLine, refused, 'complete')).toEqual({ notice: "Set not saved. The phone couldn't write it. Try again.", rest: SAVED_REST })
    expect(noticesAfter(restLine, null, 'complete')).toEqual(restLine)
    expect(noticesAfter(restLine, { ok: true, saved: false, duplicate: true }, 'complete')).toEqual(restLine)
  })
  test('a set undone takes it away: its "Saved." is no longer true', () => {
    expect(noticesAfter(restLine, { ok: true, saved: true }, 'undo')).toEqual(NO_NOTICES)
    expect(noticesAfter(restLine, refused, 'undo').rest).toBe(SAVED_REST)
  })
  test('Start rest: a rest that runs, or was already running, ends the line', () => {
    for (const action of ['rest', 'start-rest']) {
      expect(noticesAfter(restLine, { ok: true, saved: true }, action), action).toEqual(NO_NOTICES)
      expect(noticesAfter(restLine, { ok: true, saved: false, duplicate: true }, action), action).toEqual(NO_NOTICES)
    }
  })
  test('the Start rest tap that finds the rest already run out says so; the restore on open says nothing', () => {
    expect(noticesAfter(restLine, null, 'start-rest')).toEqual({ notice: 'That rest has already run out.', rest: null })
    expect(noticesAfter({ notice: 'old', rest: SAVED_REST }, null, 'start-rest')).toEqual({ notice: 'That rest has already run out.', rest: null })
    expect(noticesAfter(restLine, null, 'rest')).toEqual(NO_NOTICES)
    expect(noticesAfter({ notice: 'kept', rest: null }, null, 'rest')).toEqual({ notice: 'kept', rest: null })
  })
  test('Start rest refused: the line says why and keeps its button; the notice is left alone', () => {
    expect(noticesAfter({ notice: 'kept', rest: SAVED_REST }, refused, 'start-rest')).toEqual({ notice: 'kept', rest: "Rest didn't start. The phone couldn't write it. Try again." })
    expect(noticesAfter({ notice: 'kept', rest: SAVED_REST }, refused, 'rest')).toEqual({ notice: 'kept', rest: "Rest didn't start. The phone couldn't write it. Try again." })
    // The rest restored on open is the same write: refused, it offers Start rest too.
    expect(noticesAfter(NO_NOTICES, refused, 'rest')).toEqual({ notice: null, rest: "Rest didn't start. The phone couldn't write it. Try again." })
  })
  test('a rest that ran but whose timer checkpoint failed says so', () => {
    expect(noticesAfter(restLine, { ok: true, saved: true, checkpointError: STORAGE }, 'rest'))
      .toEqual({ notice: "Saved. The workout time couldn't be updated, so it may be off after a restart.", rest: null })
  })
  test('a tap the gate dropped changes nothing', () => {
    expect(noticesAfter(restLine, { ignored: true }, 'complete')).toBe(restLine)
    expect(noticesAfter(restLine, { ignored: true }, 'rest')).toBe(restLine)
    expect(noticesAfter(restLine, { ignored: true }, 'start-rest')).toBe(restLine)
  })
})

// VoiceOver on iOS ignores live regions, so the screen announces a notice itself: once, when it
// appears or its words change, never on a re-render.
describe('noticeAnnouncement', () => {
  const FAILED = "Set not saved. The phone couldn't write it. Try again."
  test('a notice or rest line that appears is spoken', () => {
    expect(noticeAnnouncement(NO_NOTICES, { notice: FAILED, rest: null })).toBe(FAILED)
    expect(noticeAnnouncement(NO_NOTICES, { notice: null, rest: SAVED_REST })).toBe(SAVED_REST)
  })
  test('one whose words changed is spoken; one that stayed the same is not spoken again', () => {
    expect(noticeAnnouncement({ notice: 'Set not added. No rest is running.', rest: SAVED_REST }, { notice: FAILED, rest: SAVED_REST })).toBe(FAILED)
    const why = "Rest didn't start. The phone couldn't write it. Try again."
    expect(noticeAnnouncement({ notice: FAILED, rest: SAVED_REST }, { notice: FAILED, rest: why })).toBe(why)
    expect(noticeAnnouncement({ notice: FAILED, rest: SAVED_REST }, { notice: FAILED, rest: SAVED_REST })).toBeNull()
  })
  test('both new: the notice, then the rest line', () => {
    expect(noticeAnnouncement(NO_NOTICES, { notice: FAILED, rest: SAVED_REST })).toBe(`${FAILED} ${SAVED_REST}`)
  })
  // The keypad and Finish sheets show their own notice (a refusal kept with the typed numbers,
  // a finish that did not go through); the alert role alone is silent on iOS too.
  test("the keypad and Finish sheets' notices are spoken by the same rule, after the screen's", () => {
    const quiet = { notice: null, rest: null, sheet: null, finish: null }
    const notClosed = "The workout isn't closed yet. Tap Save workout again."
    expect(noticeAnnouncement(quiet, { ...quiet, sheet: FAILED })).toBe(FAILED)
    expect(noticeAnnouncement({ ...quiet, sheet: FAILED }, { ...quiet, sheet: FAILED })).toBeNull()
    expect(noticeAnnouncement({ ...quiet, sheet: FAILED }, { ...quiet, sheet: 'Numbers not saved. The phone couldn\'t write it. Try again.' })).toBe("Numbers not saved. The phone couldn't write it. Try again.")
    expect(noticeAnnouncement({ ...quiet, sheet: FAILED }, quiet)).toBeNull()
    expect(noticeAnnouncement(quiet, { ...quiet, finish: notClosed })).toBe(notClosed)
    expect(noticeAnnouncement({ ...quiet, finish: notClosed }, { ...quiet, finish: notClosed })).toBeNull()
    expect(noticeAnnouncement(quiet, { notice: FAILED, rest: null, sheet: null, finish: notClosed })).toBe(`${FAILED} ${notClosed}`)
    expect(noticeAnnouncement(null, quiet)).toBeNull()
  })
  test('one that went away is not spoken', () => {
    expect(noticeAnnouncement({ notice: FAILED, rest: SAVED_REST }, NO_NOTICES)).toBeNull()
    expect(noticeAnnouncement({ notice: FAILED, rest: SAVED_REST }, { notice: null, rest: SAVED_REST })).toBeNull()
    expect(noticeAnnouncement(NO_NOTICES, NO_NOTICES)).toBeNull()
  })
})

describe('primaryAction', () => {
  test('ready completes in one tap; a blank weight opens the keypad instead', () => {
    expect(primaryAction('ready')).toBe('complete')
    expect(primaryAction('enter-weight')).toBe('keypad')
  })
  test('a finished exercise moves on, and a finished workout opens Finish', () => {
    expect(primaryAction('exercise-done')).toBe('follow')
    expect(primaryAction('all-done')).toBe('finish')
  })
  test('blank reps open the keypad too', () => {
    expect(primaryAction('enter-reps')).toBe('keypad')
  })
  test('resting has no primary button', () => {
    expect(primaryAction('resting')).toBe('none')
  })
})

describe('dockKeypadField', () => {
  test('blank reps open the keypad on reps; everything else on weight', () => {
    expect(dockKeypadField('enter-reps')).toBe('r')
    expect(dockKeypadField('enter-weight')).toBe('w')
    expect(dockKeypadField('ready')).toBe('w')
  })
})

describe('sheetMode', () => {
  test('a done row edits, the current row completes, a later row only takes a draft', () => {
    expect(sheetMode('done')).toBe('done')
    expect(sheetMode('current')).toBe('current')
    expect(sheetMode('pending')).toBe('pending')
    expect(sheetMode(undefined)).toBe('pending')
  })
})

describe('resultNotice', () => {
  test('a refused write is visible, in words', () => {
    expect(resultNotice({ ok: false, saved: false, error: { code: 'storage', message: 'disk full' } }, 'draft')).toBe("Numbers not saved. The phone couldn't write it. Try again.")
    expect(resultNotice({ ok: false, saved: false, error: { code: 'no-rest' } }, 'add-time')).toBe('Time not added. No rest is running.')
    expect(resultNotice({ ok: false, saved: false }, 'finish')).toBe('Workout not saved. Something went wrong. Try again.')
    expect(resultNotice({ ok: false, saved: false, error: { code: 'overnight' } }, 'finish')).toBe(OVERNIGHT_NOTICE)
  })
  test('a saved workout whose session did not close says so', () => {
    expect(resultNotice({ ok: false, saved: true, error: { message: 'clear failed' } }, 'finish')).toBe("The workout isn't closed yet. Tap Save workout again.")
  })
  test('saved, a repeat, no change, or a tap the gate dropped show nothing', () => {
    expect(resultNotice({ ok: true, saved: true })).toBeNull()
    expect(resultNotice({ ok: true, saved: false, duplicate: true })).toBeNull()
    expect(resultNotice({ ok: true, saved: false, unchanged: true })).toBeNull()
    expect(resultNotice({ ignored: true })).toBeNull()
    expect(resultNotice(null)).toBeNull()
  })
})

// The same calls through the session controller the screen's hook wraps, on real SQLite, with
// db.reopen() as the kill.
describe.each(SQLITE_DRIVERS)('%s: the calls drive the engine', (_name, createDb) => {
  const T0 = Date.parse('2026-11-09T17:00:00.000Z')
  const engineBase = () => ({
    id: 'sess-1', d: '2026-11-09', start: T0, name: 'Push A', routineIds: ['push-a'],
    entries: [
      { id: 'bench', target: { restSec: 120 }, sets: [todo(75, 8), todo(75, 8)] },
      { id: 'lat', target: {}, sets: [sided(7.5, { r: 10, done: false }, { r: 10, done: false })] },
    ],
  })
  let clock = T0
  const open = async (db, withBase = true) => {
    const controller = createSessionController(sessionOptionsFrom({ db, base: withBase ? engineBase() : null, now: () => clock, timeZone: 'UTC' }))
    await controller.open()
    return controller
  }
  const current = controller => withTargets(controller.getState().view, engineBase())
  const restMsOf = entry => restMsFor(entry, 90)
  const benchSet = plannedSetId('bench', 0)
  const latSet = plannedSetId('lat', 0)

  test('Complete, then its rest; a kill restores the set and the time left', async () => {
    clock = T0 + 1000
    let db = createDb()
    const first = await open(db)
    const call = completeCall(current(first), { setId: benchSet, side: null, eventId: 'c1', now: clock })
    expect((await first.call('commitSet', call)).saved).toBe(true)
    const rest = restAfterComplete(current(first), benchSet, restMsOf)
    expect(rest).toEqual({ eventId: restEventId(benchSet, T0 + 1000), deadline: T0 + 1000 + 120_000 })
    await first.call('startRest', rest)
    db = db.reopen()
    clock = T0 + 31_000
    const second = await open(db, false)
    const view = second.getState().view
    expect(view.entries[0].sets[0].row).toMatchObject({ w: 75, r: 8, done: true })
    expect(view.rest).toMatchObject({ status: 'running', remainingMs: 90_000 })
    // A second Complete on the same set, as a stale tap would send it, writes nothing.
    expect(completeCall(current(second), { setId: benchSet, side: null, eventId: 'c2', now: clock })).toBeNull()
  })

  test('per side: left, kill, right; rest waits for both and typed reps survive', async () => {
    clock = T0 + 1000
    let db = createDb()
    const first = await open(db)
    const values = { w: 10, sides: { L: { r: 12 }, R: { r: 11 } } }
    await first.call('commitSet', completeCall(current(first), { setId: latSet, side: 'L', values, eventId: 'l1', now: clock }))
    expect(restAfterComplete(current(first), latSet, restMsOf)).toBeNull()
    db = db.reopen()
    clock = T0 + 20_000
    const second = await open(db, false)
    const row = second.getState().view.entries[1].sets[0].row
    expect(row.sides).toEqual({ L: { w: 10, r: 12, done: true }, R: { w: 10, r: 11, done: false } })
    await second.call('commitSet', completeCall(current(second), { setId: latSet, side: 'R', eventId: 'r1', now: clock }))
    expect(restAfterComplete(current(second), latSet, restMsOf)).toEqual({ eventId: restEventId(latSet, T0 + 20_000), deadline: T0 + 20_000 + 90_000 })
  })

  test('an edit keeps the set time, so its rest keeps its id; undo clears done', async () => {
    clock = T0 + 1000
    const session = await open(createDb())
    await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    const before = restAfterComplete(current(session), benchSet, restMsOf)
    clock = T0 + 60_000
    await session.call('editSet', editCall(current(session), { setId: benchSet, values: { w: 80, r: 7 }, eventId: 'e1', now: clock }))
    expect(current(session).entries[0].sets[0].row).toMatchObject({ w: 80, r: 7, done: true, at: T0 + 1000 })
    expect(restAfterComplete(current(session), benchSet, restMsOf)).toEqual(before)
    await session.call('undoSet', undoCall(current(session), { setId: benchSet, eventId: 'u1', now: clock }))
    expect(current(session).entries[0].sets[0].row.done).toBe(false)
  })

  test('Add set on a per-side exercise adds a per-side set that survives a kill', async () => {
    let db = createDb()
    const first = await open(db)
    expect((await first.call('addSet', addSetCall(current(first), 'lat', 'a1', clock))).saved).toBe(true)
    db = db.reopen()
    const added = (await open(db, false)).getState().view.entries[1].sets[1]
    expect(added.setId).toBe('add:lat:a1')
    expect(added.row.sides).toEqual({ L: { w: 7.5, r: 10, done: false }, R: { w: 7.5, r: 10, done: false } })
  })

  test('a warm-up: add, complete, kill; still a warm-up, no rest, out of the numbers', async () => {
    clock = T0 + 1000
    let db = createDb()
    const first = await open(db)
    const add = addWarmupCall(current(first), 'bench', 'w1', clock)
    expect((await first.call('addSet', add)).saved).toBe(true)
    const call = completeCall(current(first), { setId: add.setId, side: null, values: { w: 45, r: 10 }, eventId: 'c1', now: clock })
    expect((await first.call('commitSet', call)).saved).toBe(true)
    expect(restAfterComplete(current(first), add.setId, restMsOf)).toBeNull()
    db = db.reopen()
    clock = T0 + 5000
    const second = await open(db, false)
    const view = current(second)
    const warmup = view.entries[0].sets.find(s => s.setId === 'warm:bench:w1')
    expect(warmup.row).toMatchObject({ phase: 'warmup', warmup: true, w: 45, r: 10, done: true, at: T0 + 1000 })
    expect(pendingRest(view, clock, () => 120_000)).toBeNull()
    expect(view.rest).toBeNull()
    const screen = workoutScreen(view, { names: {}, lastTimes: {} })
    expect(screen.card.rows.map(r => [r.label, r.status])).toEqual([['W', 'done'], ['1', 'current'], ['2', 'pending']])
    expect(screen.dock).toMatchObject({ lead: 'Set 1 · 75 lb × 8', setId: benchSet })
    expect(screen.header.progress).toBe(0)
  })

  // The draft the 'inactive' wrote is in the engine's view as the same numbers, so the
  // 'background' right after it writes nothing.
  // Left logged at 7.5. A Save of 10 for the right stores 7.5, as shown; a sheet Complete of 10
  // for the right logs 7.5 on both sides.
  test('per side: after the first side, a typed weight never reaches the draft or the log', async () => {
    clock = T0 + 1000
    let db = createDb()
    const session = await open(db)
    await session.call('commitSet', completeCall(current(session), { setId: latSet, side: 'L', values: { w: 7.5, sides: { L: { r: 10 }, R: { r: 10 } } }, eventId: 'l1', now: clock }))
    const save = draftCall(current(session), { setId: latSet, values: { w: 10, sides: { L: { r: 10 }, R: { r: 9 } } }, now: clock })
    expect((await session.call('putDraft', save.setId, save.values)).saved).toBe(true)
    expect((await createSqliteSessionStorage(db).readDrafts())[latSet]).toEqual({ w: 7.5, sides: { L: { r: 10 }, R: { r: 9 } } })
    const set0 = current(session).entries[1].sets[0]
    expect(shownValues(set0, 'R')).toEqual({ w: 7.5, sides: { L: { r: 10 }, R: { r: 9 } } })
    expect(workoutScreen(current(session), { names: {}, lastTimes: {}, exerciseIndex: 1 }).dock).toMatchObject({ side: 'R', figures: { w: 7.5, r: 9 } })

    clock = T0 + 20_000
    const right = completeCall(current(session), { setId: latSet, side: 'R', values: { w: 10, sides: { L: { r: 10 }, R: { r: 9 } } }, eventId: 'r1', now: clock })
    expect((await session.call('commitSet', right)).saved).toBe(true)
    const logged = view => expect(view.entries[1].sets[0].row.sides).toEqual({ L: { w: 7.5, r: 10, done: true }, R: { w: 7.5, r: 9, done: true } })
    logged(current(session))
    expect(current(session).entries[1].sets[0].row.w).toBe(7.5)
    db = db.reopen()
    logged(current(await open(db, false)))
  })

  test("leaving the app writes the typed numbers once: 'inactive' keeps them, 'background' finds them kept", async () => {
    const db = createDb()
    const session = await open(db)
    for (const [setId, values] of [[benchSet, { w: 77.5, r: 6 }], [latSet, { w: 7.5, sides: { L: { r: 10 }, R: { r: null } } }]]) {
      const storedNow = () => findSet(current(session), setId).slot.draft
      expect(sheetBackgroundCall('inactive', 'current', true, { values, stored: storedNow() })).toBe('draft')
      const call = draftCall(current(session), { setId, values, now: clock })
      expect((await session.call('putDraft', call.setId, call.values)).saved).toBe(true)
      expect(sheetBackgroundCall('background', 'current', true, { values, stored: storedNow() })).toBe('none')
    }
  })

  test('a draft from the sheet survives a kill and is what the set shows', async () => {
    let db = createDb()
    const first = await open(db)
    await first.call('putDraft', benchSet, { w: 77.5, r: 6 })
    db = db.reopen()
    const slot0 = (await open(db, false)).getState().view.entries[0].sets[0]
    expect(shownValues(slot0, null)).toEqual({ w: 77.5, r: 6 })
  })

  test('a refused commit leaves the set unsaved and says so', async () => {
    const db = createDb()
    const session = await open(db)
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const result = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    expect(resultNotice(result, 'complete')).toBe("Set not saved. The phone couldn't write it. Try again.")
    expect(noticesAfter(NO_NOTICES, completeResult(result, null), 'complete')).toEqual({ notice: "Set not saved. The phone couldn't write it. Try again.", rest: null })
    expect(current(session).entries[0].sets[0].row.done).toBe(false)
  })

  // The hook's Complete: commit, then the rest named by the commit's `at`; Start rest is the
  // rest restored on open (pendingRest), so it sends that same event id through the gate.
  test('a set saved with a refused rest says so; Start rest starts that same rest, once', async () => {
    clock = T0 + 1000
    const db = createDb()
    const session = await open(db)
    const commit = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    const rest = restAfterComplete(current(session), benchSet, restMsOf)
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const result = completeResult(commit, await session.call('startRest', rest))
    expect(writeOutcome(result, 'complete')).toEqual({ kind: 'saved-rest-failed', text: SAVED_REST })
    const notices = noticesAfter(NO_NOTICES, result, 'complete')
    expect(notices).toEqual({ notice: null, rest: SAVED_REST })
    expect(current(session).entries[0].sets[0].row).toMatchObject({ done: true, at: T0 + 1000 })
    expect(current(session).rest).toBeNull()

    clock = T0 + 11_000
    const restMsOfId = id => restMsOf(current(session).entries.find(entry => entry.id === id))
    const retry = pendingRest(current(session), clock, restMsOfId)
    expect(retry).toEqual({ eventId: restEventId(benchSet, T0 + 1000), deadline: T0 + 1000 + 120_000 })
    expect(retry).toEqual(rest)
    const started = await session.call('startRest', retry)
    expect(noticesAfter(notices, started, 'rest')).toEqual(NO_NOTICES)
    expect(current(session).rest).toMatchObject({ status: 'running', remainingMs: 110_000 })
    // A second tap, as from a stale line, writes nothing new.
    expect(await session.call('startRest', pendingRest(current(session), clock, restMsOfId))).toMatchObject({ ok: true, saved: false, duplicate: true })
  })

  test('Start rest refused again keeps the line and its button, saying why', async () => {
    clock = T0 + 1000
    const db = createDb()
    const session = await open(db)
    const commit = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const notices = noticesAfter(NO_NOTICES, completeResult(commit, await session.call('startRest', restAfterComplete(current(session), benchSet, restMsOf))), 'complete')
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const again = await session.call('startRest', pendingRest(current(session), clock, () => 120_000))
    expect(noticesAfter(notices, again, 'rest')).toEqual({ notice: null, rest: "Rest didn't start. The phone couldn't write it. Try again." })
    expect(current(session).rest).toBeNull()
  })

  // Save a draft of 80 x 5, then change the reps to 6 in the sheet and Complete: 80 x 6 is logged
  // and the clear of the 80 x 5 draft fails. The set shows, and Update starts from, 80 x 6.
  test('a set saved whose draft did not clear says so, and shows what was logged, after a kill too', async () => {
    let db = createDb()
    const first = await open(db)
    await first.call('putDraft', benchSet, { w: 80, r: 5 })
    db.failNext(/DELETE FROM session_drafts/, new Error('disk full'))
    const commit = await first.call('commitSet', completeCall(current(first), { setId: benchSet, side: null, values: { w: 80, r: 6 }, eventId: 'c1', now: clock }))
    expect(commit).toMatchObject({ ok: true, saved: true, draftError: { code: 'storage' } })
    expect(noticesAfter(NO_NOTICES, completeResult(commit, null), 'complete'))
      .toEqual({ notice: "Saved. The typed numbers for this set couldn't be cleared.", rest: null })
    const logged = view => {
      const done0 = view.entries[0].sets[0]
      expect(done0.draft).toEqual({ w: 80, r: 5 })
      expect(done0.row).toMatchObject({ w: 80, r: 6, done: true })
      expect(shownValues(done0, null)).toEqual({ w: 80, r: 6 })
      expect(workoutScreen(view, { names: {}, lastTimes: {} }).card.rows[0]).toMatchObject({ weightText: '80', repsText: '6', status: 'done' })
      // Update opens on the logged numbers, so an unchanged Update writes them back, not 80 x 5.
      expect(editCall(view, { setId: benchSet, values: shownValues(done0, null), eventId: 'e1', now: clock }).fields).toEqual({ w: 80, r: 6 })
    }
    logged(current(first))
    db = db.reopen()
    logged(current(await open(db, false)))
  })

  // A draft of 10 kept by a swipe, then the sheet reopened at 7.5 and Complete left; the clear of
  // the 10 fails. The dock's Complete right logs 7.5 on both sides, not the leftover's 10.
  test('per side: a draft left after the first side never changes the weight the second side logs', async () => {
    clock = T0 + 1000
    let db = createDb()
    const first = await open(db)
    await first.call('putDraft', latSet, { w: 10, sides: { L: { r: 10 }, R: { r: 10 } } })
    db.failNext(/DELETE FROM session_drafts/, new Error('disk full'))
    const left = await first.call('commitSet', completeCall(current(first), { setId: latSet, side: 'L', values: { w: 7.5, sides: { L: { r: 10 }, R: { r: 10 } } }, eventId: 'l1', now: clock }))
    expect(left).toMatchObject({ ok: true, saved: true, draftError: { code: 'storage' } })
    expect(current(first).entries[1].sets[0].draft).toMatchObject({ w: 10 })
    const dock = workoutScreen(current(first), { names: {}, lastTimes: {}, exerciseIndex: 1 }).dock
    expect(dock).toMatchObject({ mode: 'ready', side: 'R', figures: { w: 7.5, r: 10 } })

    clock = T0 + 20_000
    const right = completeCall(current(first), { setId: dock.setId, side: dock.side, eventId: 'r1', now: clock })
    expect(right.fields.w).toBe(7.5)
    expect((await first.call('commitSet', right)).saved).toBe(true)
    const logged = view => {
      const row = view.entries[1].sets[0].row
      expect(row).toMatchObject({ w: 7.5, done: true })
      expect(row.sides).toEqual({ L: { w: 7.5, r: 10, done: true }, R: { w: 7.5, r: 10, done: true } })
    }
    logged(current(first))
    db = db.reopen()
    logged(current(await open(db, false)))
  })

  // The same leftover (a draft of 80 x 5 whose clear failed when 80 x 6 was logged), then Undo
  // through the hook's actions as the sheet's Undo runs it: the leftover goes with the tick, so
  // the undone set shows, and one-tap Complete logs, 80 x 6, after a kill too.
  test('Undo clears a draft a failed clear left on the set, so it cannot come back', async () => {
    let db = createDb()
    const first = await open(db)
    await first.call('putDraft', benchSet, { w: 80, r: 5 })
    db.failNext(/DELETE FROM session_drafts/, new Error('disk full'))
    await first.call('commitSet', completeCall(current(first), { setId: benchSet, side: null, values: { w: 80, r: 6 }, eventId: 'c1', now: clock }))
    expect(current(first).entries[0].sets[0].draft).toEqual({ w: 80, r: 5 })

    const undone = await undoWrite(sessionActions(first, () => {}), current(first), { setId: benchSet, eventId: 'u1', now: clock })
    expect(undone).toMatchObject({ ok: true, saved: true })
    const reopened = async view => {
      const set0 = view.entries[0].sets[0]
      expect(set0.row).toMatchObject({ w: 80, r: 6, done: false })
      expect(set0.draft).toBeNull()
      expect(workoutScreen(view, { names: {}, lastTimes: {} }).dock).toMatchObject({ lead: 'Set 1 · 80 lb × 6', setId: benchSet })
      expect(completeCall(view, { setId: benchSet, side: null, eventId: 'c2', now: clock }).fields).toEqual({ w: 80, r: 6 })
    }
    await reopened(current(first))
    expect((await createSqliteSessionStorage(db).readDrafts())).toEqual({})
    db = db.reopen()
    await reopened(current(await open(db, false)))
  })

  test('Undo whose clear of that draft fails undoes nothing and says so', async () => {
    const db = createDb()
    const session = await open(db)
    await session.call('putDraft', benchSet, { w: 80, r: 5 })
    db.failNext(/DELETE FROM session_drafts/, new Error('disk full'))
    await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, values: { w: 80, r: 6 }, eventId: 'c1', now: clock }))
    db.failNext(/DELETE FROM session_drafts/, new Error('disk full'))
    const undone = await undoWrite(sessionActions(session, () => {}), current(session), { setId: benchSet, eventId: 'u1', now: clock })
    expect(resultNotice(undone, 'undo')).toBe("Set not undone. The phone couldn't write it. Try again.")
    const set0 = current(session).entries[0].sets[0]
    expect(set0.row).toMatchObject({ w: 80, r: 6, done: true })
    // Still done, so the leftover stays hidden behind what was logged.
    expect(shownValues(set0, null)).toEqual({ w: 80, r: 6 })
    expect((await createSqliteSessionStorage(db).readAll()).map(event => event.type)).not.toContain('set.undo')
  })

  test('Undo of a set with no draft is the undo alone', async () => {
    const db = createDb()
    const session = await open(db)
    await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    const executed = db.executed.length
    expect(await undoWrite(sessionActions(session, () => {}), current(session), { setId: benchSet, eventId: 'u1', now: clock })).toMatchObject({ ok: true, saved: true })
    expect(db.executed.slice(executed).some(sql => /session_drafts/.test(sql))).toBe(false)
    expect(current(session).entries[0].sets[0].row.done).toBe(false)
    // Nothing to undo writes nothing.
    expect(await undoWrite(sessionActions(session, () => {}), current(session), { setId: benchSet, eventId: 'u2', now: clock })).toBeNull()
  })

  test('Start rest after that rest has run out starts nothing and says so', async () => {
    clock = T0 + 1000
    const db = createDb()
    const session = await open(db)
    const commit = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const notices = noticesAfter(NO_NOTICES, completeResult(commit, await session.call('startRest', restAfterComplete(current(session), benchSet, restMsOf))), 'complete')
    clock = T0 + 1000 + 120_000
    expect(pendingRest(current(session), clock, () => 120_000)).toBeNull()
    expect(noticesAfter(notices, null, 'start-rest')).toEqual({ notice: 'That rest has already run out.', rest: null })
    expect(current(session).rest).toBeNull()
  })

  test('a set saved whose timer checkpoint failed says so instead of dropping it', async () => {
    clock = T0
    const db = createDb()
    const session = await open(db)
    clock = T0 + 20_000
    db.failNext(/UPDATE session_base/, new Error('disk full'))
    const commit = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1', now: clock }))
    expect(commit).toMatchObject({ ok: true, saved: true, checkpointError: { code: 'storage' } })
    expect(writeOutcome(completeResult(commit, null), 'complete'))
      .toEqual({ kind: 'warning', text: "Saved. The workout time couldn't be updated, so it may be off after a restart." })
  })
})

// A workout left on screen across midnight, on real SQLite: the view drawn before midnight takes
// no write after it, through the same decision helpers the screen's hook calls inside its gate.
describe.each(SQLITE_DRIVERS)('%s: a view drawn before midnight takes no write after it', (_name, createDb) => {
  const zone = 'America/New_York'
  const start = Date.parse('2026-11-09T23:00:00-05:00')
  const at2350 = Date.parse('2026-11-09T23:50:00-05:00')
  const at0010 = Date.parse('2026-11-10T00:10:00-05:00')
  const engineBase = () => ({
    id: 'sess-night', d: '2026-11-09', start, name: 'Push A', routineIds: ['push-a'],
    entries: [{ id: 'bench', target: { restSec: 120 }, sets: [todo(75, 8), todo(75, 8)] }],
  })
  let clock = start
  const open = async (db, timeZone, withBase = true) => {
    const controller = createSessionController(sessionOptionsFrom({ db, base: withBase ? engineBase() : null, now: () => clock, timeZone }))
    await controller.open()
    return controller
  }
  const current = controller => withTargets(controller.getState().view, engineBase())
  const stored = async db => {
    const storage = createSqliteSessionStorage(db)
    return { events: (await storage.readAll()).map(event => event.id), drafts: await storage.readDrafts() }
  }
  const set0 = plannedSetId('bench', 0)
  const set1 = plannedSetId('bench', 1)

  test('every write refuses at 00:10, nothing lands, the engine agrees once asked, and Resume lets the set in', async () => {
    clock = start
    let db = createDb()
    const first = await open(db, zone)
    clock = at2350
    expect((await first.call('commitSet', completeCall(current(first), { setId: set0, side: null, eventId: 'c1', now: clock }))).saved).toBe(true)
    // The phone is now in another zone; the app reopens at 23:55. The session keeps New York's day.
    db = db.reopen()
    clock = at2350 + 5 * 60_000
    const session = await open(db, 'UTC', false)
    const drawn = current(session)
    expect(drawn).toMatchObject({ timeZone: zone, activityAt: at2350, disposition: { kind: 'active' } })
    const before = await stored(db)

    // Nothing is touched until 00:10: the screen still holds the view drawn at 23:55.
    clock = at0010
    expect(current(session).disposition.kind).toBe('active')
    expect(overnightNow(drawn, clock)).toBe(true)
    // The device's zone would have missed it: both instants fall on the same UTC day.
    expect(overnightNow(drawn, clock, 'UTC')).toBe(false)
    // Checked at the time it was drawn, the same view would have taken the next set into last
    // night's workout.
    expect(completeCall(drawn, { setId: set1, side: null, eventId: 'c2', now: at2350 + 5 * 60_000 })).not.toBeNull()

    // Each write as the hook builds it inside the gate, with the clock now: no call is built, so
    // nothing goes to the engine, and the refusal is the stage-1 sentence.
    const now = clock
    const writes = [
      ['commitSet', completeCall(drawn, { setId: set1, side: null, eventId: 'c2', now })],
      ['commitSet', completeCall(drawn, { setId: set1, side: null, values: { w: 80, r: 8 }, eventId: 'c3', now })],
      ['editSet', editCall(drawn, { setId: set0, values: { w: 80, r: 8 }, eventId: 'e1', now })],
      ['undoSet', undoCall(drawn, { setId: set0, eventId: 'u1', now })],
      ['addSet', addSetCall(drawn, 'bench', 'a1', now)],
      ['addSet', addWarmupCall(drawn, 'bench', 'w1', now)],
    ]
    for (const [name, call] of writes) {
      if (call) await session.call(name, call)
    }
    const draft = draftCall(drawn, { setId: set1, values: { w: 80, r: 8 }, now })
    if (draft) await session.call('putDraft', draft.setId, draft.values)
    expect([...writes.map(([, call]) => call), draft]).toEqual([null, null, null, null, null, null, null])
    expect(resultNotice(overnightRefusal(drawn, now), 'complete')).toBe(OVERNIGHT_NOTICE)
    expect(await stored(db)).toEqual(before)

    // The refusal reloads the view, writing nothing, and the engine says overnight too.
    const executed = db.executed.length
    await session.refresh()
    expect(db.executed.length).toBe(executed)
    expect(current(session).disposition.kind).toBe('overnight')
    db = db.reopen()
    const killed = await open(db, 'UTC', false)
    expect(current(killed).entries[0].sets.map(s => s.row.done)).toEqual([true, false])
    expect(current(killed).disposition.kind).toBe('overnight')

    // Resume, and the same set goes in on the new day.
    expect((await killed.call('resume', { eventId: 'r1' })).saved).toBe(true)
    const resumed = current(killed)
    expect(overnightNow(resumed, clock)).toBe(false)
    expect((await killed.call('commitSet', completeCall(resumed, { setId: set1, side: null, eventId: 'c2', now: clock }))).saved).toBe(true)
    db = db.reopen()
    expect(current(await open(db, 'UTC', false)).entries[0].sets.map(s => s.row.done)).toEqual([true, true])
  })

  // Last set 23:30, Finish opened at 23:40 (no end: the engine would end it then), Save at 00:05.
  test('a Finish opened before midnight and saved after it is refused, then saves at the last set', async () => {
    clock = start
    const db = createDb()
    const session = await open(db, zone)
    const lastSet = Date.parse('2026-11-09T23:30:00-05:00')
    clock = lastSet
    await session.call('commitSet', completeCall(current(session), { setId: set0, side: null, eventId: 'c1', now: clock }))
    clock = Date.parse('2026-11-09T23:40:00-05:00')
    const end = null
    clock = Date.parse('2026-11-10T00:05:00-05:00')
    const sender = async () => ({ saved: true })
    const refusedSave = await session.finishSession({ sender })
    expect(refusedSave).toMatchObject({ ok: false, saved: false, error: { code: 'overnight' } })
    expect((await stored(db)).events).toEqual(['c1'])
    await session.refresh()
    const retarget = finishRetarget(refusedSave, end, current(session))
    expect(retarget).toEqual({ end: lastSet, notice: PAST_MIDNIGHT })
    const saved = await session.finishSession({ sender, end: retarget.end })
    expect(saved).toMatchObject({ ok: true, saved: true })
    expect(saved.payload.workout).toMatchObject({ start, end: lastSet })
  })
})
