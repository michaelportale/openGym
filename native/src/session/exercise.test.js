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

test('a copied per-side set starts undone on the row and both sides', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  const copied = {
    w: 20,
    r: 16,
    done: true,
    sides: {
      L: { w: 20, r: 8, done: true },
      R: { w: 18, r: 8, done: true },
    },
  }
  await session.addSet({ eventId: 'add-side', exerciseId: 'bench', setId: 'extra-side', fields: copied })
  await session.addExercise({
    eventId: 'add-side-ex',
    exerciseId: 'curl',
    entry: { id: 'curl', target: { sets: 1, reps: 8 }, sets: [copied] },
  })

  function expectUndone(slot) {
    expect(slot.completed).toBe(false)
    expect(slot.row.done).toBe(false)
    expect(slot.row.sides.L).toMatchObject({ w: 20, r: 8, done: false })
    expect(slot.row.sides.R).toMatchObject({ w: 18, r: 8, done: false })
  }

  const live = session.view()
  expectUndone(live.entries.find(entry => entry.id === 'bench').sets.find(set => set.setId === 'extra-side'))
  expectUndone(live.entries.find(entry => entry.id === 'curl').sets[0])

  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  const replayed = restored.view()
  expectUndone(replayed.entries.find(entry => entry.id === 'bench').sets.find(set => set.setId === 'extra-side'))
  expectUndone(replayed.entries.find(entry => entry.id === 'curl').sets[0])
  expect(replayed.totals.completedSets).toBe(0)
})

test('committing a per-side set marks both sides done unless the commit names them', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  const copied = {
    w: 20,
    r: 16,
    done: true,
    sides: {
      L: { w: 20, r: 8, done: true },
      R: { w: 18, r: 8, done: true },
    },
  }
  await session.addSet({ eventId: 'add-both', exerciseId: 'bench', setId: 'both', fields: copied })
  await session.addSet({ eventId: 'add-one', exerciseId: 'bench', setId: 'one', fields: copied })
  await session.commitSet({ eventId: 'commit-both', exerciseId: 'bench', setId: 'both', fields: { w: 22 } })
  await session.commitSet({
    eventId: 'commit-one',
    exerciseId: 'bench',
    setId: 'one',
    fields: {
      sides: {
        L: { w: 20, r: 8, done: true },
        R: { w: 18, r: 8, done: false },
      },
    },
  })

  function slot(view, setId) {
    return view.entries.find(entry => entry.id === 'bench').sets.find(set => set.setId === setId)
  }

  const live = session.view()
  const both = slot(live, 'both')
  expect(both.completed).toBe(true)
  expect(both.row.done).toBe(true)
  expect(both.row.w).toBe(22)
  expect(both.row.sides.L).toMatchObject({ w: 20, r: 8, done: true })
  expect(both.row.sides.R).toMatchObject({ w: 18, r: 8, done: true })
  const one = slot(live, 'one')
  expect(one.completed).toBe(true)
  expect(one.row.done).toBe(false)
  expect(one.row.sides.L.done).toBe(true)
  expect(one.row.sides.R.done).toBe(false)

  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  const replayed = restored.view()
  expect(slot(replayed, 'both').row.sides.L.done).toBe(true)
  expect(slot(replayed, 'both').row.sides.R.done).toBe(true)
  expect(slot(replayed, 'both').row.done).toBe(true)
  expect(slot(replayed, 'one').row.done).toBe(false)
  expect(slot(replayed, 'one').row.sides.R.done).toBe(false)
})

test('editing one side of a committed per-side set clears the row done flag', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  await session.addSet({
    eventId: 'add-side',
    exerciseId: 'bench',
    setId: 'side',
    fields: {
      w: 20,
      r: 16,
      sides: {
        L: { w: 20, r: 8, done: false },
        R: { w: 18, r: 8, done: false },
      },
    },
  })
  await session.commitSet({ eventId: 'commit-side', exerciseId: 'bench', setId: 'side', fields: { w: 22 } })
  await session.editSet({
    eventId: 'edit-side',
    exerciseId: 'bench',
    setId: 'side',
    fields: {
      sides: {
        L: { w: 20, r: 8, done: true },
        R: { w: 18, r: 8, done: false },
      },
    },
  })

  function slot(view) {
    return view.entries.find(entry => entry.id === 'bench').sets.find(set => set.setId === 'side')
  }

  const live = slot(session.view())
  expect(live.completed).toBe(true)
  expect(live.row.done).toBe(false)
  expect(live.row.sides.L).toMatchObject({ w: 20, r: 8, done: true })
  expect(live.row.sides.R).toMatchObject({ w: 18, r: 8, done: false })

  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  const replayed = slot(restored.view())
  expect(replayed.row.done).toBe(false)
  expect(replayed.row.sides.L.done).toBe(true)
  expect(replayed.row.sides.R.done).toBe(false)
})

test('removing an exercise drops its logged work and clears its draft', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
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

  const last = await session.removeExercise({ eventId: 'rm-bench', exerciseId: 'bench' })
  expect(last).toMatchObject({ ok: false, saved: false, error: { code: 'last-exercise' } })
  expect(session.view().entries.map(entry => entry.id)).toEqual(['bench'])
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect((await storage.readAll()).some(event => event.id === 'rm-bench')).toBe(false)
  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.entries.map(entry => entry.id)).toEqual(['bench'])
  const after = await session.removeExercise({ eventId: 'rm-after', exerciseId: 'bench' })
  expect(after).toMatchObject({ ok: false, saved: false, error: { code: 'finished' } })
})

test('a smuggled remove cannot drop the last exercise', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  await session.removeExercise({ eventId: 'rm-row', exerciseId: 'row' })
  await storage.append({
    id: 'rm-smuggle',
    type: 'exercise.remove',
    at: T0 + 60_000,
    exerciseId: 'bench',
  })
  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  expect(restored.view().entries.map(entry => entry.id)).toEqual(['bench'])
})

test.each(SQLITE_DRIVERS)('%s: an added exercise and a removal survive replay', async (_driver, createDb) => {
  let db = createDb()
  const session = await started(createSqliteSessionStorage(db))
  await session.addExercise({ eventId: 'add-curl', exerciseId: 'curl', entry: curl })
  await session.commitSet({
    eventId: 'c-curl',
    exerciseId: 'curl',
    setId: plannedSetId('curl', 0),
    fields: { w: 22.5, r: 8 },
  })
  await session.removeExercise({ eventId: 'rm-bench', exerciseId: 'bench' })

  db = db.reopen()
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
