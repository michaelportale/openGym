import { describe, it, expect } from 'vitest'
import { shortDate } from './dates.js'

describe('shortDate', () => {
  it('formats with and without the year', () => {
    expect(shortDate('2026-11-09')).toBe('Nov 9, 2026')
    expect(shortDate('2026-11-09', { year: false })).toBe('Nov 9')
  })
  it('passes through what it cannot read', () => {
    expect(shortDate('')).toBe('')
    expect(shortDate(null)).toBe('')
    expect(shortDate('soon')).toBe('soon')
  })
})
