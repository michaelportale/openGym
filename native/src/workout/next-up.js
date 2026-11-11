import { format, history, queue, rotation } from '../shared/training.js'

const byDateThenStart = (a, b) => String(a.d ?? '').localeCompare(String(b.d ?? '')) || (a.start ?? 0) - (b.start ?? 0)

// A weekday list or a date override that names a routine, or the rest sentinel.
function holdsPinOrRest(map) {
  if (!map || typeof map !== 'object') return false
  return Object.values(map).some(value => {
    if (value === 'rest') return true
    if (typeof value === 'string') return value.length > 0
    if (!Array.isArray(value)) return false
    return value.some(id => id === 'rest' || (typeof id === 'string' && id.length > 0))
  })
}

// The week decides only when nothing live is queued and a fixed week is actually in force:
// the mode was chosen, or week / dayPlan holds a pin or rest. A usable queue keeps scheduleModeOf
// on 'rotation', and that stays on the replay below.
function weekInForce(state) {
  if (rotation.scheduleModeOf(state) !== 'week') return false
  return state.scheduleMode === 'week' || holdsPinOrRest(state.week) || holdsPinOrRest(state.dayPlan)
}

// Today's plan, else the next day that has something to train. A routine with no exercises still
// counts today; nextTrainingDay is the one that skips an empty session. Reads a shallow copy so
// a missing week, dayPlan, or routines cannot throw, and the caller's object stays as it was.
function routineFromWeek(state, now) {
  const view = {
    ...state,
    week: state.week ?? {},
    dayPlan: state.dayPlan ?? {},
    routines: state.routines ?? [],
  }
  const iso = format.isoOf(new Date(now))
  const today = history.effectiveRoutineIds(view, iso, iso)
  if (today.length) return today[0]
  return history.nextTrainingDay(view, iso)?.routine?.id ?? null
}

// The queue next-up replays, and the one a rotation edit is built on. A deep copy: refillAfter
// rewrites the queue in place, and the caller's state must stay as it was. Finishes land in
// date-then-start order, then refillAfter, as they would have on the web.
export function replayFinishes(state, now) {
  const copy = JSON.parse(JSON.stringify(state))
  const finished = [...(copy.workouts ?? [])].sort(byDateThenStart)
  copy.workouts = []
  for (const w of finished) {
    copy.workouts.push(w)
    rotation.refillAfter(copy, w, w.d, w.end ?? w.start ?? now)
  }
  return copy
}

// The routine to suggest next. A fixed week follows history. Otherwise this is the web's queue:
// the web saves its queue and runs refillAfter as each finished workout lands; the phone never
// saves one, so it replays those finishes.
export function nextRoutineId(state, now) {
  if (weekInForce(state)) return routineFromWeek(state, now)
  const copy = replayFinishes(state, now)
  return queue.queueRemaining(copy)[0] ?? copy.routines?.[0]?.id ?? null
}
