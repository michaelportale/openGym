import { expect, test } from 'vitest'
import { motionDuration } from './motion.js'

test('reduced motion removes every duration', () => {
  expect(motionDuration('press', true)).toBe(0)
  expect(motionDuration('progress', true)).toBe(0)
})
test('normal motion keeps press feedback quicker than progress', () => {
  expect(motionDuration('press', false)).toBeGreaterThan(0)
  expect(motionDuration('progress', false)).toBeGreaterThan(motionDuration('press', false))
})
test('an unknown motion name throws rather than animating nothing', () => {
  expect(() => motionDuration('typo', false)).toThrow('typo')
})
test('inherited object names throw rather than returning inherited values', () => {
  expect(() => motionDuration('constructor', false)).toThrow('constructor')
  expect(() => motionDuration('toString', false)).toThrow('toString')
})
