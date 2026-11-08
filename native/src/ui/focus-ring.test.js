import { expect, test } from 'vitest'
import { color } from '../theme/tokens.js'
import { focusRingStyle } from './focus-ring.js'

test('web focus draws an accent ring and resting or native focus does not', () => {
  expect(focusRingStyle(true, 'web', color.accent)).toEqual({
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineColor: color.accent
  })
  expect(focusRingStyle(false, 'web', color.accent)).toBeNull()
  expect(focusRingStyle(true, 'ios', color.accent)).toBeNull()
})
