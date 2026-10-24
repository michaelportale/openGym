// Stats' strength trend: the lifts trained most in the last few weeks, each with its estimated
// 1RM now and how far it moved over that window. Read from e1rmSeries (lib/onerm.js), the same
// per-workout estimates the Exercise progress chart draws, so the two always agree. Nothing here
// is stored.
import { e1rmSeries } from './onerm.js'

export const TREND_DAYS = 56

/**
 * Up to `max` lifts with at least two estimates inside the window, most-trained first (ties go
 * to the heavier estimate). Each row: `{ id, points, now, from, delta }`, where `points` are the
 * window's estimates oldest first, `now` the latest, `from` the first and `delta` their gap.
 * Assisted lifts have no estimate (e1rmSeries returns none), so they never appear.
 */
export function strengthTrend(S, { now = Date.now(), days = TREND_DAYS, max = 3 } = {}) {
  const from = now - days * 86400000
  const ids = [...new Set((S.workouts || []).flatMap(w => (w.entries || []).map(e => e && e.id).filter(id => id != null)))]
  const rows = []
  for (const id of ids) {
    let pts
    try { pts = e1rmSeries(S, id) } catch { continue }
    pts = pts.filter(p => p.t >= from && p.t <= now && p.y > 0).sort((a, b) => a.t - b.t)
    if (pts.length < 2) continue
    const first = pts[0], last = pts[pts.length - 1]
    rows.push({ id, points: pts, now: last.y, from: first.y, delta: last.y - first.y })
  }
  rows.sort((a, b) => b.points.length - a.points.length || b.now - a.now)
  return rows.slice(0, max)
}
