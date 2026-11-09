import { expect, test } from 'vitest'
import { gateSyncId, syncMetadata, syncIdOf, sortOwnWorkouts, externalBodyMass, readVerdict, syncIdFilter, toOwnWorkout, toBodyMassReading, toBodyMassChanges } from './gates.js'

const own = 'io.github.michaelportale.opengym'

test('gate sync ids carry the phase prefix and the time', () => {
  expect(gateSyncId(42)).toBe('opengym-phase0-gate-42')
})

test('sync metadata carries id, version and volume', () => {
  expect(syncMetadata('w1', 2, 1500)).toEqual({ HKMetadataKeySyncIdentifier: 'w1', HKMetadataKeySyncVersion: 2, openGymTotalVolumeLb: 1500 })
})

test('the sync id comes from the Apple key, or the key early builds saved under', () => {
  expect(syncIdOf({ HKMetadataKeySyncIdentifier: 'apple' })).toBe('apple')
  expect(syncIdOf({ HKSyncIdentifier: 'early' })).toBe('early')
})

test('a workout with missing or empty metadata has no sync id', () => {
  expect(syncIdOf(undefined)).toBeUndefined()
  expect(syncIdOf({})).toBeUndefined()
})

test('only this app\'s workouts with a gate id count as gate workouts', () => {
  const { gate, other } = sortOwnWorkouts([
    { uuid: 'timed', bundleId: own, syncId: 'opengym-phase0-gate-1730000000000' },
    { uuid: 'manual', bundleId: own, syncId: 'opengym-phase0-gate-manual' },
    { uuid: 'no-id', bundleId: own },
    { uuid: 'real', bundleId: own, syncId: 'workout-123' },
    { uuid: 'near-miss', bundleId: own, syncId: 'opengym-phase0-gateway' },
    { uuid: 'numeric', bundleId: own, syncId: 42 },
    { uuid: 'foreign', bundleId: 'com.example.other', syncId: 'opengym-phase0-gate-1' },
    { uuid: 'no-source', syncId: 'opengym-phase0-gate-2' }
  ], own)
  expect(gate.map(w => w.uuid)).toEqual(['timed', 'manual'])
  expect(other.map(w => w.uuid)).toEqual(['no-id', 'real', 'near-miss', 'numeric'])
})

test('own samples never count as external', () => {
  const samples = [{ uuid: 'a', bundleId: own }, { uuid: 'b', bundleId: 'com.apple.Health' }]
  expect(externalBodyMass(samples, own).map(s => s.uuid)).toEqual(['b'])
})

test('an empty or own-only read is inconclusive, never a pass', () => {
  expect(readVerdict([], own)).toBe('inconclusive')
  expect(readVerdict([{ uuid: 'a', bundleId: own }], own)).toBe('inconclusive')
  expect(readVerdict([{ uuid: 'b', bundleId: 'com.apple.Health' }], own)).toBe('pass')
})

test('the partial flag adds a key only when set', () => {
  expect('openGymVolumePartial' in syncMetadata('x', 5, 1200)).toBe(false)
  expect('openGymVolumePartial' in syncMetadata('x', 5, 1200, { partial: false })).toBe(false)
  expect(syncMetadata('x', 5, 1200, { partial: true }).openGymVolumePartial).toBe(true)
  expect(Object.keys(syncMetadata('x', 5, 1200))).toEqual(['HKMetadataKeySyncIdentifier', 'HKMetadataKeySyncVersion', 'openGymTotalVolumeLb'])
})

test('the delete filter needs an own source, or it would match every app', () => {
  expect(syncIdFilter('opengym-w-1', [], 4)).toBeNull()
  const src = { bundleIdentifier: own }
  expect(syncIdFilter('opengym-w-1', [src], 4)).toEqual({
    AND: [
      { metadata: { withMetadataKey: 'HKMetadataKeySyncIdentifier', operatorType: 4, value: 'opengym-w-1' } },
      { sources: [src] }
    ]
  })
})

test('an own workout tolerates missing metadata', () => {
  expect(toOwnWorkout({ uuid: 'u' })).toEqual({ uuid: 'u', syncId: null, syncVersion: null, volumeLb: null })
  expect(toOwnWorkout({ uuid: 'u', metadata: { HKMetadataKeySyncIdentifier: 'a', HKMetadataKeySyncVersion: 3, openGymTotalVolumeLb: 10 } }))
    .toEqual({ uuid: 'u', syncId: 'a', syncVersion: 3, volumeLb: 10 })
})

