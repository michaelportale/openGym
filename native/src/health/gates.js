export const GATE_PREFIX = 'opengym-phase0-gate-'

export function gateSyncId(nowMs) {
  return GATE_PREFIX + nowMs
}

export function syncMetadata(id, version, volumeLb) {
  return { HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: version, openGymTotalVolumeLb: volumeLb }
}

export function externalBodyMass(samples, ownBundleId) {
  return samples.filter(s => s.bundleId !== ownBundleId)
}

export function readVerdict(samples, ownBundleId) {
  return externalBodyMass(samples, ownBundleId).length > 0 ? 'pass' : 'inconclusive'
}
