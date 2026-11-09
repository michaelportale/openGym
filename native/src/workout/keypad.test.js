import { expect, test } from 'vitest'
import { applyKey, completeBlocker, fieldText, keypadState, keypadValues, sheetCloseAction } from './keypad.js'

const press = (state, ...keys) => keys.reduce(applyKey, state)
const values = (state, ...keys) => keypadValues(press(state, ...keys))

test('typing replaces the value first', () => {
  expect(values(keypadState({ w: 75, r: 8 }), '8', '0').w).toBe(80)
})
test('back deletes a digit', () => {
  expect(values(keypadState({ w: 80, r: 8 }), 'back').w).toBe(8)
  expect(values(keypadState({ w: 80, r: 8 }), 'back', 'back').w).toBe(null)
})
test('a decimal is allowed once', () => {
  expect(values(keypadState({ w: 75, r: 8 }), '7', '.', '5', '.').w).toBe(7.5)
  expect(values(keypadState({ w: 75, r: 8 }), '.', '5').w).toBe(0.5)
})
test('chips step from the current value', () => {
  expect(values(keypadState({ w: 75, r: 8 }), 'chip:+5').w).toBe(80)
  expect(values(keypadState({ w: 75, r: 8 }), 'chip:-10').w).toBe(65)
  expect(values(keypadState({ w: 0, r: 8 }), 'chip:-5').w).toBe(0)
  expect(values(keypadState({ w: 75, r: 8 }), '8', 'chip:+10').w).toBe(18)
})
test('a blank weight starts empty', () => {
  const blank = keypadState({ w: null, r: 8 })
  expect(keypadValues(blank).w).toBe(null)
  expect(values(blank, '0').w).toBe(0)
  expect(values(blank, 'chip:+5').w).toBe(5)
})
test('field:r switches to reps and typing replaces reps', () => {
  const out = values(keypadState({ w: 75, r: 8 }), 'field:r', '1', '2')
  expect(out).toEqual({ w: 75, r: 12 })
})
test('switching fields keeps what was typed', () => {
  expect(values(keypadState({ w: 75, r: 8 }), '9', '0', 'field:r', 'field:w').w).toBe(90)
})
test('per-side reps are separate', () => {
  const state = keypadState({ w: 25, sides: { L: { r: 12 }, R: { r: 12 } } })
  const out = values(state, 'field:L.r', '2', '0', 'field:R.r', '1', '8')
  expect(out).toEqual({ w: 25, sides: { L: { r: 20 }, R: { r: 18 } } })
})
test('output values are numbers or null, never strings', () => {
  const out = values(keypadState({ w: null, r: null }), '7', '.', 'field:r', '5', '.')
  expect(out).toEqual({ w: 7, r: 5 })
})
test('digits stop at six characters', () => {
  expect(values(keypadState({ w: 1, r: 8 }), '1', '2', '3', '4', '5', '6', '7').w).toBe(123456)
})
test('a side field is ignored on a plain set', () => {
  expect(values(keypadState({ w: 75, r: 8 }), 'field:L.r', '3').w).toBe(3)
})
test('done flags are accepted and not echoed', () => {
  const state = keypadState({ w: 25, sides: { L: { r: 12, done: true }, R: { r: 12 } } })
  expect(keypadValues(state)).toEqual({ w: 25, sides: { L: { r: 12 }, R: { r: 12 } } })
})

test('sheetCloseAction: unchanged values give none', () => {
  const initial = keypadState({ w: 75, r: 8 })
  expect(sheetCloseAction(initial, press(initial, 'field:r'))).toBe('none')
  expect(sheetCloseAction(initial, press(initial, '7', '5'))).toBe('none')
})
test('sheetCloseAction: changed values give save', () => {
  const initial = keypadState({ w: 75, r: 8 })
  expect(sheetCloseAction(initial, press(initial, 'chip:+5'))).toBe('save')
  const sided = keypadState({ w: 25, sides: { L: { r: 12 }, R: { r: 12 } } })
  expect(sheetCloseAction(sided, press(sided, 'field:R.r', '9'))).toBe('save')
})

test('fieldText shows what is being typed, the value otherwise, and a dash when blank', () => {
  const state = keypadState({ w: null, r: 8 })
  expect(fieldText(state, 'w')).toBe('–')
  expect(fieldText(press(state, '7', '.'), 'w')).toBe('7.')
  expect(fieldText(press(state, '7', 'field:r'), 'w')).toBe('7')
  expect(fieldText(state, 'r')).toBe('8')
  const sided = keypadState({ w: 25, sides: { L: { r: 12 }, R: { r: null } } })
  expect(fieldText(sided, 'L.r')).toBe('12')
  expect(fieldText(sided, 'R.r')).toBe('–')
})

test('chips do not leave floating-point noise', () => {
  expect(values(keypadState({ w: 20.1, r: 8 }), 'chip:-5').w).toBe(15.1)
  expect(values(keypadState({ w: 5.1, r: 8 }), 'chip:-5').w).toBe(0.1)
})
test('the sheet can open on reps, and typing then replaces reps only', () => {
  const out = values(keypadState({ w: 75, r: 8 }, 'r'), '1', '0')
  expect(out).toEqual({ w: 75, r: 10 })
  const sided = keypadState({ w: 25, sides: { L: { r: 12 }, R: { r: 12 } } }, 'R.r')
  expect(values(sided, '9')).toEqual({ w: 25, sides: { L: { r: 12 }, R: { r: 9 } } })
})
test('a field that does not fit the set falls back to weight', () => {
  expect(values(keypadState({ w: 75, r: 8 }, 'L.r'), '3').w).toBe(3)
})
test('reps stay whole numbers', () => {
  expect(values(keypadState({ w: 75, r: 8 }), 'field:r', '8', '.', '5').r).toBe(85)
  const sided = keypadState({ w: 25, sides: { L: { r: 12 }, R: { r: 12 } } })
  expect(values(sided, 'field:L.r', '1', '.', '5').sides.L.r).toBe(15)
})

test('completeBlocker: Complete waits for a weight, then for the reps being logged', () => {
  expect(completeBlocker({ w: null, r: 8 }, null)).toBe('weight')
  expect(completeBlocker({ w: 75, r: null }, null)).toBe('reps')
  expect(completeBlocker({ w: 75, r: 8 }, null)).toBeNull()
  expect(completeBlocker({ w: 0, r: 0 }, null)).toBeNull()
})

test('completeBlocker: per side, only the side being completed needs reps', () => {
  const v = { w: 7.5, sides: { L: { r: 10 }, R: { r: null } } }
  expect(completeBlocker(v, 'L')).toBeNull()
  expect(completeBlocker(v, 'R')).toBe('reps')
  expect(completeBlocker({ w: null, sides: { L: { r: 10 }, R: { r: 10 } } }, 'L')).toBe('weight')
})
