import { expect, test } from 'vitest'
import { buildPush } from './outbox.js'

const fixture = () => ({
  unit: 'lb',
  futureFeature: { nested: [1, { x: 'y' }], flag: true },
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }],
  deleted: { workouts: ['gone-1'], routines: [] },
  edited: { 'w1': { at: 123, by: 'web' } },
  _rev: 41,
  _wid: 'wid-a',
  _wids: ['wid-a', 'wid-b'],
  workouts: [
    { id: 'w1', d: '2026-11-01', entries: [{ id: 'bench', sets: [{ w: 100, r: 5, done: true, type: 'quantum' }] }], mystery: 1 },
    { id: 'w2', d: '2026-11-02', entries: [] },
  ],
})
const pend = (id, extra = {}) => ({ id, d: '2026-11-08', entries: [], vol: 0, ...extra })

test('a push keeps every other part of the document and extends only workouts', () => {
  const state = fixture()
  const copy = { state, rev: 41, wid: 'wid-a' }
  const pending = [pend('p1', { importedFrom: 'x' }), pend('p2')]
  const push = buildPush(copy, pending)
  expect(push.state).toEqual({ ...fixture(), workouts: [...fixture().workouts, pending[0], pending[1]] })
  expect(push.baseRev).toBe(copy.rev)
  expect(push.baseWid).toBe(copy.wid)
  expect(state).toEqual(fixture()) // input not mutated
})

test('a pending id the copy already holds is skipped, and nothing to add is null', () => {
  const copy = { state: fixture(), rev: 1, wid: 'w' }
  const push = buildPush(copy, [pend('w1'), pend('p1')])
  expect(push.state.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'p1'])
  expect(push.state.workouts[0]).toEqual(fixture().workouts[0])
  expect(buildPush(copy, [pend('w1'), pend('w2')])).toBeNull()
  expect(buildPush(copy, [])).toBeNull()
})

test('a copy with no workouts array is treated as empty', () => {
  const copy = { state: { unit: 'lb' }, rev: 0, wid: 'w' }
  expect(buildPush(copy, [pend('p1')]).state).toEqual({ unit: 'lb', workouts: [pend('p1')] })
})

// Server documents with a malformed entry: the push still sends the document as it is, plus the
// workout it lacks.
const okWorkout = { id: 'w1', d: '2026-11-01', entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }] }
const okRoutine = { id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }
test.each([
  ['a null routine', { routines: [null, okRoutine], workouts: [okWorkout] }],
  ['a null workout', { routines: [okRoutine], workouts: [null, okWorkout] }],
  ['a null element in a routine\'s ex', { routines: [{ ...okRoutine, ex: [null] }], workouts: [okWorkout] }],
  ['a null element in a workout\'s entries', { routines: [okRoutine], workouts: [{ ...okWorkout, entries: [null] }] }],
  ['a null element in customEx', { routines: [okRoutine], workouts: [okWorkout], customEx: [null] }],
])('%s: sent verbatim with the new workout on the end', (_n, doc) => {
  const copy = { state: doc, rev: 5, wid: 'w' }
  const stored = JSON.parse(JSON.stringify(doc))
  const push = buildPush(copy, [pend('w1'), pend('p1')])
  expect(push.state).toEqual({ ...stored, unit: 'lb', workouts: [...stored.workouts, pend('p1')] })
  expect(doc).toEqual(stored)
})

test('workouts that is not a list: the new workout starts the list, as with none', () => {
  const copy = { state: { routines: [okRoutine], workouts: {} }, rev: 5, wid: 'w' }
  expect(buildPush(copy, [pend('p1')]).state).toEqual({ routines: [okRoutine], unit: 'lb', workouts: [pend('p1')] })
})

test('a document with no unit is pushed as pounds; a present unit is never changed', () => {
  const bare = { state: { routines: [okRoutine] }, rev: 0, wid: 'w' }
  expect(buildPush(bare, [pend('p1')]).state).toEqual({ routines: [okRoutine], unit: 'lb', workouts: [pend('p1')] })
  expect(bare.state).toEqual({ routines: [okRoutine] }) // input not mutated
  expect(buildPush({ state: { unit: 'kg' }, rev: 0, wid: 'w' }, [pend('p1')]).state.unit).toBe('kg')
})

const withBody = bodyweight => ({ state: { ...fixture(), bodyweight }, rev: 5, wid: 'wid-a' })
const typedSet = (d, w, t, extra = {}) => ({ d, op: 'set', w, t, ...extra })

