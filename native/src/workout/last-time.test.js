import { expect, test } from 'vitest'
import { workoutModel } from '../shared/training.js'
import { applyOpeningWeights, lastTime } from './last-time.js'
import { sessionState } from './history-state.js'

const row = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const warm = (w, r) => row(w, r, { phase: 'warmup' })

const p1 = {
  id: 'p1', d: '2026-10-12', routineId: 'push-a', routineIds: ['push-a'],
  entries: [{ id: '0289', sets: [warm(40, 10), warm(65, 6), row(75, 10), row(75, 10), row(75, 5)] }],
}
const u1 = {
  id: 'u1', d: '2026-10-16', routineIds: [],
  entries: [{ id: '0289', sets: [warm(35, 10), warm(55, 6), row(75, 8), row(75, 8), row(75, 7)] }],
}
const state = { workouts: [p1, u1] }

test('same routine wins', () => {
  const t = lastTime(state, '0289', 'push-a')
  expect(t.workoutId).toBe('p1')
  expect(t.top).toBe(75)
  expect(t.sets).toEqual([{ w: 75, r: 10 }, { w: 75, r: 10 }, { w: 75, r: 5 }])
})
test('falls back to any routine', () => {
  const t = lastTime(state, '0289', 'push-b')
  expect(t.d).toBe('2026-10-16')
  expect(t.sets).toEqual([{ w: 75, r: 8 }, { w: 75, r: 8 }, { w: 75, r: 7 }])
})
test('matches a phone workout by routineIds or by entry rid', () => {
  const byIds = { id: 'x', d: '2026-10-20', routineIds: ['pull'], entries: [{ id: '0289', sets: [row(50, 5)] }] }
  const byRid = { id: 'y', d: '2026-10-21', routineIds: [], entries: [{ id: '0289', rid: 'pull', sets: [row(60, 5)] }] }
  expect(lastTime({ workouts: [p1, byIds] }, '0289', 'pull').workoutId).toBe('x')
  expect(lastTime({ workouts: [p1, byIds, byRid] }, '0289', 'pull').workoutId).toBe('y')
})
test('skips a session with no usable set', () => {
  const blank = {
    id: 'p2', d: '2026-10-19', routineId: 'push-a', routineIds: ['push-a'],
    entries: [{ id: '0289', sets: [row(null, 10), row(null, 8)] }],
  }
  expect(lastTime({ workouts: [p1, u1, blank] }, '0289', 'push-a').workoutId).toBe('p1')
})
test('an unusable same-routine session falls back to any routine', () => {
  const blank = { id: 'p2', d: '2026-10-19', routineId: 'push-a', entries: [{ id: '0289', sets: [row(null, 10)] }] }
  expect(lastTime({ workouts: [blank, u1] }, '0289', 'push-a').workoutId).toBe('u1')
})
test('later start breaks a tie on the same date', () => {
  const a = { id: 'a', d: '2026-10-20', start: 1, routineIds: [], entries: [{ id: '0289', sets: [row(10, 5)] }] }
  const b = { id: 'b', d: '2026-10-20', start: 2, routineIds: [], entries: [{ id: '0289', sets: [row(20, 5)] }] }
  expect(lastTime({ workouts: [b, a] }, '0289', 'zz').top).toBe(20)
})
test('phone history beats an older snapshot session', () => {
  const merged = sessionState({ state }, [
    { id: 'n1', d: '2026-11-09', start: 1, routineIds: ['push-a'], entries: [{ id: '0289', rid: 'push-a', sets: [row(80, 8)] }] },
  ])
  expect(lastTime(merged, '0289', 'push-a').top).toBe(80)
})
test('zero-only history opens at 0', () => {
  const z = { id: 'z', d: '2026-10-20', routineIds: [], entries: [{ id: '0289', sets: [row(0, 10)] }] }
  expect(lastTime({ workouts: [z] }, '0289', 'push-a').top).toBe(0)
})
test('no history gives null', () => {
  expect(lastTime({ workouts: [] }, '0289', 'push-a')).toBeNull()
  expect(lastTime({}, '0289', 'push-a')).toBeNull()
  expect(lastTime(state, 'other', 'push-a')).toBeNull()
})
test('undone rows are ignored', () => {
  const w = { id: 'w', d: '2026-10-20', routineIds: [], entries: [{ id: '0289', sets: [row(90, 5, { done: false }), row(70, 5)] }] }
  const t = lastTime({ workouts: [w] }, '0289', 'x')
  expect(t.top).toBe(70)
  expect(t.sets).toEqual([{ w: 70, r: 5 }])
})
test('rows without numeric reps are ignored', () => {
  const w = { id: 'w', d: '2026-10-20', routineIds: [], entries: [{ id: '0289', sets: [row(90, null), row(70, 5)] }] }
  expect(lastTime({ workouts: [w] }, '0289', 'x').top).toBe(70)
})
test('per-side top uses the sides weights', () => {
  const side = (w, r, done = true) => ({ w, r, done })
  const w = {
    id: 's', d: '2026-10-20', routineIds: [],
    entries: [{ id: '0289', sets: [{ sides: { L: side(7.5, 10), R: side(7.5, 10) } }] }],
  }
  const t = lastTime({ workouts: [w] }, '0289', 'x')
  expect(t.top).toBe(7.5)
  expect(t.sets).toEqual([{ sides: { L: { w: 7.5, r: 10 }, R: { w: 7.5, r: 10 } } }])
})
test('a per-side set counts when one side is done, using the done side weight', () => {
  const w = {
    id: 's', d: '2026-10-20', routineIds: [],
    entries: [{ id: '0289', sets: [{ sides: { L: { w: 10, r: 8, done: true }, R: { w: 12, r: 8, done: false } } }] }],
  }
  expect(lastTime({ workouts: [w] }, '0289', 'x').top).toBe(10)
})

