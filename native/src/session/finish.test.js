import { expect, test } from 'vitest'
import { openSession, plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createSqliteFinishedWorkouts } from './finished-workouts.js'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createSessionController } from './session-controller.js'
import { toWorkoutPayload } from './finish.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function clockAt(start) {
  const clock = {
    t: start,
    now() { return this.t },
    advance(ms) { this.t += ms },
  }
  return clock
}

function baseWorkout() {
  return {
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    bw: 80,
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

async function sealed(base, commit) {
  const storage = createMemoryStorage()
  const clock = clockAt(T0 + 60_000)
  const session = await openSession({
    base,
    storage,
    now: () => clock.now(),
    timeZone: 'UTC',
  })
  if (commit) await commit(session, clock)
  await session.finish({ eventId: 'finish-1' })
  return session.view().finished
}

test('an empty session is still one workout, with no entries and no volume', async () => {
  const finished = await sealed(baseWorkout())
  const payload = toWorkoutPayload(finished)

  expect(payload.workout).toMatchObject({
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    bw: 80,
    routineIds: ['routine-1'],
    routineId: 'routine-1',
    entries: [],
    prs: [],
    vol: 0,
  })
  expect(payload.workout.end).toBe(T0 + 60_000)
  expect(payload.workouts).toEqual([payload.workout])
})

test('a skipped set stays on an exercise that has other work, and an exercise with only skipped sets is omitted', async () => {
  const finished = await sealed(baseWorkout(), async (session) => {
    await session.commitSet({
      eventId: 'bench-0',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 0),
      fields: { w: 60, r: 5 },
    })
  })
  const payload = toWorkoutPayload(finished)

  expect(payload.workout.entries.map(entry => entry.id)).toEqual(['bench'])
  expect(payload.workout.entries[0].sets.map(set => set.done)).toEqual([true, false])
  expect(payload.workout.vol).toBe(300)
})

test('warm-up sets stay flagged and are left out of top weight and volume', async () => {
  const base = baseWorkout()
  base.entries[0].sets = [
    { w: 100, r: 10, done: false, warmup: true },
    { w: 60, r: 5, done: false },
  ]
  const finished = await sealed(base, async (session) => {
    await session.commitSet({
      eventId: 'warm',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 0),
      fields: { w: 100, r: 10, warmup: true },
    })
    await session.commitSet({
      eventId: 'work',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 1),
      fields: { w: 60, r: 5 },
    })
  })
  const payload = toWorkoutPayload(finished)
  const bench = payload.workout.entries.find(entry => entry.id === 'bench')

  expect(bench.sets[0].warmup).toBe(true)
  expect(bench.topW).toBe(60)
  expect(payload.workout.vol).toBe(300)
})

test('a phase warm-up stays on the set and is left out of top weight and volume', async () => {
  const base = baseWorkout()
  base.entries = [{
    id: 'bench',
    target: { sets: 2, reps: 5 },
    sets: [
      { w: 80, r: 8, done: false, phase: 'warmup' },
      { w: 50, r: 5, done: false },
    ],
  }]
  const finished = await sealed(base, async (session) => {
    await session.commitSet({
      eventId: 'warm',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 0),
      fields: { w: 80, r: 8, phase: 'warmup' },
    })
    await session.commitSet({
      eventId: 'work',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 1),
      fields: { w: 50, r: 5 },
    })
  })
  const payload = toWorkoutPayload(finished)
  const bench = payload.workout.entries[0]

  expect(bench.sets[0].phase).toBe('warmup')
  expect(bench.topW).toBe(50)
  expect(payload.workout.vol).toBe(250)
})

test('the session opens, drafts, commits, finishes, and reopens when structuredClone is missing', async () => {
  const trainingSnapshot = { role: 'horizontal-press', primary: ['chest'], secondary: [], status: 'curated' }
  const equipmentSnapshot = { stationId: 'bench-station', loadConvention: 'barbell-total', unit: 'kg', status: 'exact' }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')
  delete globalThis.structuredClone
  try {
    expect(globalThis.structuredClone).toBeUndefined()
    const db = createFakeSqliteDb()
    const base = baseWorkout()
    base.entries[0].trainingSnapshot = trainingSnapshot
    base.entries[0].equipmentSnapshot = equipmentSnapshot
    const storage = createSqliteSessionStorage(db)
    const finishedWorkouts = createSqliteFinishedWorkouts(db)
    const active = createSessionController({
      base,
      storage,
      finishedWorkouts,
      now: () => T0 + 60_000,
      timeZone: 'UTC',
    })
    const opened = await active.open()
    expect(opened.status).toBe('ready')
    expect(opened.view).not.toBeNull()

    const setId = plannedSetId('bench', 0)
    const drafted = await active.call('putDraft', setId, { w: 60, r: 5 })
    expect(drafted).toMatchObject({ ok: true, saved: true })
    expect(active.getState().view.entries[0].sets[0].draft).toEqual({ w: 60, r: 5 })

    const committed = await active.call('commitSet', {
      eventId: 'bench-0',
      exerciseId: 'bench',
      setId,
      fields: { w: 60, r: 5 },
    })
    expect(committed).toMatchObject({ ok: true, saved: true })
    expect(active.getState().view.totals).toMatchObject({ completedSets: 1, loadReps: 300 })

    const finished = await active.finishSession({ sender: async () => ({ saved: true }) })
    expect(finished).toMatchObject({ ok: true, saved: true })
    expect(finished.payload.workout.id).toBe('session-1')
    expect(finished.payload.workout.vol).toBe(300)
    expect(finished.payload.workout.entries[0].sets[0].r).toBe(5)
    expect(finished.payload.workout.entries[0].trainingSnapshot).toEqual(trainingSnapshot)
    expect(finished.payload.workout.entries[0].equipmentSnapshot).toEqual(equipmentSnapshot)
    finished.payload.workout.entries[0].sets[0].r = 1
    finished.payload.workout.entries[0].trainingSnapshot.role = 'changed'
    const stored = await finishedWorkouts.get('session-1')
    expect(stored.entries[0].sets[0].r).toBe(5)
    expect(stored.entries[0].trainingSnapshot).toEqual(trainingSnapshot)

    const reopened = createSessionController({
      base,
      storage: createSqliteSessionStorage(db),
      finishedWorkouts: createSqliteFinishedWorkouts(db),
      now: () => T0 + 120_000,
      timeZone: 'UTC',
    })
    const again = await reopened.open()
    expect(again).toMatchObject({ status: 'saved', view: null })
    expect(globalThis.structuredClone).toBeUndefined()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor)
  }
})

