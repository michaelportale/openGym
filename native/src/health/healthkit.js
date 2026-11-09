import {
  AuthorizationStatus,
  ComparisonPredicateOperator,
  WorkoutActivityType,
  authorizationStatusFor,
  currentAppSource,
  deleteObjects,
  queryQuantitySamples,
  querySources,
  queryWorkoutSamples,
  requestAuthorization,
  saveWorkoutSample
} from '@kingstinct/react-native-healthkit'
import { syncIdFilter, syncIdOf, syncMetadata, toBodyMassReading, toOwnWorkout } from './gates.js'

const WORKOUT = 'HKWorkoutTypeIdentifier'
const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass'

export async function requestHealthAccess() {
  await requestAuthorization({ toShare: [WORKOUT, BODY_MASS], toRead: [BODY_MASS] })
}

export async function ownBundleId() {
  const source = currentAppSource()
  try {
    return source.bundleIdentifier
  } finally {
    source.dispose()
  }
}

export function workoutWriteAccess() {
  try {
    const status = authorizationStatusFor(WORKOUT)
    if (status === AuthorizationStatus.sharingAuthorized) return 'on'
    if (status === AuthorizationStatus.sharingDenied) return 'off'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function saveStrengthWorkout({ id, version, start, end, volumeLb, partial }) {
  const workout = await saveWorkoutSample(
    WorkoutActivityType.traditionalStrengthTraining,
    [],
    start,
    end,
    undefined,
    syncMetadata(id, version, volumeLb, { partial })
  )
  try {
    return { uuid: workout.uuid }
  } finally {
    workout.dispose()
  }
}

export async function findWorkoutsBySyncId(id) {
  const workouts = await queryWorkoutSamples({
    limit: 0,
    filter: { metadata: { withMetadataKey: 'HKMetadataKeySyncIdentifier', operatorType: ComparisonPredicateOperator.equalTo, value: id } }
  })
  return workouts.map(w => {
    try {
      return toOwnWorkout(w)
    } finally {
      w.dispose()
    }
  })
}

export async function findOwnWorkouts(bundleId) {
  const sources = await querySources(WORKOUT)
  try {
    const own = sources.filter(s => s.bundleIdentifier === bundleId)
    // The library treats an empty source list as no filter, which would read every app's workouts.
    if (own.length === 0) return []
    const workouts = await queryWorkoutSamples({ limit: 0, filter: { sources: own } })
    return workouts.map(w => {
      try {
        return { uuid: w.uuid, bundleId: w.sourceRevision?.source?.bundleIdentifier, syncId: syncIdOf(w.metadata) }
      } finally {
        w.dispose()
      }
    })
  } finally {
    sources.forEach(s => s.dispose())
  }
}

export async function deleteWorkoutsBySyncId(syncId) {
  const bundleId = await ownBundleId()
  const sources = await querySources(WORKOUT)
  try {
    const filter = syncIdFilter(syncId, sources.filter(s => s.bundleIdentifier === bundleId), ComparisonPredicateOperator.equalTo)
    if (!filter) return 0
    return await deleteObjects(WORKOUT, filter)
  } finally {
    sources.forEach(s => s.dispose())
  }
}

export function deleteWorkout(uuid) {
  return deleteObjects(WORKOUT, { uuid })
}

export async function readBodyMass({ start, end }) {
  const samples = await queryQuantitySamples(BODY_MASS, {
    limit: 0,
    unit: 'lb',
    filter: { date: { startDate: start, endDate: end } }
  })
  try {
    return samples.map(toBodyMassReading).filter(Boolean)
  } finally {
    samples.forEach(s => s.dispose?.())
  }
}
