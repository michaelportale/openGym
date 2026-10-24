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
