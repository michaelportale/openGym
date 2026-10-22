import { it, expect } from 'vitest'
import { convertStateUnit } from './units.js'
import { repeatSessionEntries } from './session-repeat.js'
import { routineFromSession } from './session-routines.js'
import { buildPlannedEntry } from './session-start.js'
import { entryDbLoad, volumeFactor, withMeaning } from './dumbbells.js'

it('converts a stamped mass load with its recorded unit and preserves machine settings', () => {
  const st = { unit: 'lb', routines: [{ id: 'r', ex: [{ id: '0576', weight: 5, loadConvention: 'machine-setting' }] }], workouts: [{ entries: [
    { id: '0025', equipmentSnapshot: { stationId: null, loadConvention: 'barbell-total', unit: 'lb', status: 'unknown' }, sets: [{ w: 45, r: 8, done: true }] },
    { id: '0576', equipmentSnapshot: { stationId: 'pin', loadConvention: 'machine-setting', unit: null, status: 'exact' }, target: { weight: 5 }, sets: [{ w: 5, r: 8, done: true }] },
  ] }] }
  const converted = convertStateUnit(st, 'kg')
  expect(converted.workouts[0].entries[0].equipmentSnapshot.unit).toBe('kg')
  expect(converted.workouts[0].entries[0].sets[0].w).toBe(20.5)
  expect(converted.workouts[0].entries[1].equipmentSnapshot.unit).toBe(null)
  expect(converted.workouts[0].entries[1].sets[0].w).toBe(5)
  expect(converted.workouts[0].entries[1].target.weight).toBe(5)
  expect(converted.routines[0].ex[0].weight).toBe(5)
  expect(st.workouts[0].entries[0].equipmentSnapshot.unit).toBe('lb')
})
it('repeating work snapshots current metadata while keeping the old record intact', () => {
  const old = { entries: [{ id: '0025', target: { sets: 1, reps: 8, weight: 45 }, trainingSnapshot: { role: 'horizontal-press', primary: ['chest'], secondary: [], status: 'curated' }, equipmentSnapshot: { stationId: 'gone', loadConvention: 'barbell-total', unit: 'lb', status: 'exact' }, sets: [{ w: 45, r: 8, done: true }] }] }
  const st = { unit: 'lb', workouts: [], routines: [], exWeights: {}, trainingMetadata: { '0025': { role: 'horizontal-press', primary: ['chest'], secondary: ['triceps'] } } }
  const repeated = repeatSessionEntries(st, old).entries[0]
  expect(repeated.trainingSnapshot.secondary).toEqual(['triceps'])
  expect(repeated.equipmentSnapshot.stationId).toBe(null)
  expect(old.entries[0].equipmentSnapshot.stationId).toBe('gone')
  const cfg = routineFromSession(old).ex[0]
  expect(cfg).not.toHaveProperty('trainingSnapshot')
  expect(cfg).not.toHaveProperty('equipmentSnapshot')
})

it.each([
  ['total', 'db-per-hand', 'db-total', 1],
  ['each', 'db-total', 'db-per-hand', 2],
  ['as', 'db-per-hand', null, 1],
])('builds snapshot from the authoritative dumbbell meaning %s despite stale convention %s', (meaning, stale, convention, factor) => {
  const st = { unit: 'kg', workouts: [], exWeights: {}, dbLoad: { '0289': { mode: meaning } } }
  const built = buildPlannedEntry(st, { id: '0289', sets: 1, reps: 8, weight: 20, prog: 'off', loadConvention: stale })
  const entry = { id: '0289', ...built }
  expect(built.equipmentSnapshot.loadConvention).toBe(convention)
  expect(built.target).not.toHaveProperty('loadConvention')
  expect(entryDbLoad(entry)).toBe(meaning)
  expect(volumeFactor(entry)).toBe(factor)
})
it('leaves unchanged legacy as-entered dumbbell entries with unknown convention', () => {
  const built = buildPlannedEntry({ unit: 'kg', workouts: [], exWeights: {} }, { id: '0289', sets: 1, reps: 8, weight: 20, prog: 'off' })
  expect(built.target).not.toHaveProperty('dbLoad')
  expect(built.equipmentSnapshot.loadConvention).toBe(null)
  expect(volumeFactor({ id: '0289', ...built })).toBe(1)
})

it('normalizes a freestyle dumbbell target to its actual meaning without mutating its config', () => {
  const cfg = { sets: 1, weight: 20, dbLoad: 'each', loadConvention: 'db-total' }
  const target = withMeaning({}, cfg, '0289')
  expect(target).toEqual({ sets: 1, weight: 20, dbLoad: 'each' })
  expect(cfg.loadConvention).toBe('db-total')
})
