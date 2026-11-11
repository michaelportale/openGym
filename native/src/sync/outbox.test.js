import { expect, test } from 'vitest'
import { ROUTINE_DELETED } from './edit-guard.js'
import { buildPush } from './outbox.js'
import { createMemoryPendingEdits } from './pending-edits.js'

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

// Routine edits (pending-edits.js rows): the copy's routine as the Plan screen saved it, on
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
const routineEdit = (routine, extra = {}) => ({ kind: 'routine', key: routine.id, baseTs: 1000, value: routine, sent: null, t: 50, ...extra })
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
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 50, baseTs: 1000, value: mine }])
  expect(copy).toEqual(planCopy()) // input not mutated
})

test('a superseded edit makes no push, and the routines are not touched', () => {
  const copy = planCopy()
  expect(buildPush(copy, [], [], [routineEdit(movedR1(), { baseTs: 999 })])).toBeNull() // changed on the web
  expect(buildPush(copy, [], [], [routineEdit({ ...movedR1(), id: 'gone' })])).toBeNull() // deleted on the web
  const withWorkout = buildPush(copy, [pend('p1')], [], [routineEdit(movedR1(), { baseTs: 999 })])
  expect(withWorkout.state.routines).toBe(copy.state.routines)
  expect(withWorkout.edits).toEqual([])
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
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 50, baseTs: 1000, value: mine }])
})

test('a push without routine edits says it carries none', () => {
  const copy = planCopy()
  expect(buildPush(copy, [pend('p1')]).edits).toEqual([])
  expect(buildPush(copy, [], [typedSet('2026-11-08', 180, 5)]).edits).toEqual([])
  expect(buildPush(copy, [pend('p1')]).state.routines).toBe(copy.state.routines)
})

test('a rebased edit goes in with its newer routine: the copy holds what this phone sent before', () => {
  const copy = planCopy()
  const sentBefore = { ...copy.state.routines[0], _ts: 1, _f: undefined }
  const newer = { ...movedR1(), name: 'Push day' }
  const push = buildPush(copy, [], [], [routineEdit(newer, { baseTs: 1, sent: sentBefore, t: 60 })])
  expect(push.state.routines[0]).toEqual(newer)
  // the row's own baseTs as listed, not the copy's _ts it goes on: markSent matches the row
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 60, baseTs: 1, value: newer }])
})

test('only the edits that go are carried, each with its own t', () => {
  const copy = planCopy()
  const mine = movedR1()
  const r2 = { ...copy.state.routines[1], ex: [{ id: '0027', sets: 5, reps: 8 }] }
  const push = buildPush(copy, [], [], [routineEdit(mine, { t: 70 }), routineEdit(r2, { baseTs: 2, t: 71 })])
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 70, baseTs: 1000, value: mine }])
  expect(push.state.routines[1]).toBe(copy.state.routines[1])
})

test('an edit made on older stamps goes on the copy\'s, and is recorded for markSent as it goes', () => {
  const copy = planCopy()
  const { _f, ...stale } = { ...movedR1(), _ts: 1 }
  const push = buildPush(copy, [], [], [routineEdit(stale)])
  expect(push.state.routines[0]).toEqual({ ...stale, _ts: 1000, _f: { ex: 900 } })
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 50, baseTs: 1000, value: push.state.routines[0] }])
})

// Creating and deleting a routine (7E-A): a create goes in at the end with no stamps, which the
// server sets; a delete leaves the routine out, which the server records in deleted.routines,
// with the copy's week and dayPlan cleaned as the web's deleteRoutine cleans them.
const deleteRow = (key, extra = {}) => ({ kind: 'routine', key, baseTs: 1000, value: ROUTINE_DELETED, sent: null, t: 50, ...extra })

