import { expect, test } from 'vitest'
import { exercises, history } from '../shared/training.js'
import { buildSessionBase } from './start-session.js'

const now = Date.parse('2026-11-09T23:30:00-05:00')
const timeZone = 'America/New_York'
const row = (w, r) => ({ w, r, done: true })

const routine = {
  id: 'r1',
  name: 'Push A',
  ex: [
    { id: 'bench', sets: 3, reps: 10 },
    { id: 'lateral', sets: 2, reps: 12, side: true },
  ],
}
const state = {
  routines: [routine],
  workouts: [{
    id: 'old', d: '2026-11-01', routineIds: ['r1'],
    entries: [{ id: 'bench', sets: [row(70, 10), row(75, 10)] }],
  }],
}

test('builds the base document', () => {
  const base = buildSessionBase({ state, routine, now, timeZone, id: 's1' })
  expect(base).toMatchObject({ id: 's1', d: '2026-11-09', start: now, name: 'Push A', routineIds: ['r1'] })
  expect(base.entries.map(e => e.id)).toEqual(['bench', 'lateral'])
  expect(base.entries.every(e => e.rid === 'r1')).toBe(true)
})

test('opening weights are applied', () => {
  const base = buildSessionBase({ state, routine, now, timeZone, id: 's1' })
  expect(base.entries[0].sets.map(s => s.w)).toEqual([75, 75, 75])
})

test('a side exercise builds rows with both sides and no warm-ups', () => {
  const base = buildSessionBase({ state, routine, now, timeZone, id: 's1' })
  const sets = base.entries[1].sets
  expect(sets).toHaveLength(2)
  for (const s of sets) {
    expect(Object.keys(s.sides)).toEqual(['L', 'R'])
    expect(s.sides.L.done).toBeFalsy()
  }
  expect(base.entries.flatMap(e => e.sets).some(s => s.phase === 'warmup')).toBe(false)
})

test('does not mutate state or routine, and makes an id when none is given', () => {
  const before = JSON.stringify({ state, routine })
  const base = buildSessionBase({ state, routine, now, timeZone })
  expect(JSON.stringify({ state, routine })).toBe(before)
  expect(typeof base.id).toBe('string')
  expect(base.id).not.toBe('')
})

// Without the custom in EXIDX, modeOf falls through to reps and the session opens as a lift.
test('a custom cardio slot opens in cardio mode', () => {
  const custom = { id: 'c-cardio-sess', n: 'Run', bp: 'cardio', eq: 'body weight', custom: true }
  const cardioRoutine = { id: 'r-cardio', name: 'Run', ex: [{ id: 'c-cardio-sess', sets: 3 }] }
  const cardioState = { customEx: [custom], routines: [cardioRoutine], workouts: [] }
  try {
    const base = buildSessionBase({ state: cardioState, routine: cardioRoutine, now, timeZone, id: 's-cardio' })
    expect(history.modeOf(base.entries[0])).toBe('cardio')
    // min/speed are chosen while the entry is built. modeOf alone would pass if registration ran after.
    expect(base.entries[0].sets.map(s => [s.min, s.speed])).toEqual([[20, 8], [20, 8], [20, 8]])
  } finally {
    exercises.registerCustom([])
  }
})
