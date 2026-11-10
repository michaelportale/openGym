import { expect, test } from 'vitest'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { createMemoryPendingEdits } from '../sync/pending-edits.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { progressLoader } from './progress-source.js'

const bundled = { state: { workouts: [], bodyweight: [{ d: '2026-11-01', w: 190, t: 1 }] }, names: {} }
const copyDoc = {
  state: { routines: [], workouts: [{ id: 'c1', d: '2026-11-05', start: 1, entries: [] }], bodyweight: [{ d: '2026-11-07', w: 181, t: 1 }], deleted: { bodyweight: {} }, targetW: 175 },
  rev: 3, wid: 'x',
}

function counted(copy, log) {
  return { get: async () => { log.push('copy'); return copy }, key: async () => (copy ? { rev: copy.rev, wid: copy.wid } : null) }
}

test('paired: one read of the copy gives the state and the weigh-ins, pending ones laid over', async () => {
  const log = []
  const finished = createMemoryFinishedWorkouts()
  await finished.put({ id: 'p1', d: '2026-11-08', start: 2, entries: [] })
  const memo = createMemoryWeighIns()
  await memo.put({ d: '2026-11-09', op: 'set', w: 180.4, t: 9 })
  const weighIns = { ...memo, listPending: async () => { log.push('weigh-ins'); return memo.listPending() } }
  const out = await progressLoader()({ finished, serverCopy: counted(copyDoc, log), weighIns, bundled })
  expect(log).toEqual(['weigh-ins', 'copy'])
  expect(out.state.workouts.map(w => w.id)).toEqual(['c1', 'p1'])
  expect(out.state.targetW).toBe(175)
  expect(out.bodyweight.map(e => [e.d, e.w])).toEqual([['2026-11-07', 181], ['2026-11-09', 180.4]])
  // The copy as read, without the overlay: what a save's base is read from (Nutrition).
  expect(out.copy).toBe(copyDoc)
})

test('unpaired: the snapshot stands in for the copy, for workouts and weigh-ins', async () => {
  const log = []
  const out = await progressLoader()({ finished: createMemoryFinishedWorkouts(), serverCopy: counted(null, log), weighIns: createMemoryWeighIns(), bundled })
  expect(log).toEqual(['copy'])
  expect(out.bodyweight).toEqual(bundled.state.bodyweight)
  expect(out.state.workouts).toEqual([])
  expect(out.copy).toBeNull()
})

test('a weigh-in alone keeps the same state object, and changes the weigh-ins', async () => {
  const stores = { finished: createMemoryFinishedWorkouts(), serverCopy: counted(copyDoc, []), weighIns: createMemoryWeighIns(), bundled, now: Date.UTC(2026, 10, 9, 12) }
  const load = progressLoader()
  const first = await load(stores)
  await stores.weighIns.put({ d: '2026-11-09', op: 'set', w: 180.4, t: 9 })
  const second = await load(stores)
  expect(second.state).toBe(first.state)
  expect(second.bodyweight).not.toEqual(first.bodyweight)
  expect(second.bodyweight.at(-1)).toMatchObject({ d: '2026-11-09', w: 180.4 })
  await stores.finished.put({ id: 'p1', d: '2026-11-08', start: 2, entries: [] })
  expect((await load(stores)).state).not.toBe(first.state)
})

test('a pending routine edit reaches the state, and moves its key', async () => {
  const doc = { ...copyDoc, state: { ...copyDoc.state, routines: [{ id: 'r', name: 'R', ex: [] }] } }
  const edits = createMemoryPendingEdits()
  const stores = { finished: createMemoryFinishedWorkouts(), serverCopy: counted(doc, []), weighIns: createMemoryWeighIns(), edits, bundled, now: Date.UTC(2026, 10, 9, 12) }
  const load = progressLoader()
  const first = await load(stores)
  await edits.put({ kind: 'routine', key: 'r', baseTs: null, value: { id: 'r', name: 'Mine', ex: [] }, t: 5 })
  const second = await load(stores)
  expect(first.state.routines[0].name).toBe('R')
  expect(second.state.routines[0].name).toBe('Mine')
})
