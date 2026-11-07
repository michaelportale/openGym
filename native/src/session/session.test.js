import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { openSession, plannedSetId } from './session.js'
import { REST_MAX_MS } from './timing.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function createClock(start = T0) {
  let t = start
  return {
    now: () => t,
    set(n) { t = n },
    advance(ms) { t += ms },
  }
}

function baseWorkout(extra = {}) {
  return {
    id: 'w1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    bw: 80,
    routineIds: ['routine-1'],
    importedFrom: 'fitnotes',
    entries: [
      {
        id: 'bench',
        coachNote: 'keep-entry',
        target: { sets: 2, reps: 5, weight: 60 },
        sets: [
          { w: 60, r: 5, done: false, bar: 'texas' },
          { w: 60, r: 5, done: false },
        ],
      },
      {
        id: 'row',
        target: { sets: 1, reps: 8 },
        sets: [{ w: 40, r: 8, done: false }],
      },
    ],
    ...extra,
  }
}

async function started(over = {}) {
  const clock = over.clock || createClock(over.start ?? T0)
  const storage = over.storage || createMemoryStorage()
  const base = over.base === undefined ? baseWorkout() : over.base
  const session = await openSession({
    base,
    storage,
    now: clock.now,
    timeZone: over.timeZone || 'UTC',
  })
  return { session, clock, storage, base }
}

const bench0 = plannedSetId('bench', 0)
const bench1 = plannedSetId('bench', 1)

test('a repeated event id is a no-op and does not double count', async () => {
  const { session } = await started()
  const first = await session.commitSet({
    eventId: 'commit-1',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 60, r: 5 },
  })
  const again = await session.commitSet({
    eventId: 'commit-1',
    exerciseId: 'bench',
    setId: bench1,
    fields: { w: 100, r: 10 },
  })
  const view = session.view()
  expect(first).toMatchObject({ ok: true, saved: true })
  expect(again).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(view.totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(view.entries[0].sets[0].completed).toBe(true)
  expect(view.entries[0].sets[1].completed).toBe(false)
  expect(view.entries[0].sets[1].row.w).toBe(60)
})

test('rapid complete then undo leaves the set uncounted, and a second undo stays a single correction', async () => {
  const { session } = await started()
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 80, r: 5 } })
  await session.undoSet({ eventId: 'u1', exerciseId: 'bench', setId: bench0 })
  const afterUndo = session.view()
  expect(afterUndo.entries[0].sets[0].completed).toBe(false)
  expect(afterUndo.entries[0].sets[0].row.done).toBe(false)
  expect(afterUndo.totals.completedSets).toBe(0)
  expect(afterUndo.totals.loadReps).toBe(0)

  const duplicateUndo = await session.undoSet({ eventId: 'u1', exerciseId: 'bench', setId: bench0 })
  expect(duplicateUndo).toMatchObject({ ok: true, saved: false, duplicate: true })

  await session.commitSet({ eventId: 'c2', exerciseId: 'bench', setId: bench0, fields: { w: 80, r: 3 } })
  const redone = session.view()
  expect(redone.totals).toMatchObject({ completedSets: 1, reps: 3, loadReps: 240 })
  expect(redone.entries[0].sets[0].row.w).toBe(80)
})

test('replay shows the same row a non-JSON commit field produced live', async () => {
  const storage = createMemoryStorage()
  const { session } = await started({ storage })
  const committed = await session.commitSet({
    eventId: 'c1',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: NaN, r: 5, bar: undefined },
  })
  expect(committed).toMatchObject({ ok: true, saved: true })
  const live = session.view()
  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  const replayed = restored.view()
  expect(replayed.entries[0].sets[0].row.w).toBe(live.entries[0].sets[0].row.w)
  expect(replayed.entries[0].sets[0].row.bar).toBe(live.entries[0].sets[0].row.bar)
  expect(replayed.totals.loadReps).toBe(live.totals.loadReps)
})

