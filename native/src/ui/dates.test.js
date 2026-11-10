import { describe, it, expect } from 'vitest'
import { addDays, dayLabel, isoDay, sheetDate, shortDate, stepDay, todayIso } from './dates.js'

describe('isoDay', () => {
  it("is the local calendar day of a time, zero-padded", () => {
    expect(isoDay(new Date(2026, 10, 9, 0, 1).getTime())).toBe('2026-11-09')
    expect(isoDay(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02')
  })
})

describe('todayIso', () => {
  it("is the day on this phone of the time given, or of now", () => {
    expect(todayIso(new Date(2026, 10, 9, 12).getTime())).toBe('2026-11-09')
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("stepDay (a day sheet's date: today or earlier)", () => {
  it('steps back any day, forward up to today and not past it', () => {
    const TODAY = '2026-11-09'
    expect(stepDay(TODAY, -1, TODAY)).toBe('2026-11-08')
    expect(stepDay('2026-11-08', 1, TODAY)).toBe(TODAY)
    expect(stepDay(TODAY, 1, TODAY)).toBeNull()
    expect(stepDay('bad', -1, TODAY)).toBeNull()
  })
})

describe('sheetDate', () => {
  it("is the full date, marked when it is today", () => {
    expect(sheetDate('2026-11-09', '2026-11-09')).toBe('Today, Nov 9, 2026')
    expect(sheetDate('2026-11-08', '2026-11-09')).toBe('Nov 8, 2026')
  })
})

describe('addDays', () => {
  it('steps across months and years', () => {
    expect(addDays('2026-11-09', -1)).toBe('2026-11-08')
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-11-09', -7)).toBe('2026-11-02')
    expect(addDays('2026-11-09', 0)).toBe('2026-11-09')
  })
  it('steps over a daylight-saving change by whole days', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })
  it('gives null for what is not a date', () => {
    expect(addDays('', 1)).toBeNull()
    expect(addDays(null, 1)).toBeNull()
    expect(addDays('2026-02-30', 1)).toBeNull()
  })
})

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
