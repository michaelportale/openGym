import { describe, it, expect } from 'vitest'
import { buildPlannedEntry, buildSessionEntries } from './session-start.js'
import { buildSets, freestyleConfig, workoutVolume, workoutVolumeIsPartial, bestWeightForEntry } from './history.js'
import { nextPrescription } from './progression.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { bestSetOf, e1rmSeries } from './onerm.js'
import { exerciseHistory } from './exercise-history.js'
import { workoutCardModel } from './workout-card.js'
import { coverageForState } from './training-coverage.js'
import { convertStateUnit } from './units.js'
import { parseFitnessNotes, prepareFitnessNotes } from './import-fitness-notes.js'
import { mergeImport } from './import-csv.js'
import { fitnessNote } from '../test/fitness-notes.js'

const cfg = { id: '0576', stationId: 'b', sets: 2, repsMin: 8, reps: 9, weight: 7, inc: 1, prog: 'double' }
const station = (id, loadConvention) => ({ id, label: id, exerciseIds: [cfg.id], loadConvention })
const state = () => ({ unit: 'kg', workouts: [], exWeights: {}, customEx: [], bodyweight: [], routines: [], activeEquipId: 'gym', equipProfiles: [{ id: 'gym', stations: [station('a', 'machine-total'), station('b', 'machine-setting')] }] })
const old = (over = {}) => ({ id: cfg.id, target: { ...cfg }, planned: { ...cfg }, equipmentSnapshot: { stationId: 'a', loadConvention: 'machine-total', unit: 'kg', status: 'exact' }, sets: [1, 2].map(() => ({ w: 80, r: 9, done: true })), ...over })
const withHistory = e => ({ ...state(), workouts: [{ id: 'prior', d: '2026-10-20', entries: [e] }] })

describe('automatic load identity at production boundaries', () => {
  it.each([
    ['different exact stations', { stationId: 'b', loadConvention: 'machine-total' }],
    ['mass versus setting on the same station', { stationId: 'a', loadConvention: 'machine-setting' }],
    ['unknown station after an exact station', { stationId: undefined }],
  ])('does not seed %s', (_, change) => {
    const s = withHistory(old()), c = { ...cfg, ...change }
    const built = buildPlannedEntry(s, c)
    expect(built.plan.kind).toBe('first')
    expect(built.target.weight).toBe(7)
    expect(built.sets.map(r => r.w)).toEqual([7, 7])
    expect(nextPrescription(s, c).kind).toBe('first')
    expect(buildSets(s, c).map(r => r.w)).toEqual([7, 7])
    expect(freestyleConfig(s, c).weight).toBe(7)
  })
  it('cannot fall through to an unscoped confirmed weight', () => {
    const s = state(); s.exWeights[cfg.id] = { w: 80, d: '2026-10-20' }
    expect(buildPlannedEntry(s, cfg).sets.map(r => r.w)).toEqual([7, 7])
    expect(buildSets(s, cfg, { preferLast: true }).map(r => r.w)).toEqual([7, 7])
  })
  it('excludes a mapped uncertain historical import from real planned and freestyle seeding', () => {
    const s = state()
    const parsed = parseFitnessNotes([{ name: 'synthetic.md', text: fitnessNote({ setup: 'Unknown machine', convention: 'setting', load: '80', reps: '9' }) }])
    mergeImport(s, prepareFitnessNotes(parsed, s, { mappings: { [parsed.customEx[0].id]: cfg.id } }))
    const c = { ...cfg, stationId: 'a', loadConvention: 'machine-total' }
    expect(buildPlannedEntry(s, c).sets.map(r => r.w)).toEqual([7, 7])
    expect(freestyleConfig(s, c).weight).toBe(7)
    const legacy = { ...c }; delete legacy.stationId; delete legacy.loadConvention
    expect(buildPlannedEntry(s, legacy).sets.map(r => r.w)).toEqual([7, 7])
  })
  it('retains same-station progression and deliberate legacy history/fallback behavior', () => {
    const s = withHistory(old()), c = { ...cfg, stationId: 'a', loadConvention: 'machine-total' }
    expect(buildPlannedEntry(s, c).sets.map(r => r.w)).toEqual([81, 81])
    const legacy = { ...cfg }; delete legacy.stationId
    const prior = old(); delete prior.equipmentSnapshot; delete prior.target.stationId; delete prior.planned.stationId
    expect(buildPlannedEntry(withHistory(prior), legacy).sets.map(r => r.w)).toEqual([81, 81])
    expect(buildSets({ ...state(), exWeights: { [cfg.id]: { w: 60 } } }, legacy)[0].w).toBe(60)
  })
})