test('an edit after finish is refused and does not change the finished document', async () => {
  const { session, storage, clock } = await started()
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  clock.advance(60_000)
  const finished = await session.finish({ eventId: 'finish-1' })
  expect(finished).toMatchObject({ ok: true, saved: true })
  const before = session.view().finished
  const edit = await session.editSet({
    eventId: 'edit-after',
    exerciseId: 'bench',
    setId: bench0,
    fields: { r: 1, w: 1 },
  })
  expect(edit).toMatchObject({ ok: false, saved: false, error: { code: 'finished' } })
  expect(session.view().finished).toEqual(before)
  expect((await storage.readAll()).map(event => event.id)).not.toContain('edit-after')

  await storage.append({
    id: 'edit-smuggled',
    type: 'set.edit',
    at: clock.now(),
    exerciseId: 'bench',
    setId: bench0,
    fields: { r: 1, w: 1 },
  })
  const restored = await openSession({ storage, now: clock.now, timeZone: 'UTC' })
  expect(restored.view().finished.entries[0].sets[0]).toMatchObject({ w: 60, r: 5, done: true })
  expect(restored.view().finished).toEqual(before)
})

test('a draft is visible but never counts until it is committed', async () => {
  const { session } = await started()
  const put = await session.putDraft(bench0, { w: 70, r: 4 })
  expect(put).toMatchObject({ ok: true, saved: true })
  const drafted = session.view()
  expect(drafted.entries[0].sets[0].draft).toEqual({ w: 70, r: 4 })
  expect(drafted.entries[0].sets[0].completed).toBe(false)
  expect(drafted.entries[0].sets[0].row).toMatchObject({ w: 60, r: 5, done: false })
  expect(drafted.totals).toMatchObject({ completedSets: 0, reps: 0, loadReps: 0 })

  const commit = await session.commitSet({ eventId: 'from-draft', exerciseId: 'bench', setId: bench0 })
  expect(commit).toMatchObject({ ok: true, saved: true })
  const done = session.view()
  expect(done.entries[0].sets[0].draft).toBeNull()
  expect(done.entries[0].sets[0].completed).toBe(true)
  expect(done.entries[0].sets[0].row).toMatchObject({ w: 70, r: 4, done: true })
  expect(done.totals).toMatchObject({ completedSets: 1, reps: 4, loadReps: 280 })
  expect(session.getDraft(bench0)).toBeNull()
})

test('restoring from storage after termination reproduces the same view', async () => {
  const storage = createMemoryStorage()
  const clock = createClock(T0)
  const { session } = await started({ storage, clock })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  await session.putDraft(bench1, { w: 62.5, r: 5 })
  await session.addSet({ eventId: 'add-1', exerciseId: 'bench', setId: 'extra-1', fields: { w: 40, r: 8, warmup: true } })
  await session.startRest({ eventId: 'rest-1', durationMs: 90_000 })
  await session.moveExercise({ eventId: 'move-1', exerciseId: 'row', toIndex: 0 })
  clock.advance(25_000)
  const before = session.view()

  const restored = await openSession({ storage, now: clock.now, timeZone: 'UTC' })
  expect(restored.view()).toEqual(before)
  expect(restored.getDraft(bench1)).toEqual({ w: 62.5, r: 5 })
})

test('locking during rest reports the deadline remainder, and expiry does not start the next set', async () => {
  const clock = createClock(T0)
  const { session } = await started({ clock })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const deadline = clock.now() + 90_000
  await session.startRest({ eventId: 'rest-1', deadline })

  clock.advance(40_000)
  const during = session.view().rest
  expect(during).toMatchObject({ status: 'running', deadline, remainingMs: 50_000 })

  clock.set(deadline + 5_000)
  const expired = session.view()
  expect(expired.rest).toMatchObject({ status: 'complete', remainingMs: 0, deadline })
  expect(expired.entries[0].sets[1].completed).toBe(false)
  expect(expired.totals.completedSets).toBe(1)
})

