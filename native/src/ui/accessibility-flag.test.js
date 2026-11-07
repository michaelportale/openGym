import { expect, test } from 'vitest'
import { accessibilityFlagDefault } from './accessibility-flag.js'

const info = {
  isReduceMotionEnabled() {
    return Promise.resolve(false)
  }
}

test('a platform that can answer starts reduced until it does', () => {
  expect(accessibilityFlagDefault(info, 'reduceMotion')).toBe(true)
})

test('a platform with no reader does not force the reduced treatment', () => {
  expect(accessibilityFlagDefault(info, 'reduceTransparency')).toBe(false)
  expect(accessibilityFlagDefault(null, 'reduceTransparency')).toBe(false)
  expect(accessibilityFlagDefault(undefined, 'reduceMotion')).toBe(false)
})

test('an unknown flag throws', () => {
  expect(() => accessibilityFlagDefault(info, 'boldText')).toThrow('boldText')
  expect(() => accessibilityFlagDefault(info, 'constructor')).toThrow('constructor')
})
