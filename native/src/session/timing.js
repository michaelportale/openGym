// Timing strategy
//
// Event order is the journal order. Each event stores the injected clock's `at` when it is
// appended. Replay never re-reads a running timer; rest and duration are recomputed.
//
// Rest remaining while running is deadline - now, clamped to [0, total]. Zero means the rest is
// complete. Nothing in this module starts the next set. Pause stores the remaining time and a
// new deadline anchored at the pause instant (pausedAt + remaining). While paused, remaining
// does not consult `now`, so backgrounding and a clock step leave it where it was. Extend adds
// to that deadline (and to the frozen remaining, when paused). A later rest.start is how a
// paused rest starts counting again.
//
// Session elapsed walks stamps in journal order and keeps a high-water mark. A backward step
// (delta <= 0) adds nothing and does not pull the high-water mark back, so elapsed cannot go
// negative or shrink. A forward gap longer than DURATION_GAP_MS adds nothing either. The bound
// is 4 hours: long enough that a locked phone still counts as session time (the workout keeps
// running in the background), and short enough that a multi-hour clock jump or an overnight
// return is not added. Time zones do not enter this math. Stamps are epoch milliseconds.
//
// Overnight is a local-date change in the session's time zone, and only when `now` is actually
// later than the last activity. Finishing that session requires an explicit end. The suggested
// end comes from the shared sessionEnd helper, which already clips a forgotten gap to the last
// logged work. Discard and resume are the other two choices. Resume appends an event so the
// activity anchor moves to "now" without adding the gap to elapsed.

// Matches frontend/src/lib/duration.js REST_MAX (15 minutes). Not imported: only
// native/src/shared/training.js may import frontend/, and it does not re-export duration.js.
export const REST_MAX_MS = 15 * 60 * 1000

export const DURATION_GAP_MS = 4 * 60 * 60 * 1000

export function clampMs(value, max = Infinity) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (Number.isFinite(max) && value > max) return max
  return value
}

export function localDate(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs))
  const pick = type => parts.find(part => part.type === type).value
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function isOvernight(activityAt, now, timeZone) {
  if (!Number.isFinite(activityAt) || !Number.isFinite(now)) return false
  if (now <= activityAt) return false
  return localDate(activityAt, timeZone) !== localDate(now, timeZone)
}

export function elapsedMs(stamps, now, gap = DURATION_GAP_MS) {
  let elapsed = 0
  let high = null
  for (const raw of stamps) {
    if (!Number.isFinite(raw)) continue
    if (high == null) {
      high = raw
      continue
    }
    const delta = raw - high
    if (delta > 0 && delta <= gap) elapsed += delta
    if (raw > high) high = raw
  }
  if (high != null && Number.isFinite(now)) {
    const tail = now - high
    if (tail > 0 && tail <= gap) elapsed += tail
  }
  return elapsed
}

export function projectRest(rest, now) {
  if (!rest) return null
  if (rest.status === 'paused') {
    return {
      status: 'paused',
      deadline: rest.deadline,
      remainingMs: clampMs(rest.remainingMs, rest.totalMs),
      totalMs: rest.totalMs,
    }
  }
  const remainingMs = clampMs(rest.deadline - now, rest.totalMs)
  return {
    status: remainingMs === 0 ? 'complete' : 'running',
    deadline: rest.deadline,
    remainingMs,
    totalMs: rest.totalMs,
  }
}
