import { describe, expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { progression } from '../shared/training.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createSessionController } from '../session/session-controller.js'
import { sessionOptionsFrom } from '../session/use-active-session.js'
import { sessionState } from './history-state.js'
import { nextTimeLines, savedNextTime } from './next-time.js'
import { withTargets } from './session-screen.js'
import { completeCall, restAfterComplete } from './set-calls.js'
import { buildSessionBase } from './start-session.js'
import { workoutScreen } from './workout-view.js'

// The real shape end to end: a base built the way the phone builds it (equipment snapshot in lb),
// sets committed through the session controller, Finish folding and storing the workout
// (toWorkoutPayload), the saved screen's lines, and the next session built from the same phone
// history. The line and what the next session opens at must agree. Synthetic data only.

const snapshot = {
  names: { '0025': { name: 'Bench press', category: 'chest' } },
  state: {
    unit: 'lb',
    restSec: 90,
    // '0025' is a barbell lift with a 5 lb step; no policy named, so the native double default.
    routines: [{ id: 'push', name: 'Push', ex: [{ id: '0025', sets: 2, reps: 12, repsMin: 8 }] }],
    workouts: [],
  },
}
const timeZone = 'America/New_York'

// One phone session through the controller: every work set committed at `values`, rests started
// and skipped, then Finish. Returns the payload the sender was handed.
async function logSession({ db, base, clock, values }) {
  const now = () => clock.at
  const controller = createSessionController(sessionOptionsFrom({ db, base, now, timeZone }))
  await controller.open()
  const viewOf = () => withTargets(controller.getState().view, base)
  for (let i = 0; i < base.entries[0].sets.length; i++) {
    const { dock } = workoutScreen(viewOf(), { names: snapshot.names, title: base.name })
    clock.at += 60_000
    const call = completeCall(viewOf(), { setId: dock.setId, side: dock.side, values, eventId: `c-${clock.at}`, now: clock.at })
    expect((await controller.call('commitSet', call)).saved).toBe(true)
    const rest = restAfterComplete(viewOf(), dock.setId, () => 90_000)
    if (rest) expect((await controller.call('startRest', rest)).saved).toBe(true)
    clock.at += 5_000
    expect((await controller.call('cancelRest', { eventId: `skip-${clock.at}` })).saved).toBe(true)
  }
  clock.at += 60_000
  let sent = null
  const done = await controller.finishSession({ sender: async payload => { sent = payload; return { saved: true } } })
  expect(done).toMatchObject({ ok: true, saved: true })
  return sent
}

describe.each(SQLITE_DRIVERS)('%s: finished workout to next-time line to next start', (_name, createDb) => {
  test('the saved line and the next session open at the same weight and reps', async () => {
    const clock = { at: Date.parse('2026-11-09T22:00:00Z') }
    const db = createDb()
    const finished = createSqliteFinishedWorkouts(db)

    const state = sessionState(snapshot, await finished.list())
    const routine = state.routines[0]
    const base = buildSessionBase({ state, routine, now: clock.at, timeZone, id: 'phone-1' })
    expect(base.entries[0].equipmentSnapshot).toMatchObject({ loadConvention: 'barbell-total', unit: 'lb' })

    const sent = await logSession({ db, base, clock, values: { w: 80, r: 12 } })

    // The stored workout is the folded payload, equipment snapshot and all.
    const phone = await finished.list()
    expect(phone).toEqual([sent.workout])
    expect(phone[0].entries[0].equipmentSnapshot).toMatchObject({ loadConvention: 'barbell-total', unit: 'lb' })

    // The saved screen: the session's state plus the phone's workouts, the saved one included.
    const lines = savedNextTime({ state, base, phoneWorkouts: phone, names: snapshot.names })
    expect(lines).toEqual([expect.objectContaining({
      exerciseId: '0025',
      kind: 'up',
      weight: 85,
      reps: '8–12',
      text: 'Bench press — next time 85 lb × 8–12',
      reason: 'Top of the rep range in every set. 5 lb more, back to 8 reps.',
      whyId: 'double-progression',
    })])

    // The next start, as the Workout tab reloads it: the same weight, the reps the reason names.
    const after = sessionState(snapshot, phone)
    expect(nextTimeLines(after, after.routines[0], phone[0].entries, snapshot.names)).toEqual(lines)
    const again = buildSessionBase({ state: after, routine: after.routines[0], now: clock.at, timeZone, id: 'phone-2' })
    expect(again.entries[0].sets.map(s => [s.w, s.r])).toEqual([[85, 8], [85, 8]])
    expect(again.entries[0].target).toMatchObject({ weight: 85, reps: 8 })
  })

  test('a plateau at the opened reps is graded against them: three sessions of 85 × 8 hold, no deload', async () => {
    // Last week topped 80 × 12, so the raise opens 85 × 8. Then 8, 8 three sessions running.
    const cfg = snapshot.state.routines[0].ex[0]
    const topped = {
      id: 'old', d: '2026-11-02', start: Date.parse('2026-11-02T22:00:00Z'), routineIds: ['push'],
      entries: [{
        id: '0025', rid: 'push', target: { ...cfg, weight: 80 }, planned: progression.plannedOf(cfg),
        equipmentSnapshot: { stationId: null, loadConvention: 'barbell-total', unit: 'lb', status: 'unknown' },
        sets: [{ w: 80, r: 12, done: true }, { w: 80, r: 12, done: true }],
      }],
    }
    const start = { ...snapshot, state: { ...snapshot.state, workouts: [topped] } }
    const clock = { at: Date.parse('2026-11-09T22:00:00Z') }
    const db = createDb()
    const finished = createSqliteFinishedWorkouts(db)
    const opened = []
    let lines = []
    for (let day = 0; day < 3; day++) {
      const state = sessionState(start, await finished.list())
      const base = buildSessionBase({ state, routine: state.routines[0], now: clock.at, timeZone, id: `plateau-${day}` })
      opened.push(base.entries[0].sets.map(s => [s.w, s.r]))
      await logSession({ db, base, clock, values: { w: 85, r: 8 } })
      lines = savedNextTime({ state, base, phoneWorkouts: await finished.list(), names: snapshot.names })
      clock.at += 24 * 60 * 60_000
    }
    // The raise, then the aim one rep up while the misses are counted against it.
    expect(opened).toEqual([[[85, 8], [85, 8]], [[85, 9], [85, 9]], [[85, 9], [85, 9]]])
    expect(lines).toEqual([expect.objectContaining({ kind: 'hold', weight: 85, reason: 'Same weight, aim for 9 reps this time.' })])
    const state = sessionState(start, await finished.list())
    const next = buildSessionBase({ state, routine: state.routines[0], now: clock.at, timeZone, id: 'plateau-3' })
    expect(next.entries[0].sets.map(s => [s.w, s.r])).toEqual([[85, 9], [85, 9]])
  })
})
