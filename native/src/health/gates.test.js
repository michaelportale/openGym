import { expect, test } from 'vitest'
import { gateSyncId, syncMetadata, externalBodyMass, readVerdict } from './gates.js'

const own = 'io.github.michaelportale.opengym'

test('gate sync ids carry the phase prefix and the time', () => {
  expect(gateSyncId(42)).toBe('opengym-phase0-gate-42')
})

test('sync metadata carries id, version and volume', () => {
  expect(syncMetadata('w1', 2, 1500)).toEqual({ HKSyncIdentifier: 'w1', HKSyncVersion: 2, openGymTotalVolumeLb: 1500 })
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
