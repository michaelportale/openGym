import { sessionStart } from '../shared/training.js'
import { localDate } from '../session/timing.js'
import { createEventId } from '../session/ids.js'
import { applyOpeningWeights } from './last-time.js'

// The base document a session opens from, built as the web's beginWorkout builds it, with
// each work set opened at the prescription's weight, else at what was lifted last time.
export function buildSessionBase({ state, routine, now, timeZone, id = createEventId() }) {
  const built = sessionStart.buildSessionEntries(state, routine).map(e => ({ ...e, rid: routine.id }))
  return {
    id,
    d: localDate(now, timeZone),
    start: now,
    name: routine.name,
    routineIds: [routine.id],
    entries: applyOpeningWeights(built, state, routine.id, routine),
  }
}