test('a typed weigh-in is applied by day and everything else goes back verbatim', () => {
  const web = { d: '2026-11-01', w: 180, t: 100, extra: 'kept' }
  const copy = withBody([web])
  const push = buildPush(copy, [], [typedSet('2026-11-08', 181.2, 500)])
  expect(push.state.bodyweight).toEqual([web, { d: '2026-11-08', w: 181.2, t: 500 }])
  expect(push.state.bodyweight[0]).toBe(web)
  expect(push.state.workouts).toBe(copy.state.workouts)
  expect({ ...push.state, bodyweight: undefined }).toEqual({ ...fixture(), bodyweight: undefined })
  expect(push.baseRev).toBe(5)
  expect(push.baseWid).toBe('wid-a')
})

test('only superseded or already-present weigh-ins make no push, and the body is not touched', () => {
  const typed = { d: '2026-11-08', w: 180, t: 900 }
  const copy = withBody([typed])
  const health = { d: '2026-11-08', op: 'set', w: 175, t: 800, src: 'health', hk: 'u1' }
  expect(buildPush(copy, [], [health])).toBeNull() // a Health set never overwrites a typed entry
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 900)])).toBeNull() // already there
  expect(buildPush(copy, [], [{ d: '2026-11-08', op: 'remove', t: 1000, baseT: 5 }])).toBeNull() // saw another entry
})

test('a duplicate-day or malformed bodyweight is left as it was unless something applies', () => {
  const messy = [{ d: '2026-11-01', w: 1, t: 1 }, { d: '2026-11-01', w: 2, t: 2 }, 'junk']
  const copy = withBody(messy)
  const w = pend('p1')
  expect(buildPush(copy, [], [])).toBeNull()
  expect(buildPush(copy, [w], []).state.bodyweight).toBe(messy)
  expect(buildPush(copy, [w], [typedSet('2026-11-05', 170, 9)]).state.bodyweight.map(e => e.d)).toEqual(['2026-11-01', '2026-11-05'])
})

test('a weigh-in alone pushes, and a copy with no bodyweight starts one', () => {
  const copy = { state: fixture(), rev: 1, wid: 'w' }
  const push = buildPush(copy, [], [typedSet('2026-11-08', 180, 5)])
  expect(push.state.bodyweight).toEqual([{ d: '2026-11-08', w: 180, t: 5 }])
  expect(push.state.workouts).toEqual(fixture().workouts)
  expect(copy.state).toEqual(fixture())
})

test('a typed remove takes out the entry it saw and leaves an unseen one', () => {
  const copy = withBody([{ d: '2026-11-08', w: 180, t: 50 }])
  expect(buildPush(copy, [], [{ d: '2026-11-08', op: 'remove', t: 60, baseT: 50 }]).state.bodyweight).toEqual([])
})

test('a weigh-in alone turns a non-list workouts into a list, as the workout path does', () => {
  const copy = { state: { ...fixture(), workouts: 'junk' }, rev: 1, wid: 'w' }
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 5)]).state.workouts).toEqual([])
  expect(buildPush(copy, [pend('p1')]).state.workouts).toEqual([pend('p1')])
})

test('a removal on record in the document supersedes a set made before it', () => {
  const copy = { state: { ...fixture(), deleted: { workouts: [], bodyweight: { '2026-11-08': 900 } } }, rev: 1, wid: 'w' }
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 500)])).toBeNull()
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 950)]).state.bodyweight).toEqual([{ d: '2026-11-08', w: 180, t: 950 }])
})

// Routine edits (plan/routine-edits.js rows): the copy's routine as the Plan screen saved it, on
// the copy routine's _ts.
const slotA = () => ({ id: '0025', sets: 3, reps: 5, mode: 'reps', weight: 60, prog: 'linear', pyramid: [{ w: 60, r: 8 }, { w: 70, r: 5 }], dbLoad: 'pair', stationId: 'rack-2', intensifier: 'drop', note: 'pause at the bottom', sgName: 'A' })
const slotB = () => ({ id: '0027', sets: 3, reps: 8, mode: 'reps', stationId: 'cable-1', futureSlotKey: { nested: [1] } })
const planCopy = () => ({
  state: {
    ...fixture(),
    routines: [
      { id: 'r1', name: 'Push', ex: [slotA(), slotB()], _ts: 1000, _f: { ex: 900 }, futureRoutineKey: 'x' },
      { id: 'r2', name: 'Pull', ex: [{ id: '0027', sets: 3, reps: 8 }], _ts: 1000 },
      'junk',
    ],
  },
  rev: 7,
  wid: 'wid-a',
})
const routineEdit = (routine, extra = {}) => ({ rid: routine.id, baseTs: 1000, routine, sent: null, t: 50, ...extra })
// r1 with its two slots swapped and the moved one edited.
const movedR1 = () => {
  const r = planCopy().state.routines[0]
  return { ...r, ex: [{ ...slotB(), sets: 4 }, slotA()] }
}