test('a newer excluded session is skipped, by either flag', () => {
  const sets = [row(30, 10)]
  const wk = { id: 'x', d: '2026-10-25', routineIds: ['push-a'], excludeFromProgression: true, entries: [{ id: '0289', sets }] }
  const nk = { id: 'y', d: '2026-10-26', routineIds: ['push-a'], entries: [{ id: '0289', noProg: true, sets }] }
  expect(lastTime({ workouts: [p1, wk] }, '0289', 'push-a').workoutId).toBe('p1')
  expect(lastTime({ workouts: [p1, nk] }, '0289', 'push-a').workoutId).toBe('p1')
})
test('top is the max weight, not the first or last', () => {
  const w = { id: 'm', d: '2026-10-20', routineIds: [], entries: [{ id: '0289', sets: [row(60, 5), row(80, 5), row(70, 5)] }] }
  expect(lastTime({ workouts: [w] }, '0289', 'x').top).toBe(80)
})
test('per-side top is the heavier done side', () => {
  const w = {
    id: 's', d: '2026-10-20', routineIds: [],
    entries: [{ id: '0289', sets: [{ sides: { L: { w: 7.5, r: 10, done: true }, R: { w: 10, r: 10, done: true } } }] }],
  }
  expect(lastTime({ workouts: [w] }, '0289', 'x').top).toBe(10)
})
test('a truthy done counts, as in the shared lib', () => {
  const w = { id: 'd', d: '2026-10-20', routineIds: [], entries: [{ id: '0289', sets: [row(55, 5, { done: 1 })] }] }
  expect(lastTime({ workouts: [w] }, '0289', 'x').top).toBe(55)
})

const planned = () => [
  { id: '0289', sets: [{ w: 0, r: 10, phase: 'warmup' }, { w: 0, r: 10 }, { w: 0, r: 8 }] },
  { id: '0999', sets: [{ w: 5, r: 12, sides: { L: { w: 5, r: 12 }, R: { w: 5, r: 12 } } }] },
]
test('applyOpeningWeights sets work rows to top and leaves warm-ups and reps', () => {
  const input = planned()
  const out = applyOpeningWeights(input, state, 'push-a')
  expect(out[0].sets.map(s => s.w)).toEqual([0, 75, 75])
  expect(out[0].sets.map(s => s.r)).toEqual([10, 10, 8])
})
test('applyOpeningWeights opens blank with no history', () => {
  const out = applyOpeningWeights(planned(), state, 'push-a')
  expect(out[1].sets[0].w).toBeNull()
  expect(out[1].sets[0].sides.L.w).toBeNull()
  expect(out[1].sets[0].sides.R.w).toBeNull()
  expect(out[1].sets[0].r).toBe(12)
})
test('applyOpeningWeights sets both sides of a per-side row', () => {
  const h = { id: 'h', d: '2026-10-20', routineIds: [], entries: [{ id: '0999', sets: [row(20, 10)] }] }
  const out = applyOpeningWeights(planned(), { workouts: [h] }, 'push-a')
  expect(out[1].sets[0].sides.L.w).toBe(20)
  expect(out[1].sets[0].sides.R.w).toBe(20)
  expect(out[1].sets[0].sides.L.r).toBe(12)
})
test('applyOpeningWeights does not mutate its input', () => {
  const input = planned()
  const copy = JSON.parse(JSON.stringify(input))
  const out = applyOpeningWeights(input, state, 'push-a')
  expect(input).toEqual(copy)
  expect(out).not.toBe(input)
  expect(out[0]).not.toBe(input[0])
  expect(out[0].sets[1]).not.toBe(input[0].sets[1])
})

// applyOpeningWeights as it was before prescriptions (8c1014124), kept as the oracle for "off".
function openingWeightsBefore(entries, state, routineId) {
  return entries.map(entry => {
    const top = lastTime(state, entry.id, routineId)?.top ?? null
    const sets = (entry.sets ?? []).map(set => {
      if (workoutModel.isWarmupRow(set)) return set
      const next = { ...set, w: top }
      if (workoutModel.isSideSet(set)) {
        next.sides = { L: { ...set.sides.L, w: top }, R: { ...set.sides.R, w: top } }
      }
      return next
    })
    return { ...entry, sets }
  })
}

