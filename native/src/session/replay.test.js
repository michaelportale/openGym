import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { openSession, plannedSetId } from './session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const MORNING = Date.parse('2026-11-08T07:00:00.000Z')
const bench0 = plannedSetId('bench', 0)
const bench1 = plannedSetId('bench', 1)

function createClock(start = T0) {
  let t = start
  return {
    now: () => t,
    set(n) { t = n },
  }
}

function baseWorkout() {
  return {
    id: 'w1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
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

function takesEventId(fn) {
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  if (open < 0) return false
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return /\beventId\b/.test(source.slice(open, i + 1))
    }
  }
  return false
}

function commandsTakingEventId(session) {
  const proto = Object.getPrototypeOf(session)
  return Object.getOwnPropertyNames(proto)
    .filter(name => name !== 'constructor' && typeof proto[name] === 'function' && takesEventId(proto[name]))
    .sort()
}

async function opened(start = T0) {
  const clock = createClock(start)
  const storage = createMemoryStorage()
  const base = baseWorkout()
  base.start = start
  const session = await openSession({ base, storage, now: clock.now, timeZone: 'UTC' })
  return { session, clock, storage }
}

const curl = {
  id: 'curl',
  target: { sets: 1, reps: 10, weight: 20 },
  sets: [{ w: 20, r: 10, done: false }],
}