test('finishing the same session twice replaces the workout with that id', async () => {
  const finished = await sealed(baseWorkout(), async (session) => {
    await session.commitSet({
      eventId: 'bench-0',
      exerciseId: 'bench',
      setId: plannedSetId('bench', 0),
      fields: { w: 60, r: 5 },
    })
  })
  const existing = [{ id: 'other-session', d: '2026-11-06' }, { id: 'session-1', entries: [], vol: 0 }]
  const first = toWorkoutPayload(finished, { workouts: existing })
  const second = toWorkoutPayload(
    { ...finished, note: 'same session' },
    { workouts: first.workouts },
  )

  expect(second.workouts.map(workout => workout.id)).toEqual(['other-session', 'session-1'])
  expect(second.workouts.filter(workout => workout.id === 'session-1')).toHaveLength(1)
  expect(second.workouts[1].note).toBe('same session')
  expect(second.workouts[1].vol).toBe(300)
})

test('finishSession sends the payload and clears the journal only after the sender confirms the save', async () => {
  const storage = createMemoryStorage()
  const clock = clockAt(T0 + 60_000)
  const controller = createSessionController({
    base: baseWorkout(),
    storage,
    now: () => clock.now(),
    timeZone: 'UTC',
  })
  await controller.open()
  await controller.call('commitSet', {
    eventId: 'bench-0',
    exerciseId: 'bench',
    setId: plannedSetId('bench', 0),
    fields: { w: 60, r: 5 },
  })

  const sent = []
  const refused = await controller.finishSession({
    sender: async (payload) => {
      sent.push(payload)
      return { saved: false }
    },
  })
  expect(refused).toMatchObject({ ok: false, saved: false, error: { code: 'not-saved' } })
  expect(sent).toHaveLength(1)
  expect(sent[0].workout.id).toBe('session-1')
  expect(await storage.readAll()).not.toEqual([])

  await expect(controller.finishSession({
    sender: async () => { throw new Error('offline') },
  })).resolves.toMatchObject({ ok: false, saved: false, error: { code: 'send' } })
  expect(await storage.readAll()).not.toEqual([])

  const saved = await controller.finishSession({
    workouts: sent[0].workouts,
    sender: async (payload) => {
      sent.push(payload)
      return { saved: true }
    },
  })
  expect(saved).toMatchObject({ ok: true, saved: true })
  expect(saved.payload.workout.id).toBe('session-1')
  expect(saved.payload.workouts.filter(workout => workout.id === 'session-1')).toHaveLength(1)
  expect(await storage.readAll()).toEqual([])
  expect(await storage.readDrafts()).toEqual({})
  expect(await storage.readBase()).toBeNull()
  expect(controller.getState().status).toBe('saved')

  const again = await controller.finishSession({
    sender: async (payload) => {
      sent.push(payload)
      return { saved: true }
    },
  })
  expect(again).toMatchObject({ ok: true, saved: true, duplicate: true })
  expect(sent).toHaveLength(2)
})

test('finishSession does not send or clear when the session still needs an end', async () => {
  const storage = createMemoryStorage()
  const clock = clockAt(Date.parse('2026-11-08T15:00:00.000Z'))
  const controller = createSessionController({
    base: baseWorkout(),
    storage,
    now: () => clock.now(),
    timeZone: 'UTC',
  })
  await controller.open()
  let sent = 0
  const result = await controller.finishSession({
    sender: async () => {
      sent += 1
      return { saved: true }
    },
  })
  expect(result).toMatchObject({ ok: false, saved: false, error: { code: 'overnight' } })
  expect(sent).toBe(0)
  expect(await storage.readAll()).toEqual([])
  expect(controller.getState().status).toBe('ready')
})
