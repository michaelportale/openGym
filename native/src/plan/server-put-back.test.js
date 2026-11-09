import { describe, expect, test } from 'vitest'
import { keepUnknown } from '../../../api/sync-stamps.js'
import { putBackChanges, serverPutBack } from './server-put-back.js'

const clone = v => JSON.parse(JSON.stringify(v))
// What the API stores for this routine when the phone (a writer that does not stamp) sends `edit`
// over `copy`: the real step 0 of PUT /api/data.
const real = (copy, edit) => {
  const next = { routines: [clone(edit)] }
  keepUnknown({ routines: [clone(copy)] }, next)
  return next.routines[0]
}

const bench = { id: 'bench', sets: 3, reps: 5, mode: 'reps', weight: 60, prog: 'linear', repsMin: 4, pyramid: [{ w: 60, r: 8 }], stationId: 'rack-2', loadConvention: 'total' }
const backoff = { id: 'bench', sets: 3, reps: 10, mode: 'reps', weight: 45 }
const row = { id: 'row', sets: 3, reps: 8, mode: 'reps', weight: 40, note: 'pause', sgName: 'A' }
const squat = { id: 'squat', sets: 5, reps: 5, dbLoad: 'pair', intensifier: 'drop' }
const routine = (ex, extra = {}) => ({ id: 'r1', name: 'Push', ex, _ts: 1000, _f: { ex: 900 }, excludeFromProgression: true, futureRoutineKey: { x: 1 }, ...extra })

const COPIES = {
  'unique ids': routine([bench, row, squat]),
  'twins side by side': routine([bench, backoff, row]),
  'twins apart': routine([bench, row, backoff]),
  'twins told apart only by edit fields': routine([{ id: 'bench', sets: 3, reps: 5 }, { id: 'bench', sets: 4, reps: 10 }]),
  'the same exercise three times': routine([backoff, bench, { ...backoff, sets: 2 }]),
}

const orders = n => (n <= 1 ? [[0]] : orders(n - 1).flatMap(p => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])))
// What a swap leaves on a slot: the new exercise id, the station and load convention gone.
const swapTo = (slot, id) => {
  const { stationId, loadConvention, ...rest } = slot
  return { ...rest, id }
}
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const at = (ex, i, f) => ex.map((s, j) => (j === i ? f(s) : s))

// Every move, every move plus one swap, every pair of swaps, every field edit and removal of a
// slot key, and the routine-level keys, for one copy.
function* edits(copy) {
  const ex = copy.ex
  const ids = [...new Set(ex.map(s => s.id)), 'incline']
  for (const order of orders(ex.length)) {
    const moved = order.map(i => ex[i])
    yield [`move ${order.join('')}`, { ...copy, ex: moved }]
    for (let i = 0; i < moved.length; i++) {
      for (const id of ids) if (id !== moved[i].id) yield [`move ${order.join('')}, swap ${i} to ${id}`, { ...copy, ex: at(moved, i, s => swapTo(s, id)) }]
    }
  }
  for (let i = 0; i < ex.length; i++) {
    for (let j = 0; j < ex.length; j++) {
      if (i === j) continue
      for (const a of ids) for (const b of ids) {
        if (a === ex[i].id || b === ex[j].id) continue
        yield [`swap ${i} to ${a} and ${j} to ${b}`, { ...copy, ex: at(at(ex, i, s => swapTo(s, a)), j, s => swapTo(s, b)) }]
      }
    }
    yield [`sets and reps on ${i}`, { ...copy, ex: at(ex, i, s => ({ ...s, sets: s.sets + 1, reps: 12, sec: 30, min: 2 })) }]
    yield [`prog and repsMin off ${i}`, { ...copy, ex: at(ex, i, s => without(s, 'prog', 'repsMin')) }]
    for (const key of Object.keys(ex[i])) {
      if (key !== 'id') yield [`${key} off ${i}`, { ...copy, ex: at(ex, i, s => without(s, key)) }]
    }
  }
  yield ['routine excludeFromProgression off', without(copy, 'excludeFromProgression')]
  yield ['routine futureRoutineKey off', without(copy, 'futureRoutineKey')]
  yield ['routine renamed, without its stamps', without({ ...copy, name: 'Push A' }, '_ts', '_f')]
  yield ['a slot added', { ...copy, ex: [...ex, { id: 'incline', sets: 3, reps: 8 }] }]
  yield ['a slot taken out', { ...copy, ex: ex.slice(1) }]
}

describe.each(Object.entries(COPIES))('%s', (_name, copy) => {
  test('the native put-back is the API\'s on every generated edit', () => {
    let changed = 0
    let cases = 0
    for (const [what, edit] of edits(copy)) {
      const before = clone(edit)
      const expected = real(copy, edit)
      expect(JSON.stringify(serverPutBack(copy, edit)), what).toBe(JSON.stringify(expected))
      const differs = JSON.stringify(expected) !== JSON.stringify(edit)
      expect(putBackChanges(copy, edit), what).toBe(differs)
      expect(edit, what).toEqual(before)
      cases++
      if (differs) changed++
    }
    expect(cases).toBeGreaterThan(20)
    expect(changed).toBeGreaterThan(0)
    expect(changed).toBeLessThan(cases)
  })
})

test('a cross-swap with no repeated id: the slot that takes the first exercise gets its keys back', () => {
  const copy = routine([bench, row])
  const edit = routine([{ ...swapTo(bench, 'incline'), weight: 0 }, { ...swapTo(row, 'bench') }])
  expect(putBackChanges(copy, edit)).toBe(true)
  expect(serverPutBack(copy, edit).ex[1]).toMatchObject({ id: 'bench', pyramid: bench.pyramid, stationId: 'rack-2', loadConvention: 'total' })
  expect(serverPutBack(copy, edit)).toEqual(real(copy, edit))
})

test('a swap of two twins puts the moved twin\'s keys on the other', () => {
  const copy = routine([bench, backoff])
  expect(putBackChanges(copy, routine([backoff, bench]))).toBe(true)
})

test('what goes as sent: field edits, prog and repsMin off, a move with unique ids, a swap to a new exercise, a routine key v1.3.9 drops', () => {
  const copy = routine([bench, row, squat])
  expect(putBackChanges(copy, routine([{ ...without(bench, 'prog', 'repsMin'), sets: 5 }, row, squat]))).toBe(false)
  expect(putBackChanges(copy, routine([squat, bench, row]))).toBe(false)
  expect(putBackChanges(copy, routine([bench, swapTo(row, 'pullup'), squat]))).toBe(false)
  expect(putBackChanges(copy, without(copy, 'excludeFromProgression'))).toBe(false)
  expect(putBackChanges(copy, without(copy, 'futureRoutineKey'))).toBe(true)
  expect(putBackChanges(copy, routine([without(bench, 'pyramid'), row, squat]))).toBe(true)
})

test('malformed slots and lists are paired as the API pairs them', () => {
  const copy = routine([null, bench, 'x'])
  for (const edit of [routine([bench, null, 'x']), routine([null, without(bench, 'pyramid'), 'x']), routine({ not: 'a list' }), { id: 'r1' }]) {
    expect(serverPutBack(copy, edit)).toEqual(real(copy, edit))
  }
  expect(serverPutBack({ id: 'r1', ex: 'junk' }, routine([bench]))).toEqual(real({ id: 'r1', ex: 'junk' }, routine([bench])))
})
