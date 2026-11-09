import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { openSession, plannedSetId } from './session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function baseWorkout() {
  return {
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [
      {
        id: 'bench',
        target: { sets: 2, reps: 5, weight: 60 },
        sets: [
          { w: 60, r: 5, done: false },
          { w: 60, r: 5, done: false },
        ],
      },
      {
        id: 'row',
        target: { sets: 1, reps: 8 },
        sets: [{ w: 40, r: 8, done: false }],
      },
    ],
  }
}

async function started(storage = createMemoryStorage()) {
  const session = await openSession({
    base: baseWorkout(),
    storage,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
  return session
}

test('editing a committed set updates the totals and the finished workout', async () => {
  const session = await started()
  const bench0 = plannedSetId('bench', 0)
  await session.commitSet({
    eventId: 'c1',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 60, r: 5 },
  })
  const edited = await session.editSet({
    eventId: 'e1',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 70, r: 4 },
  })
  const again = await session.editSet({
    eventId: 'e1',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 1, r: 1 },
  })
  expect(edited).toMatchObject({ ok: true, saved: true })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(session.view().entries[0].sets[0].row).toMatchObject({ w: 70, r: 4, done: true })
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 4, loadReps: 280 })

  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.entries[0].sets[0]).toMatchObject({ w: 70, r: 4, done: true })
})

test('deleting a committed set drops it from the totals, and the last set stays', async () => {
  const session = await started()
  const bench0 = plannedSetId('bench', 0)
  const bench1 = plannedSetId('bench', 1)
  await session.commitSet({
    eventId: 'c0',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 60, r: 5 },
  })
  await session.commitSet({
    eventId: 'c1',
    exerciseId: 'bench',
    setId: bench1,
    fields: { w: 60, r: 5 },
  })
  await session.putDraft(bench1, { w: 62.5, r: 3 })

  const removed = await session.removeSet({
    eventId: 'rm-1',
    exerciseId: 'bench',
    setId: bench1,
  })
  expect(removed).toMatchObject({ ok: true, saved: true })
  const view = session.view()
  expect(view.entries[0].sets.map(set => set.setId)).toEqual([bench0])
  expect(view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(session.getDraft(bench1)).toBeNull()

  const duplicate = await session.removeSet({
    eventId: 'rm-1',
    exerciseId: 'bench',
    setId: bench1,
  })
  expect(duplicate).toMatchObject({ ok: true, saved: false, duplicate: true })

  const last = await session.removeSet({
    eventId: 'rm-last',
    exerciseId: 'bench',
    setId: bench0,
  })
  expect(last).toMatchObject({ ok: false, saved: false, error: { code: 'last-set' } })
  expect(session.view().entries[0].sets).toHaveLength(1)

  const missing = await session.removeSet({
    eventId: 'rm-missing',
    exerciseId: 'bench',
    setId: 'nope',
  })
  expect(missing).toMatchObject({ ok: false, saved: false, error: { code: 'unknown-set' } })

  const onlyRow = await session.removeSet({
    eventId: 'rm-row',
    exerciseId: 'row',
    setId: plannedSetId('row', 0),
  })
  expect(onlyRow).toMatchObject({ ok: false, saved: false, error: { code: 'last-set' } })
  expect(session.view().entries[1].sets).toHaveLength(1)

  await session.finish({ eventId: 'finish-1' })
  const finished = session.view().finished
  expect(finished.entries.map(entry => entry.id)).toEqual(['bench'])
  expect(finished.entries[0].sets).toHaveLength(1)
  expect(finished.entries[0].sets[0]).toMatchObject({ w: 60, r: 5, done: true })

  const after = await session.removeSet({
    eventId: 'rm-after',
    exerciseId: 'bench',
    setId: bench0,
  })
  expect(after).toMatchObject({ ok: false, saved: false, error: { code: 'finished' } })
})

test.each(SQLITE_DRIVERS)('%s: a deleted set stays gone when the journal is replayed', async (_driver, createDb) => {
  let db = createDb()
  const storage = createSqliteSessionStorage(db)
  const session = await started(storage)
  const bench0 = plannedSetId('bench', 0)
  const bench1 = plannedSetId('bench', 1)
  await session.commitSet({
    eventId: 'c0',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 60, r: 5 },
  })
  await session.editSet({
    eventId: 'e0',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 65, r: 5 },
  })
  await session.commitSet({
    eventId: 'c1',
    exerciseId: 'bench',
    setId: bench1,
    fields: { w: 60, r: 5 },
  })
  await session.removeSet({
    eventId: 'rm-1',
    exerciseId: 'bench',
    setId: bench1,
  })

  db = db.reopen()
  const restored = await openSession({
    storage: createSqliteSessionStorage(db),
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  })
  const view = restored.view()
  expect(view.entries[0].sets.map(set => set.setId)).toEqual([bench0])
  expect(view.entries[0].sets[0].row).toMatchObject({ w: 65, r: 5, done: true })
  expect(view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 325 })
})

test('a smuggled remove cannot empty an exercise', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  const row0 = plannedSetId('row', 0)
  await storage.append({
    id: 'rm-smuggle',
    type: 'set.remove',
    at: T0 + 60_000,
    exerciseId: 'row',
    setId: row0,
  })
  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  expect(restored.view().entries.find(entry => entry.id === 'row').sets).toHaveLength(1)
})
