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
  const copy = { state, rev: 41, wid: 'wid-a', pulledAt: 't' }
  const pending = [pend('p1', { importedFrom: 'x' }), pend('p2')]
  const push = buildPush(copy, pending)
  expect(push.state).toEqual({ ...fixture(), workouts: [...fixture().workouts, pending[0], pending[1]] })
  expect(push.baseRev).toBe(copy.rev)
  expect(push.baseWid).toBe(copy.wid)
  expect(push.added).toEqual(['p1', 'p2'])
  expect(state).toEqual(fixture()) // input not mutated
})

test('a pending id the copy already holds is skipped, and nothing to add is null', () => {
  const copy = { state: fixture(), rev: 1, wid: 'w', pulledAt: 't' }
  const push = buildPush(copy, [pend('w1'), pend('p1')])
  expect(push.added).toEqual(['p1'])
  expect(push.state.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'p1'])
  expect(push.state.workouts[0]).toEqual(fixture().workouts[0])
  expect(buildPush(copy, [pend('w1'), pend('w2')])).toBeNull()
  expect(buildPush(copy, [])).toBeNull()
})

test('a copy with no workouts array is treated as empty', () => {
  const copy = { state: { unit: 'lb' }, rev: 0, wid: 'w', pulledAt: 't' }
  expect(buildPush(copy, [pend('p1')]).state).toEqual({ unit: 'lb', workouts: [pend('p1')] })
})
