import { expect, test } from 'vitest'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { openSession, plannedSetId } from './session.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createMemoryStorage } from './storage.js'

// One fixed clock. Every step below uses these instants, in this order.
const START = Date.parse('2026-11-07T22:00:00.000Z')
const SET_ONE = Date.parse('2026-11-07T22:12:00.000Z')
const REST_START = Date.parse('2026-11-07T22:14:00.000Z')
const REST_PAUSE = Date.parse('2026-11-07T22:14:30.000Z')
const REST_EXTEND = Date.parse('2026-11-07T22:16:00.000Z')
const AFTER_PAUSE = Date.parse('2026-11-07T22:20:00.000Z')
const REST_CANCEL = Date.parse('2026-11-07T22:21:00.000Z')
const SET_TWO = Date.parse('2026-11-07T22:40:00.000Z')
const BEFORE_MIDNIGHT = Date.parse('2026-11-07T23:50:00.000Z')
const JUST_AFTER_MIDNIGHT = Date.parse('2026-11-08T00:05:00.000Z')
const SAME_NIGHT = Date.parse('2026-11-08T01:40:00.000Z')
const NEXT_NIGHT = Date.parse('2026-11-09T00:20:00.000Z')
const AFTER_RESUME = Date.parse('2026-11-09T00:30:00.000Z')

const bench0 = plannedSetId('bench', 0)
const bench1 = plannedSetId('bench', 1)

function createClock(start) {
  let t = start
  return {
    now: () => t,
    set(n) { t = n },
  }
}

function baseWorkout(start) {
  return {
    id: 'w1',
    d: '2026-11-07',
    start,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [{
      id: 'bench',
      target: { sets: 2, reps: 5 },
      sets: [
        { w: 60, r: 5, done: false },
        { w: 60, r: 5, done: false },
      ],
    }],
  }
}

async function openDriver(kind, clock) {
  if (kind === 'memory') {
    const storage = createMemoryStorage()
    const session = await openSession({
      base: baseWorkout(clock.now()),
      storage,
      now: clock.now,
      timeZone: 'UTC',
    })
    return {
      session,
      reopen: () => openSession({ storage, now: clock.now, timeZone: 'UTC' }),
    }
  }
  let db = kind === 'node sqlite file' ? createNodeSqliteFileDb() : createFakeSqliteDb()
  const session = await openSession({
    base: baseWorkout(clock.now()),
    storage: createSqliteSessionStorage(db),
    now: clock.now,
    timeZone: 'UTC',
  })
  return {
    session,
    reopen: () => {
      db = db.reopen()
      return openSession({
        storage: createSqliteSessionStorage(db),
        now: clock.now,
        timeZone: 'UTC',
      })
    },
  }
}

test('displayed elapsed never rewinds across a fixed session', async () => {
  for (const kind of ['memory', 'sqlite', 'node sqlite file']) {
    const clock = createClock(START)
    let { session, reopen } = await openDriver(kind, clock)
    let previous = null
    let allowDrop = false
    const trace = []
    const at = {}

    function observe(label) {
      const view = session.view()
      const elapsed = view.elapsedMs
      trace.push(`${kind} ${label} ${elapsed}`)
      if (!allowDrop && previous != null && elapsed < previous) {
        expect.fail(`${kind} ${label} rewound elapsed from ${previous} to ${elapsed}\n${trace.join('\n')}`)
      }
      allowDrop = false
      previous = elapsed
      at[label] = elapsed
      return view
    }

    async function kill(label) {
      await session.flushSeen()
      session = await reopen()
      observe(label)
    }

    observe('open')

    clock.set(SET_ONE)
    expect(await session.commitSet({
      eventId: 'set-1',
      exerciseId: 'bench',
      setId: bench0,
      fields: { w: 60, r: 5 },
    })).toMatchObject({ ok: true, saved: true })
    observe('set one')
    await session.noteSeen()

    clock.set(REST_START)
    expect(await session.startRest({ eventId: 'rest-1', durationMs: 90_000 })).toMatchObject({ ok: true, saved: true })
    observe('rest started')

    clock.set(REST_PAUSE)
    expect(await session.pauseRest({ eventId: 'pause-1' })).toMatchObject({ ok: true, saved: true })
    observe('rest paused')

    clock.set(REST_EXTEND)
    expect(await session.extendRest({ eventId: 'extend-1', byMs: 30_000 })).toMatchObject({ ok: true, saved: true })
    observe('rest extended')

    clock.set(AFTER_PAUSE)
    observe('still paused')
    await session.flushSeen()
    await kill('reopen after pause')

    clock.set(REST_CANCEL)
    expect(await session.cancelRest({ eventId: 'cancel-1' })).toMatchObject({ ok: true, saved: true })
    observe('rest cancelled')

    clock.set(SET_TWO)
    expect(await session.commitSet({
      eventId: 'set-2',
      exerciseId: 'bench',
      setId: bench1,
      fields: { w: 60, r: 5 },
    })).toMatchObject({ ok: true, saved: true })
    observe('set two')
    await session.noteSeen()

    clock.set(BEFORE_MIDNIGHT)
    observe('before midnight')
    await session.flushSeen()

    clock.set(JUST_AFTER_MIDNIGHT)
    observe('short rest across midnight')
    await session.noteSeen()
    await session.flushSeen()
    await kill('reopen just after midnight')

    clock.set(SAME_NIGHT)
    observe('later the same night')
    await session.flushSeen()
    await kill('reopen later the same night')

    clock.set(NEXT_NIGHT)
    observe('long overnight gap')
    expect(await session.resume({ eventId: 'resume-1' })).toMatchObject({ ok: true, saved: true })
    observe('resumed')

    clock.set(AFTER_RESUME)
    observe('after resume')
    await session.flushSeen()
    await kill('reopen after resume')

    allowDrop = true
    expect(await session.discard()).toMatchObject({ ok: true, saved: true })
    const discarded = observe('discarded')
    expect(discarded.status).toBe('discarded')
    expect(discarded.elapsedMs).toBe(0)

    expect(at['short rest across midnight'] - at['before midnight']).toBe(15 * 60 * 1000)
    expect(at['reopen just after midnight']).toBe(at['short rest across midnight'])
    expect(at['later the same night']).toBeGreaterThan(at['short rest across midnight'])
    expect(at['long overnight gap']).toBe(at['later the same night'])
    expect(at['resumed']).toBe(at['long overnight gap'])
    expect(at['after resume'] - at['resumed']).toBe(10 * 60 * 1000)
    expect(at['reopen after resume']).toBe(at['after resume'])
    expect(at['discarded']).toBeLessThan(at['reopen after resume'])
  }
})
