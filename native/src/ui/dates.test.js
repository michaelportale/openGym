import { describe, it, expect } from 'vitest'
import { dayLabel, shortDate } from './dates.js'

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

describe('dayLabel', () => {
  const now = new Date(2026, 10, 9, 12).getTime()
  it('leaves the year off this year and puts it on any other', () => {
    expect(dayLabel('2026-11-09', now)).toBe('Nov 9')
    expect(dayLabel('2026-01-01', now)).toBe('Jan 1')
    expect(dayLabel('2025-11-09', now)).toBe('Nov 9, 2025')
    expect(dayLabel('2027-01-02', now)).toBe('Jan 2, 2027')
  })
  it('passes through what it cannot read', () => {
    expect(dayLabel('', now)).toBe('')
    expect(dayLabel(null, now)).toBe('')
    expect(dayLabel('soon', now)).toBe('soon')
  })
})
