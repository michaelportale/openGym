import { expect, test } from 'vitest'
import { plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { createMemoryFinishedWorkouts } from './finished-workouts.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSessionController } from './session-controller.js'
import { sessionOptionsFrom, useActiveSession } from './use-active-session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function baseWorkout() {
  return {
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [{
      id: 'bench',
      target: { sets: 2, reps: 5 },
      sets: [
        { w: 60, r: 5, done: false },
        { w: 60, r: 5, done: false },
      ],
    }],
  }
}

function controllerFor(db, extra = {}) {
  return createSessionController(sessionOptionsFrom({
    db,
    base: baseWorkout(),
    now: () => T0 + 60_000,
    timeZone: 'UTC',
    ...extra,
  }))
}

test('useActiveSession is a react hook over the session controller', () => {
  expect(typeof useActiveSession).toBe('function')
  expect(useActiveSession.toString()).toContain('sessionOptionsFrom')
})

test.each(SQLITE_DRIVERS)('%s: a database handle wires the sqlite journal and the finished-workout store', async (_driver, createDb) => {
  let db = createDb()
  const active = controllerFor(db)
  await active.open()
  await active.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })

  const saved = await active.finishSession({ sender: async () => ({ saved: true }) })
  expect(saved).toMatchObject({ ok: true, saved: true })

  db = db.reopen()
  const reopened = createSessionController(sessionOptionsFrom({
    db,
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  }))
  await reopened.open()
  expect(reopened.getState().view.totals.completedSets).toBe(0)
  const listed = await sessionOptionsFrom({ db }).finishedWorkouts.list()
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({ id: 'session-1', d: '2026-11-07', vol: 300 })
})

test('callers can still pass their own journal and finished-workout store', () => {
  const db = createFakeSqliteDb()
  const storage = createMemoryStorage()
  const finishedWorkouts = createMemoryFinishedWorkouts()
  const resolved = sessionOptionsFrom({ db, storage, finishedWorkouts })
  expect(resolved.storage).toBe(storage)
  expect(resolved.finishedWorkouts).toBe(finishedWorkouts)
})
