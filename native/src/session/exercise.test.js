import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
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
        target: { sets: 1, reps: 5, weight: 60 },
        sets: [{ w: 60, r: 5, done: false }],
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
  return openSession({
    base: baseWorkout(),
    storage,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
}

const curl = {
  id: 'curl',
  coachNote: 'keep-entry',
  target: { sets: 1, reps: 10, weight: 20 },
  sets: [{ w: 20, r: 10, done: true }],
}

test('an exercise added mid-session starts unlogged and can be committed', async () => {
  const session = await started()
  const added = await session.addExercise({ eventId: 'add-curl', exerciseId: 'curl', entry: curl })
  const again = await session.addExercise({ eventId: 'add-curl', exerciseId: 'curl', entry: curl })
  const repeat = await session.addExercise({ eventId: 'add-curl-2', exerciseId: 'curl', entry: curl })
  expect(added).toMatchObject({ ok: true, saved: true })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(repeat).toMatchObject({ ok: false, saved: false, error: { code: 'known-exercise' } })

  const curlSet = plannedSetId('curl', 0)
  const view = session.view()
  expect(view.entries.map(entry => entry.id)).toEqual(['bench', 'row', 'curl'])
  expect(view.entries[2].sets[0]).toMatchObject({ setId: curlSet, completed: false })
  expect(view.entries[2].sets[0].row.done).toBe(false)
  expect(view.totals.completedSets).toBe(0)

  await session.commitSet({
    eventId: 'c-curl',
    exerciseId: 'curl',
    setId: curlSet,
    fields: { w: 20, r: 10 },
  })
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 10, loadReps: 200 })
  await session.finish({ eventId: 'finish-1' })
  const finished = session.view().finished
  const saved = finished.entries.find(entry => entry.id === 'curl')
  expect(saved.coachNote).toBe('keep-entry')
  expect(saved.sets[0]).toMatchObject({ w: 20, r: 10, done: true })
})

test('removing an exercise drops its logged work and clears its draft', async () => {
  const session = await started()
  const bench0 = plannedSetId('bench', 0)
  await session.commitSet({
    eventId: 'c-bench',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 60, r: 5 },
  })
  await session.putDraft(plannedSetId('row', 0), { w: 42.5, r: 6 })
  const removed = await session.removeExercise({ eventId: 'rm-row', exerciseId: 'row' })
  expect(removed).toMatchObject({ ok: true, saved: true })
  expect(session.view().entries.map(entry => entry.id)).toEqual(['bench'])
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(session.getDraft(plannedSetId('row', 0))).toBeNull()

  const duplicate = await session.removeExercise({ eventId: 'rm-row', exerciseId: 'row' })
  expect(duplicate).toMatchObject({ ok: true, saved: false, duplicate: true })
  const missing = await session.removeExercise({ eventId: 'rm-missing', exerciseId: 'row' })
  expect(missing).toMatchObject({ ok: false, saved: false, error: { code: 'unknown-exercise' } })

  await session.removeExercise({ eventId: 'rm-bench', exerciseId: 'bench' })
  expect(session.view().entries).toEqual([])
  expect(session.view().totals).toMatchObject({ completedSets: 0, reps: 0, loadReps: 0 })
  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.entries).toEqual([])
  const after = await session.removeExercise({ eventId: 'rm-after', exerciseId: 'bench' })
  expect(after).toMatchObject({ ok: false, saved: false, error: { code: 'finished' } })
})

test('an added exercise and a removal survive replay', async () => {
  const db = createFakeSqliteDb()
  const session = await started(createSqliteSessionStorage(db))
  await session.addExercise({ eventId: 'add-curl', exerciseId: 'curl', entry: curl })
  await session.commitSet({
    eventId: 'c-curl',
    exerciseId: 'curl',
    setId: plannedSetId('curl', 0),
    fields: { w: 22.5, r: 8 },
  })
  await session.removeExercise({ eventId: 'rm-bench', exerciseId: 'bench' })

  const restored = await openSession({
    storage: createSqliteSessionStorage(db),
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  })
  const view = restored.view()
  expect(view.entries.map(entry => entry.id)).toEqual(['row', 'curl'])
  expect(view.entries[1].sets[0].row).toMatchObject({ w: 22.5, r: 8, done: true })
  expect(view.totals).toMatchObject({ completedSets: 1, reps: 8, loadReps: 180 })
})
