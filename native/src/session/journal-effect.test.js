import { expect, test } from 'vitest'
import { workoutFold } from './fold.js'
import { createMemoryStorage } from './storage.js'
import { openSession, plannedSetId } from './session.js'
import { REST_MAX_MS } from './timing.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const MORNING = Date.parse('2026-11-08T07:00:00.000Z')
const STATES = ['active', 'finished', 'discarded']
const SEEDS = [1, 7, 42]
const bench0 = plannedSetId('bench', 0)
const bench1 = plannedSetId('bench', 1)
const row0 = plannedSetId('row', 0)

// discard() clears the journal. It does not take an event id and does not append.
// resume is the one saved event the fold applies as a no-op on purpose.
const STAMP_ONLY = {
  resume: 'resume only leaves a stamp so the timer can cross midnight. Sets, rest, notes, and the finish stay as they are.',
}

function createClock(start = T0) {
  let t = start
  return {
    now: () => t,
    set(n) { t = n },
    advance(ms) { t += ms },
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

async function opened() {
  const clock = createClock()
  const storage = createMemoryStorage()
  const session = await openSession({
    base: baseWorkout(),
    storage,
    now: clock.now,
    timeZone: 'UTC',
  })
  return { session, clock, storage }
}

const curl = {
  id: 'curl',
  target: { sets: 1, reps: 10, weight: 20 },
  sets: [{ w: 20, r: 10, done: false }],
}

function commit(id, fields = { w: 60, r: 5 }) {
  return session => session.commitSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields })
}