test('a create goes in at the end of routines with no stamps, and is recorded for markSent as it goes', () => {
  const copy = planCopy()
  const made = { id: 'r9', name: 'Legs', ex: [{ id: '0031', sets: 3, reps: 8 }] }
  const push = buildPush(copy, [], [], [routineEdit({ ...made, _ts: 1000, _f: { ex: 900 } }, { baseTs: 0 })])
  expect(push.state.routines).toEqual([...copy.state.routines, made])
  push.state.routines.slice(0, 3).forEach((r, i) => expect(r).toBe(copy.state.routines[i]))
  expect({ ...push.state, routines: undefined }).toEqual({ ...copy.state, routines: undefined })
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r9', t: 50, baseTs: 0, value: made }])
  expect(copy).toEqual(planCopy())
})

test('a delete leaves the routine out and cleans the copy\'s week and dayPlan; markSent records the marker and does not throw', async () => {
  const copy = planCopy()
  Object.assign(copy.state, { week: { 1: ['r1', 'r2'], 4: ['r1'] }, dayPlan: { '2026-11-12': 'r1', '2026-11-13': 'r2' }, queue: { ids: ['r2', 'r1'] } })
  const before = structuredClone(copy)
  const row = deleteRow('r1')
  const push = buildPush(copy, [], [], [row])
  expect(push.state.routines).toEqual([copy.state.routines[1], 'junk'])
  expect(push.state.week).toEqual({ 1: ['r2'] })
  expect(push.state.dayPlan).toEqual({ '2026-11-13': 'r2' })
  const rest = s => ({ ...s, routines: undefined, week: undefined, dayPlan: undefined })
  expect(rest(push.state)).toEqual(rest(copy.state)) // the queue, edited and deleted go as the copy has them
  expect(push.edits).toEqual([{ kind: 'routine', key: 'r1', t: 50, baseTs: 1000, value: ROUTINE_DELETED }])
  expect(copy).toEqual(before)
  const store = createMemoryPendingEdits()
  await store.put(row)
  await expect(store.markSent(push.edits)).resolves.toEqual({ ok: true })
  expect((await store.get('routine', 'r1')).sent).toEqual(ROUTINE_DELETED)
})

test('a routine created and deleted before any sync makes no push, and rides along with nothing when a workout goes', () => {
  const copy = planCopy()
  const row = deleteRow('r9', { baseTs: 0 })
  expect(buildPush(copy, [], [], [row])).toBeNull()
  const push = buildPush(copy, [pend('p1')], [], [row])
  expect(push.edits).toEqual([])
  expect(push.state.routines).toBe(copy.state.routines)
})

// Nutrition days and the two settings (pending-edits.js rows of kind nutritionDay and setting): a
// day goes in on the copy day's _ts, a setting whole; `edited` goes as the copy has it, since the
// server moves a changed setting's stamp itself.
const nutritionCopy = () => ({
  state: {
    ...fixture(),
    nutritionDays: {
      '2026-11-07': { kcal: 2000, protein: 150, carbs: 200, fat: 60, fiber: 25, dayType: 'rest', supps: ['s1'], futureDayKey: { x: 1 }, _ts: 100 },
      '2026-11-08': { kcal: 2400, protein: 170, carbs: 260, fat: 70, fiber: 30, dayType: 'training', note: 'leg day', _ts: 200 },
    },
    nutritionTargets: { training: { kcal: 2400, protein: 170, fiber: 30 }, rest: { kcal: 2000, protein: 160, fiber: 30 }, futureTargetKey: 'x' },
    supplements: [{ id: 's1', name: 'Creatine' }],
    edited: { ...fixture().edited, nutritionTargets: 300, supplements: 310 },
  },
  rev: 9,
  wid: 'wid-n',
})
const dayEdit = (key, value, extra = {}) => ({ kind: 'nutritionDay', key, baseTs: null, value, sent: null, t: 80, ...extra })
const settingEdit = (key, value, extra = {}) => ({ kind: 'setting', key, baseTs: null, value, sent: null, t: 81, ...extra })
const NEW_DAY = { kcal: 2100, protein: 160, carbs: 220, fat: 70, fiber: 30, dayType: 'training' }

