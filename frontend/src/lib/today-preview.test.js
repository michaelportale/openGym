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
    expect(todayPreview({}, [], '2026-10-03')).toEqual({ exercises: 0, last: null, up: [], lighter: [], recovering: [], toBeat: null })
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

  it('reads the top set to beat from the first lift last time, warm-ups left out', () => {
    const done = workout('w1', '2026-10-01', [entry(bench, [{ w: 40, r: 10, done: true, warmup: true }, set(60, 5), set(62.5, 3), set(62.5, 4)])])
    const S = { unit: 'kg', routines: [routine()], workouts: [done], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-03').toBeat).toEqual({ id: 'bench', w: 62.5, r: 4 })
  })
  it('has no top set to beat without a loaded set logged', () => {
    const S = { unit: 'kg', routines: [routine()], workouts: [], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-03').toBeat).toBeNull()
  })
})

// The set to beat is read from the history the session is built from (buildPlannedEntry): a
// lift moved to another machine station starts again, and a dumbbell weight is read the way it
// is logged today.
describe("the Today card's set to beat across load boundaries", () => {
  const press = { id: '0576', stationId: 'b', sets: 2, reps: 9, weight: 7, mode: 'reps', prog: 'double' }
  const station = id => ({ id, label: id, exerciseIds: [press.id], loadConvention: 'machine-total' })
  const gym = { activeEquipId: 'gym', equipProfiles: [{ id: 'gym', stations: [station('a'), station('b')] }] }
  const onStation = (id, w) => workout('w1', '2026-10-01', [{ id: press.id, rid: 'r1', target: { ...press, stationId: id }, planned: { ...press, stationId: id },
    equipmentSnapshot: { stationId: id, label: id, loadConvention: 'machine-total', unit: 'kg', status: 'exact' }, sets: [set(w, 9), set(w, 9)] }])
  const day = { id: 'r1', name: 'A', prog: 'double', ex: [press] }

  it('offers no target from another station, as Start does not', () => {
    const S = { unit: 'kg', routines: [day], workouts: [onStation('a', 80)], exWeights: {}, ...gym }
    expect(buildPlannedEntry(S, press, day).plan.kind).toBe('first')
    expect(todayPreview(S, ['r1'], '2026-10-03').toBeat).toBeNull()
  })
  it('still offers the same station\'s last top set', () => {
    const S = { unit: 'kg', routines: [day], workouts: [onStation('b', 80)], exWeights: {}, ...gym }
    expect(todayPreview(S, ['r1'], '2026-10-03').toBeat).toEqual({ id: press.id, w: 80, r: 9 })
  })
  it('reads a dumbbell weight logged as a total in today\'s per-bell meaning', () => {
    const db = { id: '0289', sets: 2, reps: 8, weight: 20, mode: 'reps', dbLoad: 'each' }
    const done = workout('w1', '2026-10-01', [{ id: db.id, rid: 'r1', target: { ...db, dbLoad: 'total' }, sets: [set(50, 8)] }])
    const S = { unit: 'kg', routines: [{ id: 'r1', name: 'A', prog: 'linear', ex: [db] }], workouts: [done], exWeights: {} }
    expect(todayPreview(S, ['r1'], '2026-10-03').toBeat).toEqual({ id: db.id, w: 25, r: 8 })
  })
})

describe('what the Today preview reads', () => {
  it('touches no part of the state outside PREVIEW_INPUTS, so Home can redo it on those alone', async () => {
    const { PREVIEW_INPUTS } = await import('./today-preview.js')
    const seen = new Set()
    const watch = o => new Proxy(o, { get(t, k) { if (typeof k === 'string') seen.add(k); return t[k] }, has(t, k) { seen.add(String(k)); return k in t } })
    const cfgs = [bench, { id: 'db-press', sets: 3, reps: 8, weight: 20, mode: 'reps', dbLoad: 'each' }, { id: 'plank', sets: 3, sec: 30, mode: 'time' }, { id: 'pullup', sets: 3, reps: 5, mode: 'reps', sides: true }]
    const r = routine({ ex: cfgs })
    const w = workout('w1', '2026-10-01', cfgs.map(c => entry(c, [set(60, 5), set(60, 5), set(60, 5)])))
    for (const extra of [{}, { plates: { kg: [20, 10, 5] }, dumbbells: { kg: [10, 20] }, barWeights: {}, dbLoad: { 'db-press': 'total' }, bodyweight: [{ d: '2026-10-01', w: 80 }] }]) {
      todayPreview(watch({ unit: 'kg', routines: [r], workouts: [w], exWeights: {}, ...extra }), ['r1'], '2026-10-05')
    }
    expect(seen.size).toBeGreaterThan(3)
    expect([...seen].filter(k => !PREVIEW_INPUTS.includes(k))).toEqual([])
  })
})
