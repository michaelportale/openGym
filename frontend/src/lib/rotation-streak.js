// Rotation streak: counts sessions that keep a training loop going, rather than calendar weeks
// with any workout in them (streakWeeks, history.js). A pure function of the state, so imports,
// backdated logs and deletions are handled by recomputing from scratch.
//
// The loop: in Rotation mode, the rotation's routines; in Fixed Week, the routines planned on
// the weekday grid. N is the loop's length (sequence slots, or planned weekdays), and P is the
// number of days a round is meant to take (S.roundDays in Rotation mode, 7 in Fixed Week).
//
// Walking the log oldest to newest, one step per workout day:
//   - a gap of more than maxGap days since the last workout spends one rest pass if one is banked
//     and the gap is no longer than twice maxGap; otherwise the streak ends and a new one starts;
//   - a day with a loop session adds 1 (two on one day count once);
//   - a day with only other training (cardio, a freestyle session) adds nothing, but it resets
//     the gap clock: showing up counts;
//   - doing every routine of the loop completes a round and banks a pass, at most MAX_PASSES.
// A pause (break, sick, injured) freezes the clock: the gap is measured from the day it ended.
//
// S.status = null | { kind: 'break'|'sick'|'injured', since: iso }  (the pause running now)
// S.pauses = [{ kind, since, until }]                                (pauses that have ended)
import { isoOf, todayISO } from './format.js'
import { workoutDay } from './history.js'
import { scheduleModeOf, rotationIds } from './rotation.js'

export const ROUND_DAY_OPTIONS = [7, 10, 14]
export const MAX_PASSES = 2
export const PAUSE_KINDS = ['break', 'sick', 'injured']

const ISO = /^\d{4}-\d{2}-\d{2}$/
// Whole days since the epoch, from the calendar date alone, so DST never shifts a gap.
const dayNum = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000)
const isoOfNum = n => { const d = new Date(n * 86400000); return isoOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)) }
const idsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : (w?.routineId ? [w.routineId] : []))

/** The default round length: two weeks for a loop of 6 or more routines, one week below that. */
export const defaultRoundDays = n => (n >= 6 ? 14 : 7)

/** The gap a streak survives: twice the loop's spacing, never under 3 days. */
export const maxGapOf = (P, N) => Math.max(3, Math.ceil((2 * P) / Math.max(1, N)))

/**
 * The loop the streak follows, or null when there is none (no rotation, nothing planned).
 * { mode: 'rotation'|'week', ids: string[] (unique routine ids), N, P }
 */
export function streakLoop(S) {
  const routines = Array.isArray(S?.routines) ? S.routines : []
  const exists = id => routines.some(r => r.id === id)
  if (scheduleModeOf(S) === 'rotation') {
    const seq = (Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : []).filter(exists)
    const ids = rotationIds(S)
    if (!ids.length) {
      const q = Array.isArray(S?.queue?.ids) ? S.queue.ids.filter(exists) : []
      const qIds = q.filter((id, i) => q.indexOf(id) === i)
      if (!qIds.length) return null
      return { mode: 'rotation', ids: qIds, N: qIds.length, P: roundDaysOf(S, qIds.length) }
    }
    const N = Math.max(seq.length, ids.length)
    return { mode: 'rotation', ids, N, P: roundDaysOf(S, N) }
  }
  const week = S?.week && typeof S.week === 'object' ? S.week : {}
  let N = 0
  const ids = []
  for (let wd = 0; wd < 7; wd++) {
    const day = [].concat(week[wd] || []).filter(exists)
    if (day.length) N++
    for (const id of day) if (!ids.includes(id)) ids.push(id)
  }
  return N ? { mode: 'week', ids, N, P: 7 } : null
}

export const roundDaysOf = (S, N) => (ROUND_DAY_OPTIONS.includes(S?.roundDays) ? S.roundDays : defaultRoundDays(N))

// Pause intervals as day numbers, the running one ending today.
function pausesOf(S, todayN) {
  const out = []
  for (const p of Array.isArray(S?.pauses) ? S.pauses : []) {
    if (p && ISO.test(p.since || '') && ISO.test(p.until || '')) out.push([dayNum(p.since), dayNum(p.until)])
  }
  const st = S?.status
  if (st && ISO.test(st.since || '')) out.push([dayNum(st.since), todayN])
  return out
}

// The day the gap clock counts from: the last workout, or the end of a pause after it.
const clockFrom = (anchor, upTo, pauses) => {
  let from = anchor
  for (const [a, b] of pauses) if (b >= anchor && a <= upTo && b < upTo) from = Math.max(from, b)
  return from
}

/**
 * The streak as of `today`.
 * Returns null when there is no loop (callers fall back to the week streak), else
 * { mode, N, P, maxGap, count, rounds, passes, best, state, deadline, kind, since }
 * state: 'zero' (never trained) | 'active' | 'atRisk' | 'paused' | 'broken'
 * deadline: the last day a session keeps the streak (iso), for 'active' and 'atRisk'.
 */
export function rotationStreak(S, today = todayISO()) {
  const loop = streakLoop(S)
  if (!loop) return null
  const { mode, ids, N, P } = loop
  const maxGap = maxGapOf(P, N)
  const todayN = dayNum(today)
  const pauses = pausesOf(S, todayN)

  // One step per day: whether any session that day was part of the loop, and which routines.
  const days = new Map()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const d = workoutDay(w)
    if (!d || d > today) continue
    const n = dayNum(d)
    const day = days.get(n) || new Set()
    for (const id of idsOf(w)) if (ids.includes(id)) day.add(id)
    days.set(n, day)
  }

  let count = 0, rounds = 0, passes = 0, best = 0, anchor = null
  let seen = new Set()
  const end = () => { count = 0; rounds = 0; passes = 0; seen = new Set() }
  for (const n of [...days.keys()].sort((a, b) => a - b)) {
    if (anchor !== null) {
      const gap = n - clockFrom(anchor, n, pauses)
      if (gap > maxGap) {
        if (passes > 0 && gap <= 2 * maxGap) passes--
        else end()
      }
    }
    const done = days.get(n)
    if (done.size) {
      count++
      for (const id of done) seen.add(id)
      if (ids.every(id => seen.has(id))) { rounds++; passes = Math.min(MAX_PASSES, passes + 1); seen = new Set() }
    }
    anchor = n
    best = Math.max(best, count)
  }

  const base = { mode, N, P, maxGap, rounds, passes, best, deadline: null, kind: null, since: null }
  if (anchor === null) return { ...base, count: 0, state: 'zero' }
  if (S?.status && ISO.test(S.status.since || '')) {
    return { ...base, count, state: 'paused', kind: PAUSE_KINDS.includes(S.status.kind) ? S.status.kind : 'break', since: S.status.since }
  }
  const from = clockFrom(anchor, todayN, pauses)
  const limit = passes > 0 ? 2 * maxGap : maxGap
  const gap = todayN - from
  if (count === 0 || gap > limit) return { ...base, count: 0, rounds: 0, passes: 0, state: best > 0 ? 'broken' : 'zero' }
  return { ...base, count, state: gap > limit - 2 ? 'atRisk' : 'active', deadline: isoOfNum(from + limit) }
}
