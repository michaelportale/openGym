import { expect, test } from 'vitest'
import { sessionState } from './history-state.js'
import { history } from '../shared/training.js'

const snapshot = {
  version: 1,
  example: true,
  names: {},
  state: {
    routines: [{ id: 'push-a' }],
    workouts: [
      { id: 'b', d: '2026-10-16', start: 5 },
      { id: 'a', d: '2026-10-12', start: 1 },
      { id: 'c', d: '2026-10-16', start: 2 },
    ],
  },
}

test('merges by id with the phone copy winning, sorted by d then start', () => {
  const phone = [{ id: 'a', d: '2026-10-12', start: 1, name: 'phone' }, { id: 'n', d: '2026-11-09', start: 0 }]
  const state = sessionState(snapshot, phone)
  expect(state.workouts.map(w => w.id)).toEqual(['a', 'c', 'b', 'n'])
  expect(state.workouts[0].name).toBe('phone')
  expect(state.routines).toEqual([{ id: 'push-a' }])
})
test('does not mutate the snapshot', () => {
  sessionState(snapshot, [{ id: 'z', d: '2026-11-09' }])
  expect(snapshot.state.workouts).toHaveLength(3)
})
test('tolerates a missing phone list and missing workouts', () => {
  expect(sessionState({ state: {} }, undefined).workouts).toEqual([])
})

test('workouts without an id each keep their place', () => {
  const state = sessionState({ state: { workouts: [{ d: '2026-10-01', start: 1 }, { d: '2026-10-02', start: 1 }, { d: '2026-10-02', start: 2 }] } }, [])
  expect(state.workouts).toHaveLength(3)
})
test('same id on the server and the phone: the phone copy wins', () => {
  const state = sessionState({ state: { workouts: [{ id: 'x', d: '2026-10-01', name: 'server' }] } }, [{ id: 'x', d: '2026-10-01', name: 'phone' }])
  expect(state.workouts).toHaveLength(1)
  expect(state.workouts[0].name).toBe('phone')
})
test('Best sees the heavier of two id-less workouts', () => {
  const wk = (d, w) => ({ d, start: 1, entries: [{ id: '0025', sets: [{ w, r: 5, done: true }] }] })
  const state = sessionState({ state: { workouts: [wk('2026-10-01', 225), wk('2026-10-08', 185)] } }, [])
  expect(history.bestWeightFor(state, '0025')).toBe(225)
})
