// "Your week" as a picture to share: the week so far, in the shape the workout share card takes
// (lib/workout-card.js workoutCardModel), so the same layout and painter draw it. Reads the
// workouts, writes nothing.
//   title   "Your week"
//   date    the week's first and last day
//   stats   workouts, volume, and the muscle that took the most sets
//   records every exercise that set a new best this week, named once, in the order they were set
//   levels  the week's muscle map
import { workoutVolume, workoutVolumeIsPartial, workoutDay } from './history.js'
import { EXIDX } from './exercises.js'
import { MUSCLES, MUSCLE_NAME, levelsOf, loadOfWorkouts } from './muscles.js'
import { fmtDateRange, fmtNum, fmtVol, capWords, weekKey, startOfWeek, isoOf, MONDAY } from './format.js'
import { t, exerciseNameClass } from './i18n-core.js'

export function weekWorkouts(workouts, today, ws = MONDAY) {
  const key = weekKey(today, ws)
  return (workouts || []).filter(w => { const d = workoutDay(w); return d && weekKey(d, ws) === key })
    .sort((a, b) => (workoutDay(a) < workoutDay(b) ? -1 : workoutDay(a) > workoutDay(b) ? 1 : (a.start || 0) - (b.start || 0)))
}

// The muscle with the most load this week, by the muscle map's own weighting; null for a week
// of only cardio or nothing logged.
export function topMuscle(load) {
  let best = null
  for (const m of MUSCLES) if ((load[m] || 0) > 0 && (!best || load[m] > load[best])) best = m
  return best
}

export function weekRecapModel(workouts, { today, ws = MONDAY, unit, nameOf }) {
  const week = weekWorkouts(workouts, today, ws)
  const first = startOfWeek(today, ws)
  const last = new Date(first); last.setDate(last.getDate() + 6)
  const vol = week.reduce((n, w) => n + (w.vol ?? workoutVolume(w)), 0)
  const partial = week.some(w => workoutVolumeIsPartial(w))
  const load = loadOfWorkouts(week)
  const top = topMuscle(load)
  const records = []
  for (const w of week) {
    const prs = new Set(w.prs || [])
    for (const e of w.entries || []) {
      if (!prs.has(e.id) || records.some(r => r.id === e.id)) continue
      const name = nameOf(e)
      records.push({ id: e.id, name: exerciseNameClass(EXIDX[e.id]) ? capWords(name) : name })
    }
  }
  const levels = levelsOf(load)
  return {
    title: t('Your week'),
    date: fmtDateRange(isoOf(first), isoOf(last)),
    stats: [
      { label: t('Workouts'), value: fmtNum(week.length) },
      { label: t('Volume'), value: fmtVol(vol, unit, partial) },
      ...(top ? [{ label: t('Top muscle'), value: t(MUSCLE_NAME[top] || top) }] : []),
    ],
    records: records.map(r => r.name),
    levels: MUSCLES.some(m => levels[m] > 0) ? levels : null,
    count: week.length,
  }
}