test('a nutrition day and a targets edit go out; every other day and key is byte-identical', () => {
  const copy = nutritionCopy()
  // made on the copy's day, so it carries that day's _ts
  const day = { ...copy.state.nutritionDays['2026-11-08'], kcal: 2500, note: 'more rice' }
  const targets = { ...copy.state.nutritionTargets, training: { kcal: 2600, protein: 180, fiber: 32 } }
  const push = buildPush(copy, [], [], [dayEdit('2026-11-08', day, { baseTs: 200 }), settingEdit('nutritionTargets', targets, { baseTs: 300 })])
  expect(push.state.nutritionDays['2026-11-08']).toEqual({ ...day, _ts: 200 })
  expect(push.state.nutritionDays['2026-11-07']).toBe(copy.state.nutritionDays['2026-11-07'])
  expect(push.state.nutritionTargets).toEqual(targets)
  expect(push.state.supplements).toBe(copy.state.supplements)
  expect(push.state.edited).toBe(copy.state.edited) // the server moves edited.nutritionTargets
  expect(push.state.routines).toBe(copy.state.routines)
  expect(push.state.workouts).toBe(copy.state.workouts)
  const rest = s => JSON.stringify({ ...s, nutritionDays: { ...s.nutritionDays, '2026-11-08': undefined }, nutritionTargets: undefined })
  expect(rest(push.state)).toBe(rest(nutritionCopy().state))
  expect(push.baseRev).toBe(9)
  expect(push.baseWid).toBe('wid-n')
  expect(push.edits).toEqual([
    { kind: 'nutritionDay', key: '2026-11-08', t: 80, baseTs: 200, value: { ...day, _ts: 200 } },
    { kind: 'setting', key: 'nutritionTargets', t: 81, baseTs: 300, value: targets },
  ])
  expect(copy).toEqual(nutritionCopy()) // input not mutated
})

test('a day the copy lacks goes in with no _ts, starting nutritionDays when the copy has none', () => {
  const copy = planCopy()
  const push = buildPush(copy, [], [], [dayEdit('2026-11-09', NEW_DAY)])
  expect(push.state.nutritionDays).toEqual({ '2026-11-09': NEW_DAY })
  expect({ ...push.state, nutritionDays: undefined }).toEqual({ ...copy.state, nutritionDays: undefined })
  expect(push.edits).toEqual([{ kind: 'nutritionDay', key: '2026-11-09', t: 80, baseTs: null, value: NEW_DAY }])
  expect(copy).toEqual(planCopy())
})

test('supplements go whole, as a list', () => {
  const copy = nutritionCopy()
  const supps = [{ id: 's1', name: 'Creatine' }, { id: 's2', name: 'Fish oil' }]
  const push = buildPush(copy, [], [], [settingEdit('supplements', supps, { baseTs: 310 })])
  expect(push.state.supplements).toEqual(supps)
  expect(push.state.nutritionDays).toBe(copy.state.nutritionDays)
  expect(push.state.nutritionTargets).toBe(copy.state.nutritionTargets)
  expect(push.edits).toEqual([{ kind: 'setting', key: 'supplements', t: 81, baseTs: 310, value: supps }])
})

test('a day or setting the web changed first makes no push, and nothing of it is touched', () => {
  const copy = nutritionCopy()
  expect(buildPush(copy, [], [], [dayEdit('2026-11-08', NEW_DAY, { baseTs: 150 })])).toBeNull()
  expect(buildPush(copy, [], [], [dayEdit('2026-11-08', NEW_DAY)])).toBeNull() // logged on the web first
  expect(buildPush(copy, [], [], [settingEdit('supplements', [], { baseTs: 1 })])).toBeNull()
  const withWorkout = buildPush(copy, [pend('p1')], [], [dayEdit('2026-11-08', NEW_DAY, { baseTs: 150 }), settingEdit('nutritionTargets', {}, { baseTs: 1 })])
  expect(withWorkout.state.nutritionDays).toBe(copy.state.nutritionDays)
  expect(withWorkout.state.nutritionTargets).toBe(copy.state.nutritionTargets)
  expect(withWorkout.edits).toEqual([])
})

