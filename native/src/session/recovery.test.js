import { expect, test } from 'vitest'
import { openSession, plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createSqliteFinishedWorkouts } from './finished-workouts.js'
import { createSessionController } from './session-controller.js'
import { sessionOptionsFrom } from './use-active-session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

// Each kill below is db.reopen(). On the file database that closes the connection, so the
// next boot reads only what SQLite committed.

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

function boot(db, extra = {}) {
  return createSessionController(sessionOptionsFrom({
    db,
    base: baseWorkout(),
    now: () => T0 + 60_000,
    timeZone: 'UTC',
    ...extra,
  }))
}

test.each(SQLITE_DRIVERS)('%s: killing the app keeps a partial set out of the totals and restores it on open', async (_driver, createDb) => {
  let db = createDb()
  const first = boot(db)
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await first.call('putDraft', plannedSetId('bench', 1), { w: 62.5, r: 3 })

  db = db.reopen()
  const restored = boot(db)
  const opened = await restored.open()
  const sets = opened.view.entries[0].sets
  expect(opened.status).toBe('ready')
  expect(sets[0].completed).toBe(true)
  expect(sets[1].completed).toBe(false)
  expect(sets[1].draft).toEqual({ w: 62.5, r: 3 })
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
})

test.each(SQLITE_DRIVERS)('%s: replaying the journal after a kill counts a duplicate event id once', async (_driver, createDb) => {
  let db = createDb()
  const first = boot(db)
  await first.open()
  const committed = await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  const again = await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 8 },
  })
  expect(committed).toMatchObject({ ok: true, saved: true })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })

  db = db.reopen()
  const restored = boot(db)
  const opened = await restored.open()
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(await createSqliteSessionStorage(db).readAll()).toHaveLength(1)
})

test.each(SQLITE_DRIVERS)('%s: a finished workout with a different id does not block the open journal', async (_driver, createDb) => {
  let db = createDb()
  const first = boot(db)
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await createSqliteFinishedWorkouts(db).put({
    id: 'session-9',
    d: '2026-11-06',
    name: 'Pull',
    entries: [],
    prs: [],
    vol: 0,
  })

  db = db.reopen()
  const restored = boot(db)
  const opened = await restored.open()
  expect(opened.status).toBe('ready')
  expect(opened.view.totals.completedSets).toBe(1)
  expect(await createSqliteSessionStorage(db).readAll()).toHaveLength(1)
})

test.each(SQLITE_DRIVERS)('%s: open does not resurrect a session whose workout is already finished', async (_driver, createDb) => {
  let db = createDb()
  const first = boot(db)
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await createSqliteFinishedWorkouts(db).put({
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    end: T0 + 60_000,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [],
    prs: [],
    vol: 300,
  })

  db = db.reopen()
  const restored = boot(db)
  const opened = await restored.open()
  expect(opened).toMatchObject({ status: 'saved', view: null })
  expect(await createSqliteSessionStorage(db).readAll()).toEqual([])
  expect(await createSqliteFinishedWorkouts(db).list()).toHaveLength(1)

  db = db.reopen()
  const second = boot(db)
  const reopened = await second.open()
  expect(reopened).toMatchObject({ status: 'saved', view: null })
  expect(await createSqliteSessionStorage(db).readAll()).toEqual([])
})

test.each(SQLITE_DRIVERS)('%s: an unfinished journal is restored when the incoming base is a different finished workout', async (_driver, createDb) => {
  let db = createDb()
  const first = boot(db)
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await createSqliteFinishedWorkouts(db).put({
    id: 'session-9',
    d: '2026-11-06',
    name: 'Pull',
    entries: [],
    prs: [],
    vol: 0,
  })

  db = db.reopen()
  const restored = createSessionController(sessionOptionsFrom({
    db,
    base: {
      id: 'session-9',
      d: '2026-11-06',
      start: T0,
      name: 'Pull',
      routineIds: ['routine-9'],
      entries: [{
        id: 'row',
        target: { sets: 1, reps: 8 },
        sets: [{ w: 40, r: 8, done: false }],
      }],
    },
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  }))
  const opened = await restored.open()
  expect(opened.status).toBe('ready')
  expect(opened.view.entries.map(entry => entry.id)).toEqual(['bench'])
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect((await createSqliteSessionStorage(db).readBase()).id).toBe('session-1')
  expect(await createSqliteSessionStorage(db).readAll()).toHaveLength(1)
  expect((await createSqliteFinishedWorkouts(db).get('session-9')).id).toBe('session-9')
})

test.each(SQLITE_DRIVERS)('%s: killing the app recomputes rest from the stored deadline and does not complete the next set', async (_driver, createDb) => {
  let db = createDb()
  let now = T0 + 60_000
  const first = boot(db, { now: () => now })
  await first.open()
  await first.call('startRest', { eventId: 'rest-1', durationMs: 90_000 })

  now = T0 + 100_000
  db = db.reopen()
  const during = await boot(db, { now: () => now }).open()
  expect(during.view.rest).toMatchObject({ status: 'running', remainingMs: 50_000, deadline: T0 + 150_000 })
  expect(during.view.totals.completedSets).toBe(0)

  now = T0 + 200_000
  db = db.reopen()
  const expired = await boot(db, { now: () => now }).open()
  expect(expired.view.rest).toMatchObject({ status: 'complete', remainingMs: 0 })
  expect(expired.view.entries[0].sets.every(set => set.completed)).toBe(false)
})

