import { expect, test } from 'vitest'
import { nextRoutineId } from './next-up.js'

const since = Date.parse('2026-10-22T00:00:00Z')
const now = Date.parse('2026-11-09T12:00:00Z')

const fixture = workouts => ({
  // c first, so the no-queue fallback (routines[0]) cannot pass for the refill case
  routines: [{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  rotation: { id: 'rot', sequence: ['a', 'b', 'c'] },
  queue: { ids: ['a', 'b', 'c'], since, startsOn: '2026-10-22', rotationId: 'rot' },
  workouts,
})
const done = (id, extra = {}) => ({ id: `w-${id}`, routineIds: [id], start: since + 1, d: '2026-11-09', ...extra })

test('no workouts gives the first', () => {
  expect(nextRoutineId(fixture([]), '2026-11-09', now)).toBe('a')
})

test('a historical import does not count', () => {
  expect(nextRoutineId(fixture([done('a', { historicalImport: true })]), '2026-11-09', now)).toBe('a')
})

test('a phone workout of a moves to b', () => {
  expect(nextRoutineId(fixture([done('a')]), '2026-11-09', now)).toBe('b')
})

test('a full pass refills and starts over', () => {
  expect(nextRoutineId(fixture([done('a'), done('b'), done('c')]), '2026-11-09', now)).toBe('a')
})

test('does not mutate the state', () => {
  const state = fixture([done('a'), done('b'), done('c')])
  const before = JSON.stringify(state)
  nextRoutineId(state, '2026-11-09', now)
  expect(JSON.stringify(state)).toBe(before)
})

test('without a queue it gives the first routine, or null with none', () => {
  expect(nextRoutineId({ routines: [{ id: 'x' }], workouts: [] }, '2026-11-09', now)).toBe('x')
  expect(nextRoutineId({ routines: [], workouts: [] }, '2026-11-09', now)).toBeNull()
})
