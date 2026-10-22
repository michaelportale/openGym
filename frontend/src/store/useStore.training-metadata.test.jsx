// @vitest-environment happy-dom
import { afterEach, it, expect, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
import { DEF, freshState, useStore, restoredStateFor } from './useStore.js'
import { mergeStates, stampChange, resetIdsOf, sinceReset } from '../lib/sync-merge.js'
import { trainingMetadataOf } from '../lib/training-metadata.js'

const clone = x => structuredClone(x)
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null }) })
it('loads old profiles without assigning a role to an unknown custom exercise', () => {
  const old = { workouts: [], routines: [], customEx: [{ id: 'cMystery', n: 'Mystery', bp: 'chest', custom: true }] }
  const restored = restoredStateFor({}, old)
  expect(restored.trainingMetadata).toEqual({})
  expect(trainingMetadataOf(restored.customEx[0]).status).toBe('unknown')
})
it('persists, exports, imports and resets station inventory and manual metadata', () => {
  useStore.setState({ S: freshState(), user: null })
  useStore.getState().update(s => {
    s.trainingMetadata = { c1: { role: 'horizontal-press', primary: ['chest'], secondary: [], _ts: 100 } }
    s.equipProfiles = [{ id: 'gym', name: 'Gym', stations: [{ id: 'press', label: 'Press', exerciseIds: ['c1'], loadConvention: 'machine-setting' }] }]
    s.routines = [{ id: 'push', ex: [{ id: 'c1', stationId: 'press' }] }]
    s.active = { id: 'active', entries: [{ id: 'c1', trainingSnapshot: { role: null, primary: [], secondary: [], status: 'unknown' }, equipmentSnapshot: { stationId: 'press', loadConvention: 'machine-setting', unit: 'kg', status: 'exact' } }] }
    s.workouts = [{ id: 'w1', d: '2026-10-01', entries: clone(s.active.entries) }]
  })
  const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
  expect(saved.trainingMetadata.c1.role).toBe('horizontal-press')
  expect(saved.active.entries[0].equipmentSnapshot.stationId).toBe('press')
  useStore.setState({ S: freshState() })
  useStore.getState().importBackup(saved)
  const s = useStore.getState().S
  expect(s.routines[0].ex[0].stationId).toBe('press')
  expect(s.equipProfiles[0].stations[0].loadConvention).toBe('machine-setting')
  expect(s.workouts[0].entries[0].trainingSnapshot.status).toBe('unknown')
  useStore.getState().resetEverything()
  expect(useStore.getState().S.trainingMetadata).toEqual({})
})
it('merges independent metadata overrides and removes reset keys without resurrecting them', () => {
  const base = { ...freshState(), _ts: 1, trainingMetadata: {} }
  const a = clone(base), b = clone(base)
  a.trainingMetadata.a = { role: 'hinge', primary: ['hamstring'], secondary: [], _ts: 10 }
  b.trainingMetadata.b = { role: 'squat', primary: ['quadriceps'], secondary: [], _ts: 20 }
  stampChange(base, a, 10); stampChange(base, b, 20)
  const merged = mergeStates(a, b)
  expect(Object.keys(merged.trainingMetadata).sort()).toEqual(['a', 'b'])
  const ids = resetIdsOf(merged)
  expect(ids.trainingMetadata).toEqual(['b', 'a'])
  expect(sinceReset(merged, 30, ids).trainingMetadata).toEqual({})
})
