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

describe('weekRecapModel v2: sessions, record values, streak and body weight', () => {
  // A six-routine rotation; this week (Mon 19 – Sun 25 Oct) ran four of them, one with a record.
  const ids = ['A', 'B', 'C', 'D', 'E', 'F']
  const S = {
    scheduleMode: 'rotation', rotation: { id: 'rot', sequence: ids, label: '' },
    queue: { ids, since: 0, startsOn: '2026-10-01', label: '', rotationId: 'rot' },
    routines: ids.map(id => ({ id, name: 'Day ' + id })), week: {}, status: null, pauses: [],
    bodyweight: [], unit: 'kg',
  }
  const run = (d, rid, entries = [], prs = []) => ({ ...wk(d, entries, prs), routineId: rid })
  const before = run('2026-10-15', 'F', [{ id: 'bench', sets: sets(3, 80, 5) }])
  const weekRuns = [
    run('2026-10-19', 'A'), run('2026-10-20', 'B', [{ id: 'bench', sets: sets(3, 82.5, 5) }], ['bench']),
    run('2026-10-21', 'C'), run('2026-10-23', 'D'),
  ]
  const all = [before, ...weekRuns]
  const opts = { today: '2026-10-23', unit: 'kg', nameOf: e => (e.id === 'bench' ? 'Bench Press' : e.id), S: { ...S, workouts: all } }

  it('shows a pill per rotation slot: four done, one with a record, two still open', () => {
    const m = weekRecapModel(all, opts)
    expect(m.sessions).toHaveLength(6)
    expect(m.sessions.filter(s => s.done)).toHaveLength(4)
    expect(m.sessions.filter(s => s.pr)).toEqual([{ label: 'Day B', done: true, pr: true }])
    expect(m.sessionsLine).toBe('4 of 6 sessions')
  })

  it('gives each record its value and how far it passed the best before the week', () => {
    const m = weekRecapModel(all, opts)
    expect(m.records).toEqual(['Bench Press'])
    expect(m.recordValues).toEqual(['82.5 kg · +2.5'])
    expect(m.recordsTitle).toBe('New bests')
    expect(m.footer).toBe('Made with openGym')
  })

  it('in Fixed Week mode the streak line counts sessions in a row, never "on rotation"', () => {
    const SW = { ...S, scheduleMode: 'week', queue: null, rotation: null, week: { 1: ['A'], 2: ['B'], 3: ['C'], 4: ['D'], 5: ['E'] }, workouts: all }
    const m = weekRecapModel(all, { ...opts, S: SW })
    expect(m.lines.some(l => /^\d+ sessions in a row$/.test(l))).toBe(true)
    expect(m.lines.some(l => l.includes('on rotation'))).toBe(false)
  })

  it('adds the rotation streak line, and the body weight only when asked', () => {
    const bw = [{ d: '2026-10-15', t: Date.parse('2026-10-15T08:00:00'), w: 79 }, { d: '2026-10-22', t: Date.parse('2026-10-22T08:00:00'), w: 78.7 }]
    const S2 = { ...opts.S, bodyweight: bw }
    const off = weekRecapModel(all, { ...opts, S: S2 })
    expect(off.lines.some(l => /sessions on rotation$/.test(l))).toBe(true)
    expect(off.lines.some(l => l.includes('7-day average'))).toBe(false)
    const on = weekRecapModel(all, { ...opts, S: S2, bw: true })
    expect(on.lines.some(l => l.startsWith('7-day average'))).toBe(true)
  })

  it('leaves the v1 card alone without the state', () => {
    const m = weekRecapModel(all, { today: '2026-10-23', unit: 'kg', nameOf: e => e.id })
    expect(m.sessions).toBeUndefined()
    expect(m.lines).toBeUndefined()
    expect(m.footer).toBeUndefined()
  })

  it('uses planned weekdays in Fixed Week', () => {
    const SW = { ...S, scheduleMode: 'week', queue: null, week: { 1: ['A'], 3: ['B'], 5: ['C'] }, workouts: [] }
    const runs = [run('2026-10-19', 'A'), run('2026-10-21', 'C')]
    const m = weekRecapModel(runs, { ...opts, S: SW })
    expect(m.sessions.map(s => [s.label, s.done])).toEqual([['Day A', true], ['Day B', false], ['Day C', false]])
  })
})
