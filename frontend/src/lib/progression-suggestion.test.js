import { describe, it, expect } from 'vitest'
import { suggestProgression, comparableEntries } from './progression-suggestion.js'

const equipment = { stationId: 'station-a', loadConvention: 'machine-total', unit: 'kg', status: 'exact' }
const prescription = { sets: 3, repsMin: 8, reps: 12, weight: 50, inc: 2.5 }
const exercise = { id: 'press', equipmentSnapshot: equipment, target: prescription }
const entry = (rir = 2, extra = {}) => ({ ...exercise, sets: [0, 1, 2].map(i => ({ w: 50, r: 12, done: true, ...(i === 2 && rir != null ? { rir } : {}) })), ...extra })
const history = e => [{ id: 'w1', d: '2026-10-20', start: 1, entries: [e] }]
const suggest = (e = entry(), p = prescription, ex = exercise, policy = 'double') => suggestProgression({ exercise: ex, history: history(e), prescription: p, policy })

describe('effort-aware progression proposals', () => {
  it('proposes one known load step and lower reps after every prescribed set hits the ceiling with logged final RIR2', () => {
    const h = history(entry()); const before = structuredClone(h)
    expect(suggestProgression({ exercise, history: h, prescription, policy: 'double' })).toMatchObject({ load: 52.5, reps: 8, action: 'increase-load', percentChange: 5, policyVersion: 'personal-strength-v1' })
    expect(h).toEqual(before)
  })
  it.each([0, 0.5, 1])('retains load at logged final RIR%s', rir => {
    expect(suggest(entry(rir))).toMatchObject({ load: 50, reps: 12, action: 'hold' })
  })
  it('offers reps first at RIR4 when one working set remains below the ceiling', () => {
    const e = entry(4); e.sets[0].r = 10
    expect(suggest(e)).toMatchObject({ load: 50, reps: 11, action: 'increase-reps' })
  })
  it('marks missing effort as a limited editable suggestion, never passing the effort gate', () => {
    expect(suggest(entry(null))).toMatchObject({ load: 52.5, reps: 8, action: 'limited-load', limitations: expect.arrayContaining(['Effort unknown']) })
  })
  it('does not substitute a failure flag or an earlier rating for final logged effort', () => {
    const e = entry(null); e.sets[0].rir = 4; e.sets[2].failure = true
    expect(suggest(e).action).toBe('limited-load')
  })
  it('converts a logged final RPE8 to the RIR2 gate', () => {
    const e = entry(null); e.sets[2].rpe = 8
    expect(suggest(e).action).toBe('increase-load')
  })
  it.each(['w', 'r'])('never raises load with a missing required %s', field => {
    const e = entry(); e.sets[0][field] = null
    expect(suggest(e).action).toBe('hold')
  })
  it('never raises load with incomplete prescribed work or unequal working loads', () => {
    const e = entry(); e.sets[0].done = false
    expect(suggest(e).action).toBe('hold')
    e.sets[0].done = true; e.sets[0].w = 45
    expect(suggest(e).action).toBe('hold')
    e.sets.pop(); expect(suggest(e).action).toBe('hold')
  })
  it('excludes warm-ups from rep, load and final-effort evidence', () => {
    const e = entry(); e.sets.push({ phase: 'warmup', w: 10, r: 3, done: false, rir: 0 })
    expect(suggest(e).action).toBe('increase-load')
  })
  it('requires the final working set rating even when an extra completed set was added', () => {
    const e = entry(); e.sets.push({ w: 50, r: 12, done: true })
    expect(suggest(e).action).toBe('limited-load')
  })
  it.each(['pain', 'techniqueProblem', 'safetyConcern', 'userOverride'])('exposes documented %s and avoids an increase', flag => {
    const out = suggest(entry(4, { [flag]: 'Review form' }))
    expect(out).toMatchObject({ action: 'review', load: 50 })
    expect(out.reasons).toContain('Review form')
  })
  it('never invents an exact available step', () => {
    const { inc, ...unknownStep } = prescription
    expect(suggest(entry(), unknownStep)).toMatchObject({ load: 50, action: 'hold', limitations: expect.arrayContaining(['Load increment unknown']) })
  })
  it('uses the smallest known available load above the performed load', () => {
    expect(suggest(entry(), { ...prescription, availableLoads: [60, 55, 50] })).toMatchObject({ load: 55, reps: 8, percentChange: 10 })
  })
  it('keeps other selected policies in control', () => {
    expect(suggest(entry(), prescription, exercise, 'linear')).toMatchObject({ action: 'existing-policy', load: 50 })
  })
  it('requires both limbs completed and rated before a bilateral row proves effort', () => {
    const e = entry(); e.sets[2] = { w: 50, r: 24, done: true, sides: { L: { w: 50, r: 12, done: true, rir: 2 }, R: { w: 50, r: 12, done: false } } }
    expect(suggest(e).action).toBe('hold')
  })
})

