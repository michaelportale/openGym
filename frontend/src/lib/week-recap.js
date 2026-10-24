// "Your week" as a picture to share: the week so far, in the shape the workout share card takes
// (lib/workout-card.js workoutCardModel), so the same layout and painter draw it. Reads the
// workouts, writes nothing.
//   title   "Your week"
//   date    the week's first and last day
//   stats   workouts, volume, and the muscle that took the most sets
//   records every exercise that set a new best this week, named once, in the order they were set
//   levels  the week's muscle map
// v2 (all additive, the painter skips what is missing):
//   sessions  one pill per rotation slot or planned day this week: { label, done, pr }
//   sessionsLine "{n} of {N} sessions" over the pills
//   recordValues each record's top weight this week and how far it passed the best before it
//   lines     the streak ("14 sessions on rotation", or "14 sessions in a row" in Fixed Week) and, only when asked for, the body weight
//   footer    "Made with openGym"
import { workoutVolume, workoutVolumeIsPartial, workoutDay, doneUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { streakLoop, rotationStreak } from './rotation-streak.js'
import { bwTrend, bwWeekChange } from './bw-trend.js'
import { EXIDX } from './exercises.js'
import { MUSCLES, MUSCLE_NAME, levelsOf, loadOfWorkouts } from './muscles.js'
import { fmtDateRange, fmtNum, fmtVol, capWords, weekKey, startOfWeek, isoOf, MONDAY } from './format.js'
import { t, tn, exerciseNameClass } from './i18n-core.js'

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

const idsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : (w?.routineId ? [w.routineId] : []))
const hasPR = w => Array.isArray(w?.prs) && w.prs.length > 0

// The week's slots. Rotation: one per place in the loop (a routine repeated in the sequence
// gets two), each filled by the first workout of the week that ran it. Fixed Week: one per
// planned weekday, done when a workout on that date ran one of the day's routines.
export function weekSessions(S, week, first) {
  const loop = streakLoop(S)
  if (!loop) return null
  const nameOfId = id => (S.routines || []).find(r => r.id === id)?.name || ''
  if (loop.mode === 'rotation') {
    const seq = (Array.isArray(S.rotation?.sequence) ? S.rotation.sequence : []).filter(id => loop.ids.includes(id))
    const slots = (seq.length >= loop.ids.length ? seq : loop.ids).map(id => ({ id, label: nameOfId(id), done: false, pr: false }))
    for (const w of week) {
      const slot = slots.find(sl => !sl.done && idsOf(w).includes(sl.id))
      if (slot) { slot.done = true; slot.pr = hasPR(w) }
    }
    return slots.map(({ label, done, pr }) => ({ label, done, pr }))
  }
  const out = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(first); d.setDate(d.getDate() + i)
    const day = [].concat(S.week?.[d.getDay()] || []).filter(id => loop.ids.includes(id))
    if (!day.length) continue
    const iso = isoOf(d)
    const ran = week.filter(w => workoutDay(w) === iso && idsOf(w).some(id => day.includes(id)))
    out.push({ label: day.map(nameOfId).join(' + '), done: ran.length > 0, pr: ran.some(hasPR) })
  }
  return out.length ? out : null
}

const topWeight = (entries, id) => Math.max(0, ...entries.filter(e => e.id === id)
  .flatMap(e => (e.sets || []).filter(s => !isWarmupRow(s) && doneUnits(s) > 0).map(s => Number(s.w) || 0)))

// opts.S (the whole state) turns on the v2 rows; opts.bw adds the body-weight line.
export function weekRecapModel(workouts, { today, ws = MONDAY, unit, nameOf, S = null, bw = false }) {
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
  // A record's number: the top weight of the lift this week and, when there was a best before
  // the week, by how much it passed it ("82.5 kg · +2.5"). A record without load has no number.
  const before = (workouts || []).filter(w => { const d = workoutDay(w); return d && d < isoOf(first) })
  const recordValues = records.map(r => {
    const top = Math.max(0, ...week.map(w => topWeight(w.entries || [], r.id)))
    if (!(top > 0)) return ''
    const was = Math.max(0, ...before.map(w => topWeight(w.entries || [], r.id)))
    return fmtNum(top) + ' ' + unit + (was > 0 && top > was ? ' · +' + fmtNum(Math.round((top - was) * 100) / 100) : '')
  })
  const v2 = {}
  if (S) {
    const sessions = weekSessions(S, week, first)
    if (sessions) {
      v2.sessions = sessions
      v2.sessionsLine = t('{0} of {1} sessions', sessions.filter(x => x.done).length, sessions.length)
    }
    const lines = []
    const streak = rotationStreak(S, today)
    if (streak && streak.count > 0 && streak.state !== 'broken') {
      // "on rotation" only in Rotation mode; a Fixed Week streak counts its planned sessions.
      lines.push(streak.mode === 'rotation'
        ? tn('{0} session on rotation', '{0} sessions on rotation', streak.count)
        : tn('{0} session in a row', '{0} sessions in a row', streak.count))
    }
    if (bw && (S.bodyweight || []).length) {
      const trend = bwTrend(S.bodyweight.map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w })))
      const now = trend.at(-1)
      const ch = bwWeekChange(trend)
      if (now) lines.push(t('7-day average {0}', fmtNum(now.y) + ' ' + unit)
        + (ch ? ' · ' + (ch > 0 ? '+' : '−') + fmtNum(Math.abs(ch)) : ''))
    }
    if (lines.length) v2.lines = lines
    v2.recordsTitle = t('New bests')
    v2.footer = t('Made with openGym')
  }
  return {
    ...v2,
    recordValues,
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
