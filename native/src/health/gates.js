export const GATE_PREFIX = 'opengym-phase0-gate-'

export function gateSyncId(nowMs) {
  return GATE_PREFIX + nowMs
}

export function syncMetadata(id, version, volumeLb) {
  return { HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: version, openGymTotalVolumeLb: volumeLb }
}

// HKSyncIdentifier is what builds before the key fix saved under, so their workouts need it to be found.
export function syncIdOf(metadata) {
  return metadata?.HKMetadataKeySyncIdentifier ?? metadata?.HKSyncIdentifier
}

export function sortOwnWorkouts(workouts, ownBundleId) {
  const own = workouts.filter(w => w.bundleId === ownBundleId)
  const isGate = w => typeof w.syncId === 'string' && w.syncId.startsWith(GATE_PREFIX)
  return { gate: own.filter(isGate), other: own.filter(w => !isGate(w)) }
}

export function externalBodyMass(samples, ownBundleId) {
  return samples.filter(s => s.bundleId !== ownBundleId)
}

export function readVerdict(samples, ownBundleId) {
  return externalBodyMass(samples, ownBundleId).length > 0 ? 'pass' : 'inconclusive'
}