describe('comparable performance', () => {
  it.each([
    { stationId: 'station-b' }, { loadConvention: 'plate-per-side' }, { unit: 'lb' }, { loadConvention: null },
  ])('rejects changed station, convention or unit: %j', change => {
    expect(suggest(entry(2, { equipmentSnapshot: { ...equipment, ...change } })).action).toBe('start')
  })
  it('does not compare unknown machine identity or unknown DB meaning with a known lift', () => {
    expect(suggest(entry(), prescription, { ...exercise, equipmentSnapshot: { ...equipment, stationId: null } }).action).toBe('start')
    expect(suggest(entry(2, { equipmentSnapshot: undefined })).action).toBe('start')
  })
  it('requires the same prescribed rep range and movement variant', () => {
    expect(suggest(entry(2, { target: { ...prescription, reps: 15 } })).action).toBe('start')
    expect(suggest(entry(2, { target: { ...prescription, variant: 'wide' } })).action).toBe('start')
  })
  it('includes off-program comparable work, excludes progression opt-outs, and sorts newest first', () => {
    const h = [...history(entry()), { id: 'w2', d: '2026-10-21', entries: [entry(0)] }, { id: 'w3', d: '2026-10-22', entries: [entry(4, { noProg: true })] }]
    expect(comparableEntries({ exercise, history: h, prescription }).map(e => e.d)).toEqual(['2026-10-21', '2026-10-20'])
    expect(suggestProgression({ exercise, history: h, prescription, policy: 'double' }).action).toBe('hold')
  })
})

describe('explicit restrictions and bilateral evidence', () => {
  it('honors an explicit progression override on the active exercise', () => {
    expect(suggest(entry(), prescription, { ...exercise, noProg: true }).action).toBe('review')
  })
  it('does not compare total dumbbells to per-hand or barbell loads', () => {
    const ex = { ...exercise, equipmentSnapshot: { stationId: null, loadConvention: 'db-per-hand', unit: 'kg' } }
    for (const loadConvention of ['db-total', 'barbell-total']) {
      expect(suggest(entry(2, { equipmentSnapshot: { ...ex.equipmentSnapshot, loadConvention } }), prescription, ex).action).toBe('start')
    }
  })
  it('requires both final limb ratings rather than a scalar rating from the completed limb', () => {
    const p = { ...prescription, reps: 24, repsMin: 16 }
    const ex = { ...exercise, target: p }
    const e = { ...ex, sets: [0, 1, 2].map(() => ({ w: 50, r: 24, done: true, rir: 3, sides: { L: { w: 50, r: 12, done: true, rir: 3 }, R: { w: 50, r: 12, done: true } } })) }
    expect(suggest(e, p, ex).action).toBe('limited-load')
    e.sets[2].sides.R.rir = 0
    expect(suggest(e, p, ex).action).toBe('hold')
    e.sets[2].sides.R.rir = 2
    expect(suggest(e, p, ex)).toMatchObject({ load: 52.5, reps: 16, action: 'increase-load' })
  })
})

it('retains the existing directional policy for assistance machines', () => {
  expect(suggest(entry(), prescription, { ...exercise, target: { ...prescription, assisted: true } }).action).toBe('existing-policy')
})
it('does not use an invalid increment', () => {
  expect(suggest(entry(), { ...prescription, inc: Infinity }).action).toBe('hold')
})
it('does not compare unrecognized load conventions', () => {
  const e = entry(2, { equipmentSnapshot: { ...equipment, loadConvention: 'unknown-setting' } })
  const ex = { ...exercise, equipmentSnapshot: e.equipmentSnapshot }
  expect(suggest(e, prescription, ex).action).toBe('start')
})

it('rejects a contradictory dumbbell snapshot instead of reinterpreting the authoritative logged meaning', () => {
  const equipmentSnapshot = { stationId: null, loadConvention: 'db-total', unit: 'kg' }
  const ex = { ...exercise, target: { ...prescription, dbLoad: 'total' }, equipmentSnapshot }
  const e = entry(2, { target: { ...prescription, dbLoad: 'each' }, equipmentSnapshot })
  expect(suggest(e, prescription, ex).action).toBe('start')
})


it('uses consistent explicit per-hand dumbbell snapshots without converting the recorded load', () => {
  const equipmentSnapshot = { stationId: null, loadConvention: 'db-per-hand', unit: 'kg' }
  const target = { ...prescription, dbLoad: 'each' }
  const ex = { ...exercise, target, equipmentSnapshot }
  const e = entry(2, { target, equipmentSnapshot })
  expect(suggest(e, prescription, ex)).toMatchObject({ load: 52.5, reps: 8, action: 'increase-load' })
})
