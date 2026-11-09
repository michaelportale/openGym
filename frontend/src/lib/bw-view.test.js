import { describe, it, expect } from 'vitest'
import { bodyweightView } from './bw-view.js'
import { bwTrend, bwWeekChange, bwTrendChange, bwTowardGoal, BW_TREND_MIN, DAY_MS } from './bw-trend.js'

// Local noon, so a weigh-in written at the same hour as NOW sits exactly at its day's noon.
const NOW = new Date(2026, 5, 30, 12).getTime()
const pts = rows => rows.map(b => ({ t: b.t, y: b.w, d: b.d }))
const localDay = ms => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const noonOf = d => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day, 12).getTime() }
const wi = (daysAgo, w) => ({ t: NOW - daysAgo * DAY_MS, d: localDay(NOW - daysAgo * DAY_MS), w })

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

  it('places a weigh-in at local noon of its day, with or without t', () => {
    const v = bodyweightView([{ d: '2026-06-28', w: 182, t: NOW }, { d: '2026-06-29', w: 181 }], { now: NOW })
    expect(v.points).toEqual([
      { t: noonOf('2026-06-28'), y: 182, d: '2026-06-28' },
      { t: noonOf('2026-06-29'), y: 181, d: '2026-06-29' },
    ])
  })

  it('falls back to t only when the day is unusable', () => {
    const v = bodyweightView([{ d: 'soon', w: 181, t: NOW - DAY_MS }], { now: NOW })
    expect(v.points[0].t).toBe(NOW - DAY_MS)
  })

  it("counts this morning's weigh-in in the 30-day change", () => {
    const morning = NOW - 4 * 3600000
    const rows = [wi(10, 182), wi(5, 181), { d: localDay(NOW), w: 179, t: morning - 3600000 }]
    const v = bodyweightView(rows, { now: morning })
    expect(v.points.at(-1).t).toBe(noonOf(localDay(NOW)))
    expect(v.trendNow.y).toBe(180)
    expect(v.delta30).toBe(-2)
  })

  it('averages today and the six days before, morning or evening', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ d: localDay(NOW - (9 - i) * DAY_MS), w: 180 - i, t: NOW - (9 - i) * DAY_MS }))
    const mean7 = Math.round(rows.slice(-7).reduce((a, r) => a + r.w, 0) / 7 * 100) / 100
    for (const hour of [7, 12, 20]) {
      const v = bodyweightView(rows, { now: NOW + (hour - 12) * 3600000 })
      expect(v.trendNow.y).toBe(mean7)
      expect(v.points).toHaveLength(10)
    }
  })

  it('cuts the range by whole days, morning or evening', () => {
    const rows = [wi(30, 190), wi(29, 189), wi(1, 185)]
    for (const hour of [7, 20]) {
      expect(bodyweightView(rows, { range: 30, now: NOW + (hour - 12) * 3600000 }).points.map(p => p.y)).toEqual([189, 185])
    }
  })

  it('holds a weigh-in dated after today at today', () => {
    const v = bodyweightView([wi(1, 181), { d: localDay(NOW + DAY_MS), w: 180, t: NOW }], { now: NOW - 3600000 })
    expect(v.points.at(-1).t).toBe(NOW)
  })

  it('puts readings imported in a later pass on their own days', () => {
    // Mon, Wed and Fri passes each bring in every reading since the last one, all stamped with
    // the pass's time: each reading still sits on its own day.
    const passAt = d => noonOf(d) + 6 * 3600000
    const days = Array.from({ length: 9 }, (_, i) => localDay(NOW - (8 - i) * DAY_MS))
    const rows = days.map((d, i) => ({ d, w: 180 - i * 0.5, t: passAt(days[Math.min(8, Math.ceil(i / 3) * 3)]), src: 'health' }))
    const v = bodyweightView(rows, { now: NOW })
    expect(v.points.map(p => p.t)).toEqual(days.map(noonOf))
    expect(new Set(v.points.map(p => p.t)).size).toBe(9)
  })

  it('two weeks without opening the app still averages the last 7 days by day', () => {
    // Fourteen readings arrive in one pass, all with the same t.
    const rows = Array.from({ length: 14 }, (_, i) => ({ d: localDay(NOW - (13 - i) * DAY_MS), w: 190 - i, t: NOW, src: 'health' }))
    const v = bodyweightView(rows, { now: NOW })
    const last7 = rows.slice(-7).map(r => r.w)
    expect(v.trendNow.y).toBe(Math.round(last7.reduce((a, b) => a + b, 0) / 7 * 100) / 100)
    expect(v.week).toBe(-7)
    expect(v.delta30).not.toBeNull()
  })

  it('last7 is the last seven stored entries, newest first', () => {
    const rows = Array.from({ length: 9 }, (_, i) => wi(9 - i, 180 + i))
    expect(bodyweightView(rows, { now: NOW }).last7).toEqual(rows.slice(-7).reverse())
  })
})
