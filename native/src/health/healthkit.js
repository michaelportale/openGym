import {
  AuthorizationStatus,
  ComparisonPredicateOperator,
  WorkoutActivityType,
  authorizationStatusFor,
  currentAppSource,
  deleteObjects,
  queryQuantitySamples,
  queryQuantitySamplesWithAnchor,
  queryWorkoutSamples,
  requestAuthorization,
  saveWorkoutSample
} from '@kingstinct/react-native-healthkit'
import { syncIdFilter, syncMetadata, toBodyMassChanges, toBodyMassReading, toOwnWorkout } from './gates.js'

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

// The app's own source comes from currentAppSource(), not querySources: the source query may
// return nothing when only write access is granted for a type.
export async function findOwnWorkouts() {
  const source = currentAppSource()
  try {
    const workouts = await queryWorkoutSamples({ limit: 0, filter: { sources: [source] } })
    return workouts.map(w => {
      try {
        return { ...toOwnWorkout(w), bundleId: w.sourceRevision?.source?.bundleIdentifier }
      } finally {
        w.dispose()
      }
    })
  } finally {
    source.dispose()
  }
}

export async function deleteWorkoutsBySyncId(syncId) {
  const source = currentAppSource()
  try {
    const filter = syncIdFilter(syncId, [source], ComparisonPredicateOperator.equalTo)
    return await deleteObjects(WORKOUT, filter)
  } finally {
    source.dispose()
  }
}

// Every workout this app's source wrote, linked or not.
export async function deleteAllOwnWorkouts() {
  const source = currentAppSource()
  try {
    return await deleteObjects(WORKOUT, { sources: [source] })
  } finally {
    source.dispose()
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

// Body-mass changes since the anchor (every sample from `since` when there is none), in lb.
// A malformed anchor throws; the caller clears it and reads again without one.
export async function readBodyMassChanges({ anchor, since }) {
  const options = { limit: 0, unit: 'lb', filter: { date: { startDate: since } } }
  const result = await queryQuantitySamplesWithAnchor(BODY_MASS, anchor ? { ...options, anchor } : options)
  try {
    return toBodyMassChanges(result)
  } finally {
    result?.samples?.forEach(s => s.dispose?.())
  }
}
