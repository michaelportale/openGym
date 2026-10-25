import { describe, expect, it } from 'vitest'
import { strengthTrend } from './strength-trend.js'

const DAY = 86400000
const NOW = new Date('2026-10-23T12:00:00').getTime()
const BENCH = '0025', SQUAT = '0043', CURL = '0031'
const session = (daysAgo, sets) => {
  const t = NOW - daysAgo * DAY
  return { id: 'w' + daysAgo, d: new Date(t).toISOString().slice(0, 10), start: t, end: t + 3600e3, prs: [],
    entries: Object.entries(sets).map(([id, [w, r]]) => ({ id, target: { mode: 'reps' }, sets: [{ w, r, done: true }] })) }
}
const S = workouts => ({ unit: 'kg', workouts })

describe('strength trend', () => {
  it('lists lifts with two estimates in the window, most-trained first, with the change', () => {
    const rows = strengthTrend(S([
      session(50, { [BENCH]: [60, 5], [SQUAT]: [100, 5] }),
      session(30, { [BENCH]: [62.5, 5], [SQUAT]: [100, 5] }),
      session(10, { [BENCH]: [65, 5] }),
      session(5, { [CURL]: [20, 10] }),          // one estimate only: left out
    ]), { now: NOW })
    expect(rows.map(r => r.id)).toEqual([BENCH, SQUAT])
    const [bench, squat] = rows
    expect(bench.points).toHaveLength(3)
    expect(bench.now).toBeGreaterThan(bench.from)
    expect(bench.delta).toBeCloseTo(bench.now - bench.from)
    expect(squat.delta).toBeCloseTo(0)
  })

  it('ignores what falls outside the window and caps the list', () => {
    const old = strengthTrend(S([session(90, { [BENCH]: [60, 5] }), session(80, { [BENCH]: [70, 5] })]), { now: NOW })
    expect(old).toEqual([])
    const many = strengthTrend(S([
      session(20, { [BENCH]: [60, 5], [SQUAT]: [100, 5], [CURL]: [20, 8] }),
      session(10, { [BENCH]: [60, 5], [SQUAT]: [100, 5], [CURL]: [20, 8] }),
    ]), { now: NOW, max: 2 })
    expect(many).toHaveLength(2)
    expect(many.map(r => r.id)).toEqual([SQUAT, BENCH])   // same count: heavier first
  })

  it('is empty with no workouts', () => {
    expect(strengthTrend({ workouts: [] }, { now: NOW })).toEqual([])
    expect(strengthTrend({}, { now: NOW })).toEqual([])
  })
})
