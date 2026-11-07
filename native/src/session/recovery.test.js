import { expect, test } from 'vitest'
import { plannedSetId } from './session.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createSqliteFinishedWorkouts } from './finished-workouts.js'
import { createSessionController } from './session-controller.js'
import { sessionOptionsFrom } from './use-active-session.js'

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

function boot(db, extra = {}) {
  return createSessionController(sessionOptionsFrom({
    db,
    base: baseWorkout(),
    now: () => T0 + 60_000,
    timeZone: 'UTC',
    ...extra,
  }))
}

test('killing the app keeps a partial set out of the totals and restores it on open', async () => {
  const db = createFakeSqliteDb()
  const first = boot(db)
  await first.open()
  await first.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await first.call('putDraft', plannedSetId('bench', 1), { w: 62.5, r: 3 })

  const restored = boot(db)
  const opened = await restored.open()
  const sets = opened.view.entries[0].sets
  expect(opened.status).toBe('ready')
  expect(sets[0].completed).toBe(true)
  expect(sets[1].completed).toBe(false)
  expect(sets[1].draft).toEqual({ w: 62.5, r: 3 })
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
})

test('replaying the journal after a kill counts a duplicate event id once', async () => {
  const db = createFakeSqliteDb()
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

  const restored = boot(db)
  const opened = await restored.open()
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(await createSqliteSessionStorage(db).readAll()).toHaveLength(1)
})

test('a finished workout with a different id does not block the open journal', async () => {
  const db = createFakeSqliteDb()
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

  const restored = boot(db)
  const opened = await restored.open()
  expect(opened.status).toBe('ready')
  expect(opened.view.totals.completedSets).toBe(1)
  expect(await createSqliteSessionStorage(db).readAll()).toHaveLength(1)
})

test('open does not resurrect a session whose workout is already finished', async () => {
  const db = createFakeSqliteDb()
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

  const restored = boot(db)
  const opened = await restored.open()
  expect(opened).toMatchObject({ status: 'saved', view: null })
  expect(await createSqliteSessionStorage(db).readAll()).toEqual([])
  expect(await createSqliteFinishedWorkouts(db).list()).toHaveLength(1)

  const second = boot(db)
  const reopened = await second.open()
  expect(reopened).toMatchObject({ status: 'saved', view: null })
  expect(await createSqliteSessionStorage(db).readAll()).toEqual([])
})

test('an unfinished journal is restored when the incoming base is a different finished workout', async () => {
  const db = createFakeSqliteDb()
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

test('killing the app recomputes rest from the stored deadline and does not complete the next set', async () => {
  const db = createFakeSqliteDb()
  let now = T0 + 60_000
  const first = boot(db, { now: () => now })
  await first.open()
  await first.call('startRest', { eventId: 'rest-1', durationMs: 90_000 })

  now = T0 + 100_000
  const during = await boot(db, { now: () => now }).open()
  expect(during.view.rest).toMatchObject({ status: 'running', remainingMs: 50_000, deadline: T0 + 150_000 })
  expect(during.view.totals.completedSets).toBe(0)

  now = T0 + 200_000
  const expired = await boot(db, { now: () => now }).open()
  expect(expired.view.rest).toMatchObject({ status: 'complete', remainingMs: 0 })
  expect(expired.view.entries[0].sets.every(set => set.completed)).toBe(false)
})

test('a paused rest stays frozen when the app is killed and the clock moves', async () => {
  const db = createFakeSqliteDb()
  let now = T0 + 60_000
  const first = boot(db, { now: () => now })
  await first.open()
  await first.call('startRest', { eventId: 'rest-1', durationMs: 90_000 })
  now = T0 + 70_000
  await first.call('pauseRest', { eventId: 'rest-pause' })
  expect(first.getState().view.rest.remainingMs).toBe(80_000)

  now = T0 + 10 * 60_000
  const restored = await boot(db, { now: () => now }).open()
  expect(restored.view.rest).toMatchObject({ status: 'paused', remainingMs: 80_000 })
})
