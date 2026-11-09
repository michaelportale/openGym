import { expect, test } from 'vitest'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { loadProgress } from './progress-source.js'

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
  const out = await loadProgress({ finished, serverCopy: counted(copyDoc, log), weighIns, bundled })
  expect(log).toEqual(['weigh-ins', 'copy'])
  expect(out.state.workouts.map(w => w.id)).toEqual(['c1', 'p1'])
  expect(out.state.targetW).toBe(175)
  expect(out.bodyweight.map(e => [e.d, e.w])).toEqual([['2026-11-07', 181], ['2026-11-09', 180.4]])
})

test('unpaired: the snapshot stands in for the copy, for workouts and weigh-ins', async () => {
  const log = []
  const out = await loadProgress({ finished: createMemoryFinishedWorkouts(), serverCopy: counted(null, log), weighIns: createMemoryWeighIns(), bundled })
  expect(log).toEqual(['copy'])
  expect(out.bodyweight).toEqual(bundled.state.bodyweight)
  expect(out.state.workouts).toEqual([])
})
