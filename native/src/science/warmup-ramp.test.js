import { expect, test } from 'vitest'
import { history } from '../shared/training.js'
import { isWarmupSet, setsFor } from './warmup.js'
import { WARMUP_PERCENTS, WARMUP_REPS, warmupRamp, warmupRampWhy } from './warmup-ramp.js'

test('two sets of 6 at 40% and 80%, rounded down to the step and never under the bar', () => {
  expect(WARMUP_PERCENTS).toEqual([0.4, 0.8])
  expect(WARMUP_REPS).toBe(6)
  const sets = warmupRamp({ working: 100, step: 2.5, floor: 20 })
  expect(sets.map(s => s.w)).toEqual([40, 80])
  expect(sets.every(s => s.r === 6 && s.done === false && isWarmupSet(s))).toBe(true)
  expect(setsFor('volume', sets)).toEqual([])
})

test('an 80 lb dumbbell work weight on a 5 lb step is about 30 and 60', () => {
  expect(warmupRamp({ working: 80, step: 5 }).map(s => s.w)).toEqual([30, 60])
})

test('a percentage under the bar is raised to the bar and nothing exceeds the work weight', () => {
  expect(warmupRamp({ working: 40, step: 2.5, floor: 20 }).map(s => s.w)).toEqual([20, 30])
  expect(warmupRamp({ working: 50, step: 5, floor: 45 }).map(s => s.w)).toEqual([45, 45])
  expect(warmupRamp({ working: 30, step: 5, floor: 45 }).map(s => s.w)).toEqual([30, 30])
})

test('owned bells round down to a bell you have', () => {
  expect(warmupRamp({ working: 80, owned: [10, 15, 25, 30, 35, 40, 50, 55] }).map(s => s.w)).toEqual([30, 55])
})

test('there is no ramp without a working weight', () => {
  expect(warmupRamp({ working: 0, step: 2.5 })).toEqual([])
  expect(warmupRamp({ working: null, step: 2.5 })).toEqual([])
})

test('the ramp can use the shared bar floor', () => {
  const barbell = history.barFloor({ unit: 'kg' }, '0025')
  expect(barbell).toBeGreaterThan(0)
  const sets = warmupRamp({ working: 40, step: 2.5, floor: barbell, id: '0025' })
  expect(sets[0].w).toBeGreaterThanOrEqual(barbell)
  expect(sets.every(s => s.w <= 40)).toBe(true)
})

test('the ramp explains itself from the warm-up loads rule', () => {
  const why = warmupRampWhy()
  expect(why.ruleId).toBe('warmup-loads')
  expect(why.source).toContain('https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/')
  expect(why.reason).toContain('40%')
})
