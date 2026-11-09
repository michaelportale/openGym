import { expect, test } from 'vitest'
import { fadesIn } from './fade-in.js'

test('first mount does not fade: the key is where it started', () => {
  expect(fadesIn(0, 0)).toBe(false)
  expect(fadesIn(false, false)).toBe(false)
})
test('an undefined key never fades: the screen is not ready yet', () => {
  expect(fadesIn(undefined, undefined)).toBe(false)
  expect(fadesIn(2, undefined)).toBe(false)
})
test('the first defined key after not ready does not fade (opening the screen)', () => {
  expect(fadesIn(undefined, 0)).toBe(false)
})
test('a defined key that changes fades', () => {
  expect(fadesIn(0, 1)).toBe(true)
  expect(fadesIn(false, true)).toBe(true)
  expect(fadesIn(true, false)).toBe(true)
})
test('a key that stays the same does not fade again', () => {
  expect(fadesIn(1, 1)).toBe(false)
})
