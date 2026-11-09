import { expect, test } from 'vitest'
import { plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { createSessionController } from './session-controller.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { SQLITE_DRIVERS, createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
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

const STORES = {
  memory: () => createMemoryFinishedWorkouts(),
  'fake sqlite': () => createSqliteFinishedWorkouts(createFakeSqliteDb()),
  'node sqlite': () => createSqliteFinishedWorkouts(createNodeSqliteDb()),
}

test('the finished-workout table indexes id and date', () => {
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/finished_workouts/)
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/id TEXT PRIMARY KEY/)
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/finished_workouts_d/)
  expect(FINISHED_WORKOUTS_SCHEMA).not.toMatch(/expo-sqlite/)
})

test('sqlite finished workouts require an injected db handle, and say so', () => {
  expect(() => createSqliteFinishedWorkouts()).toThrow('SQLite finished workouts need a db handle with exec, run, and getAll (see storage/db-handle.js)')
})

test.each(Object.keys(STORES))('%s store starts empty and keeps unknown keys', async (kind) => {
  const store = STORES[kind]()
  expect(await store.list()).toEqual([])
  expect(await store.get('session-1')).toBeNull()

  await store.put(workout('session-1', '2026-11-07'))
  const saved = await store.get('session-1')
  expect(saved.importedFrom).toBe('fitnotes')
  expect(saved.entries[0].sets[0].bar).toBe('texas')
  saved.entries[0].sets[0].r = 1
  expect((await store.get('session-1')).entries[0].sets[0].r).toBe(5)
})

test.each(Object.keys(STORES))('%s store replaces a workout with the same id', async (kind) => {
  const store = STORES[kind]()
  await store.put(workout('session-1', '2026-11-07'))
  await store.put(workout('session-1', '2026-11-08', { vol: 400, note: 'same session' }))
  await store.put(workout('session-2', '2026-11-06'))

  const listed = await store.list()
  expect(listed.map(item => item.id)).toEqual(['session-2', 'session-1'])
  expect(listed.filter(item => item.id === 'session-1')).toHaveLength(1)
  expect(listed[1]).toMatchObject({ d: '2026-11-08', vol: 400, note: 'same session' })
})