test('pause freezes remaining across a background gap and extend writes a new deadline', async () => {
  const clock = createClock(T0)
  const { session } = await started({ clock })
  await session.startRest({ eventId: 'rest-1', durationMs: 60_000 })
  clock.advance(10_000)
  const pause = await session.pauseRest({ eventId: 'pause-1' })
  expect(pause).toMatchObject({ ok: true, saved: true })
  const paused = session.view().rest
  expect(paused.status).toBe('paused')
  expect(paused.remainingMs).toBe(50_000)
  expect(paused.deadline).toBe(clock.now() + 50_000)

  clock.advance(30_000)
  expect(session.view().rest.remainingMs).toBe(50_000)
  expect(session.view().rest.status).toBe('paused')

  const extend = await session.extendRest({ eventId: 'extend-1', byMs: 15_000 })
  expect(extend).toMatchObject({ ok: true, saved: true })
  const extended = session.view().rest
  expect(extended.status).toBe('paused')
  expect(extended.remainingMs).toBe(65_000)
  expect(extended.deadline).toBe(paused.deadline + 15_000)

  clock.advance(20_000)
  expect(session.view().rest).toMatchObject({ status: 'paused', remainingMs: 65_000 })
})

test('a repeated pause, cancel, or resume id is a duplicate once its precondition is gone', async () => {
  const clock = createClock(T0)
  const storage = createMemoryStorage()
  const { session } = await started({ clock, storage })
  await session.startRest({ eventId: 'rest-1', durationMs: 60_000 })
  const pause = await session.pauseRest({ eventId: 'pause-1' })
  expect(pause).toMatchObject({ ok: true, saved: true })
  const pauseAgain = await session.pauseRest({ eventId: 'pause-1' })
  expect(pauseAgain).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(session.view().rest).toMatchObject({ status: 'paused', remainingMs: 60_000 })

  const restored = await openSession({ storage, now: clock.now, timeZone: 'UTC' })
  const pauseReplay = await restored.pauseRest({ eventId: 'pause-1' })
  expect(pauseReplay).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(restored.view().rest).toMatchObject({ status: 'paused', remainingMs: 60_000 })

  const cancel = await session.cancelRest({ eventId: 'cancel-1' })
  expect(cancel).toMatchObject({ ok: true, saved: true })
  const cancelAgain = await session.cancelRest({ eventId: 'cancel-1' })
  expect(cancelAgain).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(session.view().rest).toBeNull()

  const night = createClock(Date.parse('2026-11-07T23:10:00.000Z'))
  const nightStorage = createMemoryStorage()
  const nightBase = baseWorkout()
  nightBase.start = night.now()
  const overnight = await started({ clock: night, storage: nightStorage, base: nightBase, timeZone: 'UTC' })
  await overnight.session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  night.set(Date.parse('2026-11-08T07:00:00.000Z'))
  const resume = await overnight.session.resume({ eventId: 'resume-1' })
  expect(resume).toMatchObject({ ok: true, saved: true })
  const resumeAgain = await overnight.session.resume({ eventId: 'resume-1' })
  expect(resumeAgain).toMatchObject({ ok: true, saved: false, duplicate: true })
  expect(overnight.session.view().overnight).toBe(false)
  expect((await nightStorage.readAll()).filter(event => event.type === 'session.resume')).toHaveLength(1)
})

