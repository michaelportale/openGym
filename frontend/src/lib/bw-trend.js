// Body-weight trend: a day's weigh-in says as much about water and salt as about weight. The
// trend at each weigh-in is the mean of every weigh-in in the `days` days up to and including
// it, so one heavy morning moves the line by a fraction instead of all of it.
// points: [{ t: ms, y: number, d?: iso }] in any order. Returns the same shape, one per input,
// in time order (a sync merge or an edited weigh-in can leave the stored list out of order).
export const DAY_MS = 86400000

export function bwTrend(input, days = 7) {
  const points = [...input].sort((a, b) => a.t - b.t)
  const out = []
  let lo = 0, sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += points[i].y
    while (points[lo].t <= points[i].t - days * DAY_MS) sum -= points[lo++].y
    out.push({ t: points[i].t, y: Math.round(sum / (i - lo + 1) * 100) / 100, d: points[i].d })
  }
  return out
}

// How far the trend moved over the last week: the latest trend value against the trend value at
// the last weigh-in 7 or more days before it, and no more than 14 days before it, so a gap of a
// month is not passed off as a week. null when there is no such pair.
export function bwWeekChange(trend) {
  const last = trend.at(-1)
  if (!last) return null
  for (let i = trend.length - 2; i >= 0; i--) {
    const gap = last.t - trend[i].t
    if (gap < 7 * DAY_MS) continue
    if (gap > 14 * DAY_MS) return null
    return Math.round((last.y - trend[i].y) * 100) / 100
  }
  return null
}

// How far the trend moved within the last `days` days up to `now`: the latest trend value in the
// window against the first one. null with fewer than two weigh-ins in it, so a log that stopped
// months ago says nothing about the last 30 days. Feeds the Stats "Weight 30d" tile, so one
// heavy morning at either end does not decide the number.
export function bwTrendChange(trend, days = 30, now = Date.now()) {
  const inWindow = trend.filter(p => p.t > now - days * DAY_MS && p.t <= now)
  if (inWindow.length < 2) return null
  return Math.round((inWindow.at(-1).y - inWindow[0].y) * 100) / 100
}

// Whether a change moves toward the goal: true or false, or null with no goal, no change, or
// the goal already reached. Said in words next to a neutral number (body weight is not a score).
export function bwTowardGoal(delta, current, goal) {
  if (!delta || goal == null || !isFinite(goal) || current == null) return null
  if (Math.abs(goal - current) < 0.05) return null
  return (delta < 0) === (goal < current)
}

// Weigh-ins the trend needs before it is drawn; fewer show as dots with a nudge to log more.
export const BW_TREND_MIN = 3
