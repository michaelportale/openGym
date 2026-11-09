import { expect, test } from 'vitest'
import { becameDone } from './done-transition.js'

test('a row that was open and is now done just became done', () => {
  expect(becameDone('current', 'done')).toBe(true)
  expect(becameDone('pending', 'done')).toBe(true)
})
test('a row already done on first sight does not pop', () => {
  expect(becameDone(undefined, 'done')).toBe(false)
})
test('a done row staying done, or one still open, does not pop', () => {
  expect(becameDone('done', 'done')).toBe(false)
  expect(becameDone('pending', 'current')).toBe(false)
})
test('undoing a set does not pop', () => {
  expect(becameDone('done', 'pending')).toBe(false)
})
