import { expect, test } from 'vitest'
import { progressWidth } from './progress.js'

test.each([[0.5, '50%'], [0, '0%'], [1, '100%'], [-0.2, '0%'], [1.4, '100%'], [NaN, '0%'], [undefined, '0%'], [Infinity, '0%']])(
  'progress %s draws as %s', (value, width) => { expect(progressWidth(value)).toBe(width) })
test('floating point noise never reaches the style', () => {
  expect(progressWidth(0.55)).toBe('55%')
})
