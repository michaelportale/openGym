import { describe, it, expect } from 'vitest'
import { bodyweightCard } from './bodyweight-card.js'

const NOW = Date.UTC(2026, 10, 9, 12)
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10)
// n weigh-ins, one a day, oldest first, ending today, falling 0.2 lb a day.
const series = (n, start = 180) => Array.from({ length: n }, (_, i) => ({ d: day(n - 1 - i), w: Math.round((start - i * 0.2) * 10) / 10, t: NOW - (n - 1 - i) * 86400000 }))

describe('bodyweightCard', () => {
  it('has no lines and a nudge when empty', () => {
    const c = bodyweightCard({ bodyweight: [], range: 90, now: NOW })
    expect(c).toMatchObject({ averageLine: null, weekLine: null, monthLine: null, towardLine: null, chart: null, recent: [] })
    expect(c.nudge).toBe('Log 3 more weigh-ins to see a trend.')
  })
  it('says 1 more weigh-in for two, and passes no trend', () => {
    const c = bodyweightCard({ bodyweight: series(2), range: 90, now: NOW })
    expect(c.nudge).toBe('Log 1 more weigh-in to see a trend.')
    expect(c.chart.trend).toBeNull()
    expect(c.chart.points).toHaveLength(2)
  })
  it('gives the average, week and month lines for ten weigh-ins', () => {
    const c = bodyweightCard({ bodyweight: series(10), range: 90, now: NOW })
    expect(c.nudge).toBeNull()
    expect(c.averageLine).toBe('7-day average 178.8 lb')
    expect(c.weekLine).toBe('−1 lb this week')
    expect(c.monthLine).toBe('−1.2 lb over 30 days')
    expect(c.towardLine).toBeNull()
    expect(c.chart.trend.length).toBe(10)
    expect(c.chart.goal).toBeNull()
  })
  it('says toward your goal and carries the goal', () => {
    const c = bodyweightCard({ bodyweight: series(10), range: 90, now: NOW, targetW: 170 })
    expect(c.towardLine).toBe('toward your goal')
    expect(c.chart.goal).toBe(170)
    expect(bodyweightCard({ bodyweight: series(10), range: 90, now: NOW, targetW: 190 }).towardLine).toBeNull()
  })
  it('signs a rise with + and a flat week with ±0', () => {
    const up = series(10).map((e, i) => ({ ...e, w: 170 + i }))
    expect(bodyweightCard({ bodyweight: up, range: 90, now: NOW }).weekLine).toMatch(/^\+\d/)
    const flat = series(10).map(e => ({ ...e, w: 170 }))
    const c = bodyweightCard({ bodyweight: flat, range: 90, now: NOW })
    expect(c.weekLine).toBe('±0 lb this week')
    expect(c.monthLine).toBe('±0 lb over 30 days')
  })
  it('lists recent weigh-ins newest first with Health flags', () => {
    const bw = series(10)
    bw[9] = { ...bw[9], src: 'health' }
    const c = bodyweightCard({ bodyweight: bw, range: 90, now: NOW })
    expect(c.recent).toHaveLength(7)
    expect(c.recent[0]).toEqual({ d: '2026-11-09', label: 'Nov 9', weight: 178.2, health: true })
    expect(c.recent[1]).toMatchObject({ d: '2026-11-08', label: 'Nov 8', health: false })
  })
  it('shows a pending typed weigh-in in recent', () => {
    const bw = [...series(4), { d: '2026-11-10', w: 175.5, t: NOW + 86400000 }]
    const c = bodyweightCard({ bodyweight: bw, range: 0, now: NOW + 86400000 })
    expect(c.recent[0]).toMatchObject({ d: '2026-11-10', label: 'Nov 10', weight: 175.5, health: false })
  })
})