// Both exercises reached the top of a double-progression range last time: a raise is due.
const topped = {
  unit: 'lb',
  workouts: [{
    id: 't1', d: '2026-11-09', routineIds: ['push-a'],
    entries: [
      { id: '0289', rid: 'push-a', target: { id: '0289', sets: 2, reps: 10, repsMin: 8 }, sets: [warm(40, 10), row(75, 10), row(75, 10)] },
      { id: '0999', rid: 'push-a', target: { id: '0999', sets: 1, reps: 24, repsMin: 16, side: true }, sets: [{ ...row(20, 24), sides: { L: row(20, 12), R: row(20, 12) } }] },
    ],
  }],
}
const pushA = (prog, extra = {}) => ({
  id: 'push-a', ...(prog ? { prog } : {}),
  ex: [{ id: '0289', sets: 2, reps: 10, repsMin: 8 }, { id: '0999', sets: 1, reps: 24, repsMin: 16, side: true }],
  ...extra,
})

const withEach = extra => pushA(null, { ex: pushA().ex.map(c => ({ ...c, ...extra })) })

test('progression off opens exactly as before, weights and reps: deep equal to the old output', () => {
  // Under double the topped state would open at other weights and reps, so the oracle sees both.
  const double = applyOpeningWeights(planned(), topped, 'push-a', pushA())
  const before = openingWeightsBefore(planned(), topped, 'push-a')
  expect(double[0].sets[1].r).not.toBe(before[0].sets[1].r)
  expect(double[1].sets[0].sides.L.r).not.toBe(before[1].sets[0].sides.L.r)
  for (const routine of [pushA('off'), withEach({ prog: 'off' }), pushA(null, { excludeFromProgression: true })]) {
    for (const s of [topped, state, {}]) {
      expect(applyOpeningWeights(planned(), s, 'push-a', routine)).toStrictEqual(openingWeightsBefore(planned(), s, 'push-a'))
    }
  }
})

test('without a routine, or for an exercise it does not hold, last time decides as before', () => {
  expect(applyOpeningWeights(planned(), topped, 'push-a')).toStrictEqual(openingWeightsBefore(planned(), topped, 'push-a'))
  const other = { id: 'push-a', ex: [{ id: 'nope', sets: 1, reps: 5 }] }
  expect(applyOpeningWeights(planned(), topped, 'push-a', other)).toStrictEqual(openingWeightsBefore(planned(), topped, 'push-a'))
})

test('a prescription opens every work set at its weight and reps, per-side rows on both sides, warm-ups untouched', () => {
  const input = planned()
  const out = applyOpeningWeights(input, topped, 'push-a', pushA())
  // '0289' raises 75 → 80 on a 5 lb step and goes back to the bottom of 8–10.
  expect(out[0].sets[0]).toStrictEqual(input[0].sets[0])
  expect(out[0].sets.map(s => [s.w, s.r])).toEqual([[0, 10], [80, 8], [80, 8]])
  // '0999' is per side (16–24 for both sides together, 10 lb step): 20 → 30, back to 16, 8 a side.
  expect(out[1].sets[0]).toMatchObject({ w: 30, r: 16, sides: { L: { w: 30, r: 8 }, R: { w: 30, r: 8 } } })
})

test('a timed exercise keeps last time\'s weight even when its prescription carries one', () => {
  // The plan's hold changed (25 → 30 s) and its weight with it, so the prescription holds at 15.
  const plank = { id: '0289', mode: 'time', sets: 2, sec: 30, weight: 15, prog: 'time' }
  const held = { sec: 25, w: 10, done: true }
  const timedState = {
    unit: 'lb',
    workouts: [{
      id: 'h1', d: '2026-11-09', routineIds: ['push-a'],
      entries: [{ id: '0289', rid: 'push-a', target: { mode: 'time', sets: 2, sec: 25 }, planned: { sets: 2, sec: 25, weight: 10 }, sets: [held, held] }],
    }],
  }
  const timed = { id: 'push-a', ex: [plank, pushA().ex[1]] }
  const out = applyOpeningWeights(planned(), timedState, 'push-a', timed)
  expect(out[0]).toStrictEqual(openingWeightsBefore(planned(), timedState, 'push-a')[0])
})

test('linear, greyskull and triple open exactly as before: no register entry, so last time decides', () => {
  for (const prog of ['linear', 'greyskull', 'triple']) {
    for (const routine of [pushA(prog), withEach({ prog })]) {
      for (const s of [topped, state, {}]) {
        expect(applyOpeningWeights(planned(), s, 'push-a', routine)).toStrictEqual(openingWeightsBefore(planned(), s, 'push-a'))
      }
    }
  }
})

test('a named double policy opens at its prescription like the unnamed default', () => {
  expect(applyOpeningWeights(planned(), topped, 'push-a', pushA('double'))).toStrictEqual(applyOpeningWeights(planned(), topped, 'push-a', pushA()))
})

test('an unnamed pyramid opens exactly as before', () => {
  for (const s of [topped, state, {}]) {
    expect(applyOpeningWeights(planned(), s, 'push-a', withEach({ pyramid: [10, 8] }))).toStrictEqual(openingWeightsBefore(planned(), s, 'push-a'))
  }
})
