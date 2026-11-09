import { expect, test } from 'vitest'
import { plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { createMemoryFinishedWorkouts } from './finished-workouts.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { activeSessionController, sessionActions, sessionOptionsFrom } from './use-active-session.js'

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

// The controller the hook builds from the screen's options.
function controllerFor(db, extra = {}) {
  return activeSessionController({
    db,
    base: baseWorkout(),
    now: () => T0 + 60_000,
    timeZone: 'UTC',
    ...extra,
  })
}

// What the hook hands the screen, outside React: each command, then the state it settled in.
test.each(SQLITE_DRIVERS)("%s: the hook's actions run the command, then publish the state it settled in", async (_driver, createDb) => {
  const db = createDb()
  const controller = controllerFor(db)
  await controller.open()
  const published = []
  const actions = sessionActions(controller, () => published.push(controller.getState()))
  for (const name of ['putDraft', 'commitSet', 'editSet', 'undoSet', 'addSet', 'startRest', 'extendRest', 'cancelRest', 'resume', 'discard', 'finishSession', 'getState', 'refresh']) {
    expect(typeof actions[name], name).toBe('function')
  }

  const setId = plannedSetId('bench', 0)
  const saved = await actions.commitSet({ eventId: 'bench-0', exerciseId: 'bench', setId, fields: { w: 60, r: 5 } })
  expect(saved).toMatchObject({ ok: true, saved: true })
  // Right after the await, the screen reads the committed row's time (its rest is named by it)
  // through getState: the hook value in its closure is still the old render.
  expect(actions.getState().view.entries[0].sets[0].row).toMatchObject({ w: 60, r: 5, done: true, at: T0 + 60_000 })
  expect(published).toHaveLength(1)
  expect(published[0].view.entries[0].sets[0].row.done).toBe(true)

  // A refused write is a result, never a throw, and the screen still gets the state, error and all.
  db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
  const refused = await actions.commitSet({ eventId: 'bench-1', exerciseId: 'bench', setId: plannedSetId('bench', 1), fields: { w: 60, r: 5 } })
  expect(refused).toMatchObject({ ok: false, saved: false, error: { code: 'storage' } })
  expect(published).toHaveLength(2)
  expect(published[1].error).toMatchObject({ code: 'storage' })
  expect(published[1].view.entries[0].sets[1].row.done).toBe(false)

  // The view again, writing nothing.
  const executed = db.executed.length
  expect((await actions.refresh()).status).toBe('ready')
  expect(db.executed.length).toBe(executed)
  expect(published).toHaveLength(3)

  expect(await actions.finishSession({ sender: async () => ({ saved: true }) })).toMatchObject({ ok: true, saved: true })
  expect(published).toHaveLength(4)
  expect(published[3].status).toBe('saved')
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
  const reopened = activeSessionController({
    db,
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  })
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
