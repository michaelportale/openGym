import { describe, it, expect } from 'vitest'
import { todayPreview } from './today-preview.js'
import { buildPlannedEntry } from './session-start.js'

const set = (w, r) => ({ w, r, done: true })
const bench = { id: 'bench', sets: 3, reps: 5, weight: 60, mode: 'reps' }
const row = { id: 'row', sets: 3, reps: 5, weight: 50, mode: 'reps' }
const routine = (more = {}) => ({ id: 'r1', name: 'A', prog: 'linear', ex: [bench, row], ...more })
const workout = (id, d, entries, more = {}) => ({ id, d, routineIds: ['r1'], start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), entries, ...more })
const entry = (cfg, sets) => ({ id: cfg.id, rid: 'r1', target: { ...cfg }, sets })

describe("Home's Today preview", () => {
  it('counts the exercises and finds the last session of the routine before today', () => {
    const w1 = workout('w1', '2026-10-01', [entry(bench, [set(60, 5)])])
    const w2 = workout('w2', '2026-10-08', [entry(bench, [set(60, 5)])])
    const other = workout('w3', '2026-10-09', [], { routineIds: ['zz'] })
    const later = workout('w4', '2026-10-10', [entry(bench, [set(60, 5)])])
    const S = { unit: 'kg', routines: [routine()], workouts: [w2, w1, other, later], exWeights: {} }
    const p = todayPreview(S, ['r1'], '2026-10-10')
    expect(p.exercises).toBe(2)
    expect(p.last.id).toBe('w2')
  })
  it('names the lifts the prescription moves up, exactly as Start builds them', () => {
    const done = workout('w1', '2026-10-01', [entry(bench, [set(60, 5), set(60, 5), set(60, 5)]), entry(row, [set(50, 3), set(50, 3), set(50, 2)])])
    const S = { unit: 'kg', routines: [routine()], workouts: [done], exWeights: {} }
    const p = todayPreview(S, ['r1'], '2026-10-03')
    const kinds = [bench, row].map(c => buildPlannedEntry(S, c, S.routines[0]).plan?.kind)
    expect(p.up).toEqual([bench, row].filter((_, i) => kinds[i] === 'up').map(c => c.id))
    expect(p.lighter).toEqual([bench, row].filter((_, i) => kinds[i] === 'deload').map(c => c.id))
    expect(p.up).toContain('bench')
  })
  it('lists nothing for a routine excluded from progression, and survives an unreadable one', () => {
    const done = workout('w1', '2026-10-01', [entry(bench, [set(60, 5), set(60, 5), set(60, 5)])])
    const S = { unit: 'kg', routines: [routine({ excludeFromProgression: true })], workouts: [done], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-03')).toMatchObject({ exercises: 2, up: [], lighter: [] })
    expect(todayPreview({ routines: [{ id: 'r1', ex: [null, { id: 'x' }] }] }, ['r1', 'missing'], '2026-10-03'))
      .toMatchObject({ exercises: 1, last: null })
    expect(todayPreview({}, [], '2026-10-03')).toEqual({ exercises: 0, last: null, up: [], lighter: [], recovering: [] })
  })

  // Recovery: the same fatigue scoring as the Stats body map (lib/recovery.js).
  const press = { id: '0025', sets: 3, reps: 8, weight: 60, mode: 'reps' }   // chest primary; shoulders, triceps 0.4
  const squat = { id: '0026', sets: 3, reps: 8, weight: 80, mode: 'reps' }   // quads primary
  const heavy = (cfg, d, n = 10) => ({ id: 'h' + d + cfg.id, d, routineIds: ['zz'], start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
    entries: [{ id: cfg.id, target: { ...cfg }, sets: Array.from({ length: n }, () => ({ w: cfg.weight, r: 8, rir: 0, done: true })) }] })
  const pushDay = { id: 'r1', name: 'Push', prog: 'linear', ex: [press] }
  it('names a primary muscle of the session that is still fatigued', () => {
    const S = { unit: 'kg', routines: [pushDay], workouts: [heavy(press, '2026-10-09')], exWeights: {} }
    const p = todayPreview(S, ['r1'], '2026-10-10', Date.parse('2026-10-10T09:00:00'))
    expect(p.recovering).toEqual(['chest'])
  })
  it('leaves out muscles the session only supports, and fatigue the session does not touch', () => {
    const S = { unit: 'kg', routines: [pushDay], workouts: [heavy(squat, '2026-10-09')], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-10', Date.parse('2026-10-10T09:00:00')).recovering).toEqual([])
  })
  it('says nothing once the muscle has had time to recover', () => {
    const S = { unit: 'kg', routines: [pushDay], workouts: [heavy(press, '2026-10-01')], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-10', Date.parse('2026-10-10T09:00:00')).recovering).toEqual([])
  })
})
