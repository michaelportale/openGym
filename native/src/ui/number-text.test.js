import { describe, expect, test } from 'vitest'
import { num, numberText, parseNumberText } from './number-text.js'

// The web's NumberField commit (frontend/src/components/ui.jsx NumberField, nullable), which every
// nutrition and measurement field on the web goes through.
describe('parseNumberText (ui.jsx NumberField commit, nullable)', () => {
  test('empty, missing or no digits reads as no value', () => {
    for (const text of ['', null, undefined, '.', 'abc', ' ']) expect(parseNumberText(text)).toBeNull()
  })

  test('a number reads as typed; a comma is the decimal point', () => {
    expect(parseNumberText('2500')).toBe(2500)
    expect(parseNumberText('150.5')).toBe(150.5)
    expect(parseNumberText('2,5')).toBe(2.5)
    expect(parseNumberText('.5')).toBe(0.5)
    expect(parseNumberText('0')).toBe(0)
  })

  test('only the first point counts and other characters drop out, as the web strips them', () => {
    expect(parseNumberText('2.5.1')).toBe(2.51)
    expect(parseNumberText('-5')).toBe(5)
    expect(parseNumberText(' 32 in')).toBe(32)
  })

  test('a whole-number field counts only the part before a point', () => {
    expect(parseNumberText('2500.7', { decimal: false })).toBe(2500)
    expect(parseNumberText('8,5', { decimal: false })).toBe(8)
    expect(parseNumberText('.5', { decimal: false })).toBeNull()
  })
})

describe('numberText', () => {
  test('a number as the field shows it, nothing for no value', () => {
    expect(numberText(2500)).toBe('2500')
    expect(numberText(32.5)).toBe('32.5')
    expect(numberText(0)).toBe('0')
    expect(numberText(null)).toBe('')
    expect(numberText(undefined)).toBe('')
    expect(numberText(NaN)).toBe('')
  })
})

// The web's fmtNum (format.js), in English: what every nutrition and measurement value reads as.
describe('num', () => {
  test('one decimal at most, no stray zeros, thousands separators, a plain minus', () => {
    expect(num(2500)).toBe('2,500')
    expect(num(150.5)).toBe('150.5')
    expect(num(150.04)).toBe('150')
    expect(num(1234.56)).toBe('1,234.6')
    expect(num(-0.47)).toBe('-0.5')
  })
})
