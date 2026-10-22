import { describe, expect, it } from 'vitest'
import * as swaps from './active-exercise-swap.js'
import { swapActiveExercise } from './active-exercise-swap.js'
import { buildCombinedEntries } from './session-merge.js'

const entry = (id, { sg, done = false, target, sets } = {}) => ({
  id,
  ...(sg ? { sg } : {}),
  target: target || { mode: 'reps', sets: 1, reps: 5, weight: 40 },
  sets: sets || [{ w: 40, r: 5, done }]
})

const replacement = () => entry('incline', {
  target: { mode: 'reps', sets: 2, reps: 8, weight: 32.5, note: 'Keep elbows tucked.', intensifier: { type: 'dropset', count: 1, pct: 20 } },
  sets: [{ w: 32.5, r: 8, done: false }, { w: 32.5, r: 8, done: false }]
})

describe('safe active exercise swap', () => {
  it('replaces only the selected duplicate occurrence and preserves its group and replacement metadata', () => {
    const first = entry('bench', { sg: 'pair' })
    const selected = entry('bench', { sg: 'pair' })
    selected.occurrenceId = 'bench#2'
    selected.provenance = { routineIndex: 4 }
    const unrelated = entry('row')
    const active = { cur: 1, entries: [first, selected, unrelated] }
    const next = replacement()

    expect(swapActiveExercise(active, 1, next)).toEqual({ inserted: false, index: 1 })
    expect(active.entries.map(value => value.id)).toEqual(['bench', 'incline', 'row'])
    expect(active.entries[0]).toBe(first)
    expect(active.entries[2]).toBe(unrelated)
    expect(active.entries[1]).toEqual({
      ...next,
      occurrenceId: 'bench#2',
      provenance: { routineIndex: 4 },
      sg: 'pair'
    })
    expect(active.cur).toBe(1)
  })

  it('fails closed before a logged standalone occurrence is explicitly confirmed', () => {
    const logged = entry('bench', { sets: [{ w: 42.5, r: 7, done: true, rir: 1 }] })
    const active = { cur: 0, entries: [logged, entry('row')] }

    expect(swapActiveExercise(active, 0, replacement())).toEqual({ needsConfirmation: true, grouped: false, index: 0 })
    expect(active.entries).toEqual([logged, active.entries[1]])
    expect(active.cur).toBe(0)
  })

  it('preserves a confirmed logged occurrence and inserts the replacement after it', () => {
    const logged = entry('bench', { sets: [{ w: 42.5, r: 7, done: true, rir: 1 }] })
    const unrelated = entry('row')
    const active = { cur: 0, entries: [logged, unrelated] }

    expect(swapActiveExercise(active, 0, replacement(), { loggedConfirmed: true })).toEqual({ inserted: true, index: 1 })
    expect(active.entries[0]).toBe(logged)
    expect(active.entries[0].sets[0]).toEqual({ w: 42.5, r: 7, done: true, rir: 1 })
    expect(active.entries[1].id).toBe('incline')
    expect(active.entries[2]).toBe(unrelated)
    expect(active.cur).toBe(1)
  })

  it('requires an explicit grouped disposition before changing a logged group member', () => {
    const active = { cur: 0, entries: [entry('bench', { sg: 'pair', done: true }), entry('row', { sg: 'pair' }), entry('curl')] }
    const before = [...active.entries]

    expect(swapActiveExercise(active, 0, replacement(), { loggedConfirmed: true }))
      .toEqual({ needsConfirmation: true, grouped: true, index: 0 })
    expect(active.entries).toEqual(before)
  })

  it.each([
    ['keep', ['bench', 'incline', 'row', 'curl'], ['pair', 'pair', 'pair', undefined], 1],
    ['detach', ['bench', 'row', 'incline', 'curl'], ['pair', 'pair', undefined, undefined], 2]
  ])('%s confirmation preserves logged group data and unrelated entries', (groupDisposition, ids, groups, cursor) => {
    const logged = entry('bench', { sg: 'pair', sets: [{ w: 45, r: 6, done: true }] })
    const partner = entry('row', { sg: 'pair' })
    const unrelated = entry('curl')
    const active = { cur: 0, entries: [logged, partner, unrelated] }

    expect(swapActiveExercise(active, 0, replacement(), { loggedConfirmed: true, groupDisposition }))
      .toEqual({ inserted: true, index: cursor })
    expect(active.entries.map(value => value.id)).toEqual(ids)
    expect(active.entries.map(value => value.sg)).toEqual(groups)
    expect(active.entries[0]).toBe(logged)
    expect(active.entries.includes(partner)).toBe(true)
    expect(active.entries.at(-1)).toBe(unrelated)
    expect(active.cur).toBe(cursor)
  })
})

it('requires confirmation for a completed limb and preserves its original station and results', () => {
  const logged = entry('bench', { sets: [{ done: false, sides: { L: { w: 23, r: 7, rir: 1, done: true }, R: { w: 23, r: 7, done: false } } }] })
  logged.equipmentSnapshot = { stationId: 'old', loadConvention: 'machine-setting', unit: null }
  logged.trainingSnapshot = { role: 'horizontal-press', primary: ['chest'], secondary: [], status: 'manual' }
  const active = { entries: [logged], cur: 0 }
  const before = structuredClone(active)
  expect(swapActiveExercise(active, 0, replacement())).toEqual({ needsConfirmation: true, grouped: false, index: 0 })
  expect(active).toEqual(before)
  expect(swapActiveExercise(active, 0, { ...replacement(), equipmentSnapshot: { stationId: 'new' } }, { loggedConfirmed: true })).toEqual({ inserted: true, index: 1 })
  expect(active.entries[0]).toEqual(before.entries[0])
  expect(active.entries[1].equipmentSnapshot.stationId).toBe('new')
})

