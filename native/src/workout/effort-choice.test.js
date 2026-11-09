import { describe, expect, test } from 'vitest'
import { validateRir } from '../science/effort.js'
import { RIR_CHOICES, rirChipHint, effortShown, isRirSelected, rirChipLabel, rirChipText, rirFields, toggleRir, withRir } from './effort-choice.js'

describe('the choices', () => {
  test('0 to 5, with 5 shown as 5+', () => {
    expect(RIR_CHOICES).toEqual([0, 1, 2, 3, 4, 5])
    expect(RIR_CHOICES.map(rirChipText)).toEqual(['0', '1', '2', '3', '4', '5+'])
  })
  test('each chip is spoken in words', () => {
    expect(rirChipLabel(3)).toBe('3 reps left')
    expect(rirChipLabel(1)).toBe('1 rep left')
    expect(rirChipLabel(0)).toBe('0 reps left')
    expect(rirChipLabel(5)).toBe('5 or more reps left')
  })
})

describe('toggleRir', () => {
  test('picking selects, picking the selected one again clears', () => {
    expect(toggleRir(null, 3)).toBe(3)
    expect(toggleRir(3, 3)).toBeNull()
    expect(toggleRir(3, 1)).toBe(1)
    expect(toggleRir(0, 0)).toBeNull()
  })
  test('a logged 7 (set on the web) shows 5+ selected; tapping 5+ clears it', () => {
    expect(isRirSelected(7, 5)).toBe(true)
    expect(isRirSelected(7, 4)).toBe(false)
    expect(isRirSelected(4, 5)).toBe(false)
    expect(isRirSelected(null, 0)).toBe(false)
    expect(toggleRir(7, 5)).toBeNull()
  })
})

describe('where the row shows', () => {
  test('work sets: the current set and a done one', () => {
    expect(effortShown({ mode: 'current', warmup: false, perSide: false, side: null })).toBe(true)
    expect(effortShown({ mode: 'done', warmup: false, perSide: true, side: null })).toBe(true)
  })
  test('never on a warm-up, nor a set that is not current', () => {
    expect(effortShown({ mode: 'current', warmup: true, perSide: false, side: null })).toBe(false)
    expect(effortShown({ mode: 'done', warmup: true, perSide: false, side: null })).toBe(false)
    expect(effortShown({ mode: 'pending', warmup: false, perSide: false, side: null })).toBe(false)
  })
  test('per side: not for the first side, yes for the second', () => {
    expect(effortShown({ mode: 'current', warmup: false, perSide: true, side: 'L' })).toBe(false)
    expect(effortShown({ mode: 'current', warmup: false, perSide: true, side: 'R' })).toBe(true)
  })
})

describe('rirFields', () => {
  const row = { w: 75, r: 8, done: false }
  test('blank (not touched) writes nothing', () => {
    expect(rirFields(row, undefined)).toEqual({ ok: true, fields: {} })
    expect(rirFields(row, null)).toEqual({ ok: true, fields: {} })
  })
  test('a chosen value is written, 0 included', () => {
    expect(rirFields(row, 3)).toEqual({ ok: true, fields: { rir: 3 } })
    expect(rirFields(row, 0)).toEqual({ ok: true, fields: { rir: 0 } })
  })
  test('a clear removes a logged value, and only when there is one', () => {
    expect(rirFields({ ...row, rir: 2 }, null, { clear: true })).toEqual({ ok: true, fields: { rir: null } })
    expect(rirFields(row, null, { clear: true })).toEqual({ ok: true, fields: {} })
    expect(rirFields({ ...row, rir: 2 }, undefined, { clear: true })).toEqual({ ok: true, fields: {} })
  })
  test('a warm-up never gets one', () => {
    expect(rirFields({ ...row, phase: 'warmup', warmup: true }, 3)).toEqual({ ok: true, fields: {} })
    expect(rirFields({ ...row, phase: 'warmup', warmup: true, rir: 2 }, null, { clear: true })).toEqual({ ok: true, fields: {} })
  })
  test('an invalid value is refused with the validator\'s sentence', () => {
    const sentence = validateRir(11).error
    for (const bad of [11, -1, 2.5, 'x']) {
      expect(rirFields(row, bad)).toEqual({ ok: false, error: sentence })
    }
  })
})

describe('what reaches the gate', () => {
  test('withRir adds the choice only when touched; keypad values are not mutated', () => {
    const values = { w: 75, r: 8 }
    expect(withRir(values, undefined)).toBe(values)
    expect(withRir(values, 3)).toEqual({ w: 75, r: 8, rir: 3 })
    expect(withRir(values, null)).toEqual({ w: 75, r: 8, rir: null })
    expect(values).toEqual({ w: 75, r: 8 })
  })
})

describe('the chip hints', () => {
  test('a plain chip is optional; the selected one clears', () => {
    expect(rirChipHint(2, 3)).toBe('Optional. Saved with this set.')
    expect(rirChipHint(3, 3)).toBe('Tap again to clear.')
  })
  test('5+ over a logged 8 says so and that tapping clears it', () => {
    expect(rirChipHint(8, 5)).toBe('Logged as 8. Tap to clear.')
    expect(rirChipHint(5, 5)).toBe('Tap again to clear.')
    expect(rirChipHint(8, 4)).toBe('Optional. Saved with this set.')
  })
})