const attempts = {
  commitSet: [
    { label: 'valid', call: (session, id) => commit(id)(session) },
    { label: 'nan-weight', call: (session, id) => commit(id, { w: Number.NaN, r: 5 })(session) },
    { label: 'unknown-set', call: (session, id) => session.commitSet({ eventId: id, exerciseId: 'bench', setId: 'missing', fields: { w: 1, r: 1 } }) },
    {
      label: 'same-fields',
      prepare: commit('setup-same'),
      call: (session, id) => commit(id)(session),
    },
    { label: 'duplicate', prepare: (session, id) => commit(id)(session), call: (session, id) => commit(id, { w: 1, r: 1 })(session) },
  ],
  editSet: [
    { label: 'valid', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { r: 6 } }) },
    { label: 'clear-weight', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { w: null } }) },
    { label: 'unknown-set', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: 'missing', fields: { r: 1 } }) },
    { label: 'empty-fields', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: {} }) },
    { label: 'done-only', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { done: true } }) },
    { label: 'at-only', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { at: T0 } }) },
    { label: 'same-weight', call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { w: 60, r: 5 } }) },
    {
      label: 'duplicate',
      prepare: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { r: 6 } }),
      call: (session, id) => session.editSet({ eventId: id, exerciseId: 'bench', setId: bench0, fields: { r: 1 } }),
    },
  ],
  undoSet: [
    {
      label: 'valid',
      prepare: commit('setup-undo'),
      call: (session, id) => session.undoSet({ eventId: id, exerciseId: 'bench', setId: bench0 }),
    },
    { label: 'unknown-set', call: (session, id) => session.undoSet({ eventId: id, exerciseId: 'bench', setId: 'missing' }) },
    { label: 'fresh', call: (session, id) => session.undoSet({ eventId: id, exerciseId: 'bench', setId: bench0 }) },
    {
      label: 'again',
      prepare: async session => {
        await commit('setup-undo-again')(session)
        return session.undoSet({ eventId: 'setup-undo-again-clear', exerciseId: 'bench', setId: bench0 })
      },
      call: (session, id) => session.undoSet({ eventId: id, exerciseId: 'bench', setId: bench0 }),
    },
    {
      label: 'duplicate',
      prepare: async (session, id) => {
        await commit('setup-undo-dup')(session)
        return session.undoSet({ eventId: id, exerciseId: 'bench', setId: bench0 })
      },
      call: (session, id) => session.undoSet({ eventId: id, exerciseId: 'bench', setId: bench0 }),
    },
  ],
  removeSet: [
    { label: 'valid', call: (session, id) => session.removeSet({ eventId: id, exerciseId: 'bench', setId: bench1 }) },
    { label: 'last-set', call: (session, id) => session.removeSet({ eventId: id, exerciseId: 'row', setId: row0 }) },
    { label: 'unknown-set', call: (session, id) => session.removeSet({ eventId: id, exerciseId: 'bench', setId: 'missing' }) },
    {
      label: 'duplicate',
      prepare: (session, id) => session.removeSet({ eventId: id, exerciseId: 'bench', setId: bench1 }),
      call: (session, id) => session.removeSet({ eventId: id, exerciseId: 'bench', setId: bench0 }),
    },
  ],
  addSet: [
    { label: 'valid', call: (session, id) => session.addSet({ eventId: id, exerciseId: 'row', setId: 'extra-1', fields: { w: 40, r: 8 } }) },
    { label: 'empty-id', call: (session, id) => session.addSet({ eventId: id, exerciseId: 'row', setId: '', fields: { w: 1, r: 1 } }) },
    { label: 'known-set', call: (session, id) => session.addSet({ eventId: id, exerciseId: 'row', setId: bench0, fields: { w: 1, r: 1 } }) },
    { label: 'unknown-exercise', call: (session, id) => session.addSet({ eventId: id, exerciseId: 'nope', setId: 'extra-2', fields: { w: 1, r: 1 } }) },
    {
      label: 'duplicate',
      prepare: (session, id) => session.addSet({ eventId: id, exerciseId: 'row', setId: 'extra-1', fields: { w: 40, r: 8 } }),
      call: (session, id) => session.addSet({ eventId: id, exerciseId: 'bench', setId: 'extra-9', fields: { w: 1, r: 1 } }),
    },
  ],
  addExercise: [
    { label: 'valid', call: (session, id) => session.addExercise({ eventId: id, exerciseId: 'curl', entry: curl }) },
    { label: 'blank-entry', call: (session, id) => session.addExercise({ eventId: id, exerciseId: 'press' }) },
    { label: 'known-exercise', call: (session, id) => session.addExercise({ eventId: id, exerciseId: 'bench', entry: curl }) },
    { label: 'empty-id', call: (session, id) => session.addExercise({ eventId: id, exerciseId: '', entry: curl }) },
    {
      label: 'known-set',
      call: (session, id) => session.addExercise({
        eventId: id,
        exerciseId: 'press',
        entry: { sets: [{ id: bench0, w: 1, r: 1 }] },
      }),
    },
    {
      label: 'duplicate-set',
      call: (session, id) => session.addExercise({
        eventId: id,
        exerciseId: 'press',
        entry: { sets: [{ id: 'same', w: 1, r: 1 }, { id: 'same', w: 2, r: 2 }] },
      }),
    },
    {
      label: 'duplicate',
      prepare: (session, id) => session.addExercise({ eventId: id, exerciseId: 'curl', entry: curl }),
      call: (session, id) => session.addExercise({ eventId: id, exerciseId: 'press', entry: curl }),
    },
  ],
  removeExercise: [
    { label: 'valid', call: (session, id) => session.removeExercise({ eventId: id, exerciseId: 'row' }) },
    { label: 'unknown-exercise', call: (session, id) => session.removeExercise({ eventId: id, exerciseId: 'nope' }) },
    {
      label: 'last-exercise',
      prepare: session => session.removeExercise({ eventId: 'setup-rm-row', exerciseId: 'row' }),
      call: (session, id) => session.removeExercise({ eventId: id, exerciseId: 'bench' }),
    },
    {
      label: 'duplicate',
      prepare: (session, id) => session.removeExercise({ eventId: id, exerciseId: 'row' }),
      call: (session, id) => session.removeExercise({ eventId: id, exerciseId: 'bench' }),
    },
  ],
  moveExercise: [
    { label: 'valid', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 0 }) },
    { label: 'negative', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: -1 }) },
    { label: 'fraction', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 1.5 }) },
    { label: 'nan', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: Number.NaN }) },
    { label: 'text', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: '0' }) },
    { label: 'missing-index', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row' }) },
    { label: 'unknown-exercise', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'nope', toIndex: 0 }) },
    { label: 'same-index', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 1 }) },
    { label: 'past-end', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 99 }) },
    { label: 'already-first', call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'bench', toIndex: 0 }) },
    {
      label: 'duplicate',
      prepare: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 0 }),
      call: (session, id) => session.moveExercise({ eventId: id, exerciseId: 'row', toIndex: 1 }),
    },
  ],
  startRest: [
    { label: 'valid', call: (session, id) => session.startRest({ eventId: id, durationMs: 60_000 }) },
    { label: 'zero-span', call: (session, id) => session.startRest({ eventId: id, deadline: T0 - 1000 }) },
    { label: 'bad-deadline', call: (session, id) => session.startRest({ eventId: id }) },
    {
      label: 'replace',
      prepare: session => session.startRest({ eventId: 'setup-rest', durationMs: 60_000 }),
      call: (session, id) => session.startRest({ eventId: id, durationMs: 90_000 }),
    },
    {
      label: 'same-rest',
      prepare: session => session.startRest({ eventId: 'setup-rest-same', durationMs: 60_000 }),
      call: (session, id) => session.startRest({ eventId: id, durationMs: 60_000 }),
    },
    {
      label: 'duplicate',
      prepare: (session, id) => session.startRest({ eventId: id, durationMs: 60_000 }),
      call: (session, id) => session.startRest({ eventId: id }),
    },
  ],
  pauseRest: [
    {
      label: 'valid',
      prepare: session => session.startRest({ eventId: 'setup-pause', durationMs: 60_000 }),
      call: (session, id) => session.pauseRest({ eventId: id }),
    },
    { label: 'no-rest', call: (session, id) => session.pauseRest({ eventId: id }) },
    {
      label: 'expired',
      prepare: async (session, _id, clock) => {
        await session.startRest({ eventId: 'setup-expired', durationMs: 1000 })
        clock.advance(1000)
      },
      call: (session, id) => session.pauseRest({ eventId: id }),
    },
    {
      label: 'already-paused',
      prepare: async session => {
        await session.startRest({ eventId: 'setup-pause-2', durationMs: 60_000 })
        return session.pauseRest({ eventId: 'setup-pause-2-done' })
      },
      call: (session, id) => session.pauseRest({ eventId: id }),
    },
    {
      label: 'duplicate',
      prepare: async (session, id) => {
        await session.startRest({ eventId: 'setup-pause-dup', durationMs: 60_000 })
        return session.pauseRest({ eventId: id })
      },
      call: (session, id) => session.pauseRest({ eventId: id }),
    },
  ],
  extendRest: [
    {
      label: 'valid',
      prepare: session => session.startRest({ eventId: 'setup-extend', durationMs: 60_000 }),
      call: (session, id) => session.extendRest({ eventId: id, byMs: 15_000 }),
    },
    {
      label: 'shrink',
      prepare: session => session.startRest({ eventId: 'setup-shrink', durationMs: 60_000 }),
      call: (session, id) => session.extendRest({ eventId: id, byMs: -1000 }),
    },
    { label: 'zero', call: (session, id) => session.extendRest({ eventId: id, byMs: 0 }) },
    { label: 'nan', call: (session, id) => session.extendRest({ eventId: id, byMs: Number.NaN }) },
    { label: 'no-rest', call: (session, id) => session.extendRest({ eventId: id, byMs: 1000 }) },
    {
      label: 'full',
      prepare: session => session.startRest({ eventId: 'setup-full', durationMs: 60_000, totalMs: REST_MAX_MS }),
      call: (session, id) => session.extendRest({ eventId: id, byMs: 1000 }),
    },
    {
      label: 'duplicate',
      prepare: async (session, id) => {
        await session.startRest({ eventId: 'setup-extend-dup', durationMs: 60_000 })
        return session.extendRest({ eventId: id, byMs: 15_000 })
      },
      call: (session, id) => session.extendRest({ eventId: id, byMs: 0 }),
    },
  ],
  cancelRest: [
    {
      label: 'valid',
      prepare: session => session.startRest({ eventId: 'setup-cancel', durationMs: 60_000 }),
      call: (session, id) => session.cancelRest({ eventId: id }),
    },
    { label: 'no-rest', call: (session, id) => session.cancelRest({ eventId: id }) },
    {
      label: 'duplicate',
      prepare: async (session, id) => {
        await session.startRest({ eventId: 'setup-cancel-dup', durationMs: 60_000 })
        return session.cancelRest({ eventId: id })
      },
      call: (session, id) => session.cancelRest({ eventId: id }),
    },
  ],
  setNote: [
    { label: 'valid', call: (session, id) => session.setNote({ eventId: id, note: 'kept' }) },
    {
      label: 'clear',
      prepare: session => session.setNote({ eventId: 'setup-note', note: 'from the plan' }),
      call: (session, id) => session.setNote({ eventId: id, note: '   ' }),
    },
    { label: 'blank', call: (session, id) => session.setNote({ eventId: id, note: '' }) },
    { label: 'spaces', call: (session, id) => session.setNote({ eventId: id, note: '   ' }) },
    { label: 'null', call: (session, id) => session.setNote({ eventId: id, note: null }) },
    { label: 'too-long', call: (session, id) => session.setNote({ eventId: id, note: 'a'.repeat(2001) }) },
    {
      label: 'same-text',
      prepare: session => session.setNote({ eventId: 'setup-note-same', note: 'kept' }),
      call: (session, id) => session.setNote({ eventId: id, note: 'kept' }),
    },
    {
      label: 'duplicate',
      prepare: (session, id) => session.setNote({ eventId: id, note: 'kept' }),
      call: (session, id) => session.setNote({ eventId: id, note: null }),
    },
  ],
  setExerciseNote: [
    {
      label: 'valid',
      call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'kept', notePin: true }),
    },
    {
      label: 'clear',
      prepare: session => session.setExerciseNote({ eventId: 'setup-ex-note', exerciseId: 'row', note: 'kept', notePin: true }),
      call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: '   ' }),
    },
    {
      label: 'unpin',
      prepare: session => session.setExerciseNote({ eventId: 'setup-ex-pin', exerciseId: 'row', note: 'kept', notePin: true }),
      call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'kept', notePin: false }),
    },
    { label: 'blank', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: '' }) },
    { label: 'spaces', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: '   ' }) },
    { label: 'null', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: null }) },
    { label: 'too-long', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'a'.repeat(2001) }) },
    { label: 'unknown-exercise', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'nope', note: 'x' }) },
    { label: 'bad-pin', call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'x', notePin: 'yes' }) },
    {
      label: 'pin-already-off',
      prepare: session => session.setExerciseNote({ eventId: 'setup-ex-off', exerciseId: 'row', note: 'kept' }),
      call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'kept', notePin: false }),
    },
    {
      label: 'duplicate',
      prepare: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: 'kept' }),
      call: (session, id) => session.setExerciseNote({ eventId: id, exerciseId: 'row', note: null }),
    },
  ],
  resume: [
    {
      label: 'overnight',
      prepare: commit('setup-resume'),
      call: (session, id, clock) => {
        clock.set(MORNING)
        return session.resume({ eventId: id })
      },
    },
    { label: 'not-overnight', call: (session, id) => session.resume({ eventId: id }) },
    {
      label: 'duplicate',
      prepare: async (session, id, clock) => {
        await commit('setup-resume-dup')(session)
        clock.set(MORNING)
        const saved = await session.resume({ eventId: id })
        clock.set(T0)
        return saved
      },
      call: (session, id) => session.resume({ eventId: id }),
    },
  ],
  finish: [
    { label: 'valid', call: (session, id) => session.finish({ eventId: id }) },
    { label: 'end-before-start', call: (session, id) => session.finish({ eventId: id, end: T0 - 1 }) },
    { label: 'bad-end', call: (session, id) => session.finish({ eventId: id, end: Number.NaN }) },
    {
      label: 'duplicate',
      states: ['finished'],
      prepare: (session, id) => session.finish({ eventId: id }),
      call: (session, id) => session.finish({ eventId: id, end: T0 - 1 }),
    },
  ],
}

