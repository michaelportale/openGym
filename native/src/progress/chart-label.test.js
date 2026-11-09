import { expect, test } from 'vitest'
import { chartLabel, RANGES } from './chart-label.js'

test('the label names the range and the average', () => {
  expect(chartLabel(90, '7-day average 182.4 lb')).toBe('Body weight, last 90 days: 7-day average 182.4 lb')
  expect(chartLabel(0, null)).toBe('Body weight, all time')
})

test('the chips are 1M, 3M, 1Y and All', () => {
  expect(RANGES.map(r => [r.label, r.days])).toEqual([['1M', 30], ['3M', 90], ['1Y', 365], ['All', 0]])
})
