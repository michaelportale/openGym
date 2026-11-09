import { describe, expect, test } from 'vitest'
import { carriedWeight, currentExerciseIndex, shownValues, workoutScreen } from './workout-view.js'

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
  test('blank reps ask for the reps; a blank weight still wins', () => {
    const { dock } = screen(view([bench([set('plan:0289:0', todo(75, null))])]))
    expect(dock).toMatchObject({ mode: 'enter-reps', lead: 'Set 1 · 75 lb × –', primaryLabel: 'Enter reps', setId: 'plan:0289:0' })
    expect(screen(view([bench([set('plan:0289:0', todo(null, null))])])).dock).toMatchObject({ mode: 'enter-weight', primaryLabel: 'Enter weight' })
  })
  test('a draft that fills the reps makes the set ready', () => {
    const v = view([bench([set('plan:0289:0', todo(75, null), { draft: { r: 8 } })])])
    expect(screen(v).dock).toMatchObject({ mode: 'ready', primaryLabel: 'Complete set 1' })
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
  // The spoken lead is built from these, not by reading the lead text back.
  test('carries the set number, figures and time left that the lead shows', () => {
    expect(screen(mid()).dock).toMatchObject({ number: 2, figures: { w: 75, r: 8 } })
    expect(screen(view([bench([set('a', todo(null, 12))])])).dock).toMatchObject({ number: 1, figures: { w: null, r: 12 } })
    expect(screen({ ...mid(), rest: { status: 'running', remainingMs: 64_000 } }).dock)
      .toMatchObject({ mode: 'resting', remainingMs: 64_000, number: 2, figures: { w: 75, r: 8 } })
    const last = view([bench([set('a', done(75, 10))])], { rest: { status: 'running', remainingMs: 5_000 } })
    expect(screen(last).dock).toMatchObject({ mode: 'resting', remainingMs: 5_000, number: null, figures: null })
    expect(screen(view([bench([set('a', done(75, 10))])])).dock).toMatchObject({ number: null, figures: null })
  })
})

describe('per-side sets', () => {
  const lateral = (L, R) => view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: L }, { r: 18, done: R }), { completed: L || R })] }])
  test('left first, then right', () => {
    expect(screen(lateral(false, false)).dock).toMatchObject({ primaryLabel: 'Complete left', side: 'L', figures: { w: 7.5, r: 20 } })
    expect(screen(lateral(true, false)).dock).toMatchObject({ primaryLabel: 'Complete right', side: 'R', figures: { w: 7.5, r: 18 } })
  })
  test('blank reps on the side being worked ask for the reps', () => {
    const blankRight = view([{ id: '0300', target: {}, sets: [set('s1', {
      w: 7.5, done: false, sides: { L: { w: 7.5, r: 20, done: true }, R: { w: 7.5, r: null, done: false } },
    }, { completed: true })] }])
    expect(screen(blankRight).dock).toMatchObject({ mode: 'enter-reps', primaryLabel: 'Enter reps', side: 'R' })
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
      [null, 'current', '–'], [1, 'done', '75 × 10'], [2, 'current', '75 × 10'], [3, 'pending', '–'],
    ])
    expect(card.rows[2]).toMatchObject({ setId: 'b', weightText: '75', repsText: '8' })
  })
  test('per-side last time and decimal weights', () => {
    const { card } = screen(view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: false }, { r: 18, done: false }))] }]), {
      lastTimes: { '0300': { workoutId: 'x', d: 'd', top: 7.5, sets: [{ sides: { L: { w: 7.5, r: 20 }, R: { w: 7.5, r: 18 } } }] } },
    })
    expect(card.rows[0].lastText).toBe('7.5 × 20/18')
    expect(card.rows[0].weightText).toBe('7.5')
  })
  // The Last cell is one line: one shared weight is written once.
  test('per-side last time is compact; different side weights keep both', () => {
    const lastOf = sides => screen(view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: false }, { r: 18, done: false }))] }]), {
      lastTimes: { '0300': { workoutId: 'x', d: 'd', top: 10, sets: [{ sides }] } },
    }).card.rows[0].lastText
    expect(lastOf({ L: { w: 7.5, r: 12 }, R: { w: 7.5, r: 12 } })).toBe('7.5 × 12/12')
    expect(lastOf({ L: { w: 7.5, r: 20 }, R: { w: 10, r: 18 } })).toBe('7.5 × 20 / 10 × 18')
  })
  test('a per-side row with one side done names that side', () => {
    const rowsOf = (L, R) => screen(view([{ id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: L }, { r: 18, done: R }), { completed: L || R })] }])).card.rows[0]
    expect(rowsOf(true, false).sideDone).toBe('L')
    expect(rowsOf(false, true).sideDone).toBe('R')
    expect(rowsOf(false, false).sideDone).toBeNull()
    expect(rowsOf(true, true).sideDone).toBeNull()
    expect(screen(mid()).card.rows.map(r => r.sideDone)).toEqual([null, null, null])
  })
  // The screen passes these to the table, the keypad and the dock's spoken lead as they are.
  test('a per-hand exercise titles the weight "Lb each" and says so; any other just "Lb"', () => {
    expect(screen(view([bench(mid().entries[0].sets, { dbLoad: 'each' })])).card).toMatchObject({ weightTitle: 'Lb each', perHand: true })
    expect(screen(mid()).card).toMatchObject({ weightTitle: 'Lb', perHand: false })
    expect(screen(view([bench(mid().entries[0].sets, { dbLoad: 'total' })])).card).toMatchObject({ weightTitle: 'Lb', perHand: false })
    expect(screen(view([])).card).toMatchObject({ weightTitle: 'Lb', perHand: false })
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
  // A kill between the two sides reopens on that set, even with an earlier exercise left open.
  test('an exercise whose current set has one side done comes first', () => {
    const half = { id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: true }, { r: 18, done: false }), { completed: true })] }
    expect(currentExerciseIndex(view([bench([set('b', todo(75, 8))]), half]))).toBe(1)
    const rightOnly = { id: '0300', target: {}, sets: [set('s1', sided(7.5, { r: 20, done: false }, { r: 18, done: true }), { completed: true })] }
    expect(currentExerciseIndex(view([bench([set('b', todo(75, 8))]), rightOnly]))).toBe(1)
  })
  test('a half-done set that is not the current one does not count', () => {
    const later = { id: '0300', target: {}, sets: [
      set('s1', sided(7.5, { r: 20, done: false }, { r: 18, done: false })),
      set('s2', sided(7.5, { r: 20, done: true }, { r: 18, done: false }), { completed: true }),
    ] }
    expect(currentExerciseIndex(view([bench([set('b', todo(75, 8))]), later]))).toBe(0)
  })
})