test.each(SQLITE_DRIVERS)('%s: a finished workout stays when the session journal is cleared and the app is killed', async (_driver, createDb) => {
  let db = createDb()
  const finished = createSqliteFinishedWorkouts(db)
  const journal = createSqliteSessionStorage(db)
  await finished.put(workout('session-1', '2026-11-07'))
  await journal.append({ id: 'e1', at: T0, type: 'set.commit' })
  await journal.clear()
  expect(db.executed.some(sql => /CREATE INDEX IF NOT EXISTS finished_workouts_d/i.test(sql))).toBe(true)

  db = db.reopen()
  expect(await createSqliteSessionStorage(db).readAll()).toEqual([])
  expect((await createSqliteFinishedWorkouts(db).get('session-1')).id).toBe('session-1')
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

test.each(['memory', 'fake sqlite', 'node sqlite'])('%s store: every written workout is pending until acked, and acking is by id', async (kind) => {
  const store = STORES[kind]()
  await store.put(workout('a', '2026-11-05'))
  await store.put(workout('b', '2026-11-06'))
  await store.put(workout('c', '2026-11-07'))
  expect((await store.listPending()).map(w => w.id)).toEqual(['a', 'b', 'c'])

  await store.markAcked(['a', 'c', 'missing'], '2026-11-08T10:00:00.000Z')
  expect((await store.listPending()).map(w => w.id)).toEqual(['b'])
  expect((await store.list()).map(w => w.id)).toEqual(['a', 'b', 'c'])
  await store.markAcked([], '2026-11-08T10:00:00.000Z')
  expect((await store.listPending()).map(w => w.id)).toEqual(['b'])
})

test.each(SQLITE_DRIVERS)('%s: pending and acked survive a kill', async (_driver, createDb) => {
  let db = createDb()
  const first = createSqliteFinishedWorkouts(db)
  await first.put(workout('a', '2026-11-05'))
  await first.put(workout('b', '2026-11-06'))
  db = db.reopen()
  expect((await createSqliteFinishedWorkouts(db).listPending()).map(w => w.id)).toEqual(['a', 'b'])
  await createSqliteFinishedWorkouts(db).markAcked(['a'], '2026-11-08T10:00:00.000Z')
  db = db.reopen()
  expect((await createSqliteFinishedWorkouts(db).listPending()).map(w => w.id)).toEqual(['b'])
})

test('a table from before Phase 5 gains acked_at once, and every old row stays pending', async () => {
  let db = createNodeSqliteDb()
  await db.exec(`CREATE TABLE finished_workouts (id TEXT PRIMARY KEY, d TEXT NOT NULL, body TEXT NOT NULL);`)
  await db.run('INSERT INTO finished_workouts (id, d, body) VALUES (?, ?, ?)', ['old-1', '2026-10-01', JSON.stringify(workout('old-1', '2026-10-01'))])
  await db.run('INSERT INTO finished_workouts (id, d, body) VALUES (?, ?, ?)', ['old-2', '2026-10-02', JSON.stringify(workout('old-2', '2026-10-02'))])

  const store = createSqliteFinishedWorkouts(db)
  expect((await store.listPending()).map(w => w.id)).toEqual(['old-1', 'old-2'])
  expect(db.executed.filter(sql => /ALTER TABLE finished_workouts ADD COLUMN acked_at/i.test(sql))).toHaveLength(1)

  // a second open on the same database neither fails nor alters again
  const again = createSqliteFinishedWorkouts(db)
  expect((await again.listPending()).map(w => w.id)).toEqual(['old-1', 'old-2'])
  expect(db.executed.filter(sql => /ALTER TABLE/i.test(sql))).toHaveLength(1)
})

test('a fresh table has acked_at from the schema and needs no ALTER', async () => {
  const db = createNodeSqliteDb()
  expect(FINISHED_WORKOUTS_SCHEMA).toMatch(/acked_at TEXT/)
  await createSqliteFinishedWorkouts(db).listPending()
  expect(db.executed.some(sql => /ALTER TABLE/i.test(sql))).toBe(false)
})

test.each(SQLITE_DRIVERS.filter(([name]) => name !== 'fake sqlite'))('%s: two stores opened at once on a pre-Phase-5 table both work, and a reopen is fine', async (_n, createDb) => {
  let db = createDb()
  await db.exec('CREATE TABLE finished_workouts (id TEXT PRIMARY KEY, d TEXT NOT NULL, body TEXT NOT NULL);')
  for (const id of ['o1', 'o2']) {
    await db.run('INSERT INTO finished_workouts (id, d, body) VALUES (?, ?, ?)', [id, '2026-10-01', JSON.stringify(workout(id, '2026-10-01'))])
  }
  const a = createSqliteFinishedWorkouts(db)
  const b = createSqliteFinishedWorkouts(db)
  const [la, lb] = await Promise.all([a.list(), b.listPending()])
  expect(la.map(w => w.id)).toEqual(['o1', 'o2'])
  expect(lb.map(w => w.id)).toEqual(['o1', 'o2'])

  db = db.reopen()
  expect((await createSqliteFinishedWorkouts(db).listPending()).map(w => w.id)).toEqual(['o1', 'o2'])
})

test('a duplicate-column error from the ALTER is treated as done', async () => {
  const db = createNodeSqliteDb()
  await db.exec('CREATE TABLE finished_workouts (id TEXT PRIMARY KEY, d TEXT NOT NULL, body TEXT NOT NULL);')
  // another connection added the column between the check and the ALTER
  const realRun = db.run
  db.run = async (sql, params) => {
    if (/ALTER TABLE/i.test(sql)) await realRun('ALTER TABLE finished_workouts ADD COLUMN acked_at TEXT')
    return realRun(sql, params)
  }
  expect(await createSqliteFinishedWorkouts(db).listPending()).toEqual([])
})

test('a second ack keeps the first time', async () => {
  const db = createNodeSqliteDb()
  const store = createSqliteFinishedWorkouts(db)
  await store.put(workout('a', '2026-11-05'))
  await store.markAcked(['a'], 'FIRST')
  await store.markAcked(['a'], 'SECOND')
  expect(await db.getAll('SELECT acked_at FROM finished_workouts WHERE id = ?', ['a'])).toEqual([{ acked_at: 'FIRST' }])
})

test.each(['memory', 'fake sqlite', 'node sqlite'])('%s store: resetAcked makes every workout pending again and keeps them all', async (kind) => {
  const store = STORES[kind]()
  await store.put(workout('a', '2026-11-05'))
  await store.put(workout('b', '2026-11-06'))
  await store.markAcked(['a', 'b'], '2026-11-08T10:00:00.000Z')
  expect(await store.listPending()).toEqual([])

  await store.resetAcked()
  expect((await store.listPending()).map(w => w.id)).toEqual(['a', 'b'])
  expect((await store.list()).map(w => w.id)).toEqual(['a', 'b'])
  // acking again after a reset takes the new time
  await store.markAcked(['a'], 'LATER')
  expect((await store.listPending()).map(w => w.id)).toEqual(['b'])
})

test.each(SQLITE_DRIVERS)('%s: a reset survives a kill', async (_driver, createDb) => {
  let db = createDb()
  const store = createSqliteFinishedWorkouts(db)
  await store.put(workout('a', '2026-11-05'))
  await store.markAcked(['a'], '2026-11-08T10:00:00.000Z')
  await store.resetAcked()
  db = db.reopen()
  expect((await createSqliteFinishedWorkouts(db).listPending()).map(w => w.id)).toEqual(['a'])
})
