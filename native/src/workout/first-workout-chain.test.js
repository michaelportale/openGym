import { describe, expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createSessionController } from '../session/session-controller.js'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'
import { sessionOptionsFrom } from '../session/use-active-session.js'
import { sessionState } from './history-state.js'
import { lastTime } from './last-time.js'
import { nextRoutineId } from './next-up.js'
import { lastTimesFor, withTargets } from './session-screen.js'
import { completeCall, restAfterComplete } from './set-calls.js'
import { buildSessionBase } from './start-session.js'
import { workoutScreen } from './workout-view.js'

// The first phone workout end to end, across the pieces each task built: a snapshot-shaped state
// picks the next routine and builds its base; the session controller logs sets through the
// screen's own calls, with a kill in the middle; Finish stores the workout; and the next start
// reads it back. Synthetic data only.

const since = Date.parse('2026-10-22T00:00:00Z')
const snapshot = {
  version: 1,
  example: false,
  names: {
    bench: { name: 'Bench press', category: 'chest' },
    lat: { name: 'Cable lateral raise', category: 'shoulders' },
    row: { name: 'Cable row', category: 'back' },
  },
  state: {
    unit: 'lb',
    restSec: 90,
    routines: [
      { id: 'push', name: 'Push', ex: [{ id: 'bench', sets: 2, reps: 8, weight: 0, prog: 'off' }, { id: 'lat', sets: 1, reps: 12, weight: 0, prog: 'off', side: true }] },
      { id: 'pull', name: 'Pull', ex: [{ id: 'row', sets: 2, reps: 10, weight: 0, prog: 'off' }] },
    ],
    rotation: { id: 'rot', sequence: ['push', 'pull'] },
    queue: { ids: ['push', 'pull'], since, startsOn: '2026-10-22', rotationId: 'rot' },
    scheduleMode: 'rotation',
    // Before the queue started, so it seeds "last time" but does not move the rotation.
    workouts: [{
      id: 'old', d: '2026-10-16', start: Date.parse('2026-10-16T17:00:00Z'), routineId: 'push', routineIds: ['push'],
      entries: [{ id: 'bench', sets: [{ w: 75, r: 8, done: true }, { w: 75, r: 7, done: true }] }],
    }],
  },
}

const timeZone = 'America/New_York'
const today = '2026-11-09'

describe.each(SQLITE_DRIVERS)('%s: snapshot to finished workout to next start', (_name, createDb) => {
  test('the next routine moves on and its exercises open at what the phone logged', async () => {
    let clock = Date.parse('2026-11-09T22:00:00Z')
    const now = () => clock
    let db = createDb()

    // Start: Push is next, and bench opens at last time's top weight.
    const state = sessionState(snapshot, await createSqliteFinishedWorkouts(db).list())
    expect(nextRoutineId(state, clock)).toBe('push')
    const base = buildSessionBase({ state, routine: state.routines.find(r => r.id === 'push'), now: clock, timeZone, id: 'phone-1' })
    const options = { names: snapshot.names, lastTimes: lastTimesFor(state, base), title: base.name }
    const open = async withBase => {
      const controller = createSessionController(sessionOptionsFrom({ db, base: withBase ? base : null, now, timeZone }))
      await controller.open()
      return controller
    }
    const viewOf = controller => withTargets(controller.getState().view, base)
    const screenOf = controller => workoutScreen(viewOf(controller), options)
    const complete = async (controller, values) => {
      const { dock } = screenOf(controller)
      clock += 60_000
      const call = completeCall(viewOf(controller), { setId: dock.setId, side: dock.side, values, eventId: `c-${clock}`, now: clock })
      expect(call).not.toBeNull()
      expect((await controller.call('commitSet', call)).saved).toBe(true)
      const rest = restAfterComplete(viewOf(controller), dock.setId, entry => (entry.target?.restSec ?? 90) * 1000)
      if (rest) expect((await controller.call('startRest', rest)).saved).toBe(true)
    }
    const skip = async controller => {
      clock += 5_000
      expect((await controller.call('cancelRest', { eventId: `skip-${clock}` })).saved).toBe(true)
    }

    let session = await open(true)
    expect(screenOf(session).dock).toMatchObject({ mode: 'ready', lead: 'Set 1 · 75 lb × 8' })

    // Set 1 from the sheet at a new weight; then a kill during its rest, which survives it.
    await complete(session, { w: 80, r: 8 })
    db = db.reopen()
    clock += 30_000
    session = await open(false)
    expect(screenOf(session).dock).toMatchObject({ mode: 'resting', lead: '1:00', sub: 'Next: set 2 · 80 lb × 8' })
    await skip(session)
    // Set 2 from the dock in one tap: the new weight carried, and it is what gets logged.
    expect(screenOf(session).dock).toMatchObject({ mode: 'ready', lead: 'Set 2 · 80 lb × 8' })
    await complete(session)
    await skip(session)

    // Lateral raise has no history, so it opens blank: the sheet's numbers for the left side,
    // then the right in one tap.
    expect(screenOf(session).dock).toMatchObject({ mode: 'enter-weight', side: 'L' })
    await complete(session, { w: 10, sides: { L: { r: 12 }, R: { r: 11 } } })
    expect(screenOf(session).dock).toMatchObject({ mode: 'ready', side: 'R' })
    await complete(session)
    expect(screenOf(session).dock.mode).toBe('resting')
    await skip(session)
    expect(screenOf(session).dock.mode).toBe('all-done')

    clock += 60_000
    const finished = await session.finishSession({ sender: async () => ({ saved: true }) })
    expect(finished).toMatchObject({ ok: true, saved: true })

    // A kill after Finish: the workout is stored and no session is open.
    db = db.reopen()
    expect(await createSqliteSessionStorage(db).readBase()).toBeNull()
    const phone = await createSqliteFinishedWorkouts(db).list()
    expect(phone.map(w => [w.id, w.d, w.routineIds])).toEqual([['phone-1', today, ['push']]])

    // The next start: Pull is next, and Push's last time is the phone session.
    const after = sessionState(snapshot, phone)
    expect(nextRoutineId(after, clock)).toBe('pull')
    expect(lastTime(after, 'bench', 'push')).toMatchObject({ workoutId: 'phone-1', top: 80, sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }] })
    expect(lastTime(after, 'lat', 'push')).toMatchObject({ workoutId: 'phone-1', top: 10 })
    const again = buildSessionBase({ state: after, routine: after.routines.find(r => r.id === 'push'), now: clock, timeZone, id: 'phone-2' })
    expect(again.entries[0].sets.map(s => s.w)).toEqual([80, 80])
    expect(again.entries[1].sets[0].sides).toMatchObject({ L: { w: 10 }, R: { w: 10 } })
  })
})