const futurePreview = (active, routines, cfg) => {
  expect(swaps.previewRoutineSwap).toBeTypeOf('function')
  return swaps.previewRoutineSwap(active, routines, 0, cfg)
}
it('previews only the source routine and changes no plan until explicitly accepted', () => {
  const active = { entries: [{ ...entry('bench'), rid: 'push', routineSourceId: 'bench' }] }
  const routines = [{ id: 'other', name: 'Other', ex: [{ id: 'bench', reps: 5 }] }, { id: 'push', name: 'Push', ex: [{ id: 'bench', reps: 8, sg: 'pair' }] }]
  const before = structuredClone(routines)
  const preview = futurePreview(active, routines, { id: 'incline', reps: 10 })
  expect(routines).toEqual(before)
  expect(preview).toMatchObject({ routineId: 'push', routineName: 'Push', index: 0, before: { id: 'bench', reps: 8, sg: 'pair' }, after: { id: 'incline', reps: 10, sg: 'pair' } })
  expect(swaps.applyRoutineSwap(routines, preview)).toBe(true)
  expect(routines[0]).toEqual(before[0])
  expect(routines[1].ex).toEqual([{ id: 'incline', reps: 10, sg: 'pair' }])
  expect(active.entries[0].id).toBe('bench')
})
it('does not guess ambiguous, missing or changed future-plan slots', () => {
  const active = { entries: [{ ...entry('bench'), rid: 'push', routineSourceId: 'bench' }] }
  const routines = [{ id: 'push', ex: [{ id: 'bench', reps: 8 }] }]
  const preview = futurePreview(active, routines, { id: 'incline', reps: 10 })
  routines[0].ex[0].reps = 12
  expect(swaps.applyRoutineSwap(routines, preview)).toBe(false)
  expect(routines[0].ex[0].reps).toBe(12)
  routines[0].ex.push({ id: 'bench' })
  expect(futurePreview(active, routines, { id: 'incline' })).toBeNull()
  expect(futurePreview({ entries: [entry('bench')] }, routines, { id: 'incline' })).toBeNull()
})

const plannedSession = () => {
  const routines = [{ id: 'push', name: 'Push', ex: ['0047', '0289'].map(id => ({ id, sets: 1, reps: 8, weight: 20, prog: 'off' })) }]
  const state = { routines, workouts: [], exWeights: {}, unit: 'kg' }
  return { routines, active: { routineId: 'push', ...buildCombinedEntries(state, ['push']) } }
}
it('keeps a second session-only swap tied to its original routine slot', () => {
  const { routines, active } = plannedSession()
  swapActiveExercise(active, 0, entry('0289'))
  const preview = swaps.previewRoutineSwap(active, routines, 0, { id: '0308', sets: 1, reps: 10 })
  expect(preview).toMatchObject({ index: 0, before: { id: '0047' } })
  swaps.applyRoutineSwap(routines, preview, active)
  expect(routines[0].ex.map(cfg => cfg.id)).toEqual(['0308', '0289'])
})
it('does not infer a routine source for a session addition with an existing exercise id', () => {
  const { routines, active } = plannedSession()
  active.entries.push({ ...entry('0047'), rid: 'push' })
  expect(swaps.previewRoutineSwap(active, routines, 2, { id: '0308' })).toBeNull()
})
it('retains the source slot on a replacement inserted after completed work', () => {
  const { routines, active } = plannedSession()
  active.entries[0].sets[0].done = true
  const original = structuredClone(active.entries[0])
  swapActiveExercise(active, 0, entry('0289'), { loggedConfirmed: true })
  expect(active.entries[0]).toEqual(original)
  expect(swaps.previewRoutineSwap(active, routines, 1, { id: '0308' }))
    .toMatchObject({ index: 0, before: { id: '0047' } })
})
it('follows an accepted future-plan replacement when that original slot is swapped again', () => {
  const { routines, active } = plannedSession()
  const preview = swaps.previewRoutineSwap(active, routines, 0, { id: '0308', sets: 1, reps: 10 })
  swapActiveExercise(active, 0, entry('0308'))
  expect(swaps.applyRoutineSwap(routines, preview, active)).toBe(true)
  const next = swaps.previewRoutineSwap(active, routines, 0, { id: '0251' })
  expect(next).toMatchObject({ index: 0, before: { id: '0308' } })
  expect(swaps.applyRoutineSwap(routines, next, active)).toBe(true)
  expect(routines[0].ex.map(cfg => cfg.id)).toEqual(['0251', '0289'])
})
it('keeps source-slot ancestry out of completed history', async () => {
  const { buildCompletedWorkout } = await import('./finish-workout.js')
  const { active } = plannedSession()
  active.entries[0].sets[0].done = true
  expect(buildCompletedWorkout(active).entries[0]).not.toHaveProperty('routineSourceId')
})
