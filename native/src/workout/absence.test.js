import { describe, expect, it } from 'vitest'
import { closeSheetOnReturn, typedNumbersKept } from './absence.js'

const MIN = 60 * 1000

describe('closeSheetOnReturn', () => {
  it('stays open at 4:59 away', () => {
    expect(closeSheetOnReturn(1000, 1000 + 5 * MIN - 1000)).toBe(false)
  })
  it('closes at exactly 5:00 away and after', () => {
    expect(closeSheetOnReturn(1000, 1000 + 5 * MIN)).toBe(true)
    expect(closeSheetOnReturn(1000, 1000 + 60 * MIN)).toBe(true)
  })
  it('stays open when the app never left (no backgroundedAt)', () => {
    expect(closeSheetOnReturn(null, 10 * MIN)).toBe(false)
    expect(closeSheetOnReturn(undefined, 10 * MIN)).toBe(false)
  })
  it('stays open on a clock that went backwards', () => {
    expect(closeSheetOnReturn(10 * MIN, 1000)).toBe(false)
  })
})

describe('typedNumbersKept', () => {
  const values = { w: 100, r: 5 }
  it('is true when nothing was typed', () => {
    expect(typedNumbersKept(false, null, values)).toBe(true)
  })
  it('is true when the stored draft holds what is typed', () => {
    expect(typedNumbersKept(true, { w: 100, r: 5 }, values)).toBe(true)
  })
  it('is false when the draft write failed or never happened', () => {
    expect(typedNumbersKept(true, null, values)).toBe(false)
    expect(typedNumbersKept(true, { w: 95, r: 5 }, values)).toBe(false)
  })
})
