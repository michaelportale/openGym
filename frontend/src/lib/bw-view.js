// The body-weight figures both apps show, in one place: the weigh-ins in a range, the 7-day
// trend over them, and the week / 30-day changes. Wording, notes and summary stay in each view.
import { bwTrend, bwWeekChange, bwTrendChange, bwTowardGoal, BW_TREND_MIN, DAY_MS } from './bw-trend.js'

const timeOf = b => b.t || new Date(b.d).getTime()

// range is in days; 0 means all. Returns fresh point objects, so a view may annotate them.
export function bodyweightView(bodyweight, { range = 90, now = Date.now(), targetW = null } = {}) {
  const inRange = t => range === 0 || t > now - range * DAY_MS
  const all = bodyweight.map(b => ({ t: timeOf(b), y: b.w, d: b.d }))
  const points = all.filter(p => inRange(p.t))
  // The 7-day trend runs over every weigh-in, then is cut to the range, so the first point of
  // a 30-day view still averages the week before it.
  const trendAll = bwTrend(all)
  const week = bwWeekChange(trendAll)
  const trendNow = trendAll.at(-1) ?? null
  return {
    points,
    trend: trendAll.filter(p => inRange(p.t)),
    trendNow,
    week,
    // The tile reads the trend, not the first and last raw weigh-ins of the month.
    delta30: bwTrendChange(trendAll, 30, now),
    toward: bwTowardGoal(week, trendNow?.y, targetW),
    enough: points.length >= BW_TREND_MIN,
    last7: bodyweight.slice(-7).reverse(),
  }
}
