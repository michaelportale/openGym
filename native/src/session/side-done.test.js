import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { openSession } from './session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const SEEDS = [1, 7, 19, 42, 99]
const STEPS = 16
const KINDS = ['add', 'commit', 'edit', 'undo', 'copy', 'move', 'addExercise', 'removeExercise']

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
        sets: [{ id: 'bench-0', w: 60, r: 5, done: false }],
      },
      {
        id: 'row',
        target: { sets: 1, reps: 8 },
        sets: [{
          id: 'row-0',
          w: 20,
          r: 16,
          done: true,
          sides: {
            L: { w: 20, r: 8, done: true },
            R: { w: 18, r: 8, done: false },
          },
        }],
      },
      {
        id: 'curl',
        target: { sets: 1, reps: 10 },
        sets: [{
          id: 'curl-0',
          w: 12,
          r: 10,
          done: false,
          sides: {
            L: { w: 12, r: 5, done: true },
            R: { w: 10, r: 5, done: true },
          },
        }],
      },
    ],
  }
}

const doneSides = {
  w: 20,
  r: 16,
  done: true,
  sides: {
    L: { w: 20, r: 8, done: true },
    R: { w: 18, r: 8, done: true },
  },
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPerSide(row) {
  return !!(row && row.sides && row.sides.L && row.sides.R)
}

function sideFacts(view) {
  const facts = []
  for (const entry of view.entries) {
    for (const set of entry.sets) {
      if (!isPerSide(set.row)) continue
      const left = set.row.sides.L.done === true
      const right = set.row.sides.R.done === true
      facts.push({
        id: `${entry.id}/${set.setId}`,
        done: set.row.done === true,
        left,
        right,
        agreed: (set.row.done === true) === (left && right),
      })
    }
  }
  return facts
}

function slots(view) {
  const out = []
  for (const entry of view.entries) {
    for (const set of entry.sets) out.push({ exerciseId: entry.id, setId: set.setId, row: set.row })
  }
  return out
}

// xorshift32. An LCG's low bits cycle too tightly to pick among eight commands.
function random(seed) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function plan(session, view, kind, next, ids) {
  const exercises = view.entries
  const sets = slots(view)
  if (!exercises.length || !sets.length) return null
  if (kind === 'add') {
    const exerciseId = exercises[next() % exercises.length].id
    const setId = `add-${ids.n}`
    ids.n += 1
    return () => session.addSet({
      eventId: ids.event(kind),
      exerciseId,
      setId,
      fields: { w: 40 + (next() % 20), r: 5 + (next() % 6), done: true },
    })
  }
  if (kind === 'copy') {
    const exerciseId = exercises[next() % exercises.length].id
    const setId = `copy-${ids.n}`
    ids.n += 1
    const perSide = sets.filter(slot => isPerSide(slot.row))
    const source = perSide.length ? perSide[next() % perSide.length].row : doneSides
    return () => session.addSet({
      eventId: ids.event(kind),
      exerciseId,
      setId,
      fields: clone(source),
    })
  }
  if (kind === 'commit' || kind === 'edit' || kind === 'undo') {
    const slot = sets[next() % sets.length]
    if (kind === 'undo') {
      return () => session.undoSet({ eventId: ids.event(kind), exerciseId: slot.exerciseId, setId: slot.setId })
    }
    if (kind === 'commit') {
      const nameSides = isPerSide(slot.row) && next() % 2 === 0
      const fields = nameSides
        ? { sides: { L: { ...slot.row.sides.L, done: next() % 2 === 0 }, R: { ...slot.row.sides.R, done: next() % 2 === 0 } } }
        : { w: 20 + (next() % 30) }
      return () => session.commitSet({
        eventId: ids.event(kind),
        exerciseId: slot.exerciseId,
        setId: slot.setId,
        fields,
      })
    }
    const makeSide = !isPerSide(slot.row) || next() % 2 === 0
    const fields = makeSide
      ? { sides: { L: { w: 20, r: 8, done: next() % 2 === 0 }, R: { w: 18, r: 8, done: next() % 2 === 0 } } }
      : { w: 30 + (next() % 10) }
    return () => session.editSet({
      eventId: ids.event(kind),
      exerciseId: slot.exerciseId,
      setId: slot.setId,
      fields,
    })
  }
  if (kind === 'move') {
    const exerciseId = exercises[next() % exercises.length].id
    const toIndex = next() % (exercises.length + 1)
    return () => session.moveExercise({ eventId: ids.event(kind), exerciseId, toIndex })
  }
  if (kind === 'addExercise') {
    const exerciseId = `extra-${ids.n}`
    ids.n += 1
    const copied = sets.filter(slot => isPerSide(slot.row))
    const source = copied.length ? clone(copied[next() % copied.length].row) : clone(doneSides)
    return () => session.addExercise({
      eventId: ids.event(kind),
      exerciseId,
      entry: {
        id: exerciseId,
        target: { sets: 2, reps: 8 },
        sets: [
          { ...source, id: `${exerciseId}-side` },
          { id: `${exerciseId}-plain`, w: 12, r: 10, done: true },
        ],
      },
    })
  }
  if (kind === 'removeExercise') {
    if (exercises.length < 2) return null
    const exerciseId = exercises[next() % exercises.length].id
    return () => session.removeExercise({ eventId: ids.event(kind), exerciseId })
  }
  return null
}

async function rejectExerciseCopies(session, storage, seed, step) {
  const view = session.view()
  const exerciseId = view.entries[0].id
  const setId = view.entries[0].sets[0].setId
  const before = (await storage.readAll()).map(event => event.id)
  const knownExercise = await session.addExercise({
    eventId: `${seed}-collide-ex-${step}`,
    exerciseId,
    entry: { sets: [{ id: `${seed}-fresh-${step}`, w: 1, r: 1 }] },
  })
  const knownSet = await session.addExercise({
    eventId: `${seed}-collide-set-${step}`,
    exerciseId: `${seed}-fresh-ex-${step}`,
    entry: { sets: [{ id: setId, w: 1, r: 1 }, { id: `${seed}-other-${step}`, w: 2, r: 2 }] },
  })
  const knownPair = await session.addExercise({
    eventId: `${seed}-collide-pair-${step}`,
    exerciseId: `${seed}-pair-ex-${step}`,
    entry: {
      sets: [
        { id: `${seed}-pair-${step}`, w: 1, r: 1 },
        { id: `${seed}-pair-${step}`, w: 2, r: 2 },
      ],
    },
  })
  const where = `seed ${seed} step ${step}`
  expect(knownExercise, `${where} addExercise known-exercise`).toMatchObject({
    ok: false,
    saved: false,
    error: { code: 'known-exercise' },
  })
  expect(knownSet, `${where} addExercise known-set`).toMatchObject({
    ok: false,
    saved: false,
    error: { code: 'known-set' },
  })
  expect(knownPair, `${where} addExercise duplicate set`).toMatchObject({
    ok: false,
    saved: false,
    error: { code: 'known-set' },
  })
  expect((await storage.readAll()).map(event => event.id), where).toEqual(before)
}

async function check(session, storage, seed, step, label) {
  const live = sideFacts(session.view())
  const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
  const replay = sideFacts(restored.view())
  const where = `seed ${seed} step ${step} ${label}`
  expect(live.filter(fact => !fact.agreed), where).toEqual([])
  expect(replay.filter(fact => !fact.agreed), `${where} replay`).toEqual([])
  expect(replay, `${where} replay rows`).toEqual(live)
}

test('per-side row.done follows both ticks on the base and after every seeded command', async () => {
  const covered = new Set()
  for (const seed of SEEDS) {
    const storage = createMemoryStorage()
    const session = await openSession({
      base: baseWorkout(),
      storage,
      now: () => T0 + 60_000,
      timeZone: 'UTC',
    })
    await check(session, storage, seed, 0, 'base')
    const next = random(seed)
    const ids = {
      n: 0,
      event(kind) {
        this.n += 1
        return `${seed}-${kind}-${this.n}`
      },
    }
    for (let step = 1; step <= STEPS; step += 1) {
      const view = session.view()
      const start = next() % KINDS.length
      let ran = null
      for (let offset = 0; offset < KINDS.length; offset += 1) {
        const kind = KINDS[(start + offset) % KINDS.length]
        const command = plan(session, view, kind, next, ids)
        if (!command) continue
        const result = await command()
        // A repeat that would not change the fold is benign. Try the next kind.
        if (result?.unchanged === true) continue
        expect(result, `seed ${seed} step ${step} ${kind}`).toMatchObject({ ok: true, saved: true })
        ran = kind
        break
      }
      expect(ran, `seed ${seed} step ${step} had no command`).not.toBeNull()
      covered.add(ran)
      await rejectExerciseCopies(session, storage, seed, step)
      await check(session, storage, seed, step, ran)
    }
  }
  expect([...covered].sort()).toEqual([...KINDS].sort())
})
