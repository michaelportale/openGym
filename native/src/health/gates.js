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

const nonEmpty = v => typeof v === 'string' && v !== ''

// One anchored body-mass sample, or null when it cannot be trusted: without a source the import
// cannot tell its own samples from a scale's, and without metadata it cannot see a sync id. A
// weight outside (0, 1000] lb is not one a typed entry could hold either.
function toAnchoredBodyMass(s) {
  if (!s || !nonEmpty(s.uuid) || !Number.isFinite(s.quantity) || !(s.quantity > 0 && s.quantity <= 1000)) return null
  const bundleId = s.sourceRevision?.source?.bundleIdentifier
  if (!nonEmpty(bundleId) || !s.metadata || typeof s.metadata !== 'object') return null
  const at = s.startDate instanceof Date ? s.startDate.getTime() : NaN
  if (!Number.isFinite(at)) return null
  const syncId = s.metadata.HKMetadataKeySyncIdentifier
  return { uuid: s.uuid, lb: s.quantity, at, bundleId, syncId: nonEmpty(syncId) ? syncId : null }
}

// The anchored query's answer as the import reads it: { samples, deleted: [uuid], anchor }.
export function toBodyMassChanges(result) {
  const samples = Array.isArray(result?.samples) ? result.samples : []
  const deleted = Array.isArray(result?.deletedSamples) ? result.deletedSamples : []
  return {
    samples: samples.map(toAnchoredBodyMass).filter(Boolean),
    deleted: deleted.map(s => s?.uuid).filter(nonEmpty),
    anchor: nonEmpty(result?.newAnchor) ? result.newAnchor : null,
  }
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