for (const seed of SEEDS) {
  const notes = ['kept', '', '   ', null]
  const indexes = [-1, 0, 1, 2, 5, 1.5]
  const shifts = [15_000, 0, Number.NaN, -1000]
  attempts.commitSet.push({
    label: `seed-${seed}`,
    call: (session, id) => commit(id, { w: 40 + seed, r: 1 + (seed % 8) })(session),
  })
  attempts.editSet.push({
    label: `seed-${seed}`,
    call: (session, id) => session.editSet({
      eventId: id,
      exerciseId: 'bench',
      setId: bench0,
      fields: seed % 3 === 0 ? { w: 60 } : { r: 3 + (seed % 5) },
    }),
  })
  attempts.moveExercise.push({
    label: `seed-${seed}`,
    call: (session, id) => session.moveExercise({
      eventId: id,
      exerciseId: seed % 2 ? 'row' : 'bench',
      toIndex: indexes[seed % indexes.length],
    }),
  })
  attempts.setNote.push({
    label: `seed-${seed}`,
    call: (session, id) => session.setNote({ eventId: id, note: notes[seed % notes.length] }),
  })
  attempts.extendRest.push({
    label: `seed-${seed}`,
    prepare: session => session.startRest({ eventId: `setup-seed-rest-${seed}`, durationMs: 60_000 }),
    call: (session, id) => session.extendRest({ eventId: id, byMs: shifts[seed % shifts.length] }),
  })
}

