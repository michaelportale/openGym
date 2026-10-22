import { describe, it, expect } from 'vitest'
import * as metadata from './training-metadata.js'
import { EXIDX } from './exercises.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'

describe('training metadata', () => {
  it('uses curated roles and never guesses unknown metadata', () => {
    expect(metadata.trainingMetadataOf(EXIDX['0289'])).toEqual({ role: 'horizontal-press', primary: ['chest'], secondary: ['triceps', 'deltoids'], status: 'curated' })
    expect(metadata.trainingMetadataOf({ id: 'unknown', n: 'mystery press', bp: 'chest' })).toEqual({ role: null, primary: [], secondary: [], status: 'unknown' })
    expect(metadata.trainingMetadataOf({ id: 'unknown', primaries: ['chest'] })).toEqual({ role: null, primary: ['chest'], secondary: [], status: 'unknown' })
  })
  it('uses manual metadata and historical snapshots before the catalogue', () => {
    expect(metadata.trainingMetadataOf({ id: '0289', trainingMetadata: { role: 'chest-isolation', primary: ['chest'], secondary: ['chest', 'triceps'] } })).toEqual({ role: 'chest-isolation', primary: ['chest'], secondary: ['triceps'], status: 'manual' })
    expect(metadata.trainingMetadataOf({ id: '0289', trainingSnapshot: { role: null, primary: [], secondary: [], status: 'unknown' } }).status).toBe('unknown')
  })
})

describe('session identity snapshots', () => {
  it('carries station and manual metadata through planned work and completed history', () => {
    const st = { unit: 'lb', workouts: [], exWeights: {}, trainingMetadata: { '0576': { role: 'horizontal-press', primary: ['chest'], secondary: ['triceps'] } }, equipProfiles: [{ id: 'gym', stations: [{ id: 'chest', label: 'Press A', manufacturer: 'Example', model: 'One', exerciseIds: ['0576'], loadConvention: 'plate-per-side' }] }], activeEquipId: 'gym' }
    const cfg = { id: '0576', stationId: 'chest', sets: 1, reps: 8, weight: 45, prog: 'off' }
    const entry = buildSessionEntries(st, { id: 'push', ex: [cfg] })[0]
    expect(entry.equipmentSnapshot).toEqual({ stationId: 'chest', label: 'Press A', manufacturer: 'Example', model: 'One', loadConvention: 'plate-per-side', unit: 'lb', status: 'exact' })
    expect(entry.trainingSnapshot).toEqual({ role: 'horizontal-press', primary: ['chest'], secondary: ['triceps'], status: 'manual' })
    entry.sets[0].done = true
    const completed = buildCompletedWorkout({ entries: [entry] }).entries[0]
    st.equipProfiles[0].stations[0].label = 'Renamed'
    st.trainingMetadata['0576'].primary.push('deltoids')
    expect(completed.equipmentSnapshot.label).toBe('Press A')
    expect(completed.trainingSnapshot.primary).toEqual(['chest'])
  })
  it('retains unknown equipment convention rather than inferring a machine setting', () => {
    const snapshot = metadata.trainingSnapshotFor({ unit: 'kg' }, { id: 'cUnknown', custom: true })
    expect(snapshot.trainingSnapshot.status).toBe('unknown')
    expect(snapshot.equipmentSnapshot).toEqual({ stationId: null, loadConvention: null, unit: 'kg', status: 'unknown' })
  })
})

describe('initial PPL family', () => {
  it('classifies every exercise in the existing PPL baseline without treating isolation as pressing', () => {
    const roles = { '0025': 'horizontal-press', '0047': 'horizontal-press', '0426': 'vertical-press', '0334': 'shoulder-isolation', '0241': 'elbow-extension', '0251': 'horizontal-press', '2330': 'vertical-pull', '0027': 'horizontal-pull', '1323': 'horizontal-pull', '0031': 'elbow-flexion', '0313': 'elbow-flexion', '0043': 'squat', '0085': 'hinge', '0739': 'squat', '0585': 'knee-extension', '0586': 'knee-flexion', '0605': 'calf-raise' }
    for (const [id, role] of Object.entries(roles)) expect(metadata.trainingMetadataOf(EXIDX[id]).role, EXIDX[id].n).toBe(role)
  })
  it('rejects invalid manual roles as unknown', () => {
    expect(metadata.trainingMetadataOf({ trainingMetadata: { role: 'invented', primary: ['chest'] } })).toEqual({ role: null, primary: ['chest'], secondary: [], status: 'unknown' })
  })
})
