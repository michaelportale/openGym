import {
  ComparisonPredicateOperator,
  WorkoutActivityType,
  deleteObjects,
  queryQuantitySamples,
  querySources,
  queryWorkoutSamples,
  requestAuthorization,
  saveWorkoutSample
} from '@kingstinct/react-native-healthkit'
import { syncIdOf, syncMetadata } from './gates.js'

const WORKOUT = 'HKWorkoutTypeIdentifier'
const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass'

export async function requestHealthAccess() {
  await requestAuthorization({ toShare: [WORKOUT, BODY_MASS], toRead: [WORKOUT, BODY_MASS] })
}

export async function saveStrengthWorkout({ id, version, start, end, volumeLb }) {
  const workout = await saveWorkoutSample(
    WorkoutActivityType.traditionalStrengthTraining,
    [],
    start,
    end,
    undefined,
    syncMetadata(id, version, volumeLb)
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
      return { uuid: w.uuid, syncVersion: Number(w.metadata.HKMetadataKeySyncVersion), volumeLb: Number(w.metadata.openGymTotalVolumeLb) }
    } finally {
      w.dispose()
    }
  })
}

export async function findOwnWorkouts(ownBundleId) {
  const sources = await querySources(WORKOUT)
  try {
    const own = sources.filter(s => s.bundleIdentifier === ownBundleId)
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

export function deleteWorkout(uuid) {
  return deleteObjects(WORKOUT, { uuid })
}

export async function readBodyMass({ start, end }) {
  const samples = await queryQuantitySamples(BODY_MASS, {
    limit: 0,
    unit: 'lb',
    filter: { date: { startDate: start, endDate: end } }
  })
  return samples.map(s => ({
    uuid: s.uuid,
    lb: s.quantity,
    at: s.startDate,
    bundleId: s.sourceRevision.source.bundleIdentifier
  }))
}
