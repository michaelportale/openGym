// The model behind the Progress tab's lift list and strength trend. Pure; the screens memoise it on
// state identity.
import { exerciseHistory, strengthTrend } from '../shared/training.js'
import { findExercise } from '../exercises/detail-view.js'
import { cap } from '../sync/source.js'

const round1 = n => Math.round(n * 10) / 10

const label = (metric, value) => (
  metric === 'reps' ? `${value} reps` : metric === 'sec' ? `${value} s` : metric === 'min' ? `${value} min` : `Best: ${value} lb`
)

export function liftsView(state, { now }) {
  const S = state || {}
  const nameOf = id => {
    const ex = findExercise(S, id)
    return ex ? cap(ex.n) : null
  }
  const trend = []
  for (const row of strengthTrend.strengthTrend(S, { now })) {
    const name = nameOf(row.id)
    if (name === null) continue
    const d = round1(row.delta)
    const sign = d === 0 ? '±' : d > 0 ? '+' : '−'
    trend.push({ id: row.id, name, now: row.now, delta: row.delta, line: `e1RM ${round1(row.now)} lb (${sign}${Math.abs(d)} lb)` })
  }
  const lifts = []
  const ids = new Set((S.workouts || []).flatMap(w => (w.entries || []).map(e => e && e.id).filter(id => id != null)))
  for (const id of ids) {
    const name = nameOf(id)
    if (name === null) continue
    const h = exerciseHistory.exerciseHistory(S, id)
    if (!h.total || !(h.best > 0)) continue
    lifts.push({ id, name, value: h.best, label: label(h.metric, h.best) })
  }
  // The web's Stats picker orders the same way: biggest figure first, then name, whatever the equipment.
  lifts.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  return { trend, lifts }
}