it('freezes existing custom muscle/equipment metadata through actual creation and completion', () => {
  const s = { ...state(), customEx: [{ id: 'custom-press', custom: true, eq: 'dumbbell', primaries: ['chest'], secondaries: ['triceps'] }], week: {}, dayPlan: { '2026-10-21': 'r' } }
  const r = { id: 'r', ex: [{ id: 'custom-press', dbLoad: 'each', sets: 3, reps: 8, weight: 20, prog: 'off' }] }; s.routines = [r]
  const entries = buildSessionEntries(s, r)
  entries[0].sets.forEach(row => { row.done = true })
  s.workouts = [buildCompletedWorkout({ id: 'w', d: '2026-10-21', entries }, { end: new Date('2026-10-21T12:00:00').getTime() })]
  expect(s.workouts[0].entries[0].equipmentSnapshot.loadConvention).toBe('db-per-hand')
  const coverage = coverageForState(s, '2026-10-21').rolling
  expect(coverage.byMuscle.chest.actual.directSets).toBe(3)
  expect(coverage.byMuscle.chest.planned.directSets).toBe(3)
  expect(coverage.byMuscle.triceps.actual.secondaryCredit).toBe(1.5)
})

it('preserves inherited setting targets and adaptation baselines across profile unit changes', () => {
  const s = state(), c = { ...cfg, warmup: [{ weight: 3 }], pyramidWeight: [4, 7] }
  s.routines = [{ id: 'r', ex: [c] }]
  s.queue = { adaptation: { baseline: structuredClone(s.routines) } }
  const converted = convertStateUnit(s, 'lb')
  expect(converted.routines[0].ex[0]).toEqual(c)
  expect(converted.queue.adaptation.baseline[0].ex[0]).toEqual(c)
  expect(buildSessionEntries(converted, converted.routines[0])[0]).toMatchObject({ target: { weight: 7 }, equipmentSnapshot: { unit: null } })
})

it('keeps native setting observations out of physical metrics after start/log/finish', () => {
  const s = state()
  const entries = buildSessionEntries(s, { ex: [{ ...cfg, sets: 1, reps: 10, prog: 'off' }] })
  entries[0].sets[0].done = true
  const w = buildCompletedWorkout({ id: 'w', d: '2026-10-21', entries })
  expect(w.entries[0].sets[0]).toMatchObject({ w: 7, r: 10, done: true })
  expect(workoutVolume(w)).toBe(0)
  expect(workoutVolumeIsPartial(w)).toBe(true)
  expect(bestSetOf(w.entries[0])).toBeNull()
  expect(bestWeightForEntry(w.entries[0])).toBe(0)
  expect(e1rmSeries({ ...s, workouts: [w] }, cfg.id)).toEqual([])
  const h = exerciseHistory({ ...s, workouts: [w] }, cfg.id)
  expect(h.sessions[0]).toMatchObject({ volume: 0, volumePartial: true, e1rm: null })
  expect(h.sessions[0].sets[0].w).toBe(7)
  expect(workoutCardModel(w, { unit: 'kg', nameOf: () => 'Synthetic press' }).stats.find(x => x.label === 'Volume').value).toContain('Partial load total')
})

it.each([false, true])('keeps a same-exercise mixed station subtotal physical in either entry order (%s)', reverse => {
  const s = state()
  const physical = old({ sets: [{ w: 10, r: 10, done: true }] })
  const setting = { ...buildPlannedEntry(s, { ...cfg, sets: 1, reps: 10, prog: 'off' }), id: cfg.id }
  setting.sets[0].done = true
  const entries = reverse ? [setting, physical] : [physical, setting]
  const w = buildCompletedWorkout({ id: 'mixed', d: '2026-10-21', entries })
  const h = exerciseHistory({ ...s, workouts: [w] }, cfg.id)
  expect(h.sessions[0]).toMatchObject({ volume: 100, volumePartial: true, e1rm: 13.3, value: 10 })
  expect(h.sessions[0].sets).toHaveLength(2)
  expect(workoutVolume(w)).toBe(100)
})

