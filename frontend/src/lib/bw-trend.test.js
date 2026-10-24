import { describe, expect, it } from 'vitest'
import { bwTrend, bwWeekChange, DAY_MS } from './bw-trend.js'

const T0 = Date.UTC(2026, 9, 1, 12)
const p = (day, y) => ({ t: T0 + day * DAY_MS, y })

describe('bwTrend', () => {
  it('averages the weigh-ins of the last seven days up to each one', () => {
    const tr = bwTrend([p(0, 80), p(2, 82), p(4, 81), p(7, 79)])
    expect(tr.map(x => x.y)).toEqual([80, 81, 81, 80.67])
  })
  it('keeps one point per weigh-in and their times', () => {
    const pts = [p(0, 80), p(1, 81)]
    expect(bwTrend(pts).map(x => x.t)).toEqual(pts.map(x => x.t))
  })
  it('is empty for no weigh-ins', () => {
    expect(bwTrend([])).toEqual([])
  })
  it('damps a single heavy morning', () => {
    const tr = bwTrend([p(0, 80), p(1, 80), p(2, 80), p(3, 83)])
    expect(tr.at(-1).y).toBe(80.75)
  })
})

describe('bwWeekChange', () => {
  it('compares the latest trend with the one a week or more before it', () => {
    expect(bwWeekChange(bwTrend([p(0, 82), p(3, 81), p(8, 80)]))).toBe(-1.5)
  })
  it('is null without a weigh-in at least a week back', () => {
    expect(bwWeekChange(bwTrend([p(0, 82), p(3, 81)]))).toBeNull()
  })
  it('is null when the earlier weigh-in is more than two weeks back', () => {
    expect(bwWeekChange(bwTrend([p(0, 82), p(20, 80)]))).toBeNull()
  })
})
