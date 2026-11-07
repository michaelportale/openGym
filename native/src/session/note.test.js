import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { openSession, plannedSetId } from './session.js'
import { createSessionController } from './session-controller.js'

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
      target: { sets: 1, reps: 5 },
      sets: [{ w: 60, r: 5, done: false }],
    }],
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

test('a session note is saved on the workout and a later note replaces it', async () => {
  const session = await started()
  const first = await session.setNote({ eventId: 'note-1', note: '  narrower grip next time  ' })
  expect(first).toMatchObject({ ok: true, saved: true })
  expect(session.view().note).toBe('  narrower grip next time  ')

  const again = await session.setNote({ eventId: 'note-1', note: 'ignored' })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(session.view().note).toBe('  narrower grip next time  ')

  const replaced = await session.setNote({ eventId: 'note-2', note: 'pause at the bottom' })
  expect(replaced).toMatchObject({ ok: true, saved: true })
  expect(session.view().note).toBe('pause at the bottom')

  const bad = await session.setNote({ eventId: 'note-bad', note: 12 })
  expect(bad).toMatchObject({ ok: false, saved: false, error: { code: 'bad-note' } })
  expect(session.view().note).toBe('pause at the bottom')

  await session.commitSet({
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.note).toBe('pause at the bottom')

  const after = await session.setNote({ eventId: 'note-3', note: 'too late' })
  expect(after).toMatchObject({ ok: false, saved: false, error: { code: 'finished' } })
  expect(session.view().finished.note).toBe('pause at the bottom')
})

test('a blank session note is omitted from the finished workout', async () => {
  const base = baseWorkout()
  base.note = 'from the plan'
  const session = await openSession({
    base,
    storage: createMemoryStorage(),
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
  expect(session.view().note).toBe('from the plan')
  const cleared = await session.setNote({ eventId: 'note-clear', note: '   ' })
  expect(cleared).toMatchObject({ ok: true, saved: true })
  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.note).toBeUndefined()
})

test('a session note survives replay', async () => {
  const db = createFakeSqliteDb()
  const session = await started(createSqliteSessionStorage(db))
  await session.setNote({ eventId: 'note-1', note: 'pause at the bottom' })
  const restored = await openSession({
    storage: createSqliteSessionStorage(db),
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  })
  expect(restored.view().note).toBe('pause at the bottom')
})

test('an exercise note is pinned on that entry and a later note keeps the pin', async () => {
  const session = await started()
  const saved = await session.setExerciseNote({
    eventId: 'en-1',
    exerciseId: 'bench',
    note: '  pause at the bottom  ',
    notePin: true,
  })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(session.view().entries[0]).toMatchObject({
    id: 'bench',
    note: '  pause at the bottom  ',
    notePin: true,
  })

  const again = await session.setExerciseNote({
    eventId: 'en-1',
    exerciseId: 'bench',
    note: 'ignored',
  })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(session.view().entries[0].note).toBe('  pause at the bottom  ')

  const missing = await session.setExerciseNote({
    eventId: 'en-missing',
    exerciseId: 'nope',
    note: 'x',
  })
  expect(missing).toMatchObject({ ok: false, saved: false, error: { code: 'unknown-exercise' } })

  const tooLong = await session.setExerciseNote({
    eventId: 'en-long',
    exerciseId: 'bench',
    note: 'a'.repeat(2001),
  })
  expect(tooLong).toMatchObject({ ok: false, saved: false, error: { code: 'note-too-long' } })

  const replaced = await session.setExerciseNote({
    eventId: 'en-2',
    exerciseId: 'bench',
    note: 'softer pause',
  })
  expect(replaced).toMatchObject({ ok: true, saved: true })
  expect(session.view().entries[0]).toMatchObject({ note: 'softer pause', notePin: true })

  await session.commitSet({
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await session.finish({ eventId: 'finish-1' })
  expect(session.view().finished.entries[0]).toMatchObject({
    note: 'softer pause',
    notePin: true,
  })
})

test('a blank exercise note drops the note and the pin', async () => {
  const session = await started()
  await session.setExerciseNote({
    eventId: 'en-1',
    exerciseId: 'bench',
    note: 'keep elbows in',
    notePin: true,
  })
  const cleared = await session.setExerciseNote({
    eventId: 'en-2',
    exerciseId: 'bench',
    note: '   ',
  })
  expect(cleared).toMatchObject({ ok: true, saved: true })
  expect(session.view().entries[0]).toMatchObject({ note: '', notePin: false })
  await session.commitSet({
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await session.finish({ eventId: 'finish-1' })
  const bench = session.view().finished.entries[0]
  expect(bench.note).toBeUndefined()
  expect(bench.notePin).toBeUndefined()
})

test('an exercise note survives replay', async () => {
  const db = createFakeSqliteDb()
  const session = await started(createSqliteSessionStorage(db))
  await session.setExerciseNote({
    eventId: 'en-1',
    exerciseId: 'bench',
    note: 'keep elbows in',
    notePin: true,
  })
  const restored = await openSession({
    storage: createSqliteSessionStorage(db),
    now: () => T0 + 120_000,
    timeZone: 'UTC',
  })
  expect(restored.view().entries[0]).toMatchObject({ note: 'keep elbows in', notePin: true })
})

test('the controller saves a session note on the open view', async () => {
  const storage = createMemoryStorage()
  const active = createSessionController({
    base: baseWorkout(),
    storage,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
  await active.open()
  const saved = await active.call('setNote', { eventId: 'note-1', note: 'pause at the bottom' })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(active.getState().view.note).toBe('pause at the bottom')
})
