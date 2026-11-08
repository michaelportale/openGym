import { describe, expect, test } from 'vitest'
import { currentExerciseIndex, workoutScreen } from './workout-view.js'

const set = (setId, row, extra = {}) => ({
  setId, completed: row.done === true, warmup: false, draft: null, row, ...extra,
})
const done = (w, r) => ({ w, r, done: true })
const todo = (w, r) => ({ w, r, done: false })
const sided = (w, l, r) => ({
  w, r: l.r, done: l.done && r.done,
  sides: { L: { w, r: l.r, done: l.done }, R: { w, r: r.r, done: r.done } },
})

const names = { '0289': { name: 'Bench press', category: 'chest' }, '0300': { name: 'Cable lateral raise', category: 'shoulders' } }
const lastTimes = { '0289': { workoutId: 'p1', d: '2026-10-12', top: 75, sets: [{ w: 75, r: 10 }, { w: 75, r: 10 }] }, '0300': null }

const bench = (sets, target = {}) => ({ id: '0289', target, sets })
const view = (entries, extra = {}) => ({
  status: 'active', entries, rest: null, elapsedMs: 252_000, disposition: { kind: 'active', actions: [], suggestedEnd: null },
  ...extra,
})
const screen = (v, opts = {}) => workoutScreen(v, { names, lastTimes, now: 0, ...opts })

const mid = () => view([bench([
  set('plan:0289:0', done(75, 10)),
  set('plan:0289:1', todo(75, 8)),
  set('plan:0289:2', todo(75, 5)),
])])

describe('dock', () => {
  test('ready', () => {
    const { dock } = screen(mid())
    expect(dock).toMatchObject({ mode: 'ready', lead: 'Set 2 · 75 lb × 8', primaryLabel: 'Complete set 2', setId: 'plan:0289:1', side: null })
  })
  test('per-hand load', () => {
    const { dock } = screen(view([bench(mid().entries[0].sets, { dbLoad: 'each' })]))
    expect(dock.lead).toBe('Set 2 · 75 lb each × 8')
  })
  test('a draft overrides the shown numbers', () => {
    const v = mid()
    v.entries[0].sets[1].draft = { w: 80 }
    const s = screen(v)
    expect(s.dock.lead).toBe('Set 2 · 80 lb × 8')
    expect(s.card.rows[1].weightText).toBe('80')
  })
  test('blank weight asks for the weight', () => {
    const { dock } = screen(view([bench([set('plan:0289:0', todo(null, 12))])]))
    expect(dock).toMatchObject({ mode: 'enter-weight', lead: 'Set 1 · – lb × 12', primaryLabel: 'Enter weight' })
  })
  test('resting', () => {
    const { dock } = screen({ ...mid(), rest: { status: 'running', remainingMs: 64_000, deadline: 1 } })
    expect(dock).toMatchObject({ mode: 'resting', lead: '1:04', sub: 'Next: set 2 · 75 lb × 8' })
  })
  test('rounds the countdown up and treats complete as not resting', () => {
    expect(screen({ ...mid(), rest: { status: 'paused', remainingMs: 59_001 } }).dock.lead).toBe('1:00')
    expect(screen({ ...mid(), rest: { status: 'complete', remainingMs: 0 } }).dock.mode).toBe('ready')
  })
  test('exercise done with others left, then all done', () => {
    const two = view([
      bench([set('a', done(75, 10))]),
      { id: '0300', target: {}, sets: [set('b', todo(10, 12))] },
    ])
    expect(screen(two, { exerciseIndex: 0 }).dock).toMatchObject({ mode: 'exercise-done', primaryLabel: 'Next exercise' })
    const all = view([bench([set('a', done(75, 10))])])
    expect(screen(all).dock).toMatchObject({ mode: 'all-done', primaryLabel: 'Finish workout' })
  })
})