test('finishing during rest clears the countdown and does not revive it on restore', async () => {
  const clock = createClock(T0)
  const storage = createMemoryStorage()
  const { session } = await started({ clock, storage })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  await session.startRest({ eventId: 'rest-1', durationMs: 90_000 })
  clock.advance(5_000)
  const result = await session.finish({ eventId: 'finish-1' })
  expect(result).toMatchObject({ ok: true, saved: true })
  expect(session.view().status).toBe('finished')
  expect(session.view().rest).toBeNull()
  expect(session.view().finished.entries).toHaveLength(1)
  expect(session.view().finished.end).toBe(clock.now())

  const restored = await openSession({ storage, now: () => clock.now() + 60_000, timeZone: 'UTC' })
  expect(restored.view().status).toBe('finished')
  expect(restored.view().rest).toBeNull()
  expect(restored.view().finished.end).toBe(clock.now())
  expect(restored.view().elapsedMs).toBe(session.view().elapsedMs)
})

test('an unfinished session that crosses local midnight offers resume, a chosen end, or discard', async () => {
  const clock = createClock(Date.parse('2026-11-07T23:10:00.000Z'))
  const storage = createMemoryStorage()
  const base = baseWorkout()
  base.start = clock.now()
  const { session } = await started({ clock, storage, base, timeZone: 'UTC' })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const loggedAt = clock.now()
  clock.set(Date.parse('2026-11-08T07:00:00.000Z'))

  const open = session.view()
  expect(open.overnight).toBe(true)
  expect(open.disposition).toMatchObject({
    kind: 'overnight',
    actions: ['resume', 'finish', 'discard'],
  })
  expect(open.disposition.suggestedEnd).toBe(loggedAt)
  expect(open.elapsedMs).toBeLessThan(30 * 60 * 1000)
  expect(open.status).toBe('active')
  expect(open.finished).toBeNull()

  const silent = await session.finish({ eventId: 'finish-silent' })
  expect(silent).toMatchObject({ ok: false, saved: false, error: { code: 'overnight' } })
  expect(session.view().finished).toBeNull()
  expect((await storage.readAll()).map(event => event.id)).not.toContain('finish-silent')

  const resume = await session.resume({ eventId: 'resume-1' })
  expect(resume).toMatchObject({ ok: true, saved: true })
  expect(session.view().overnight).toBe(false)
  expect(session.view().disposition.kind).toBe('active')
  expect(session.view().elapsedMs).toBeLessThan(30 * 60 * 1000)

  clock.set(Date.parse('2026-11-09T07:00:00.000Z'))
  expect(session.view().overnight).toBe(true)
  const chosenEnd = loggedAt + 20 * 60 * 1000
  const done = await session.finish({ eventId: 'finish-chosen', end: chosenEnd })
  expect(done).toMatchObject({ ok: true, saved: true })
  expect(session.view().finished.end).toBe(chosenEnd)
  expect(session.view().finished.start).toBe(base.start)
  expect(session.view().finished.end - session.view().finished.start).toBeLessThan(3 * 60 * 60 * 1000)
})

test('a failed clear leaves the logged set and the draft in place', async () => {
  const storage = createMemoryStorage()
  const { session } = await started({ storage })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  await session.putDraft(bench1, { w: 70, r: 3 })
  storage.clear = async () => { throw new Error('disk full') }
  let thrown = null
  let result
  try {
    result = await session.discard()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeNull()
  expect(result).toMatchObject({ ok: false, saved: false, error: { code: 'storage' } })
  expect(result.error.message).toContain('disk full')
  expect(session.view().status).toBe('active')
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 5, loadReps: 300 })
  expect(session.getDraft(bench1)).toEqual({ w: 70, r: 3 })
  expect(await storage.readBase()).not.toBeNull()
  expect(await storage.readAll()).toHaveLength(1)
})

