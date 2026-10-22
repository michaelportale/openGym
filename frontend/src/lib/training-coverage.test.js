import { describe, expect, it } from 'vitest'
import { trainingCoverage, coverageForState } from './training-coverage.js'
const window = { startDate: '2026-10-15', endDate: '2026-10-21' }
const snap = (primary = ['chest'], secondary = ['triceps'], role = 'horizontal-press') => ({ primary, secondary, role, status: 'manual' })
const entry = (n, snapshot = snap()) => ({ id: 'synthetic', trainingSnapshot: snapshot, sets: Array.from({ length: n }, () => ({ done: true, r: 8 })) })
const workout = (id, d, entries) => ({ id, d, entries })
describe('training coverage accounting', () => {
  it('keeps four direct and four indirect sets separate and credits six estimated sets without RIR', () => {
    const result = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [entry(4), entry(4, snap(['triceps'], []))])] })
    expect(result.byMuscle.triceps.actual).toMatchObject({ directSets: 4, secondarySets: 4, secondaryCredit: 2, combinedEstimate: 6, directDates: ['2026-10-21'], secondaryOnlyDates: [], target: { directDays: 2, sets: null }, gap: { directDays: 1, sets: null } })
    expect(result.byMuscle.triceps.planned.directSets).toBe(0)
    expect(result.byRole['horizontal-press'].actual.sets).toBe(8)
  })
  it('honors snapshot unknowns and reports unknown identity, phase, completion and partial limbs', () => {
    const e = entry(0, snap([], [], null)); e.id = '0047'
    e.sets = [{ done: true }, { done: true, warmup: true }, { done: true, phase: 'mystery' }, {}, { done: false }, { done: false, sides: { L: { done: true }, R: { done: false } } }]
    const r = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [e])], metadata: { '0047': snap() } })
    expect(r.byMuscle.chest).toBeUndefined()
    expect(r.unknowns.actual).toMatchObject({ targetSets: 1, roleSets: 1, phaseRows: 1, completionRows: 1, partialRows: 1 })
  })
  it('deduplicates IDs and legacy keys, counts off-program once, uses completed local dates and one day per muscle', () => {
    const w = workout('w', '2026-10-21', [entry(1)])
    const legacy = { d: '2026-10-15', start: 1, entries: [entry(1)] }
    const r = trainingCoverage({ window, workouts: [w, w, legacy, legacy, workout('same-day', '2026-10-21', [entry(1)]), workout('old', '2026-10-14', [entry(20)]), workout('future', '2026-10-22', [entry(20)]), { ...workout('timestamp', '2026-10-14', [entry(1)]), end: new Date('2026-10-21T00:30:00').getTime() }] })
    expect(r.byMuscle.chest.actual).toMatchObject({ directSets: 4, directDates: ['2026-10-15', '2026-10-21'] })
    expect(r.byMuscle.triceps.actual.secondaryOnlyDates).toEqual(['2026-10-15', '2026-10-21'])
  })
  it('does not substitute prescribed sets for partially completed actual work', () => {
    const e = entry(1); e.sets.push({ done: false }); e.planned = { sets: 4 }
    const r = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [e])], plannedSessions: [{ id: 'p', date: '2026-10-21', entries: [{ id: 'synthetic', sets: 4, trainingSnapshot: snap() }] }], policy: { targets: { chest: { directDays: 3, sets: 8 } } } })
    expect(r.byMuscle.chest.actual).toMatchObject({ directSets: 1, gap: { directDays: 2, sets: 7 } })
    expect(r.byMuscle.chest.planned).toMatchObject({ directSets: 4, directDates: ['2026-10-21'], gap: { directDays: 2, sets: 4 } })
  })
  it('keeps known targets when role is unknown and never gives secondary credit to the same primary', () => {
    const r = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [entry(2, snap(['chest'], ['chest'], null))])] })
    expect(r.byMuscle.chest.actual.combinedEstimate).toBe(2)
    expect(r.unknowns.actual.roleSets).toBe(2)
  })
  it('preserves zero targets and unknown dates or prescriptions', () => {
    const r = trainingCoverage({ window, workouts: [workout('undated', null, [entry(1)])], plannedSessions: [{ id: 'p', entries: [{ id: 'unknown' }] }], policy: { targets: { chest: { directDays: 0, sets: 0 } } } })
    expect(r.byMuscle.chest.actual.target).toEqual({ directDays: 0, sets: 0 })
    expect(r.unknowns.actual.dateSessions).toBe(1)
    expect(r.unknowns.planned.dateSessions).toBe(1)
  })
})
describe('coverage state integration', () => {
  it('shows rolling fixed dates separately from undated accepted-cycle prescriptions and all actual work since acceptance', () => {
    const S = { routines: [{ id: 'p', name: 'Push', ex: [{ id: '0047', sets: 4 }] }], week: { 3: 'p' }, dayPlan: {}, workouts: [workout('off', '2026-10-20', [entry(2)])], queue: { ids: ['p', 'p'], since: new Date('2026-10-18T12:00:00').getTime(), startsOn: '2026-10-18', rotationId: 'cycle' }, rotation: { id: 'cycle', sequence: ['p'] } }
    const r = coverageForState(S, '2026-10-21')
    expect(r.rolling.window).toEqual(window)
    expect(r.rolling.byMuscle.chest.actual.directSets).toBe(2)
    expect(r.cycle.byMuscle.chest.planned.directSets).toBe(4)
    expect(r.cycle.byMuscle.chest.planned.directDates).toEqual([])
    expect(r.cycle.byMuscle.chest.actual.directSets).toBe(2)
    expect(r.cycle.byMuscle.chest.planned.gap.directDays).toBeNull()
  })
})