// Each case runs the command once, then changes state so a second call would fail its
// precondition, then replays the same event id.
const cases = {
  commitSet: {
    type: 'set.commit',
    async run(session, eventId) {
      return session.commitSet({ eventId, exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
    },
    async spoil(session) {
      return session.removeSet({ eventId: 'spoil-commit', exerciseId: 'bench', setId: bench0 })
    },
    replay(session, eventId) {
      return session.commitSet({ eventId, exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
    },
  },
  editSet: {
    type: 'set.edit',
    async run(session, eventId) {
      await session.commitSet({ eventId: 'setup-edit', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
      return session.editSet({ eventId, exerciseId: 'bench', setId: bench0, fields: { r: 6 } })
    },
    async spoil(session) {
      return session.removeSet({ eventId: 'spoil-edit', exerciseId: 'bench', setId: bench0 })
    },
    replay(session, eventId) {
      return session.editSet({ eventId, exerciseId: 'bench', setId: bench0, fields: { r: 6 } })
    },
  },
  undoSet: {
    type: 'set.undo',
    async run(session, eventId) {
      await session.commitSet({ eventId: 'setup-undo', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
      return session.undoSet({ eventId, exerciseId: 'bench', setId: bench0 })
    },
    async spoil(session) {
      return session.removeSet({ eventId: 'spoil-undo', exerciseId: 'bench', setId: bench0 })
    },
    replay(session, eventId) {
      return session.undoSet({ eventId, exerciseId: 'bench', setId: bench0 })
    },
  },
  removeSet: {
    type: 'set.remove',
    async run(session, eventId) {
      return session.removeSet({ eventId, exerciseId: 'bench', setId: bench1 })
    },
    async spoil(session) {
      return { ok: true, saved: true }
    },
    replay(session, eventId) {
      return session.removeSet({ eventId, exerciseId: 'bench', setId: bench1 })
    },
  },
  addSet: {
    type: 'set.add',
    async run(session, eventId) {
      return session.addSet({ eventId, exerciseId: 'row', setId: 'extra-1', fields: { w: 40, r: 8 } })
    },
    async spoil(session) {
      return session.removeExercise({ eventId: 'spoil-add-set', exerciseId: 'row' })
    },
    replay(session, eventId) {
      return session.addSet({ eventId, exerciseId: 'row', setId: 'extra-1', fields: { w: 40, r: 8 } })
    },
  },
  addExercise: {
    type: 'exercise.add',
    async run(session, eventId) {
      return session.addExercise({ eventId, exerciseId: 'curl', entry: curl })
    },
    async spoil() {
      return { ok: true, saved: true }
    },
    replay(session, eventId) {
      return session.addExercise({ eventId, exerciseId: 'curl', entry: curl })
    },
  },
  removeExercise: {
    type: 'exercise.remove',
    async run(session, eventId) {
      return session.removeExercise({ eventId, exerciseId: 'row' })
    },
    async spoil() {
      return { ok: true, saved: true }
    },
    replay(session, eventId) {
      return session.removeExercise({ eventId, exerciseId: 'row' })
    },
  },
  moveExercise: {
    type: 'exercise.move',
    async run(session, eventId) {
      return session.moveExercise({ eventId, exerciseId: 'row', toIndex: 0 })
    },
    async spoil(session) {
      return session.removeExercise({ eventId: 'spoil-move', exerciseId: 'row' })
    },
    replay(session, eventId) {
      return session.moveExercise({ eventId, exerciseId: 'row', toIndex: 0 })
    },
  },
  startRest: {
    type: 'rest.start',
    async run(session, eventId) {
      return session.startRest({ eventId, durationMs: 60_000 })
    },
    async spoil(session) {
      return session.cancelRest({ eventId: 'spoil-start' })
    },
    replay(session, eventId) {
      return session.startRest({ eventId })
    },
  },
  pauseRest: {
    type: 'rest.pause',
    async run(session, eventId) {
      await session.startRest({ eventId: 'setup-pause', durationMs: 60_000 })
      return session.pauseRest({ eventId })
    },
    async spoil(session) {
      return session.cancelRest({ eventId: 'spoil-pause' })
    },
    replay(session, eventId) {
      return session.pauseRest({ eventId })
    },
  },
  extendRest: {
    type: 'rest.extend',
    async run(session, eventId) {
      await session.startRest({ eventId: 'setup-extend', durationMs: 60_000 })
      return session.extendRest({ eventId, byMs: 15_000 })
    },
    async spoil(session) {
      return session.cancelRest({ eventId: 'spoil-extend' })
    },
    replay(session, eventId) {
      return session.extendRest({ eventId, byMs: 0 })
    },
  },
  cancelRest: {
    type: 'rest.cancel',
    async run(session, eventId) {
      await session.startRest({ eventId: 'setup-cancel', durationMs: 60_000 })
      return session.cancelRest({ eventId })
    },
    async spoil() {
      return { ok: true, saved: true }
    },
    replay(session, eventId) {
      return session.cancelRest({ eventId })
    },
  },
  setNote: {
    type: 'session.note',
    async run(session, eventId) {
      return session.setNote({ eventId, note: 'kept' })
    },
    async spoil(session) {
      return session.finish({ eventId: 'spoil-note' })
    },
    replay(session, eventId) {
      return session.setNote({ eventId, note: null })
    },
  },
  setExerciseNote: {
    type: 'exercise.note',
    async run(session, eventId) {
      return session.setExerciseNote({ eventId, exerciseId: 'row', note: 'kept' })
    },
    async spoil(session) {
      return session.removeExercise({ eventId: 'spoil-ex-note', exerciseId: 'row' })
    },
    replay(session, eventId) {
      return session.setExerciseNote({ eventId, exerciseId: 'row', note: null })
    },
  },
  resume: {
    type: 'session.resume',
    async run(session, eventId, clock) {
      await session.commitSet({ eventId: 'setup-resume', exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } })
      clock.set(MORNING)
      return session.resume({ eventId })
    },
    async spoil(session) {
      return session.finish({ eventId: 'spoil-resume' })
    },
    replay(session, eventId) {
      return session.resume({ eventId })
    },
  },
  finish: {
    type: 'session.finish',
    async run(session, eventId) {
      return session.finish({ eventId })
    },
    async spoil() {
      return { ok: true, saved: true }
    },
    replay(session, eventId) {
      return session.finish({ eventId, end: T0 - 1 })
    },
  },
}

test('every eventId command replays as a duplicate after its precondition is gone', async () => {
  const probe = await opened()
  const names = commandsTakingEventId(probe.session)
  const missing = names.filter(name => !cases[name])
  const extra = Object.keys(cases).filter(name => !names.includes(name))
  expect(missing, `commands without a replay case: ${missing.join(', ')}`).toEqual([])
  expect(extra, `replay cases for unknown commands: ${extra.join(', ')}`).toEqual([])

  for (const name of names) {
    const { session, clock, storage } = await opened()
    const eventId = `${name}-1`
    const spec = cases[name]
    const first = await spec.run(session, eventId, clock)
    expect(first, name).toMatchObject({ ok: true, saved: true })
    const spoiled = await spec.spoil(session, clock)
    expect(spoiled, `${name} spoil`).toMatchObject({ ok: true })
    const again = await spec.replay(session, eventId, clock)
    expect(again, name).toEqual({ ok: true, saved: false, duplicate: true })
    const events = await storage.readAll()
    expect(events.filter(event => event.type === spec.type), name).toHaveLength(1)
    expect(events.filter(event => event.id === eventId), name).toHaveLength(1)
  }
})