test.each(SQLITE_DRIVERS)('%s: a paused rest stays frozen when the app is killed and the clock moves', async (_driver, createDb) => {
  let db = createDb()
  let now = T0 + 60_000
  const first = boot(db, { now: () => now })
  await first.open()
  await first.call('startRest', { eventId: 'rest-1', durationMs: 90_000 })
  now = T0 + 70_000
  await first.call('pauseRest', { eventId: 'rest-pause' })
  expect(first.getState().view.rest.remainingMs).toBe(80_000)

  now = T0 + 10 * 60_000
  db = db.reopen()
  const restored = await boot(db, { now: () => now }).open()
  expect(restored.view.rest).toMatchObject({ status: 'paused', remainingMs: 80_000 })
})

test.each(SQLITE_DRIVERS)('%s: a killed overnight session keeps the time zone it was started in', async (_driver, createDb) => {
  let db = createDb()
  const evening = Date.parse('2026-11-07T23:10:00-05:00')
  const morning = Date.parse('2026-11-08T07:00:00-05:00')
  let now = evening
  const base = { ...baseWorkout(), start: evening }
  const first = boot(db, { base, now: () => now, timeZone: 'America/New_York' })
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await first.call('startRest', { eventId: 'rest-1', durationMs: 90_000 })
  await first.call('pauseRest', { eventId: 'rest-pause' })
  const before = first.getState().view
  expect(before.overnight).toBe(false)
  expect(before.rest).toMatchObject({ status: 'paused', remainingMs: 90_000 })

  // The process that opens the next morning does not pass the original zone.
  // UTC puts both instants on 8 Nov, so a forgotten zone would hide the overnight.
  now = morning
  db = db.reopen()
  const restored = await boot(db, { base, now: () => now, timeZone: 'UTC' }).open()
  expect(restored.view.timeZone).toBe('America/New_York')
  expect(restored.view.overnight).toBe(true)
  expect(restored.view.elapsedMs).toBe(before.elapsedMs)
  expect(morning - evening).toBeGreaterThan(restored.view.elapsedMs)
  expect(restored.view.rest).toMatchObject({ status: 'paused', remainingMs: 90_000 })
  expect(await createSqliteSessionStorage(db).readBase()).not.toHaveProperty('_sessionTimeZone')

  db = db.reopen()
  const second = boot(db, { base, now: () => now, timeZone: 'UTC' })
  await second.open()
  let sent = 0
  const silent = await second.finishSession({
    sender: async () => {
      sent += 1
      return { saved: true }
    },
  })
  expect(silent).toMatchObject({ ok: false, saved: false, error: { code: 'overnight' } })
  expect(sent).toBe(0)
  expect(await createSqliteSessionStorage(db).readAll()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'session.finish' })]),
  )

  const resumed = await second.call('resume', { eventId: 'resume-1' })
  expect(resumed).toMatchObject({ ok: true, saved: true })
  expect(second.getState().view.overnight).toBe(false)
  expect(second.getState().view.elapsedMs).toBe(before.elapsedMs)
  expect(second.getState().view.rest).toMatchObject({ status: 'paused', remainingMs: 90_000 })

  db = db.reopen()
  const third = await boot(db, { base, now: () => now, timeZone: 'UTC' }).open()
  expect(third.view.timeZone).toBe('America/New_York')
  expect(third.view.overnight).toBe(false)
  expect(third.view.elapsedMs).toBe(before.elapsedMs)
  expect(third.view.rest).toMatchObject({ status: 'paused', remainingMs: 90_000 })

  db = db.reopen()
  const finishing = boot(db, { base, now: () => now, timeZone: 'UTC' })
  await finishing.open()
  let payload = null
  const saved = await finishing.finishSession({
    sender: async (next) => {
      sent += 1
      payload = next
      return { saved: true }
    },
  })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(sent).toBe(1)
  expect(payload.workout.end).toBe(evening)
  expect(payload.workout.end).toBeLessThan(morning)
  expect(payload.workout).not.toHaveProperty('_sessionTimeZone')
  expect(payload.workout).not.toHaveProperty('timeZone')
  expect(await createSqliteSessionStorage(db).readBase()).toBeNull()
})

test.each(SQLITE_DRIVERS)('%s: a journal stored before the time zone was kept adopts the zone of the boot that finds it', async (_driver, createDb) => {
  let db = createDb()
  const storage = createSqliteSessionStorage(db)
  const evening = Date.parse('2026-11-07T23:10:00-05:00')
  const morning = Date.parse('2026-11-08T07:00:00-05:00')
  await storage.writeBase({ ...baseWorkout(), start: evening })
  db = db.reopen()
  const first = await boot(db, {
    now: () => morning,
    timeZone: 'America/New_York',
  }).open()
  expect(first.view.timeZone).toBe('America/New_York')
  expect(first.view.overnight).toBe(true)

  db = db.reopen()
  const second = await boot(db, { now: () => morning, timeZone: 'UTC' }).open()
  expect(second.view.timeZone).toBe('America/New_York')
  expect(second.view.overnight).toBe(true)
  expect(await createSqliteSessionStorage(db).readBase()).not.toHaveProperty('_sessionTimeZone')
})

test('memory storage keeps the session time zone across a new process', async () => {
  const storage = createMemoryStorage()
  const evening = Date.parse('2026-11-07T23:10:00-05:00')
  const morning = Date.parse('2026-11-08T07:00:00-05:00')
  const base = { ...baseWorkout(), start: evening }
  let now = evening
  await openSession({ base, storage, now: () => now, timeZone: 'America/New_York' })
  expect(await storage.readBase()).not.toHaveProperty('_sessionTimeZone')

  now = morning
  const restored = await openSession({ storage, now: () => now, timeZone: 'UTC' })
  expect(restored.view().timeZone).toBe('America/New_York')
  expect(restored.view().overnight).toBe(true)
  expect(restored.view().elapsedMs).toBe(0)
})