it('includes explicit pinned cycle dates once in rolling prescriptions while keeping other cycle sessions undated', () => {
  const S = { routines: [{ id: 'p', ex: [{ id: '0047', sets: 4 }] }], workouts: [], week: { 3: 'p' }, dayPlan: { '2026-10-21': 'p' }, queue: { ids: ['p'], since: 1, startsOn: '2026-10-18' } }
  const r = coverageForState(S, '2026-10-21')
  expect(r.rolling.byMuscle.chest.planned).toMatchObject({ directSets: 4, directDates: ['2026-10-21'] })
  expect(r.cycle.byMuscle.chest.planned.directSets).toBe(4)
})
it('counts the local completion day across midnight and DST without UTC date slicing', () => {
  const date = new Date('2026-11-01T00:30:00')
  const r = trainingCoverage({ window: { startDate: '2026-10-26', endDate: '2026-11-01' }, workouts: [{ ...workout('dst', '2026-10-31', [entry(1)]), end: date.getTime() }] })
  expect(r.byMuscle.chest.actual.directDates).toEqual(['2026-11-01'])
})
it('does not replace an unknown historical snapshot with a newly edited manual mapping', () => {
  const r = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [entry(2, snap([], [], null))])], metadata: { synthetic: snap(['chest'], []) } })
  expect(r.byMuscle.chest).toBeUndefined()
  expect(r.unknowns.actual.targetSets).toBe(2)
})
it('keeps documented secondary credit while exposing unknown primary targets and unsupported role', () => {
  const r = trainingCoverage({ window, workouts: [workout('w', '2026-10-21', [entry(2, snap([], ['triceps'], 'invented-role'))])] })
  expect(r.byMuscle.triceps.actual.secondaryCredit).toBe(1)
  expect(r.unknowns.actual.targetSets).toBe(2)
  expect(r.unknowns.actual.roleSets).toBe(2)
})
it('uses completion time for cycle bounds and exposes ambiguous same-day legacy attribution', () => {
  const since = new Date('2026-10-21T12:00:00').getTime()
  const S = { routines: [{ id: 'p', ex: [{ id: '0047', sets: 4 }] }], workouts: [
    { ...workout('crossing', '2026-10-21', [entry(1)]), start: since - 1000, end: since + 1000 },
    { ...workout('before', '2026-10-21', [entry(8)]), end: since - 1000 },
    workout('unknown-time', '2026-10-21', [entry(2)])
  ], week: {}, dayPlan: {}, queue: { ids: ['p'], since, startsOn: '2026-10-21' } }
  const r = coverageForState(S, '2026-10-21')
  expect(r.cycle.byMuscle.chest.actual.directSets).toBe(1)
  expect(r.cycle.unknowns.actual.acceptanceSessions).toBe(1)
  expect(r.rolling.byMuscle.chest.actual.directSets).toBe(11)
})
it('does not apply weekly gaps to a cycle of arbitrary duration', () => {
  const S = { routines: [{ id: 'p', ex: [{ id: '0047', sets: 4 }] }], week: {}, dayPlan: {}, workouts: [workout('w', '2026-10-20', [entry(1)])], coverageTargets: { chest: { directDays: 2, sets: 8 } }, queue: { ids: ['p'], startsOn: '2026-10-01', since: 1 } }
  const r = coverageForState(S, '2026-10-21')
  expect(r.rolling.byMuscle.chest.actual.gap).toEqual({ directDays: 1, sets: 7 })
  expect(r.cycle.byMuscle.chest.actual.gap).toEqual({ directDays: null, sets: null })
  expect(r.cycle.byMuscle.chest.planned.gap).toEqual({ directDays: null, sets: null })
})
describe('planned custom exercise definitions', () => {
  const state = (cfg = {}, override) => ({
    customEx: [{ id: 'custom-press', custom: true, bp: 'chest', primaries: ['chest'], secondaries: ['triceps'] }],
    routines: [{ id: 'p', ex: [{ id: 'custom-press', sets: 4, ...cfg }] }],
    trainingMetadata: override ? { 'custom-press': override } : {},
    workouts: [], week: {}, dayPlan: { '2026-10-21': 'p' },
    queue: { ids: ['p'], startsOn: '2026-10-21', since: 1 },
  })
  it.each(['rolling', 'cycle'])('counts explicit legacy/imported custom targets in %s without inventing a role', kind => {
    const S = state(), before = structuredClone(S)
    const r = coverageForState(S, '2026-10-21')
    {
      const view = r[kind]
      expect(view.byMuscle.chest?.planned.directSets).toBe(4)
      expect(view.byMuscle.triceps.planned).toMatchObject({ secondarySets: 4, secondaryCredit: 2 })
      expect(view.unknowns.planned).toMatchObject({ targetSets: 0, roleSets: 4 })
      expect(view.byRole).toEqual({})
    }
    expect(S).toEqual(before)
  })
  it('retains explicit override priority over a custom definition in both planned views', () => {
    const r = coverageForState(state({}, snap(['quadriceps'], [], 'squat')), '2026-10-21')
    for (const view of [r.rolling, r.cycle]) {
      expect(view.byMuscle.chest).toBeUndefined()
      expect(view.byMuscle.quadriceps.planned.directSets).toBe(4)
      expect(view.byRole.squat.planned.sets).toBe(4)
    }
  })
  it('retains occurrence snapshot priority over the custom definition and manual override', () => {
    const r = coverageForState(state({ trainingSnapshot: snap([], [], null) }, snap(['quadriceps'], [], 'squat')), '2026-10-21')
    for (const view of [r.rolling, r.cycle]) {
      expect(view.byMuscle).toEqual({})
      expect(view.unknowns.planned).toMatchObject({ targetSets: 4, roleSets: 4 })
    }
  })
  it('keeps body-part-only custom definitions unclassified in both planned views', () => {
    const S = state(); S.customEx = [{ id: 'custom-press', custom: true, bp: 'chest' }]
    const r = coverageForState(S, '2026-10-21')
    for (const view of [r.rolling, r.cycle]) {
      expect(view.byMuscle).toEqual({})
      expect(view.unknowns.planned).toMatchObject({ targetSets: 4, roleSets: 4 })
    }
  })
})
