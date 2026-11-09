export const GATE_PREFIX = 'opengym-phase0-gate-'

export function gateSyncId(nowMs) {
  return GATE_PREFIX + nowMs
}

export function syncMetadata(id, version, volumeLb, { partial } = {}) {
  const metadata = { HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: version }
  if (Number.isFinite(volumeLb)) metadata.openGymTotalVolumeLb = volumeLb
  if (partial) metadata.openGymVolumePartial = true
  return metadata
}

// An empty source list means no filter to the library, which would match every app's objects.
export function syncIdFilter(syncId, ownSources, equalTo) {
  if (ownSources.length === 0) return null
  return {
    AND: [
      { metadata: { withMetadataKey: 'HKMetadataKeySyncIdentifier', operatorType: equalTo, value: syncId } },
      { sources: ownSources }
    ]
  }
}

export function toOwnWorkout(w) {
  const m = w.metadata
  return {
    uuid: w.uuid,
    syncId: syncIdOf(m) ?? null,
    syncVersion: m?.HKMetadataKeySyncVersion ?? null,
    volumeLb: m?.openGymTotalVolumeLb ?? null
  }
}

export function toBodyMassReading(s) {
  if (!Number.isFinite(s.quantity)) return null
  return { uuid: s.uuid, lb: s.quantity, at: s.startDate, bundleId: s.sourceRevision?.source?.bundleIdentifier ?? null }
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