test('a short overnight gap stays out of elapsed through a kill and a resume', async () => {
  const clock = createClock(Date.parse('2026-11-07T23:40:00.000Z'))
  const across = createMemoryStorage()
  const acrossBase = baseWorkout()
  acrossBase.start = clock.now()
  const first = await started({ clock, storage: across, base: acrossBase, timeZone: 'UTC' })
  await first.session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const beforeMidnight = first.session.view().elapsedMs
  clock.set(Date.parse('2026-11-08T00:10:00.000Z'))
  await first.session.commitSet({ eventId: 'c2', exerciseId: 'bench', setId: bench1, fields: { w: 60, r: 5 } })
  expect(first.session.view().elapsedMs - beforeMidnight).toBe(30 * 60 * 1000)

  const idleClock = createClock(Date.parse('2026-11-07T23:10:00.000Z'))
  const storage = createMemoryStorage()
  const base = baseWorkout()
  base.start = idleClock.now()
  const { session } = await started({ clock: idleClock, storage, base, timeZone: 'UTC' })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const logged = session.view().elapsedMs
  idleClock.set(Date.parse('2026-11-08T01:10:00.000Z'))
  const idle = session.view()
  expect(idle.overnight).toBe(true)
  expect(idle.elapsedMs).toBe(logged)

  const killed = await openSession({
    storage,
    now: idleClock.now,
    timeZone: 'UTC',
  })
  expect(killed.view().overnight).toBe(true)
  expect(killed.view().elapsedMs).toBe(logged)

  const resume = await session.resume({ eventId: 'resume-1' })
  expect(resume).toMatchObject({ ok: true, saved: true })
  expect(session.view().overnight).toBe(false)
  expect(session.view().elapsedMs).toBe(logged)

  idleClock.advance(10 * 60 * 1000)
  expect(session.view().elapsedMs).toBe(logged + 10 * 60 * 1000)

  const restored = await openSession({ storage, now: idleClock.now, timeZone: 'UTC' })
  expect(restored.view().overnight).toBe(false)
  expect(restored.view().elapsedMs).toBe(logged + 10 * 60 * 1000)
})

test('a rest across midnight keeps counting and does not fall back to the last set', async () => {
  const clock = createClock(Date.parse('2026-11-07T23:50:00.000Z'))
  const storage = createMemoryStorage()
  const base = baseWorkout()
  base.start = clock.now()
  const { session } = await started({ clock, storage, base, timeZone: 'UTC' })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const logged = session.view().elapsedMs

  clock.set(Date.parse('2026-11-08T00:05:00.000Z'))
  const resting = session.view()
  expect(resting.overnight).toBe(true)
  expect(resting.elapsedMs).toBe(logged + REST_MAX_MS)

  const killed = await openSession({ storage, now: clock.now, timeZone: 'UTC' })
  expect(killed.view().overnight).toBe(true)
  expect(killed.view().elapsedMs).toBe(logged + REST_MAX_MS)

  const resume = await session.resume({ eventId: 'resume-1' })
  expect(resume).toMatchObject({ ok: true, saved: true })
  expect(session.view().overnight).toBe(false)
  expect(session.view().elapsedMs).toBe(logged + REST_MAX_MS)

  const idleClock = createClock(Date.parse('2026-11-07T23:50:00.000Z'))
  const idleBase = baseWorkout()
  idleBase.start = idleClock.now()
  const idle = await started({ clock: idleClock, base: idleBase, timeZone: 'UTC' })
  await idle.session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const idleLogged = idle.session.view().elapsedMs
  idleClock.set(Date.parse('2026-11-07T23:59:00.000Z'))
  const beforeMidnight = idle.session.view().elapsedMs
  expect(beforeMidnight).toBe(idleLogged + 9 * 60 * 1000)
  idleClock.set(Date.parse('2026-11-08T00:30:00.000Z'))
  expect(idle.session.view().elapsedMs).toBe(beforeMidnight)

  const pastRest = createClock(Date.parse('2026-11-07T23:50:00.000Z'))
  const pastBase = baseWorkout()
  pastBase.start = pastRest.now()
  const longer = await started({ clock: pastRest, base: pastBase, timeZone: 'UTC' })
  await longer.session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  const pastLogged = longer.session.view().elapsedMs
  pastRest.set(Date.parse('2026-11-08T00:06:00.000Z'))
  expect(longer.session.view().elapsedMs).toBe(pastLogged)
})