// A changed weight carries to the sets after it, as the web's cascade does: a not-done set with
// no draft weight shows, and Complete logs, the weight of the last done work set before it.
describe('carry forward', () => {
  const three = (first, second, third) => view([bench([set('a', first), set('b', second), set('c', third)])])
  test('a set done at a new weight carries to the sets after it', () => {
    const s = screen(three(done(80, 10), todo(75, 8), todo(75, 5)))
    expect(s.card.rows.map(r => r.weightText)).toEqual(['80', '80', '80'])
    expect(s.dock.lead).toBe('Set 2 · 80 lb × 8')
    expect(screen({ ...three(done(80, 10), todo(75, 8), todo(75, 5)), rest: { status: 'running', remainingMs: 5000 } }).dock.sub).toBe('Next: set 2 · 80 lb × 8')
  })
  test('the latest done set wins', () => {
    expect(screen(three(done(80, 10), done(85, 8), todo(75, 5))).card.rows.map(r => r.weightText)).toEqual(['80', '85', '85'])
  })
  test('a set with its own draft weight keeps it; the reps still come from the set', () => {
    const v = three(done(80, 10), todo(75, 8), todo(75, 5))
    v.entries[0].sets[1].draft = { w: 77.5 }
    const s = screen(v)
    expect(s.card.rows.map(r => r.weightText)).toEqual(['80', '77.5', '80'])
    expect(s.dock.lead).toBe('Set 2 · 77.5 lb × 8')
  })
  test('a blank planned weight takes the weight just lifted', () => {
    const s = screen(three(done(100, 8), todo(null, 8), todo(null, 8)))
    expect(s.dock).toMatchObject({ mode: 'ready', lead: 'Set 2 · 100 lb × 8' })
  })
  test('no done set: the planned weight, or blank', () => {
    expect(screen(three(todo(75, 10), todo(75, 8), todo(75, 5))).card.rows.map(r => r.weightText)).toEqual(['75', '75', '75'])
    expect(screen(three(todo(null, 10), todo(null, 8), todo(null, 5))).dock.mode).toBe('enter-weight')
  })
  test('only sets before it carry: an undone set keeps its own weight', () => {
    expect(screen(three(todo(80, 10), done(85, 8), todo(75, 5))).card.rows.map(r => r.weightText)).toEqual(['80', '85', '85'])
  })
  test('per side: the done set\'s shared weight carries', () => {
    const v = view([{ id: '0300', target: {}, sets: [
      set('s1', sided(10, { r: 12, done: true }, { r: 12, done: true })),
      set('s2', sided(7.5, { r: 12, done: false }, { r: 12, done: false })),
    ] }])
    const s = screen(v)
    expect(s.card.rows.map(r => r.weightText)).toEqual(['10', '10'])
    expect(s.dock).toMatchObject({ lead: 'Set 2 · 10 lb × 12', side: 'L' })
  })
  test('per side: a set with one side logged keeps its logged weight', () => {
    const v = view([{ id: '0300', target: {}, sets: [
      set('s1', sided(10, { r: 12, done: true }, { r: 12, done: true })),
      set('s2', sided(12.5, { r: 12, done: true }, { r: 12, done: false }), { completed: true }),
    ] }])
    expect(screen(v).dock.lead).toBe('Set 2 · 12.5 lb × 12')
    expect(carriedWeight(v.entries[0], 's2')).toBeUndefined()
  })
  test('carriedWeight: undefined for a done set, the first set, or an unknown one', () => {
    const entry = three(done(80, 10), todo(75, 8), todo(75, 5)).entries[0]
    expect(carriedWeight(entry, 'b')).toBe(80)
    expect(carriedWeight(entry, 'a')).toBeUndefined()
    expect(carriedWeight(entry, 'nope')).toBeUndefined()
    expect(carriedWeight(null, 'b')).toBeUndefined()
  })
  test('a done set shows what was logged, never a carried weight', () => {
    expect(screen(three(done(80, 10), done(75, 8), todo(75, 5))).card.rows[1].weightText).toBe('75')
  })
  test('warm-ups neither carry nor take a carry', () => {
    const v = view([bench([
      set('w', { w: 40, r: 10, done: true, warmup: true }, { warmup: true }),
      set('a', todo(75, 8)),
    ])])
    expect(screen(v).card.rows.map(r => [r.label, r.weightText])).toEqual([['W', '40'], ['1', '75']])
  })
})