it('copies the saved native setting convention when current station metadata has changed', async () => {
  const { repeatSessionEntries } = await import('./session-repeat.js')
  const { routineFromSession } = await import('./session-routines.js')
  const s = state(), entries = buildSessionEntries(s, { ex: [cfg] })
  entries[0].sets.forEach(row => { row.done = true })
  const w = buildCompletedWorkout({ id: 'saved-setting', d: '2026-10-21', entries })
  s.equipProfiles[0].stations[1].loadConvention = 'machine-total'
  const repeated = repeatSessionEntries(s, w).entries[0]
  expect(repeated).toMatchObject({ target: { weight: 7, loadConvention: 'machine-setting' }, equipmentSnapshot: { loadConvention: 'machine-setting', unit: null } })
  const routine = routineFromSession(w)
  expect(routine.ex[0]).toMatchObject({ weight: 7, loadConvention: 'machine-setting' })
  expect(convertStateUnit({ ...s, routines: [routine] }, 'lb').routines[0].ex[0].weight).toBe(7)
})
it('does not promote a mapped uncertain import load through repeat or save-as-routine', async () => {
  const { repeatSessionEntries } = await import('./session-repeat.js')
  const { routineFromSession } = await import('./session-routines.js')
  const s = state()
  const parsed = parseFitnessNotes([{ name: 'synthetic.md', text: fitnessNote({ setup: 'Unknown machine', convention: 'setting', load: '80', reps: '9' }) }])
  mergeImport(s, prepareFitnessNotes(parsed, s, { mappings: { [parsed.customEx[0].id]: cfg.id } }))
  const source = structuredClone(s.workouts[0])
  const repeated = repeatSessionEntries(s, source).entries[0]
  expect(repeated.sets.map(row => row.w)).toEqual([0, 0, 0])
  expect(repeated.sets.filter(row => row.phase !== 'warmup').map(row => row.r)).toEqual([9, 9])
  const routine = routineFromSession(source)
  expect(routine.ex[0].weight).toBe(0)
  expect(buildSessionEntries(s, routine)[0].sets.every(row => row.w === 0)).toBe(true)
  expect(s.workouts[0]).toEqual(source)
})

it('does not treat explicitly unlocated machines or unknown snapshot units as comparable', () => {
  const s = withHistory(old({ equipmentSnapshot: { stationId: null, loadConvention: 'machine-total', unit: 'kg', status: 'unknown' } }))
  const unlocated = { ...cfg, stationId: undefined, loadConvention: 'machine-total' }
  expect(buildPlannedEntry(s, unlocated).sets[0].w).toBe(7)
  s.workouts[0].entries[0].equipmentSnapshot = { stationId: 'a', loadConvention: 'machine-total', unit: null, status: 'exact' }
  expect(buildPlannedEntry(s, { ...cfg, stationId: 'a' }).sets[0].w).toBe(7)
})
it('does not carry an explicit source station load into a different routine exercise', async () => {
  const { replaceSlotExercise } = await import('./routines.js')
  const replaced = replaceSlotExercise({ ...cfg, loadConvention: 'machine-setting' }, '0289', state())
  expect(replaced.weight).toBe(0)
  expect(replaced.stationId).toBeUndefined()
  expect(replaced.loadConvention).toBeUndefined()
})

it('does not derive a physical Epley deload estimate from repeated native settings', () => {
  const s = state()
  const c = { ...cfg, loadConvention: 'machine-setting', sets: 2, reps: 12, prog: 'linear', weight: 7 }
  s.workouts = [1, 2, 3].map(i => ({ id: `miss-${i}`, d: `2026-10-${17+i}`, entries: [{ ...old(), target: c, planned: { ...c }, equipmentSnapshot: { stationId: 'b', loadConvention: 'machine-setting', unit: null, status: 'exact' }, sets: [{ w: 7, r: 6, done: true }, { w: 7, r: 6, done: true }] }] }))
  const built = buildPlannedEntry(s, c)
  expect(built.plan.kind).toBe('deload')
  expect(built.plan.target1RM).toBeUndefined()
  expect(built.plan.why).not.toContain('kg')
})
it('finish comparison does not compare loads from different explicit stations', async () => {
  const { finishCompare } = await import('./finish-compare.js')
  const s = withHistory(old())
  const entries = buildSessionEntries(s, { ex: [cfg] }); entries[0].sets.forEach(row => { row.done = true })
  const w = buildCompletedWorkout({ id: 'today', d: '2026-10-21', entries })
  s.workouts.push(w)
  expect(finishCompare(s, w)[0]).toMatchObject({ last: null, trend: null })
})

it.each([Infinity, NaN, 0, -1])('keeps native setting rows finite when a saved increment is invalid (%s)', inc => {
  const s = withHistory(old({ equipmentSnapshot: { stationId: 'b', loadConvention: 'machine-setting', unit: null, status: 'exact' } }))
  const built = buildPlannedEntry(s, { ...cfg, inc })
  expect(built.sets.every(row => Number.isFinite(row.w))).toBe(true)
})