test('a rebased day goes in with its newer value on the copy day\'s _ts; markSent gets the row\'s own base', () => {
  const copy = nutritionCopy()
  const { _ts, ...sentBefore } = copy.state.nutritionDays['2026-11-08']
  const newer = { ...sentBefore, kcal: 2700 }
  const push = buildPush(copy, [], [], [dayEdit('2026-11-08', newer, { baseTs: null, sent: sentBefore, t: 90 })])
  expect(push.state.nutritionDays['2026-11-08']).toEqual({ ...newer, _ts: 200 })
  expect(push.edits).toEqual([{ kind: 'nutritionDay', key: '2026-11-08', t: 90, baseTs: null, value: { ...newer, _ts: 200 } }])
})

test('a routine, a day and a setting ride one push, each in its own place', () => {
  const copy = { ...planCopy(), state: { ...planCopy().state, nutritionDays: nutritionCopy().state.nutritionDays } }
  const mine = movedR1()
  const supps = [{ id: 's9', name: 'Magnesium' }]
  const push = buildPush(copy, [pend('p1')], [], [routineEdit(mine), dayEdit('2026-11-09', NEW_DAY), settingEdit('supplements', supps)])
  expect(push.state.routines[0]).toEqual(mine)
  expect(push.state.routines[1]).toBe(copy.state.routines[1])
  expect(push.state.nutritionDays).toEqual({ ...copy.state.nutritionDays, '2026-11-09': NEW_DAY })
  expect(push.state.supplements).toEqual(supps)
  expect(push.state.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'p1'])
  expect(push.edits.map(e => [e.kind, e.key])).toEqual([['routine', 'r1'], ['nutritionDay', '2026-11-09'], ['setting', 'supplements']])
})

// Body measurements (measurement-store.js rows): by day, like weigh-ins, under the same typed
// guard (measurement-ops.js). Entries as the web stores them, in cm, with keys this app does not know.
const mEntry = (d, t, fields = {}) => ({ d, t, waist: 81.28, chest: 101.6, neck: null, other: [{ id: 'c1', name: 'Calf', value: 38.1 }], futureKey: { x: [1] }, ...fields })
const mSet = e => ({ d: e.d, op: 'set', entry: e, t: e.t })
const measuredCopy = () => ({
  state: {
    ...fixture(),
    measurements: [
      mEntry('2026-11-01', 100),
      // two rows on one day, as an import can leave them: the web folds them, so both go back
      mEntry('2026-11-03', 200, { waist: 80 }),
      mEntry('2026-11-03', 300, { waist: null, hips: 99.06 }),
      mEntry('2026-11-05', 400, { mystery: { nested: [1, { y: 'z' }] } }),
    ],
    deleted: { ...fixture().deleted, measurements: { '2026-11-07': 900 } },
  },
  rev: 11,
  wid: 'wid-m',
})

test('a measurement set goes in by day; every other day, row and key is byte-identical', () => {
  const copy = measuredCopy()
  const mine = mEntry('2026-11-05', 500, { waist: 80.01, mystery: { nested: [1, { y: 'z' }] } })
  const push = buildPush(copy, [], [], [], [mSet(mine)])
  expect(push.state.measurements).toEqual([...copy.state.measurements.slice(0, 3), mine])
  copy.state.measurements.slice(0, 3).forEach((e, i) => expect(push.state.measurements[i]).toBe(e))
  const others = s => JSON.stringify(s.measurements.filter(e => e.d !== '2026-11-05'))
  expect(others(push.state)).toBe(others(measuredCopy().state))
  expect(JSON.stringify({ ...push.state, measurements: undefined })).toBe(JSON.stringify({ ...measuredCopy().state, measurements: undefined }))
  expect(push.state.workouts).toBe(copy.state.workouts)
  expect(push.state.deleted).toBe(copy.state.deleted)
  expect(push.baseRev).toBe(11)
  expect(push.baseWid).toBe('wid-m')
  expect(push.edits).toEqual([])
  expect(copy).toEqual(measuredCopy()) // input not mutated
})

