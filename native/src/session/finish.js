import { history } from '../shared/training.js'

// The folded document is the shape buildCompletedWorkout already writes. The API stores that
// object on state.workouts, with vol filled in the same way the web finish path does
// (workoutVolume, which leaves warm-ups flagged on the set and out of the total). This module
// does not send anything. The caller passes the result to its own sender.

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function upsertWorkout(workouts, workout) {
  const list = (Array.isArray(workouts) ? workouts : []).filter(isRecord)
  const id = workout?.id
  if (id == null) return list.concat(workout)
  const index = list.findIndex(item => item.id === id)
  if (index < 0) return list.concat(workout)
  const next = list.slice()
  next[index] = workout
  return next
}

export function toWorkoutPayload(finished, { workouts } = {}) {
  if (!isRecord(finished) || finished.id == null || finished.id === '') {
    throw new Error('finished session needs an id')
  }
  // Plain JSON only. Hermes on device may not provide structuredClone, and a Node
  // test run would not notice. JSON copy is the path that exists on both.
  const workout = JSON.parse(JSON.stringify(finished))
  workout.vol = history.workoutVolume(workout)
  return { workout, workouts: upsertWorkout(workouts, workout) }
}