test('a body mass reading needs a finite quantity and tolerates a missing source', () => {
  const d = new Date(0)
  expect(toBodyMassReading({ uuid: 'u', quantity: NaN, startDate: d })).toBeNull()
  expect(toBodyMassReading({ uuid: 'u', quantity: 180, startDate: d })).toEqual({ uuid: 'u', lb: 180, at: d, bundleId: null })
  expect(toBodyMassReading({ uuid: 'u', quantity: 180, startDate: d, sourceRevision: { source: { bundleIdentifier: 'b' } } }).bundleId).toBe('b')
})

test('a volume that is not a finite number leaves the volume key out', () => {
  for (const volume of [undefined, null, NaN, Infinity]) {
    const metadata = syncMetadata('x', 5, volume)
    expect('openGymTotalVolumeLb' in metadata).toBe(false)
    expect(Object.values(metadata).includes(undefined)).toBe(false)
  }
  expect(syncMetadata('x', 5, 0).openGymTotalVolumeLb).toBe(0)
})

const sample = (uuid, over = {}) => ({
  uuid,
  quantity: 181.2,
  startDate: new Date(1730000000000),
  sourceRevision: { source: { bundleIdentifier: 'com.withings.wiScaleNG', name: 'Health Mate' } },
  metadata: {},
  ...over,
})

test('anchored changes map to readings, deleted uuids and the new anchor', () => {
  const out = toBodyMassChanges({
    samples: [sample('a'), sample('b', { metadata: { HKMetadataKeySyncIdentifier: 'opengym-bw-2026-11-09', HKMetadataKeySyncVersion: 3 } })],
    deletedSamples: [{ uuid: 'gone' }, { uuid: 'also', metadata: {} }],
    newAnchor: 'anchor-2',
  })
  expect(out).toEqual({
    samples: [
      { uuid: 'a', lb: 181.2, at: 1730000000000, bundleId: 'com.withings.wiScaleNG', syncId: null },
      { uuid: 'b', lb: 181.2, at: 1730000000000, bundleId: 'com.withings.wiScaleNG', syncId: 'opengym-bw-2026-11-09' },
    ],
    deleted: ['gone', 'also'],
    anchor: 'anchor-2',
  })
})

test('an anchored sample without a source, metadata, finite quantity, start or uuid is skipped', () => {
  const bad = [
    sample('no-revision', { sourceRevision: undefined }),
    sample('no-source', { sourceRevision: {} }),
    sample('no-bundle', { sourceRevision: { source: { name: 'x' } } }),
    sample('no-metadata', { metadata: undefined }),
    sample('null-metadata', { metadata: null }),
    sample('nan', { quantity: NaN }),
    sample('infinite', { quantity: Infinity }),
    sample('text', { quantity: '181' }),
    sample('no-start', { startDate: undefined }),
    sample('bad-start', { startDate: new Date('nope') }),
    sample(''),
    sample(undefined),
    null,
  ]
  expect(toBodyMassChanges({ samples: bad, deletedSamples: [], newAnchor: 'x' }).samples).toEqual([])
})

test('only a string sync identifier counts; the early workout key is not read', () => {
  const read = metadata => toBodyMassChanges({ samples: [sample('a', { metadata })], deletedSamples: [], newAnchor: 'x' }).samples[0].syncId
  expect(read({ HKMetadataKeySyncIdentifier: 42 })).toBeNull()
  expect(read({ HKSyncIdentifier: 'opengym-bw-2026-11-09' })).toBeNull()
})

test('a deleted sample without a uuid is skipped, and a missing list or anchor is tolerated', () => {
  expect(toBodyMassChanges({ samples: [], deletedSamples: [{}, { uuid: '' }, null, { uuid: 'ok' }], newAnchor: 'x' }).deleted).toEqual(['ok'])
  expect(toBodyMassChanges({})).toEqual({ samples: [], deleted: [], anchor: null })
  expect(toBodyMassChanges({ samples: [], deletedSamples: [], newAnchor: '' }).anchor).toBeNull()
  expect(toBodyMassChanges(undefined)).toEqual({ samples: [], deleted: [], anchor: null })
})
