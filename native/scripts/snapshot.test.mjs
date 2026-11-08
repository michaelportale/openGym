import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertSameSessions, toSnapshot } from './snapshot.mjs'

const catalogue = [{ id: '0025', n: 'barbell bench press', bp: 'chest', eq: 'barbell' }]

const state = () => ({
  unit: 'lb',
  restSec: 90,
  routines: [{
    id: 'r1',
    name: 'Push A',
    ex: [
      { id: '0025', sets: 3, reps: 8, weight: 0, prog: 'off' },
      { id: 'custom-1', sets: 2, reps: 12, weight: 0, prog: 'off', side: true }
    ]
  }],
  customEx: [{ id: 'custom-1', n: 'Split squat', eq: 'body weight', tg: 'quads' }],
  workouts: [],
  body: [{ d: '2026-01-01', w: 180 }],
  measurements: [{ d: '2026-01-01' }],
  dayNotes: { '2026-01-01': 'private' },
  reminder: { on: true },
  targetW: 170
})

test('keeps only allowlisted keys', () => {
  const { state: kept } = toSnapshot(state(), catalogue)
  for (const k of ['body', 'measurements', 'dayNotes', 'reminder', 'targetW']) expect(kept).not.toHaveProperty(k)
  expect(kept.routines).toHaveLength(1)
})

test('names built-in and custom exercises', () => {
  const { names, version, example } = toSnapshot(state(), catalogue)
  expect(version).toBe(1)
  expect(example).toBe(false)
  expect(names['0025']).toEqual({ name: 'Barbell bench press', category: 'Chest · Barbell' })
  expect(names['custom-1']).toEqual({ name: 'Split squat', category: 'Quads · Body weight' })
})

test('refuses a kilogram profile', () => {
  expect(() => toSnapshot({ ...state(), unit: 'kg' }, catalogue)).toThrow(/pound/)
})

test('refuses an exercise with no name', () => {
  const s = state()
  s.routines[0].ex.push({ id: 'ghost', sets: 1, reps: 1, weight: 0, prog: 'off' })
  expect(() => toSnapshot(s, catalogue)).toThrow(/no name/)
})

test('refuses a state with no routines', () => {
  expect(() => toSnapshot({ ...state(), routines: [] }, catalogue)).toThrow(/routines/)
})

test('assertSameSessions catches a dropped key', () => {
  // Default progression reads history, so a snapshot without workouts builds different sets
  const s = state()
  s.routines[0].ex = [{ id: '0025', sets: 3, reps: 8, weight: 100 }]
  s.workouts = [{
    d: '2026-01-01',
    routineIds: ['r1'],
    entries: [{ id: '0025', target: { sets: 3, reps: 8, weight: 100 }, sets: [8, 8, 8].map(r => ({ w: 135, r, done: true })) }]
  }]
  const snap = toSnapshot(s, catalogue)
  expect(() => assertSameSessions(s, snap)).not.toThrow()
  const { workouts, ...rest } = snap.state
  expect(() => assertSameSessions(s, { ...snap, state: rest })).toThrow(/differently/)
})

test('the example snapshot is marked and names every routine exercise', () => {
  const ex = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/snapshot.example.json', import.meta.url)), 'utf8'))
  expect(ex.example).toBe(true)
  for (const r of ex.state.routines) for (const e of r.ex) expect(ex.names[e.id]?.name).toBeTruthy()
})
