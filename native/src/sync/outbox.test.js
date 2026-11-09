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
