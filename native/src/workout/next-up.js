import { queue, rotation } from '../shared/training.js'

const byDateThenStart = (a, b) => String(a.d ?? '').localeCompare(String(b.d ?? '')) || (a.start ?? 0) - (b.start ?? 0)

// The routine to suggest next, as the web's queue would have it. The web saves its queue and runs
// refillAfter as each finished workout lands; the phone never saves one, so it replays those
// finishes in date-then-start order. Works on a JSON copy: refillAfter rewrites the queue in
// place, and the caller's state must stay as it was.
export function nextRoutineId(state, now) {
  const copy = JSON.parse(JSON.stringify(state))
  const finished = [...(copy.workouts ?? [])].sort(byDateThenStart)
  copy.workouts = []
  for (const w of finished) {
    copy.workouts.push(w)
    rotation.refillAfter(copy, w, w.d, w.end ?? w.start ?? now)
  }
  return queue.queueRemaining(copy)[0] ?? copy.routines?.[0]?.id ?? null
}
