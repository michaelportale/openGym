import { expect, test } from 'vitest'
import { plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { createSessionController } from './session-controller.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import {
  FINISHED_WORKOUTS_SCHEMA,
  createMemoryFinishedWorkouts,
  createSqliteFinishedWorkouts,
} from './finished-workouts.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function workout(id, d, extra = {}) {
  return {
    id,
    d,
    start: T0,
    end: T0 + 60_000,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [{
      id: 'bench',
      sets: [{ w: 60, r: 5, done: true, bar: 'texas' }],
      topW: 60,
    }],
    prs: [],
    vol: 300,
    importedFrom: 'fitnotes',
    ...extra,
  }
}

function stores() {
  const db = createFakeSqliteDb()
  return [
    ['memory', createMemoryFinishedWorkouts()],
    ['sqlite', createSqliteFinishedWorkouts(db), db],
  ]
}

test('the finished-workout table indexes id and date', () => {
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/finished_workouts/)
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/id TEXT PRIMARY KEY/)
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/finished_workouts_d/)
  expect(FINISHED_WORKOUTS_SCHEMA).not.toMatch(/expo-sqlite/)
})

test.each([['memory'], ['sqlite']])('%s store starts empty and keeps unknown keys', async (kind) => {
  const [memory, sqlite] = stores()
  const store = kind === 'memory' ? memory[1] : sqlite[1]
  expect(await store.list()).toEqual([])
  expect(await store.get('session-1')).toBeNull()

  await store.put(workout('session-1', '2026-11-07'))
  const saved = await store.get('session-1')
  expect(saved.importedFrom).toBe('fitnotes')
  expect(saved.entries[0].sets[0].bar).toBe('texas')
  saved.entries[0].sets[0].r = 1
  expect((await store.get('session-1')).entries[0].sets[0].r).toBe(5)
})

test.each([['memory'], ['sqlite']])('%s store replaces a workout with the same id', async (kind) => {
  const [memory, sqlite] = stores()
  const store = kind === 'memory' ? memory[1] : sqlite[1]
  await store.put(workout('session-1', '2026-11-07'))
  await store.put(workout('session-1', '2026-11-08', { vol: 400, note: 'same session' }))
  await store.put(workout('session-2', '2026-11-06'))

  const listed = await store.list()
  expect(listed.map(item => item.id)).toEqual(['session-2', 'session-1'])
  expect(listed.filter(item => item.id === 'session-1')).toHaveLength(1)
  expect(listed[1]).toMatchObject({ d: '2026-11-08', vol: 400, note: 'same session' })
})

test('sqlite keeps a finished workout when the session journal is cleared', async () => {
  const db = createFakeSqliteDb()
  const finished = createSqliteFinishedWorkouts(db)
  const journal = createSqliteSessionStorage(db)
  await finished.put(workout('session-1', '2026-11-07'))
  await journal.append({ id: 'e1', at: T0, type: 'set.commit' })
  await journal.clear()

  expect(await journal.readAll()).toEqual([])
  expect((await finished.get('session-1')).id).toBe('session-1')
  expect(db.executed.some(sql => /CREATE INDEX IF NOT EXISTS finished_workouts_d/i.test(sql))).toBe(true)
})

test('finishSession leaves the journal in place when the save is refused or the workout row cannot be written', async () => {
  const journal = createMemoryStorage()
  const finished = createMemoryFinishedWorkouts()
  const controller = createSessionController({
    base: {
      id: 'session-1',
      d: '2026-11-07',
      start: T0,
      name: 'Push',
      routineIds: ['routine-1'],
      entries: [{
        id: 'bench',
        target: { sets: 1, reps: 5 },
        sets: [{ w: 60, r: 5, done: false }],
      }],
    },
    storage: journal,
    finishedWorkouts: finished,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
  await controller.open()
  await controller.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })

  const refused = await controller.finishSession({ sender: async () => ({ saved: false }) })
  expect(refused.saved).toBe(false)
  expect(await finished.list()).toEqual([])
  expect(await journal.readAll()).not.toEqual([])

  finished.put = async () => { throw new Error('disk full') }
  const stored = await controller.finishSession({ sender: async () => ({ saved: true }) })
  expect(stored).toMatchObject({ ok: false, saved: true, error: { code: 'storage' } })
  expect(stored.error.message).toContain('disk full')
  expect(await finished.list()).toEqual([])
  expect(await journal.readAll()).not.toEqual([])
})

test('a confirmed finish writes one row and then clears the journal', async () => {
  const journal = createMemoryStorage()
  const finished = createMemoryFinishedWorkouts()
  const controller = createSessionController({
    base: {
      id: 'session-1',
      d: '2026-11-07',
      start: T0,
      name: 'Push',
      routineIds: ['routine-1'],
      entries: [{
        id: 'bench',
        target: { sets: 1, reps: 5 },
        sets: [{ w: 60, r: 5, done: false }],
      }],
    },
    storage: journal,
    finishedWorkouts: finished,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
  await controller.open()
  await controller.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })

  const saved = await controller.finishSession({ sender: async () => ({ saved: true }) })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(await journal.readAll()).toEqual([])
  const listed = await finished.list()
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({ id: 'session-1', d: '2026-11-07', vol: 300 })

  const again = await controller.finishSession({ sender: async () => ({ saved: true }) })
  expect(again).toMatchObject({ duplicate: true })
  expect(await finished.list()).toHaveLength(1)
})
