import { it, expect } from 'vitest'
import { convertStateUnit } from './units.js'
import { repeatSessionEntries } from './session-repeat.js'
import { routineFromSession } from './session-routines.js'

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
