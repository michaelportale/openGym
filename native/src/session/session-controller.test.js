import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { SEEN_PERSIST_MS, plannedSetId } from './session.js'
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

test('a call notes the timer once it has moved 15 seconds', async () => {
  const storage = createMemoryStorage()
  let now = T0
  const active = controller(storage, () => now)
  await active.open()
  now = T0 + SEEN_PERSIST_MS
  await active.call('putDraft', plannedSetId('bench', 0), { w: 70 })
  expect(await storage.readLastSeen()).toBe(T0 + SEEN_PERSIST_MS)
  now = T0 + SEEN_PERSIST_MS + 1000
  await active.call('putDraft', plannedSetId('bench', 0), { w: 75 })
  expect(await storage.readLastSeen()).toBe(T0 + SEEN_PERSIST_MS)
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

function holdAppend(storage, eventId) {
  const append = storage.append.bind(storage)
  let release
  let entered
  const reached = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  storage.append = async event => {
    if (event.id === eventId) {
      entered()
      await held
    }
    return append(event)
  }
  return { entered: reached, release: () => release() }
}

test('finish waits for a pending set commit before it saves and clears the journal', async () => {
  const storage = createMemoryStorage()
  const active = controller(storage, () => T0 + 60_000)
  await active.open()
  const gate = holdAppend(storage, 'set-1')
  let rejected = false
  const pending = active.call('commitSet', {
    eventId: 'set-1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  }).catch(error => {
    rejected = true
    return { thrown: error?.message || String(error) }
  })
  await gate.entered
  let sent = 0
  let payload = null
  const finishing = active.finishSession({
    sender: async next => {
      sent += 1
      payload = next
      return { saved: true }
    },
  })
  gate.release()
  const [commit, finished] = await Promise.all([pending, finishing])

  expect(rejected).toBe(false)
  expect(commit).toMatchObject({ ok: true, saved: true })
  expect(finished).toMatchObject({ ok: true, saved: true })
  expect(sent).toBe(1)
  expect(payload.workout.vol).toBe(300)
  expect(payload.workout.entries.flatMap(entry => entry.sets)).toHaveLength(1)
  expect(await storage.readBase()).toBeNull()
  expect(await storage.readAll()).toEqual([])
  expect(active.getState()).toMatchObject({ status: 'saved', view: null })
})

test('a second finish does not call the sender while the first is still saving', async () => {
  const storage = createMemoryStorage()
  const active = controller(storage, () => T0 + 60_000)
  await active.open()
  await active.call('commitSet', {
    eventId: 'set-1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  let sent = 0
  let release
  let entered
  const reached = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  const sender = async () => {
    sent += 1
    entered()
    await held
    return { saved: true }
  }
  const first = active.finishSession({ sender })
  const second = active.finishSession({ sender })
  await reached
  await Promise.resolve()
  expect(sent).toBe(1)
  release()
  const results = await Promise.all([first, second])

  expect(sent).toBe(1)
  expect(results.filter(result => result.duplicate === true)).toHaveLength(1)
  expect(results.every(result => result.ok === true && result.saved === true)).toBe(true)
})

test('a failed append settles before finish and leaves no orphan event', async () => {
  const storage = createMemoryStorage()
  const active = controller(storage, () => T0 + 60_000)
  await active.open()
  const append = storage.append.bind(storage)
  let release
  let entered
  const reached = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  storage.append = async event => {
    if (event.id === 'set-1') {
      entered()
      await held
      throw new Error('disk full')
    }
    return append(event)
  }
  let rejected = false
  const pending = active.call('commitSet', {
    eventId: 'set-1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  }).catch(error => {
    rejected = true
    return { thrown: error?.message || String(error) }
  })
  await reached
  let sent = 0
  const finishing = active.finishSession({
    sender: async () => {
      sent += 1
      return { saved: true }
    },
  })
  // Let an unqueued finish run to the end while the append is still held.
  await new Promise(resolve => setTimeout(resolve, 0))
  release()
  const [commit, finished] = await Promise.all([pending, finishing])

  expect(rejected).toBe(false)
  expect(commit).toMatchObject({ ok: false, saved: false, error: { code: 'storage' } })
  expect(commit.error.message).toContain('disk full')
  expect(finished).toMatchObject({ ok: true, saved: true })
  expect(sent).toBe(1)
  expect(finished.payload.workout.vol).toBe(0)
  expect(finished.payload.workout.entries).toEqual([])
  expect(await storage.readBase()).toBeNull()
  expect(await storage.readAll()).toEqual([])
})

test('finishing a discarded session does not send, and a failed clear does not reject', async () => {
  const storage = createMemoryStorage()
  const active = controller(storage, () => T0 + 60_000)
  await active.open()
  await active.call('commitSet', {
    eventId: 'set-1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  await active.call('putDraft', plannedSetId('bench', 0), { w: 62.5, r: 5 })
  const discarded = await active.call('discard')
  expect(discarded).toMatchObject({ ok: true, saved: true })
  expect(active.getState().status).toBe('discarded')
  let sent = 0
  const finished = await active.finishSession({
    sender: async () => {
      sent += 1
      return { saved: true }
    },
  })
  expect(sent).toBe(0)
  expect(finished).toMatchObject({ ok: false, saved: false, error: { code: 'discarded' } })
  expect(active.getState().status).toBe('discarded')
  expect(await storage.readBase()).toBeNull()
  expect(await storage.readDrafts()).toEqual({})

  const failing = createMemoryStorage()
  const blocked = controller(failing, () => T0 + 60_000)
  await blocked.open()
  await blocked.call('commitSet', {
    eventId: 'set-1',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })
  failing.clear = async () => { throw new Error('disk full') }
  let rejected = false
  const attempt = await blocked.call('discard').catch(error => {
    rejected = true
    return { thrown: error?.message || String(error) }
  })
  expect(rejected).toBe(false)
  expect(attempt).toMatchObject({ ok: false, saved: false, error: { code: 'storage' } })
  expect(attempt.error.message).toContain('disk full')
  expect(blocked.getState().status).toBe('ready')
  expect(blocked.getState().error.code).toBe('storage')
  expect(blocked.getState().view.totals.completedSets).toBe(1)
  expect(await failing.readAll()).toHaveLength(1)
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
