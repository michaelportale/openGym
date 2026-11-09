import { expect, test } from 'vitest'
import { accessibilityFlagDefault, flagMemory } from './accessibility-flag.js'

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

test('a later mount starts from the value a read already resolved to', () => {
  const memory = flagMemory()
  // Nothing read yet in this run of the app: the safe default above.
  expect(memory.start(info, 'reduceMotion')).toBe(true)
  memory.remember('reduceMotion', false)
  expect(memory.start(info, 'reduceMotion')).toBe(false)
  memory.remember('reduceMotion', true)
  expect(memory.start(info, 'reduceMotion')).toBe(true)
})

test('each flag is remembered on its own, as a boolean', () => {
  const memory = flagMemory()
  memory.remember('reduceTransparency', 1)
  expect(memory.start(info, 'reduceTransparency')).toBe(true)
  expect(memory.start(info, 'reduceMotion')).toBe(true)
  memory.remember('reduceMotion', undefined)
  expect(memory.start(info, 'reduceMotion')).toBe(false)
})

test('remembering an unknown flag throws', () => {
  expect(() => flagMemory().remember('boldText', true)).toThrow('boldText')
})
