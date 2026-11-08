import { queue, rotation } from '../shared/training.js'

// The routine to suggest next. Works on a JSON copy: refillIfComplete rewrites the queue in place,
// and the caller's state must stay as it was.
export function nextRoutineId(state, today, now) {
  const copy = JSON.parse(JSON.stringify(state))
  rotation.refillIfComplete(copy, today, now)
  return queue.queueRemaining(copy)[0] ?? copy.routines?.[0]?.id ?? null
}
