import { expect, test } from 'vitest'
import { history, onerm, progression } from '../shared/training.js'
import { WARMUP_EXCLUDED_FROM, isWarmupSet, setsFor, warmupExclusionWhy } from './warmup.js'

const heavyWarmup = { w: 200, r: 10, done: true, phase: 'warmup' }
const work = { w: 100, r: 5, done: true }
const entry = {
  id: '0025',
  sets: [heavyWarmup, work],
  target: { sets: 1, reps: 5, weight: 100 }
}

test('a warm-up is the shared phase, including the legacy flag and the written aliases', () => {
  expect(isWarmupSet(heavyWarmup)).toBe(true)
  expect(isWarmupSet({ w: 40, r: 6, phase: 'warm-up' })).toBe(true)
  expect(isWarmupSet({ w: 40, r: 6, phase: 'warm_up' })).toBe(true)
  expect(isWarmupSet({ w: 40, r: 6, phase: ' Warmup ' })).toBe(true)
  expect(isWarmupSet({ w: 40, r: 6, warmup: true })).toBe(true)
  // An explicit work phase wins over the legacy flag, matching workout-model.
  expect(isWarmupSet({ w: 100, r: 5, phase: 'work', warmup: true })).toBe(false)
  expect(isWarmupSet(work)).toBe(false)
  expect(isWarmupSet(null)).toBe(false)
})

test('warm-up sets are left out of progression, PRs, e1RM, and volume', () => {
  expect([...WARMUP_EXCLUDED_FROM].sort()).toEqual(['e1rm', 'progression', 'prs', 'volume'])
  for (const metric of WARMUP_EXCLUDED_FROM) {
    expect(setsFor(metric, entry.sets)).toEqual([work])
  }
  expect(setsFor('volume', null)).toEqual([])
  expect(() => setsFor('history', entry.sets)).toThrow(/history/)
})

test('the exclusion can explain itself from the warm-up accounting rule', () => {
  const why = warmupExclusionWhy()
  expect(why.ruleId).toBe('warmup-accounting')
  expect(why.source).toBe('Definition')
  expect(why.reason.toLowerCase()).toContain('volume')
})

test('a heavy warm-up does not move volume, the best set, e1RM, or the progression read', () => {
  const workout = { entries: [entry] }
  const workOnly = { entries: [{ ...entry, sets: [work] }] }
  expect(history.workoutVolume(workout)).toBe(500)
  expect(history.workoutVolume(workout)).toBe(history.workoutVolume(workOnly))
  expect(history.bestWeightForEntry(entry)).toBe(100)
  expect(history.bestWeightForEntry({ ...entry, sets: [heavyWarmup] })).toBe(0)

  const best = onerm.bestSetOf(entry)
  expect(best).toEqual({ est: onerm.estimate1RM(100, 5), w: 100, r: 5 })
  expect(onerm.bestSetOf({ ...entry, sets: [heavyWarmup] })).toBeNull()

  const judged = progression.readSession(entry)
  expect(judged.weight).toBe(100)
  expect(judged.reps).toEqual([5])
  expect(judged).toEqual(progression.readSession({ ...entry, sets: [work] }))

  const warmupOnly = {
    ...entry,
    sets: [heavyWarmup, { w: 100, r: 5, done: false }]
  }
  expect(progression.readSession(warmupOnly).weight).toBe(0)
  expect(history.workoutVolume({ entries: [warmupOnly] })).toBe(0)
})
