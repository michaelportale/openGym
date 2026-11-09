// A workout the phone pushed (native toWorkoutPayload shape: UUID id, a warm-up row, rir, a per-side
// set), read through the MCP tools. The fixture is generated and verified by
// native/src/session/phone-fixture.test.js; importing native code here would pull in React Native.
import { test, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'
import { estimate1RM as epley } from '../../frontend/src/lib/onerm.js'

const workout = JSON.parse(readFileSync(new URL('./fixtures/phone-workout.json', import.meta.url), 'utf8'))
const call = (name, params = {}) => TOOLS.find(t => t.name === name).handler(params)
const BENCH = '0025'

beforeEach(() => _seedStateForTests({ unit: 'kg', routines: [], workouts: [workout], bw: [], week: {}, dayPlan: {} }))

test('list_workouts lists the phone workout with its date, name and volume', () => {
  const r = call('list_workouts', { to: '2026-12-31' })
  expect(r.workouts).toHaveLength(1)
  expect(r.workouts[0]).toMatchObject({ id: workout.id, date: '2026-11-07', routine_name: 'Phone Push', volume: 812.5, exercise_count: 2 })
})

test('get_workout finds it by its UUID', () => {
  expect(call('get_workout', { workout_id: workout.id }).routine_name).toBe('Phone Push')
})

test('estimate_1rm uses the heaviest work set, never the heavier-estimating warm-up', () => {
  const best = call('estimate_1rm', { exercise_id: BENCH }).best
  expect(best).toMatchObject({ w: 62.5, r: 5, date: '2026-11-07' })
  expect(best.est).toBeCloseTo(epley(62.5, 5), 1)
  expect(epley(65, 8)).toBeGreaterThan(best.est) // so the warm-up would have won had it counted
})

test('muscle_balance counts the work sets and not the warm-up', () => {
  const chest = r => r.worked.find(m => m.slug === 'chest')?.effective_sets
  const withWarmup = structuredClone(workout)
  withWarmup.entries[0].sets[0] = { ...withWarmup.entries[0].sets[0], phase: undefined, warmup: undefined } // as a work set
  const asWork = (_seedStateForTests({ unit: 'kg', routines: [], workouts: [withWarmup], bw: [], week: {}, dayPlan: {} }), chest(call('muscle_balance', { period: 'all' })))
  _seedStateForTests({ unit: 'kg', routines: [], workouts: [workout], bw: [], week: {}, dayPlan: {} })
  const actual = chest(call('muscle_balance', { period: 'all' }))
  expect(actual).toBeGreaterThan(0)
  expect(actual).toBeLessThan(asWork)
})