test('a moved slot carries every key it had to its new place, and the other routines go as they were', () => {
  const copy = planCopy()
  const mine = movedR1()
  const push = buildPush(copy, [], [], [routineEdit(mine)])
  expect(push.state.routines[0]).toEqual(mine)
  expect(push.state.routines[0].ex[0]).toEqual({ ...slotB(), sets: 4 })
  expect(push.state.routines[0].ex[1]).toEqual(slotA())
  for (const key of ['pyramid', 'dbLoad', 'stationId', 'intensifier', 'note', 'sgName']) {
    expect(push.state.routines[0].ex[1][key], key).toEqual(slotA()[key])
  }
  expect(push.state.routines[0]._ts).toBe(1000) // the server stamps it, not the phone
  expect(push.state.routines[1]).toBe(copy.state.routines[1])
  expect(push.state.routines[2]).toBe('junk')
  expect(JSON.stringify(push.state.routines.slice(1))).toBe(JSON.stringify(planCopy().state.routines.slice(1)))
  expect({ ...push.state, routines: undefined }).toEqual({ ...copy.state, routines: undefined })
  expect(push.state.workouts).toBe(copy.state.workouts)
  expect(push.baseRev).toBe(7)
  expect(push.baseWid).toBe('wid-a')
  expect(push.routineEdits).toEqual([{ rid: 'r1', t: 50, baseTs: 1000, routine: mine }])
  expect(copy).toEqual(planCopy()) // input not mutated
})

test('a superseded edit makes no push, and the routines are not touched', () => {
  const copy = planCopy()
  expect(buildPush(copy, [], [], [routineEdit(movedR1(), { baseTs: 999 })])).toBeNull() // changed on the web
  expect(buildPush(copy, [], [], [routineEdit({ ...movedR1(), id: 'gone' })])).toBeNull() // deleted on the web
  const withWorkout = buildPush(copy, [pend('p1')], [], [routineEdit(movedR1(), { baseTs: 999 })])
  expect(withWorkout.state.routines).toBe(copy.state.routines)
  expect(withWorkout.routineEdits).toEqual([])
})

test('an edit the copy already holds makes no push', () => {
  const copy = planCopy()
  expect(buildPush(copy, [], [], [routineEdit({ ...copy.state.routines[0], _ts: 1, _f: undefined }, { baseTs: 1 })])).toBeNull()
})

test('an edit plus a workout and a weigh-in gives one push carrying all three', () => {
  const copy = planCopy()
  const mine = movedR1()
  const push = buildPush(copy, [pend('p1')], [typedSet('2026-11-08', 181.2, 5)], [routineEdit(mine)])
  expect(push.state.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'p1'])
  expect(push.state.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: 5 }])
  expect(push.state.routines[0]).toEqual(mine)
  expect(push.routineEdits).toEqual([{ rid: 'r1', t: 50, baseTs: 1000, routine: mine }])
})

test('a push without routine edits says it carries none', () => {
  const copy = planCopy()
  expect(buildPush(copy, [pend('p1')]).routineEdits).toEqual([])
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 5)]).routineEdits).toEqual([])
  expect(buildPush(copy, [pend('p1')]).state.routines).toBe(copy.state.routines)
})

test('a rebased edit goes in with its newer routine: the copy holds what this phone sent before', () => {
  const copy = planCopy()
  const sentBefore = { ...copy.state.routines[0], _ts: 1, _f: undefined }
  const newer = { ...movedR1(), name: 'Push day' }
  const push = buildPush(copy, [], [], [routineEdit(newer, { baseTs: 1, sent: sentBefore, t: 60 })])
  expect(push.state.routines[0]).toEqual(newer)
  // the row's own baseTs as listed, not the copy's _ts it goes on: markSent matches the row
  expect(push.routineEdits).toEqual([{ rid: 'r1', t: 60, baseTs: 1, routine: newer }])
})

test('only the edits that go are carried, each with its own t', () => {
  const copy = planCopy()
  const mine = movedR1()
  const r2 = { ...copy.state.routines[1], ex: [{ id: '0027', sets: 5, reps: 8 }] }
  const push = buildPush(copy, [], [], [routineEdit(mine, { t: 70 }), routineEdit(r2, { baseTs: 2, t: 71 })])
  expect(push.routineEdits).toEqual([{ rid: 'r1', t: 70, baseTs: 1000, routine: mine }])
  expect(push.state.routines[1]).toBe(copy.state.routines[1])
})

test('an edit made on older stamps goes on the copy\'s, and is recorded for markSent as it goes', () => {
  const copy = planCopy()
  const { _f, ...stale } = { ...movedR1(), _ts: 1 }
  const push = buildPush(copy, [], [], [routineEdit(stale)])
  expect(push.state.routines[0]).toEqual({ ...stale, _ts: 1000, _f: { ex: 900 } })
  expect(push.routineEdits).toEqual([{ rid: 'r1', t: 50, baseTs: 1000, routine: push.state.routines[0] }])
})
