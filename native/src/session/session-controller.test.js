import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { plannedSetId } from './session.js'
import { createSessionController } from './session-controller.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function baseWorkout() {
  return {
    id: 'w1',
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

function controller(storage, now = () => T0) {
  return createSessionController({ base: baseWorkout(), storage, now, timeZone: 'UTC' })
}

test('open restores a session that was already in storage', async () => {
  const storage = createMemoryStorage()
  const first = controller(storage)
  expect(first.getState().status).toBe('loading')
  await first.open()
  const saved = await first.call('commitSet', {
    eventId: 'c1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  expect(saved).toMatchObject({ ok: true, saved: true })

  const restored = controller(storage)
  const opened = await restored.open()
  expect(opened.status).toBe('ready')
  expect(opened.error).toBeNull()
  expect(opened.view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
})

test('a storage failure is surfaced and the set is not saved', async () => {
  const storage = createMemoryStorage()
  const active = controller(storage)
  await active.open()
  await active.call('putDraft', plannedSetId('bench', 0), { w: 70, r: 4 })
  expect(active.getState().view.totals.completedSets).toBe(0)
  expect(active.getState().view.entries[0].sets[0].draft).toEqual({ w: 70, r: 4 })

  storage.failAppends(new Error('disk full'))
  const attempt = await active.call('commitSet', {
    eventId: 'c-fail',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
  })
  expect(attempt).toMatchObject({ ok: false, saved: false, error: { code: 'storage' } })
  expect(attempt.error.message).toContain('disk full')
  const state = active.getState()
  expect(state.error.code).toBe('storage')
  expect(state.view.totals.completedSets).toBe(0)
  expect(state.view.entries[0].sets[0].completed).toBe(false)
  expect(state.view.entries[0].sets[0].draft).toEqual({ w: 70, r: 4 })
  expect(await storage.readAll()).toEqual([])
})

test('a failed open does not let a later action report a saved set', async () => {
  const storage = createMemoryStorage()
  storage.readAll = async () => { throw new Error('unreadable') }
  const active = controller(storage)
  const opened = await active.open()
  expect(opened.status).toBe('error')
  expect(opened.error.message).toContain('unreadable')
  const attempt = await active.call('commitSet', {
    eventId: 'c1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  expect(attempt).toMatchObject({ ok: false, saved: false })
  expect(active.getState().view).toBeNull()
})
