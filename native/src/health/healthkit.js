import {
  ComparisonPredicateOperator,
  WorkoutActivityType,
  deleteObjects,
  queryQuantitySamples,
  queryWorkoutSamples,
  requestAuthorization,
  saveWorkoutSample
} from '@kingstinct/react-native-healthkit'
import { syncMetadata } from './gates.js'

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
    filter: { metadata: { withMetadataKey: 'HKSyncIdentifier', operatorType: ComparisonPredicateOperator.equalTo, value: id } }
  })
  return workouts.map(w => {
    try {
      return { uuid: w.uuid, syncVersion: w.metadata.HKSyncVersion, volumeLb: w.metadata.openGymTotalVolumeLb }
    } finally {
      w.dispose()
    }
  })
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
