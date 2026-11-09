import { expect, test } from 'vitest'
import { canRemove, parseWeight, saveOp, todayLine } from './weigh-in-view.js'

test('parseWeight accepts dot or comma, trims, rounds to 0.1', () => {
  expect(parseWeight('182.4')).toBe(182.4)
  expect(parseWeight(' 182,35 ')).toBe(182.4)
  expect(parseWeight('180')).toBe(180)
  expect(parseWeight('1000')).toBe(1000)
  expect(parseWeight('0.1')).toBe(0.1)
})

test('parseWeight rejects empty, non-numeric, and out-of-range text', () => {
  for (const text of ['', '   ', 'abc', '0', '-1', '1000.01', '1,2,3', '12 lb', 'NaN', 'Infinity', '0.04', null, undefined]) {
    expect(parseWeight(text)).toBeNull()
  }
})

test('todayLine says the weight with one decimal, the source, or nothing', () => {
  expect(todayLine({ d: '2026-01-02', w: 182.4, t: 1 })).toBe('Today: 182.4 lb')
  expect(todayLine({ d: '2026-01-02', w: 180, t: 1 })).toBe('Today: 180.0 lb')
  expect(todayLine({ d: '2026-01-02', w: 182.4, t: 1, src: 'health' })).toBe('Today: 182.4 lb (from Apple Health)')
  expect(todayLine(null)).toBe('No weight logged today.')
  expect(todayLine(undefined)).toBe('No weight logged today.')
})

test('canRemove only for this phone\'s own typed set', () => {
  const entry = { d: '2026-01-02', w: 182.4, t: 10 }
  const row = { d: '2026-01-02', op: 'set', w: 182.4, t: 10 }
  expect(canRemove(entry, row)).toBe(true)
  expect(canRemove({ ...entry, src: 'health', hk: 'u' }, { ...row, src: 'health', hk: 'u' })).toBe(false)
  expect(canRemove({ ...entry, src: 'health' }, row)).toBe(false)
  expect(canRemove(entry, { ...row, src: 'health' })).toBe(false)
  expect(canRemove(entry, null)).toBe(false) // a web-typed entry: no row of ours
  expect(canRemove(entry, { ...row, t: 9 })).toBe(false) // the row is older than the entry
  expect(canRemove(entry, { ...row, op: 'remove' })).toBe(false)
  expect(canRemove(null, row)).toBe(false)
  // an acked row (the shape weighIns.get returns) whose entry is on the server copy stays removable
  expect(canRemove({ d: '2026-01-02', w: 182.4, t: 10 }, { d: '2026-01-02', op: 'set', w: 182.4, t: 10 })).toBe(true)
  expect(canRemove({ d: '2026-01-02', w: 180, t: 12 }, row)).toBe(false) // the server copy moved on
})

test('saveOp stamps now on a plain day', () => {
  expect(saveOp({ d: '2026-01-02', w: 182.44, now: 1000, entry: null, deleted: {} })).toEqual({ d: '2026-01-02', op: 'set', w: 182.4, t: 1000 })
})

test('saveOp goes past a typed entry with a larger t, but not a Health one', () => {
  const d = '2026-01-02'
  expect(saveOp({ d, w: 180, now: 1000, entry: { d, w: 181, t: 5000 }, deleted: {} }).t).toBe(5001)
  expect(saveOp({ d, w: 180, now: 1000, entry: { d, w: 181, t: 5000, src: 'health' }, deleted: {} }).t).toBe(1000)
})

test('saveOp goes past a deletion stamp, and takes the max of all three', () => {
  const d = '2026-01-02'
  expect(saveOp({ d, w: 180, now: 1000, entry: null, deleted: { [d]: 3000 } }).t).toBe(3001)
  expect(saveOp({ d, w: 180, now: 1000, entry: { d, w: 181, t: 5000 }, deleted: { [d]: 3000 } }).t).toBe(5001)
  expect(saveOp({ d, w: 180, now: 1000, entry: { d, w: 181, t: 2000 }, deleted: { [d]: 3000 } }).t).toBe(3001)
  expect(saveOp({ d, w: 180, now: 1000, entry: { d, w: 181, t: 'x' }, deleted: { [d]: 'y' } }).t).toBe(1000)
})