test('a measurement day the copy lacks is added in day order, and a copy with no measurements starts the list', () => {
  const mine = mEntry('2026-11-04', 500)
  expect(buildPush(measuredCopy(), [], [], [], [mSet(mine)]).state.measurements.map(e => [e.d, e.t])).toEqual([
    ['2026-11-01', 100], ['2026-11-03', 200], ['2026-11-03', 300], ['2026-11-04', 500], ['2026-11-05', 400],
  ])
  const bare = { state: fixture(), rev: 1, wid: 'w' }
  const push = buildPush(bare, [], [], [], [mSet(mine)])
  expect(push.state.measurements).toEqual([mine])
  expect({ ...push.state, measurements: undefined }).toEqual({ ...fixture(), measurements: undefined })
})

test('a measurement remove takes out the day it saw, both rows of it; the removal goes as the day left out', () => {
  const copy = measuredCopy()
  const push = buildPush(copy, [], [], [], [{ d: '2026-11-03', op: 'remove', t: 600, baseT: 300 }])
  expect(push.state.measurements).toEqual([copy.state.measurements[0], copy.state.measurements[3]])
  // the server records the removal from the day the push leaves out (sync-stamps.js stampUnstamped)
  expect(push.state.deleted).toBe(copy.state.deleted)
})

test('measurements that cannot apply, or are already there, make no push and leave the list as it was', () => {
  const copy = measuredCopy()
  expect(buildPush(copy, [], [], [], [mSet(mEntry('2026-11-05', 350))])).toBeNull() // a later entry holds the day
  expect(buildPush(copy, [], [], [], [mSet(mEntry('2026-11-05', 400, { mystery: { nested: [1, { y: 'z' }] } }))])).toBeNull() // already there
  expect(buildPush(copy, [], [], [], [{ d: '2026-11-03', op: 'remove', t: 600, baseT: 200 }])).toBeNull() // saw another entry
  expect(buildPush(copy, [], [], [], [{ d: '2026-11-09', op: 'remove', t: 600, baseT: 1 }])).toBeNull() // already gone
  expect(buildPush(copy, [], [], [], [mSet(mEntry('2026-11-07', 850))])).toBeNull() // removed on the web after it
  expect(buildPush(copy, [], [], [], [mSet(mEntry('2026-11-07', 950))]).state.measurements.map(e => e.d)).toContain('2026-11-07')
  const withWorkout = buildPush(copy, [pend('p1')], [], [], [mSet(mEntry('2026-11-05', 350))])
  expect(withWorkout.state.measurements).toBe(copy.state.measurements)
})

test('a workout, a weigh-in, an edit and a measurement ride one push, each in its own place', () => {
  const copy = { ...planCopy(), state: { ...planCopy().state, measurements: measuredCopy().state.measurements } }
  const mine = mEntry('2026-11-08', 500)
  const push = buildPush(copy, [pend('p1')], [typedSet('2026-11-08', 181.2, 5)], [routineEdit(movedR1())], [mSet(mine)])
  expect(push.state.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'p1'])
  expect(push.state.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: 5 }])
  expect(push.state.routines[0]).toEqual(movedR1())
  expect(push.state.measurements).toEqual([...copy.state.measurements, mine])
  expect(push.edits.map(e => [e.kind, e.key])).toEqual([['routine', 'r1']])
})


test('a pending workout prevents a custom delete in the same outgoing document', () => {
  const exercise = { id: 'c1', n: 'Curl', _ts: 10 }
  const copy = { state: { ...fixture(), customEx: [exercise] }, rev: 41, wid: 'wid-a' }
  const row = { kind: 'customEx', key: 'c1', baseTs: 10, value: { deleted: true }, sent: null, t: 50 }
  const workout = pend('new', { entries: [{ id: 'c1', sets: [{ w: 10, r: 8, done: true }] }] })
  const push = buildPush(copy, [workout], [], [row])
  expect(push.state.customEx).toEqual([exercise])
  expect(push.state.workouts.at(-1)).toEqual(workout)
  expect(push.edits).toEqual([])
})
