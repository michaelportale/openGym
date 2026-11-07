import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { OPTIMAL_REP_RANGE, programRepRange, repRangeWhy } from './rep-range.js'

test('the program range is kept, and a missing range is not filled with 8-12', () => {
  expect(OPTIMAL_REP_RANGE).toBeNull()
  expect(programRepRange({ reps: 5, repsMin: 3 })).toEqual({ reps: 5, repsMin: 3 })
  expect(programRepRange({ reps: 12, repsMin: 8 })).toEqual({ reps: 12, repsMin: 8 })
  expect(programRepRange({})).toEqual({ reps: null, repsMin: null })
  expect(programRepRange({ reps: 0, repsMin: 0 })).toEqual({ reps: 0, repsMin: 0 })
  expect(programRepRange({ reps: 'lots', repsMin: '8-12' })).toEqual({ reps: null, repsMin: null })
})

test('the range explains itself from the rep-range rule', () => {
  const why = repRangeWhy()
  expect(why.ruleId).toBe('rep-ranges')
  expect(why.source).toContain('https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21')
  expect(why).not.toHaveProperty('population')
  const status = readFileSync(new URL('../../../docs/science/phase-4-status.md', import.meta.url), 'utf8')
  expect(status).toContain('programRepRange')
})