test('discard drops an overnight session instead of logging it', async () => {
  const clock = createClock(Date.parse('2026-11-07T23:10:00.000Z'))
  const storage = createMemoryStorage()
  const base = baseWorkout()
  base.start = clock.now()
  const { session } = await started({ clock, storage, base, timeZone: 'UTC' })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  clock.set(Date.parse('2026-11-08T07:00:00.000Z'))
  const discarded = await session.discard()
  expect(discarded).toMatchObject({ ok: true, saved: true })
  expect(session.view().status).toBe('discarded')
  expect(session.view().finished).toBeNull()
  expect(await storage.readAll()).toEqual([])
  expect(await storage.readBase()).toBeNull()
})

test('a backward or forward clock jump never makes remaining or elapsed negative', async () => {
  const clock = createClock(T0)
  const { session } = await started({ clock })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  await session.startRest({ eventId: 'rest-1', durationMs: 90_000 })
  clock.advance(30_000)
  const mid = session.view()
  expect(mid.elapsedMs).toBe(30_000)
  expect(mid.rest.remainingMs).toBe(60_000)

  clock.advance(-2 * 60 * 60 * 1000)
  const jumpedBack = session.view()
  expect(jumpedBack.elapsedMs).toBe(mid.elapsedMs)
  expect(jumpedBack.rest.remainingMs).toBeGreaterThanOrEqual(0)
  expect(jumpedBack.rest.remainingMs).toBeLessThanOrEqual(jumpedBack.rest.totalMs)
  expect(jumpedBack.elapsedMs).toBeGreaterThanOrEqual(0)

  clock.set(T0 + 30_000 + 5 * 60 * 60 * 1000)
  const jumpedForward = session.view()
  expect(jumpedForward.elapsedMs).toBe(mid.elapsedMs)
  expect(jumpedForward.rest).toMatchObject({ status: 'complete', remainingMs: 0 })
  expect(jumpedForward.totals.completedSets).toBe(1)
})

test('changing time zone does not change elapsed time or rest remaining', async () => {
  const clock = createClock(Date.parse('2026-11-07T22:00:00-05:00'))
  const base = baseWorkout()
  base.start = clock.now()
  const { session } = await started({ clock, base, timeZone: 'America/New_York' })
  await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
  await session.startRest({ eventId: 'rest-1', durationMs: 90_000 })
  clock.advance(30 * 60 * 1000)

  const east = session.view({ timeZone: 'America/New_York' })
  const west = session.view({ timeZone: 'America/Los_Angeles' })
  const auckland = session.view({ timeZone: 'Pacific/Auckland' })
  expect(west.elapsedMs).toBe(east.elapsedMs)
  expect(auckland.elapsedMs).toBe(east.elapsedMs)
  expect(west.rest.remainingMs).toBe(east.rest.remainingMs)
  expect(auckland.rest.remainingMs).toBe(east.rest.remainingMs)
  expect(east.elapsedMs).toBeGreaterThan(0)
  expect(east.overnight).toBe(false)
  expect(west.overnight).toBe(false)

  clock.set(Date.parse('2026-11-08T07:00:00-05:00'))
  const nextMorning = session.view({ timeZone: 'America/New_York' })
  const sameInstantWest = session.view({ timeZone: 'America/Los_Angeles' })
  expect(nextMorning.overnight).toBe(true)
  expect(sameInstantWest.overnight).toBe(true)
  expect(nextMorning.elapsedMs).toBe(east.elapsedMs)
  expect(sameInstantWest.elapsedMs).toBe(east.elapsedMs)
  expect(nextMorning.rest.remainingMs).toBe(0)
})

