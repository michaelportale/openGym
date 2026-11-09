import { describe, expect, test } from 'vitest'
import { ownedFor, promptForExercise, warmupPromptFor, warmupPromptText } from './warmup-prompt-view.js'

const slot = (setId, row, extra = {}) => ({ setId, completed: row.done === true, warmup: false, draft: null, row, ...extra })
let n = 0
const todo = (w, r) => slot(`s${++n}`, { w, r, done: false })
const done = (w, r) => slot(`s${++n}`, { w, r, done: true, at: 1000 })
const warm = (setId, row) => slot(setId, { ...row, phase: 'warmup', warmup: true }, { warmup: true })
// 0025 barbell bench (chest), 0289 dumbbell bench (chest), 0300 dumbbell deadlift (upper legs)
const ent = (id, sets, target = {}) => ({ id, target, sets })
const ask = (entries, i, extra = {}) => warmupPromptFor({ entry: entries[i], entryIndex: i, entries, unit: 'lb', equipment: 'dumbbell', ...extra })

describe('warmupPromptFor', () => {
  test('the first exercise of a body part gets the ramp, 80 on a 5 step is 30 and 60', () => {
    const entries = [ent('0289', [todo(80, 8), todo(80, 8)])]
    expect(ask(entries, 0, { step: 5 })).toEqual({
      sets: [{ w: 30, r: 6 }, { w: 60, r: 6 }], whyIds: ['warmup-loads', 'warmup-prompt']
    })
  })
  test('hidden for the second exercise of the same body part, shown for a new part', () => {
    const entries = [ent('0289', [todo(80, 8)]), ent('0025', [todo(135, 5)]), ent('0300', [todo(60, 8)])]
    expect(ask(entries, 1, { equipment: 'barbell' })).toBeNull()
    expect(ask(entries, 2, { step: 5 })).not.toBeNull()
  })
  test('hidden once a warm-up row exists or a work set is done or half done', () => {
    expect(ask([ent('0289', [warm('w', { w: 30, r: 6, done: false }), todo(80, 8)])], 0, { step: 5 })).toBeNull()
    expect(ask([ent('0289', [done(80, 8), todo(80, 8)])], 0, { step: 5 })).toBeNull()
    const half = slot('h', { w: 80, r: 16, done: false, sides: { L: { w: 80, r: 8, done: true }, R: { w: 80, r: 8, done: false } } })
    expect(ask([ent('0289', [half])], 0, { step: 5 })).toBeNull()
  })
  test('the first work set drives it: a draft weight beats the row', () => {
    const entries = [ent('0289', [slot('a', { w: 80, r: 8, done: false }, { draft: { w: 40 } })])]
    expect(ask(entries, 0, { step: 5 }).sets.map(s => s.w)).toEqual([15, 30])
  })
  test('barbell: the bar is the floor; at or under it nothing is offered', () => {
    const bar = ent('0025', [todo(45, 5)])
    expect(ask([bar], 0, { equipment: 'barbell', step: 5 })).toBeNull()
    expect(ask([ent('0025', [todo(60, 5)])], 0, { equipment: 'barbell', step: 5 }).sets.map(s => s.w)).toEqual([45, 45])
    expect(ask([ent('0025', [todo(100, 5)])], 0, { equipment: 'barbell', unit: 'kg', step: 2.5 }).sets.map(s => s.w)).toEqual([40, 80])
  })
  test('no weight shown, or an unknown exercise, offers nothing', () => {
    expect(ask([ent('0289', [todo(null, 8)])], 0, { step: 5 })).toBeNull()
    expect(ask([ent('nope', [todo(80, 8)])], 0, { step: 5 })).toBeNull()
  })
  test('owned dumbbells round down to a bell you have', () => {
    const entries = [ent('0289', [todo(80, 8)])]
    expect(ask(entries, 0, { owned: [10, 25, 35, 65, 80] }).sets.map(s => s.w)).toEqual([25, 35])
  })
})

describe('kg profiles', () => {
  test('the bar floor is 20 kg, not 45', () => {
    const entries = [ent('0025', [todo(60, 5)])]
    expect(ask(entries, 0, { equipment: 'barbell', unit: 'kg', step: 2.5 }).sets.map(s => s.w)).toEqual([22.5, 47.5])
    expect(ask([ent('0025', [todo(20, 5)])], 0, { equipment: 'barbell', unit: 'kg', step: 2.5 })).toBeNull()
  })
  test('without a step the kg grid is used', () => {
    const entries = [ent('0289', [todo(30, 8)])]
    const kg = ask(entries, 0, { unit: 'kg' }).sets.map(s => s.w)
    const lb = ask(entries, 0, { unit: 'lb' }).sets.map(s => s.w)
    expect(kg).toEqual([10, 22.5])
    expect(lb).not.toEqual(kg)
  })
})

describe('promptForExercise reads the profile unit', () => {
  const view = entries => ({ entries })
  test('a kg state gets the 20 kg bar and the kg owned bells', () => {
    const v = view([ent('0025', [todo(60, 5)])])
    expect(promptForExercise(v, '0025', { unit: 'kg' }).sets.map(s => s.w)).toEqual([22.5, 47.5])
    expect(promptForExercise(v, '0025', { unit: 'lb' }).sets.map(s => s.w)).toEqual([45, 45])
    const bells = view([ent('0289', [todo(30, 8)])])
    const state = { unit: 'kg', dumbbells: { kg: { weights: [4, 8, 12, 20, 24, 30] } } }
    expect(promptForExercise(bells, '0289', state).sets.map(s => s.w)).toEqual([12, 24])
  })
  test('no unit means lb; an exercise not in the view has no prompt', () => {
    expect(promptForExercise(view([ent('0025', [todo(60, 5)])]), '0025', {}).sets.map(s => s.w)).toEqual([45, 45])
    expect(promptForExercise(view([]), '0025', {})).toBeNull()
  })
})

describe('warmupPromptText', () => {
  test('lists the loads; per hand says lb each', () => {
    expect(warmupPromptText([{ w: 30, r: 6 }, { w: 60, r: 6 }], false)).toBe('Warm-up: 30 × 6, 60 × 6')
    expect(warmupPromptText([{ w: 30, r: 6 }, { w: 60, r: 6 }], true)).toBe('Warm-up: 30 × 6, 60 × 6 lb each')
  })
})

describe('ownedFor', () => {
  const state = { unit: 'lb', dumbbells: { lb: { weights: [10, 20, 30] } } }
  test('owned bells apply to a dumbbell exercise only', () => {
    expect(ownedFor(state, { id: '0289', target: {} })).toEqual([10, 20, 30])
    expect(ownedFor(state, { id: '0025', target: {} })).toBeUndefined()
    expect(ownedFor({}, { id: '0289', target: {} })).toBeUndefined()
  })
})
