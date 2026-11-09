import { describe, expect, test } from 'vitest'
import { OVERNIGHT_NOTICE, addSetCall, completeCall, dockKeypadField, draftCall, editCall, keypadField, overnightNotice, primaryAction, restAfterComplete, resultNotice, sheetCloseCall, sheetMode, sheetOutcome, shownValues, undoCall } from './set-calls.js'
import { restEventId, restMsFor } from './rest-after.js'
import { withTargets } from './session-screen.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSessionController } from '../session/session-controller.js'
import { sessionOptionsFrom } from '../session/use-active-session.js'
import { plannedSetId } from '../session/ids.js'

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
})

describe('draftCall', () => {
  test('a draft for a set not done yet', () => {
    const v = view([bench([slot('b0', done(75, 10)), slot('b1', todo(75, 8)), slot('b2', todo(75, 8))])])
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).toEqual({ setId: 'b1', values: { w: 80, r: 8 } })
    expect(draftCall(v, { setId: 'b2', values: { w: 80, r: 6 } })).toEqual({ setId: 'b2', values: { w: 80, r: 6 } })
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
    expect(editCall(v, { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1' })).toBeNull()
    expect(undoCall(v, { setId: 'b0', eventId: 'e1' })).toBeNull()
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).toBeNull()
  })
  test('the same calls go through once the session is active again', () => {
    const v = view(sets())
    expect(completeCall(v, { setId: 'b1', side: null, eventId: 'e1' })).not.toBeNull()
    expect(addSetCall(v, '0289', 'e1')).not.toBeNull()
    expect(editCall(v, { setId: 'b0', values: { w: 80, r: 9 }, eventId: 'e1' })).not.toBeNull()
    expect(undoCall(v, { setId: 'b0', eventId: 'e1' })).not.toBeNull()
    expect(draftCall(v, { setId: 'b1', values: { w: 80, r: 8 } })).not.toBeNull()
  })
})

describe('sheetCloseCall', () => {
  test('closing after typing keeps a draft for the current set only', () => {
    expect(sheetCloseCall('current', true)).toBe('draft')
  })
  test('closing a done set cancels: only Update edits a logged set', () => {
    expect(sheetCloseCall('done', true)).toBe('none')
  })
  test('closing a later set cancels too', () => {
    expect(sheetCloseCall('pending', true)).toBe('none')
  })
  test('closing unchanged writes nothing', () => {
    expect(sheetCloseCall('current', false)).toBe('none')
    expect(sheetCloseCall('done', false)).toBe('none')
  })
})

describe('sheetOutcome', () => {
  const refused = { ok: false, saved: false, error: { message: 'disk full' } }
  test('a refusal stays in the sheet, with the typed numbers, while that sheet is open', () => {
    expect(sheetOutcome(refused, true)).toEqual({ close: false, sheet: 'Not saved: disk full', screen: undefined })
  })
  test('a refusal that arrives after the sheet closed shows on the screen', () => {
    expect(sheetOutcome(refused, false)).toEqual({ close: false, sheet: null, screen: 'Not saved: disk full' })
  })
  test('a save closes the open sheet and clears the screen notice', () => {
    expect(sheetOutcome({ ok: true, saved: true }, true)).toEqual({ close: true, sheet: null, screen: null })
    expect(sheetOutcome(null, true)).toEqual({ close: true, sheet: null, screen: null })
  })
  test('a save after the sheet closed does not close another one', () => {
    expect(sheetOutcome({ ok: true, saved: true }, false)).toEqual({ close: false, sheet: null, screen: null })
  })
  test('a set saved with a refused rest closes the sheet and shows on the screen', () => {
    expect(sheetOutcome({ ...refused, committed: true }, true)).toEqual({ close: true, sheet: null, screen: 'Not saved: disk full' })
  })
  test('a tap the gate dropped changes nothing', () => {
    expect(sheetOutcome({ ignored: true }, true)).toBeNull()
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
  test('a refused write is visible', () => {
    expect(resultNotice({ ok: false, saved: false, error: { code: 'storage', message: 'disk full' } })).toBe('Not saved: disk full')
    expect(resultNotice({ ok: false, saved: false, error: { code: 'no-rest' } })).toBe('Not saved: no-rest')
    expect(resultNotice({ ok: false, saved: false })).toBe('Not saved: unknown error')
  })
  test('a saved workout whose session did not close says so', () => {
    expect(resultNotice({ ok: false, saved: true, error: { message: 'clear failed' } })).toBe('Saved, but the workout did not close: clear failed')
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
    const call = completeCall(current(first), { setId: benchSet, side: null, eventId: 'c1' })
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
    expect(completeCall(current(second), { setId: benchSet, side: null, eventId: 'c2' })).toBeNull()
  })

  test('per side: left, kill, right; rest waits for both and typed reps survive', async () => {
    clock = T0 + 1000
    let db = createDb()
    const first = await open(db)
    const values = { w: 10, sides: { L: { r: 12 }, R: { r: 11 } } }
    await first.call('commitSet', completeCall(current(first), { setId: latSet, side: 'L', values, eventId: 'l1' }))
    expect(restAfterComplete(current(first), latSet, restMsOf)).toBeNull()
    db = db.reopen()
    clock = T0 + 20_000
    const second = await open(db, false)
    const row = second.getState().view.entries[1].sets[0].row
    expect(row.sides).toEqual({ L: { w: 10, r: 12, done: true }, R: { w: 10, r: 11, done: false } })
    await second.call('commitSet', completeCall(current(second), { setId: latSet, side: 'R', eventId: 'r1' }))
    expect(restAfterComplete(current(second), latSet, restMsOf)).toEqual({ eventId: restEventId(latSet, T0 + 20_000), deadline: T0 + 20_000 + 90_000 })
  })

  test('an edit keeps the set time, so its rest keeps its id; undo clears done', async () => {
    clock = T0 + 1000
    const session = await open(createDb())
    await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1' }))
    const before = restAfterComplete(current(session), benchSet, restMsOf)
    clock = T0 + 60_000
    await session.call('editSet', editCall(current(session), { setId: benchSet, values: { w: 80, r: 7 }, eventId: 'e1' }))
    expect(current(session).entries[0].sets[0].row).toMatchObject({ w: 80, r: 7, done: true, at: T0 + 1000 })
    expect(restAfterComplete(current(session), benchSet, restMsOf)).toEqual(before)
    await session.call('undoSet', undoCall(current(session), { setId: benchSet, eventId: 'u1' }))
    expect(current(session).entries[0].sets[0].row.done).toBe(false)
  })

  test('Add set on a per-side exercise adds a per-side set that survives a kill', async () => {
    let db = createDb()
    const first = await open(db)
    expect((await first.call('addSet', addSetCall(current(first), 'lat', 'a1'))).saved).toBe(true)
    db = db.reopen()
    const added = (await open(db, false)).getState().view.entries[1].sets[1]
    expect(added.setId).toBe('add:lat:a1')
    expect(added.row.sides).toEqual({ L: { w: 7.5, r: 10, done: false }, R: { w: 7.5, r: 10, done: false } })
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
    const result = await session.call('commitSet', completeCall(current(session), { setId: benchSet, side: null, eventId: 'c1' }))
    expect(resultNotice(result)).toBe('Not saved: disk full')
    expect(current(session).entries[0].sets[0].row.done).toBe(false)
  })
})
