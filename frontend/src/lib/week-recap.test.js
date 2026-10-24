import { describe, expect, it } from 'vitest'
import { weekRecapModel, weekWorkouts, topMuscle } from './week-recap.js'
import { MONDAY, SUNDAY } from './format.js'

const sets = (n, w = 50, r = 10) => Array.from({ length: n }, () => ({ w, r, done: true }))
const wk = (d, entries, prs = []) => ({ id: d, d, start: new Date(d + 'T10:00:00').getTime(), entries, prs })
const nameOf = e => 'Lift ' + e.id
// 2026-10-23 is a Friday: the Monday week runs Oct 19–25, the Sunday week Oct 18–24.
const W = [
  wk('2026-10-12', [{ id: '0043', sets: sets(3) }], ['0043']),        // the week before
  wk('2026-10-18', [{ id: '0043', sets: sets(2) }]),                   // Sunday
  wk('2026-10-20', [{ id: '0025', sets: sets(4, 60, 8) }], ['0025']),
  wk('2026-10-22', [{ id: '0043', sets: sets(3, 100, 5) }, { id: '0025', sets: sets(1) }], ['0043', '0025']),
]

describe('weekWorkouts', () => {
  it('keeps the workouts of the week the day falls in, oldest first', () => {
    expect(weekWorkouts(W, '2026-10-23', MONDAY).map(w => w.d)).toEqual(['2026-10-20', '2026-10-22'])
    expect(weekWorkouts(W, '2026-10-23', SUNDAY).map(w => w.d)).toEqual(['2026-10-18', '2026-10-20', '2026-10-22'])
  })
})

describe('weekRecapModel', () => {
  const m = weekRecapModel(W, { today: '2026-10-23', unit: 'kg', nameOf })
  it('counts the week\'s workouts and adds up their volume', () => {
    expect(m.title).toBe('Your week')
    expect(m.count).toBe(2)
    expect(m.stats[0]).toEqual({ label: 'Workouts', value: '2' })
    expect(m.stats[1].label).toBe('Volume')
    expect(m.stats[1].value).toBe((4 * 60 * 8 + 3 * 100 * 5 + 50 * 10).toLocaleString('en-US') + ' kg')
  })
  it('names the muscle that took the most load', () => {
    expect(m.stats[2].label).toBe('Top muscle')
    expect(typeof m.stats[2].value).toBe('string')
    expect(m.levels).toBeTruthy()
  })
  it('lists each new best once, in the order it was set', () => {
    expect(m.records).toEqual(['Lift 0025', 'Lift 0043'])
  })
  it('spans the week from its first to its last day', () => {
    expect(m.date).toMatch(/19.*25/)
  })
  it('has nothing to show for an empty week', () => {
    const e = weekRecapModel(W, { today: '2026-11-04', unit: 'kg', nameOf })
    expect(e.count).toBe(0)
    expect(e.records).toEqual([])
    expect(e.levels).toBeNull()
    expect(e.stats.map(s => s.label)).toEqual(['Workouts', 'Volume'])
  })
})

describe('topMuscle', () => {
  it('picks the largest load and ignores zeroes', () => {
    expect(topMuscle({ chest: 2, quadriceps: 5, biceps: 0 })).toBe('quadriceps')
    expect(topMuscle({})).toBeNull()
  })
})