describe('per-side sets', () => {
  const lateral = (L, R) => view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: L }, { r: 18, done: R }), { completed: L || R })] }])
  test('left first, then right', () => {
    expect(screen(lateral(false, false)).dock).toMatchObject({ primaryLabel: 'Complete left', side: 'L' })
    expect(screen(lateral(true, false)).dock).toMatchObject({ primaryLabel: 'Complete right', side: 'R' })
  })
  test('one side done is still current, not counted, not advanced', () => {
    const v = view([
      { id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: true }, { r: 18, done: false }), { completed: true })] },
      bench([set('b', todo(75, 8))]),
    ])
    const s = screen(v)
    expect(currentExerciseIndex(v)).toBe(0)
    expect(s.card.rows[0].status).toBe('current')
    expect(s.card.rows[0].perSide).toBe(true)
    expect(s.dock.side).toBe('R')
    expect(s.header.progress).toBe(0)
  })
  test('both sides done counts', () => {
    expect(screen(lateral(true, true)).header.progress).toBe(1)
  })
})

describe('card', () => {
  test('rows, last column and numbering', () => {
    const { card } = screen(view([bench([
      set('w', todo(40, 10), { warmup: true, row: { w: 40, r: 10, done: false, warmup: true } }),
      set('a', done(75, 10)), set('b', todo(75, 8)), set('c', todo(75, 5)),
    ])]))
    expect(card).toMatchObject({ name: 'Bench press', category: 'chest', noHistory: false })
    expect(card.rows.map(r => [r.number, r.status, r.lastText])).toEqual([
      [1, 'done', '75 × 10'], [2, 'current', '75 × 10'], [3, 'pending', '–'],
    ])
    expect(card.rows[1]).toMatchObject({ setId: 'b', weightText: '75', repsText: '8' })
  })
  test('per-side last time and decimal weights', () => {
    const { card } = screen(view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: false }, { r: 18, done: false }))] }]), {
      lastTimes: { '0300': { workoutId: 'x', d: 'd', top: 7.5, sets: [{ sides: { L: { w: 7.5, r: 20 }, R: { w: 7.5, r: 18 } } }] } },
    })
    expect(card.rows[0].lastText).toBe('7.5 × 20 / 7.5 × 18')
    expect(card.rows[0].weightText).toBe('7.5')
  })
  test('no history and unknown exercise', () => {
    const v = view([{ id: '9999', target: {}, sets: [set('a', todo(null, null))] }])
    const { card } = screen(v)
    expect(card).toMatchObject({ name: 'Unknown exercise (9999)', category: '', noHistory: true })
    expect(card.rows[0]).toMatchObject({ weightText: '–', repsText: '–', lastText: '–' })
  })
})

describe('header', () => {
  test('elapsed text', () => {
    expect(screen(mid()).header.elapsedText).toBe('4:12')
    expect(screen({ ...mid(), elapsedMs: 3_720_000 }).header.elapsedText).toBe('1:02:00')
  })
  test('exercise number, count and title', () => {
    const v = view([bench([set('a', done(75, 10))]), { id: '0300', target: {}, sets: [set('b', todo(5, 5))] }])
    expect(screen(v).header).toMatchObject({ exerciseNumber: 2, exerciseCount: 2, title: 'Workout' })
    expect(screen(v, { exerciseIndex: 0, title: 'Push A' }).header).toMatchObject({ exerciseNumber: 1, title: 'Push A' })
  })
  test('progress', () => {
    expect(screen(mid()).header.progress).toBeCloseTo(1 / 3)
    expect(screen(view([])).header.progress).toBe(0)
  })
})

describe('currentExerciseIndex', () => {
  test('first with an incomplete work set, else the last', () => {
    const v = view([bench([set('a', done(1, 1))]), { id: '0300', target: {}, sets: [set('b', todo(1, 1))] }])
    expect(currentExerciseIndex(v)).toBe(1)
    expect(currentExerciseIndex(view([bench([set('a', done(1, 1))]), bench([set('b', done(1, 1))])]))).toBe(1)
    expect(currentExerciseIndex(view([]))).toBe(0)
  })
})