// A warm-up is logged as the engine writes it (addWarmupCall): its own row, phase 'warmup'. It is
// shown first, labelled W, and never counts: not in set numbers, the dock's set, progress, the
// exercise the screen follows, or the weight the work sets carry.
describe('warm-ups', () => {
  const warm = (setId, row) => set(setId, { ...row, phase: 'warmup', warmup: true }, { warmup: true })
  test('show first, labelled W, even when added after the work sets', () => {
    const { card } = screen(view([bench([
      set('a', done(75, 10)), set('b', todo(75, 8)),
      warm('w1', done(45, 10)), warm('w2', todo(null, null)),
    ])]))
    expect(card.rows.map(r => [r.setId, r.label, r.number, r.status, r.warmup])).toEqual([
      ['w1', 'W', null, 'done', true],
      ['w2', 'W', null, 'current', true],
      ['a', '1', 1, 'done', false],
      ['b', '2', 2, 'current', false],
    ])
  })
  test('a later open warm-up waits for the one before it', () => {
    const { card } = screen(view([bench([warm('w1', todo(45, 10)), warm('w2', todo(65, 5)), set('a', todo(75, 8))])]))
    expect(card.rows.map(r => r.status)).toEqual(['current', 'pending', 'current'])
  })
  test('a warm-up shows its own numbers and no last time; the work sets keep theirs', () => {
    const { card } = screen(view([bench([set('a', todo(75, 10)), warm('w', done(45, 10))])]))
    expect(card.rows[0]).toMatchObject({ setId: 'w', weightText: '45', repsText: '10', lastText: '–', perSide: false, sideDone: null })
    expect(card.rows[1]).toMatchObject({ setId: 'a', lastText: '75 × 10' })
  })
  test("the dock's Set 1 ignores a done warm-up, and an open one is never the dock's set", () => {
    expect(screen(view([bench([warm('w', done(45, 10)), set('a', todo(75, 8))])])).dock)
      .toMatchObject({ mode: 'ready', lead: 'Set 1 · 75 lb × 8', primaryLabel: 'Complete set 1', setId: 'a' })
    expect(screen(view([bench([warm('w', todo(45, 10)), set('a', todo(75, 8))])])).dock)
      .toMatchObject({ lead: 'Set 1 · 75 lb × 8', setId: 'a' })
  })
  test('an open warm-up leaves a finished exercise finished', () => {
    const v = view([bench([set('a', done(75, 8)), warm('w', todo(45, 10))])])
    expect(screen(v).dock).toMatchObject({ mode: 'all-done', setId: null })
  })
  // Counted, the warm-ups here would make progress 3 of 5 (0.6) and keep the screen on the bench.
  test('progress and the exercise the screen follows ignore warm-ups', () => {
    const v = view([
      bench([set('a', done(75, 8)), warm('w', todo(45, 10))]),
      { id: '0300', target: {}, sets: [warm('w2', done(5, 10)), warm('w3', done(7.5, 8)), set('b', todo(10, 12))] },
    ])
    expect(currentExerciseIndex(v)).toBe(1)
    expect(screen(v).header.progress).toBe(0.5)
  })
  test('a warm-up takes no carried weight, even after a done work set', () => {
    const v = view([bench([set('a', done(80, 10)), warm('w', todo(null, 10)), set('b', todo(75, 8))])])
    expect(carriedWeight(v.entries[0], 'w')).toBeUndefined()
    expect(screen(v).card.rows.map(r => r.weightText)).toEqual(['–', '80', '80'])
  })
  test('a done warm-up is never the weight the work sets carry', () => {
    const v = view([bench([set('a', done(80, 10)), warm('w', done(40, 10)), set('b', todo(75, 8))])])
    expect(carriedWeight(v.entries[0], 'b')).toBe(80)
  })
  // The row decides, as volume and "Last time" read it: an explicit phase beats the old flag.
  test("a row marked phase 'work' counts as work even with the old warmup flag", () => {
    const legacy = set('x', { ...done(60, 5), phase: 'work', warmup: true }, { warmup: true })
    const { card } = screen(view([bench([legacy, set('a', todo(75, 8))])]))
    expect(card.rows.map(r => [r.setId, r.label])).toEqual([['x', '1'], ['a', '2']])
  })
})

