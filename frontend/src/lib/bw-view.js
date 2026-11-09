// The body-weight figures both apps show, in one place: the weigh-ins in a range, the 7-day
// trend over them, and the week / 30-day changes. Wording, notes and summary stay in each view.
import { bwTrend, bwWeekChange, bwTrendChange, bwTowardGoal, BW_TREND_MIN, DAY_MS } from './bw-trend.js'

// A weigh-in sits at local noon of its day (the workoutAt rule). Not at its t: t is the entry's
// last write, and a Health import stamps every day it brings in with the import pass's time.
// t stands in only when the day is unusable.
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const noonOf = d => {
  const m = typeof d === 'string' ? DAY_RE.exec(d) : null
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : null
}

// range is in days; 0 means all. Returns fresh point objects, so a view may annotate them.
export function bodyweightView(bodyweight, { range = 90, now = Date.now(), targetW = null } = {}) {
  // Windows are measured from today's noon (or now, once past it), so a 7-day average or a
  // 30-day range counts whole days whatever the hour, and this morning's weigh-in is inside them.
  // A day after today is held at that instant.
  const at = new Date(now)
  const end = Math.max(now, new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12).getTime())
  const timeOf = b => {
    const noon = noonOf(b.d)
    return noon === null ? b.t || new Date(b.d).getTime() : Math.min(noon, end)
  }
  const inRange = t => range === 0 || t > end - range * DAY_MS
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
    delta30: bwTrendChange(trendAll, 30, end),
    toward: bwTowardGoal(week, trendNow?.y, targetW),
    enough: points.length >= BW_TREND_MIN,
    last7: bodyweight.slice(-7).reverse(),
  }
}