async function enter(session, state, tag) {
  if (state === 'active') return
  if (state === 'finished') {
    if (session.events.some(event => event.type === 'session.finish')) return
    const result = await session.finish({ eventId: `setup-finish-${tag}` })
    if (!result.ok) throw new Error(`finish ${tag}: ${JSON.stringify(result)}`)
    return
  }
  if (session.discarded) return
  const result = await session.discard()
  if (!result.saved) throw new Error(`discard ${tag}: ${JSON.stringify(result)}`)
}

async function checkAttempt(name, attempt, state) {
  const { session, clock, storage } = await opened()
  const eventId = `${name}-${state}-${attempt.label}`
  if (attempt.prepare) {
    const prepared = await attempt.prepare(session, eventId, clock)
    if (prepared && prepared.saved !== true) {
      throw new Error(`prepare did not save: ${JSON.stringify(prepared)}`)
    }
  }
  await enter(session, state, `${name}-${attempt.label}`)
  const before = await storage.readAll()
  const beforeBytes = JSON.stringify(before)
  const beforeFold = workoutFold(await storage.readBase(), before)
  const result = await attempt.call(session, eventId, clock)
  const after = await storage.readAll()
  const afterBytes = JSON.stringify(after)
  if (result && result.unchanged === true) {
    if (result.ok !== true || result.saved !== false || result.error) {
      return `unchanged result is not benign: ${JSON.stringify(result)}`
    }
    if (afterBytes !== beforeBytes) return 'unchanged but journal changed'
    return 'unchanged'
  }
  if (result && result.saved === true) {
    if (result.ok === false) return 'saved: true and ok: false'
    if (after.length !== before.length + 1) {
      return `saved: true but journal length ${before.length} -> ${after.length}`
    }
    if (JSON.stringify(after.slice(0, before.length)) !== beforeBytes) {
      return 'saved: true but earlier journal entries changed'
    }
    const restored = await openSession({ storage, now: clock.now, timeZone: 'UTC' })
    const afterFold = workoutFold(restored.base, restored.events)
    if (afterFold === beforeFold) {
      if (!STAMP_ONLY[name]) return 'saved: true but the reopened fold matches the fold before it'
      return null
    }
    if (STAMP_ONLY[name]) return `listed as a stamp-only no-op (${STAMP_ONLY[name]}) but the reopened fold changed`
    return null
  }
  if (result && (result.ok === false || result.saved === false)) {
    if (afterBytes !== beforeBytes) {
      const code = result.error?.code ? ` ${result.error.code}` : ''
      return `ok:${result.ok} saved:${result.saved}${code} but journal changed`
    }
    return null
  }
  return `result was neither a save nor a rejection: ${JSON.stringify(result)}`
}