// A done set never takes a draft (draftCall refuses one, and Complete clears it), so a draft on
// one is what a failed clear left behind. The set shows, and the keypad opens on, what was logged.
describe('a draft left on a done set', () => {
  test('a done set shows what was logged, not the leftover draft', () => {
    const v = view([bench([set('a', done(80, 6), { draft: { w: 82.5, r: 5 } }), set('b', todo(75, 8))])])
    expect(screen(v).card.rows[0]).toMatchObject({ weightText: '80', repsText: '6', status: 'done' })
    expect(shownValues(v.entries[0].sets[0], null)).toEqual({ w: 80, r: 6 })
  })
  test('the set after it carries the logged weight, not the draft\'s', () => {
    const v = view([bench([set('a', done(80, 6), { draft: { w: 82.5, r: 5 } }), set('b', todo(75, 8))])])
    expect(screen(v).dock.lead).toBe('Set 2 · 80 lb × 8')
  })
  test('per side, both sides done: the row\'s numbers', () => {
    const slot = set('s', sided(10, { r: 12, done: true }, { r: 11, done: true }), { draft: { w: 7.5, sides: { L: { r: 9 }, R: { r: 8 } } } })
    expect(shownValues(slot, null)).toEqual({ w: 10, sides: { L: { r: 12 }, R: { r: 11 } } })
    expect(shownValues(slot, 'R')).toEqual({ w: 10, sides: { L: { r: 12 }, R: { r: 11 } } })
    expect(screen(view([{ id: '0300', target: {}, sets: [slot] }])).card.rows[0]).toMatchObject({ weightText: '10', repsText: '12 / 11' })
  })
  test('per side, one side done: that side\'s reps from the row; the side being worked keeps its draft', () => {
    const slot = set('s', sided(10, { r: 12, done: true }, { r: 11, done: false }), { completed: true, draft: { w: 10, sides: { L: { r: 9 }, R: { r: 14 } } } })
    expect(shownValues(slot, 'R')).toEqual({ w: 10, sides: { L: { r: 12 }, R: { r: 14 } } })
    const right = set('s', sided(10, { r: 12, done: false }, { r: 11, done: true }), { completed: true, draft: { r: 9 } })
    expect(shownValues(right, 'L')).toEqual({ w: 10, sides: { L: { r: 9 }, R: { r: 11 } } })
  })
  // The weight is shared by both sides: a leftover draft's would overwrite the done side's logged
  // weight through the second side's Complete. Only a weight typed in the sheet now changes it.
  test('per side, one side done: the weight is the one that side was logged at, not the draft\'s', () => {
    const slot = set('s', sided(7.5, { r: 10, done: true }, { r: 10, done: false }), { completed: true, draft: { w: 10, sides: { L: { r: 10 }, R: { r: 9 } } } })
    expect(shownValues(slot, 'R')).toEqual({ w: 7.5, sides: { L: { r: 10 }, R: { r: 9 } } })
    const right = set('s', { w: 7.5, done: false, sides: { L: { w: 7.5, r: 10, done: false }, R: { w: 7.5, r: 8, done: true } } }, { completed: true, draft: { w: 12.5 } })
    expect(shownValues(right, 'L').w).toBe(7.5)
    const s = screen(view([{ id: '0300', target: {}, sets: [slot] }]))
    expect(s.dock).toMatchObject({ side: 'R', figures: { w: 7.5, r: 9 }, lead: 'Set 1 · 7.5 lb × 9' })
    expect(s.card.rows[0].weightText).toBe('7.5')
  })
  test('a set not done keeps its draft', () => {
    expect(shownValues(set('a', todo(75, 8), { draft: { w: 80, r: 5 } }), null)).toEqual({ w: 80, r: 5 })
  })
})
