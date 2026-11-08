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
// running in the background), and short enough that a multi-hour clock jump is not added.
//
// Leaving the session across a local midnight is not session time when the gap is longer
// than a rest. The open tail and samples from this process still count a local-date change
// within REST_MAX_MS, so a set at 23:50 and a look at 00:05 keep the timer moving instead of
// jumping back to the set. A longer overnight return stays out. Time already counted on the
// earlier side of midnight stays counted: a later idle sample does not rewind the timer.
// A set logged on the other side of midnight still counts, because that gap sits between two
// journal events. Resume adds its gap only when that gap is within REST_MAX_MS. A longer
// resume moves the high-water mark and adds nothing. Stamps are epoch milliseconds. A number
// is a journal stamp. Resume is { at, resume: true }. A sample from this process is
// { at, sample: true }.
//
// Overnight is a local-date change in the session's time zone, and only when `now` is actually
// later than the last activity. Finishing that session requires an explicit end. The suggested
// end comes from the shared sessionEnd helper, which already clips a forgotten gap to the last
// logged work. Discard and resume are the other two choices. Resume appends an event so the
// activity anchor moves to "now".

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

export function stampAt(stamp) {
  if (Number.isFinite(stamp)) return stamp
  if (stamp && Number.isFinite(stamp.at)) return stamp.at
  return null
}

function crossesLocalDate(prev, next, timeZone) {
  if (!timeZone || !Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) return false
  return localDate(prev, timeZone) !== localDate(next, timeZone)
}

function idleOvernight(delta, prev, next, timeZone) {
  return delta > REST_MAX_MS && crossesLocalDate(prev, next, timeZone)
}

function walkElapsed(stamps, now, gap, timeZone) {
  let elapsed = 0
  let high = null
  // Last instant that actually added to the timer. A later sample that is dropped
  // (an idle overnight look) must not replace it, or a restart would rewind.
  let shown = null
  for (const raw of stamps) {
    const at = stampAt(raw)
    if (at == null) continue
    if (high == null) {
      high = at
      shown = at
      continue
    }
    const delta = at - high
    const resume = !!raw && raw.resume === true
    const sample = !!raw && raw.sample === true
    const dropResume = resume && delta > REST_MAX_MS
    const dropSample = sample && idleOvernight(delta, high, at, timeZone)
    if (!dropResume && !dropSample && delta > 0 && delta <= gap) {
      elapsed += delta
      shown = at
    }
    if (at > high) high = at
  }
  if (high != null && Number.isFinite(now)) {
    const tail = now - high
    if (!idleOvernight(tail, high, now, timeZone) && tail > 0 && tail <= gap) {
      elapsed += tail
      shown = now
    }
  }
  return { elapsed, shown }
}

export function elapsedMs(stamps, now, gap = DURATION_GAP_MS, timeZone) {
  return walkElapsed(stamps, now, gap, timeZone).elapsed
}

export function shownThrough(stamps, now, gap = DURATION_GAP_MS, timeZone) {
  return walkElapsed(stamps, now, gap, timeZone).shown
}

function hopCounts(prev, next, timeZone) {
  const delta = next - prev
  if (!(delta > 0 && delta <= DURATION_GAP_MS)) return false
  if (idleOvernight(delta, prev, next, timeZone)) return false
  return true
}

// Drop a counted instant only when the hop from the one before it to the one after
// still counts. A later reopen can seed this list and get the same elapsed.
export function compactSeen(stamps, timeZone) {
  const points = []
  for (const raw of stamps) {
    const at = stampAt(raw)
    if (!Number.isFinite(at)) continue
    if (points.length && at <= points[points.length - 1]) continue
    points.push(at)
    while (points.length >= 3) {
      const earlier = points[points.length - 3]
      const middle = points[points.length - 2]
      const later = points[points.length - 1]
      const bridge = hopCounts(earlier, middle, timeZone)
        && hopCounts(middle, later, timeZone)
        && hopCounts(earlier, later, timeZone)
      if (!bridge) break
      points.splice(points.length - 2, 1)
    }
  }
  return points
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
