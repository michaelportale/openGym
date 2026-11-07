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

test('a session note longer than 2000 characters is refused', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  const exact = 'a'.repeat(2000)
  const saved = await session.setNote({ eventId: 'note-max', note: exact })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(session.view().note).toBe(exact)

  const tooLong = await session.setNote({ eventId: 'note-long', note: `${exact}b` })
  expect(tooLong).toMatchObject({ ok: false, saved: false, error: { code: 'note-too-long' } })
  expect(session.view().note).toBe(exact)
  expect((await storage.readAll()).some(event => event.id === 'note-long')).toBe(false)
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