test('a failed append surfaces the error and does not mark the set saved', async () => {
  const storage = createMemoryStorage()
  const { session } = await started({ storage })
  storage.failAppends(new Error('disk full'))
  const attempt = await session.commitSet({
    eventId: 'commit-fail',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 90, r: 3 },
  })
  expect(attempt.ok).toBe(false)
  expect(attempt.saved).toBe(false)
  expect(attempt.error.code).toBe('storage')
  expect(attempt.error.message).toContain('disk full')
  expect(session.view().entries[0].sets[0].completed).toBe(false)
  expect(session.view().totals.completedSets).toBe(0)
  expect(await storage.readAll()).toEqual([])

  storage.failAppends(null)
  const retry = await session.commitSet({
    eventId: 'commit-fail',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 90, r: 3 },
  })
  expect(retry).toMatchObject({ ok: true, saved: true })
  expect(session.view().totals).toMatchObject({ completedSets: 1, reps: 3, loadReps: 270 })
})

test('finish folds into the web workout document and keeps unknown keys', async () => {
  const clock = createClock(T0)
  const base = baseWorkout()
  const snapshot = JSON.parse(JSON.stringify(base))
  const { session } = await started({ clock, base })
  await session.commitSet({
    eventId: 'warm',
    exerciseId: 'bench',
    setId: bench0,
    fields: { w: 40, r: 5, warmup: true },
  })
  await session.commitSet({
    eventId: 'work',
    exerciseId: 'bench',
    setId: bench1,
    fields: { w: 60, r: 5 },
  })
  clock.advance(10 * 60 * 1000)
  await session.putDraft(plannedSetId('row', 0), { w: 999, r: 99 })
  const result = await session.finish({ eventId: 'finish-1' })
  expect(result).toMatchObject({ ok: true, saved: true })

  const finished = session.view().finished
  expect(finished).toMatchObject({
    id: 'w1',
    d: '2026-11-07',
    start: T0,
    end: clock.now(),
    name: 'Push',
    bw: 80,
    routineIds: ['routine-1'],
    routineId: 'routine-1',
    importedFrom: 'fitnotes',
    prs: [],
  })
  expect(finished.entries).toHaveLength(1)
  expect(finished.entries[0].id).toBe('bench')
  expect(finished.entries[0].coachNote).toBe('keep-entry')
  expect(finished.entries[0].target).toEqual({ sets: 2, reps: 5, weight: 60 })
  expect(finished.entries[0].sets[0]).toMatchObject({ w: 40, r: 5, done: true, warmup: true, bar: 'texas' })
  expect(finished.entries[0].sets[1]).toMatchObject({ w: 60, r: 5, done: true })
  expect(JSON.stringify(finished)).not.toContain('999')
  expect(finished.entries[0].topW).toBe(60)
  expect(base).toEqual(snapshot)

  const live = session.view()
  expect(live.entries[0].sets[0].warmup).toBe(true)
  expect(live.totals.warmupSets).toBe(1)
  expect(live.totals.completedSets).toBe(2)
  expect(live.totals.loadReps).toBe(40 * 5 + 60 * 5)
})

test('adding a set and moving an exercise replay in journal order', async () => {
  const { session } = await started()
  await session.addSet({ eventId: 'add-1', exerciseId: 'row', setId: 'drop-in', fields: { w: 50, r: 12 } })
  await session.moveExercise({ eventId: 'move-1', exerciseId: 'row', toIndex: 0 })
  await session.commitSet({ eventId: 'c-extra', exerciseId: 'row', setId: 'drop-in', fields: { w: 55, r: 10 } })
  const view = session.view()
  expect(view.entries.map(entry => entry.id)).toEqual(['row', 'bench'])
  expect(view.entries[0].sets.map(set => set.setId)).toEqual([plannedSetId('row', 0), 'drop-in'])
  expect(view.entries[0].sets[1].completed).toBe(true)
  expect(view.entries[0].sets[1].row).toMatchObject({ w: 55, r: 10, done: true })
  expect(view.entries[0].sets[0].completed).toBe(false)
  expect(view.totals).toMatchObject({ completedSets: 1, reps: 10, loadReps: 550 })
})
