import { describe, it, expect } from 'vitest'
import { bodyweightView } from './bw-view.js'
import { bwTrend, bwWeekChange, bwTrendChange, bwTowardGoal, BW_TREND_MIN, DAY_MS } from './bw-trend.js'

const NOW = Date.UTC(2026, 5, 30, 12)
const pts = rows => rows.map(b => ({ t: b.t, y: b.w, d: b.d }))
const wi = (daysAgo, w) => ({ t: NOW - daysAgo * DAY_MS, d: new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10), w })

describe('bodyweightView', () => {
  it('is empty for no weigh-ins', () => {
    expect(bodyweightView([], { now: NOW })).toEqual({
      points: [], trend: [], trendNow: null, week: null, delta30: null, toward: null, enough: false, last7: [],
    })
  })

  it('handles one weigh-in', () => {
    const v = bodyweightView([wi(1, 180)], { now: NOW })
    expect(v.points).toHaveLength(1)
    expect(v.points[0].y).toBe(180)
    expect(v.trendNow.y).toBe(180)
    expect(v.week).toBeNull()
    expect(v.delta30).toBeNull()
    expect(v.enough).toBe(false)
    expect(v.last7).toHaveLength(1)
  })

  it('cuts to the range, excluding exactly range days ago', () => {
    const v = bodyweightView([wi(30, 190), wi(29, 189), wi(1, 185)], { range: 30, now: NOW })
    expect(v.points.map(p => p.y)).toEqual([189, 185])
    expect(v.trend).toHaveLength(2)
  })

  it('range 0 means all, and defaults to 90 days', () => {
    const rows = [wi(200, 200), wi(10, 190)]
    expect(bodyweightView(rows, { range: 0, now: NOW }).points).toHaveLength(2)
    expect(bodyweightView(rows, { now: NOW }).points).toHaveLength(1)
  })

  it('runs the trend over all weigh-ins before the cut', () => {
    const rows = [wi(33, 200), wi(32, 200), wi(31, 200), wi(2, 190)]
    const v = bodyweightView(rows, { range: 30, now: NOW })
    expect(v.points).toHaveLength(1)
    expect(v.trend).toEqual(bwTrend(pts(rows)).filter(p => p.t > NOW - 30 * DAY_MS))
    expect(v.trendNow).toEqual(bwTrend(pts(rows)).at(-1))
  })

  it('matches the bw-trend helpers for week, delta30, toward and enough', () => {
    const rows = [wi(20, 190), wi(14, 189), wi(8, 188), wi(3, 187), wi(0.5, 186)]
    const all = bwTrend(pts(rows))
    const v = bodyweightView(rows, { range: 90, now: NOW, targetW: 175 })
    expect(v.week).toBe(bwWeekChange(all))
    expect(v.delta30).toBe(bwTrendChange(all, 30, NOW))
    expect(v.toward).toBe(bwTowardGoal(bwWeekChange(all), all.at(-1).y, 175))
    expect(v.toward).toBe(true)
    expect(v.enough).toBe(v.points.length >= BW_TREND_MIN)
    expect(bodyweightView(rows, { now: NOW }).toward).toBeNull()
  })

  it('falls back to d when t is missing', () => {
    const v = bodyweightView([{ d: '2026-06-29', w: 181 }], { now: NOW })
    expect(v.points[0]).toEqual({ t: new Date('2026-06-29').getTime(), y: 181, d: '2026-06-29' })
  })

  it('last7 is the last seven stored entries, newest first', () => {
    const rows = Array.from({ length: 9 }, (_, i) => wi(9 - i, 180 + i))
    expect(bodyweightView(rows, { now: NOW }).last7).toEqual(rows.slice(-7).reverse())
  })
})
