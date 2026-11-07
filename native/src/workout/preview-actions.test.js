import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { previewWorkout } from './preview-data.js'
import { PREVIEW_HINT, PREVIEW_NOTICE, previewActionResult, upNextAccessibilityLabel } from './preview-actions.js'

const ids = ['completeSet', 'addSet', 'addRest', 'pauseRest']

test('the standing notice is a preview and not a saved workout', () => {
  expect(PREVIEW_NOTICE).toMatch(/Preview with sample data/)
  expect(PREVIEW_NOTICE).toMatch(/Nothing is logged, saved, or synced/)
  expect(PREVIEW_HINT).toBe('Preview only. Does not log, save, or sync.')
})

test('every preview action is unavailable and leaves the sample unchanged', () => {
  const before = JSON.stringify(previewWorkout)
  for (const id of ids) {
    const result = previewActionResult(id)
    expect(result.outcome).toBe('unavailable')
    expect(result.logged).toBe(false)
    expect(result.saved).toBe(false)
    expect(result.synced).toBe(false)
    expect(result.message).toMatch(/unavailable in this preview/)
    expect(result.message).toMatch(/Nothing was logged, saved, or synced/)
  }
  expect(JSON.stringify(previewWorkout)).toBe(before)
})

test('the sample is synthetic and has one current set', () => {
  expect(previewWorkout.routine).toBe('Push day')
  expect(previewWorkout.saved).toBeUndefined()
  expect(previewWorkout.synced).toBeUndefined()
  expect(previewWorkout.exercise.sets.filter(set => set.status === 'active')).toHaveLength(1)
})

test('an unknown preview action throws', () => {
  expect(() => previewActionResult('finish')).toThrow('finish')
  expect(() => previewActionResult('constructor')).toThrow('constructor')
})

test('up next is named and not offered as an action', () => {
  expect(upNextAccessibilityLabel('Incline dumbbell press')).toBe(
    'Up next, Incline dumbbell press. Not available in this preview.'
  )
  expect(() => upNextAccessibilityLabel('')).toThrow('Up next')
  expect(() => upNextAccessibilityLabel('   ')).toThrow('Up next')
})

test('the workout screen uses the preview result and does not claim a save', () => {
  const src = readFileSync(new URL('../app/(tabs)/workout.js', import.meta.url), 'utf8')
  expect(src).toContain('previewActionResult')
  expect(src).toContain('PREVIEW_NOTICE')
  expect(src).not.toMatch(/Workout saved|Synced to Health|set logged/i)
})
