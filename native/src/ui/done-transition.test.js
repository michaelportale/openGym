import { expect, test } from 'vitest'
import { poppedSetIds, statusBySetId } from './done-transition.js'

const row = (setId, status, extra) => ({ setId, status, ...extra })
const after = (before, rows) => poppedSetIds(statusBySetId(before), rows)

test('a current work set that becomes done pops', () => {
  expect([...after([row('a', 'current')], [row('a', 'done')])]).toEqual(['a'])
})
test('a current warm-up that becomes done pops', () => {
  expect([...after([row('w', 'current', { warmup: true })], [row('w', 'done', { warmup: true })])]).toEqual(['w'])
})
test('a pending set that becomes done pops', () => {
  expect([...after([row('a', 'pending')], [row('a', 'done')])]).toEqual(['a'])
})
test('a per-side set pops when its second side finishes, not its first', () => {
  const first = row('p', 'current', { perSide: true, sideDone: 'L' })
  expect(after([row('p', 'current', { perSide: true })], [first]).size).toBe(0)
  expect([...after([first], [row('p', 'done', { perSide: true })])]).toEqual(['p'])
})
test('first render and remount do not pop (empty map)', () => {
  expect(poppedSetIds(new Map(), [row('a', 'done')]).size).toBe(0)
  expect(poppedSetIds(undefined, [row('a', 'done')]).size).toBe(0)
})
test('an exercise change does not pop: its sets are new ids', () => {
  expect(after([row('a', 'current')], [row('b', 'done')]).size).toBe(0)
})
test('an undo does not pop', () => {
  expect(after([row('a', 'done')], [row('a', 'current')]).size).toBe(0)
})
test('a set that stays done does not pop again', () => {
  expect(after([row('a', 'done')], [row('a', 'done')]).size).toBe(0)
})