test('a saved journal command changes the reopened fold, and a rejected one leaves the journal untouched', async () => {
  const probe = await opened()
  const names = commandsTakingEventId(probe.session)
  const missing = names.filter(name => !attempts[name])
  const extra = Object.keys(attempts).filter(name => !names.includes(name))
  const unknownNoop = Object.keys(STAMP_ONLY).filter(name => !names.includes(name))
  expect(missing, `commands without an effect case: ${missing.join(', ')}`).toEqual([])
  expect(extra, `effect cases for unknown commands: ${extra.join(', ')}`).toEqual([])
  expect(unknownNoop, `stamp-only list names an unknown command: ${unknownNoop.join(', ')}`).toEqual([])

  const breaks = []
  let sawUnchanged = false
  for (const name of names) {
    for (const attempt of attempts[name]) {
      for (const state of attempt.states || STATES) {
        const where = `${name} ${state} ${attempt.label}`
        try {
          const reason = await checkAttempt(name, attempt, state)
          if (reason === 'unchanged') sawUnchanged = true
          else if (reason) breaks.push(`${where}: ${reason}`)
        } catch (error) {
          breaks.push(`${where}: threw ${error.message}`)
        }
      }
    }
  }
  expect(breaks, breaks.join('\n')).toEqual([])
  expect(sawUnchanged).toBe(true)
})
