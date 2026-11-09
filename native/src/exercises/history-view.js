// The model behind "Your history" on an exercise's screen: the chart series, whether Est. 1RM
// can be shown, and the recent sessions as plain lines. Pure; the screen renders it.
import { exerciseHistory } from '../shared/training.js'
import { dayLabel } from '../ui/dates.js'

// A per-side set contributes the sides that were done; any other row is one set.
const flat = rows => rows.flatMap(s => (s?.sides ? [s.sides.L, s.sides.R].filter(x => x?.done === true) : [s]))

function setText(s, mode) {
  if (mode === 'time') return `${Number(s.sec) || 0} s`
  if (mode === 'cardio') return `${Number(s.min) || 0} min`
  const w = Number(s.w) || 0
  const r = Number(s.r) || 0
  return w > 0 ? `${w} × ${r}` : String(r)
}

/** @returns {null | { chart: { points: object[] }, canToggle: boolean, metric: 'top'|'e1rm', sessions: { d: string, label: string, sets: string, pr: boolean }[] }} */
export function exerciseHistoryView(state, id, { metric = 'top', now = Date.now() } = {}) {
  const h = exerciseHistory.exerciseHistory(state || {}, id)
  if (!h.sessions.length) return null
  // The chart needs two points: with one session there is nothing for Est. 1RM to change. Only a
  // weight chart has an Est. 1RM to switch to: a timed or cardio chart plots seconds or minutes.
  const canToggle = h.metric === 'weight' && h.e1rmPoints.length > 1
  const shown = canToggle && metric === 'e1rm' ? 'e1rm' : 'top'
  return {
    chart: { points: shown === 'e1rm' ? h.e1rmPoints : h.points },
    canToggle,
    metric: shown,
    sessions: h.sessions.map(s => ({
      d: s.d,
      label: dayLabel(s.d, now),
      sets: flat(s.sets).map(x => setText(x, s.mode)).join(', '),
      pr: !!s.pr,
    })),
  }
}
