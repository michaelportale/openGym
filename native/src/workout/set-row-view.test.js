import { expect, test } from 'vitest'
import { setRowView } from './set-row-view.js'

const view = (status, over = {}) => setRowView({ number: 2, weight: 135, reps: 8, status, ...over })

test('each status differs without relying on colour', () => {
  const shapes = ['done', 'current', 'pending'].map(s => `${view(s).marker}/${view(s).fields}`)
  expect(new Set(shapes).size).toBe(3)
})
test('only the current set shows boxed fields', () => {
  expect(view('current').fields).toBe('boxed')
  expect(view('done').fields).toBe('plain')
  expect(view('pending').fields).toBe('plain')
})
test('names the set, load, reps and state for VoiceOver', () => {
  expect(view('current').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, current set')
  expect(view('done').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, completed')
  expect(view('pending').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, not started')
})
test('the label includes last time when there is one', () => {
  expect(view('current', { weight: 75, reps: 8, lastText: '75 × 10' }).accessibilityLabel)
    .toBe('Set 2, 75 pounds, 8 reps, current set, last time 75 by 10')
  expect(view('current', { weight: '75', reps: '8', lastText: '75 × 10', perHand: true }).accessibilityLabel)
    .toBe('Set 2, 75 pounds each, 8 reps, current set, last time 75 by 10')
  expect(view('done', { lastText: '–' }).accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, completed')
})
test('uses singular words for one', () => {
  expect(view('done', { weight: 1, reps: 1 }).accessibilityLabel).toBe('Set 2, 1 pound, 1 rep, completed')
})
test('zero weight is a real value, and an unset one is not', () => {
  expect(view('pending', { weight: 0 }).weightText).toBe('0')
  expect(view('pending', { weight: 0 }).accessibilityLabel).toBe('Set 2, 0 pounds, 8 reps, not started')
  expect(view('pending', { weight: null }).weightText).toBe('–')
  expect(view('pending', { weight: null, reps: null }).accessibilityLabel).toBe('Set 2, weight not set, reps not set, not started')
})
test('an unknown status throws', () => {
  expect(() => view('skipped')).toThrow('skipped')
})
test('inherited object names throw rather than resolving to a bad row', () => {
  expect(() => view('constructor')).toThrow('constructor')
})
test('accepts the screen rows display text', () => {
  expect(view('current', { weight: '75', reps: '8' }).accessibilityLabel).toBe('Set 2, 75 pounds, 8 reps, current set')
  expect(view('pending', { weight: '–', reps: '20 / 18', perSide: true }).accessibilityLabel)
    .toBe('Set 2, weight not set, Left, 20 reps, Right, 18 reps, not started')
  expect(view('pending', { weight: '–' }).weightText).toBe('–')
})

// A per-side set says each side's reps; with one side logged it is still not done, its done
// column marks that side, and the label says which side is done.
test('one side done shows a partial mark and says which side', () => {
  const left = view('current', { weight: '7.5', reps: '20 / 18', sideDone: 'L', perSide: true, perHand: true })
  expect(left.sideMark).toEqual({ text: 'L ✓' })
  expect(left.accessibilityLabel).toBe('Set 2, 7.5 pounds each, Left, 20 reps, done, Right, 18 reps, current set')
  const right = view('current', { reps: '12 / 10', sideDone: 'R', perSide: true })
  expect(right.sideMark).toEqual({ text: 'R ✓' })
  expect(right.accessibilityLabel).toBe('Set 2, 135 pounds, Left, 12 reps, Right, 10 reps, done, current set')
})
test('a per-side set with equal reps still says both sides', () => {
  expect(view('pending', { reps: '20', perSide: true }).accessibilityLabel).toBe('Set 2, 135 pounds, Left, 20 reps, Right, 20 reps, not started')
  expect(view('done', { reps: '20 / 18', sideDone: null, perSide: true }).accessibilityLabel)
    .toBe('Set 2, 135 pounds, Left, 20 reps, Right, 18 reps, completed')
})
test('no partial mark otherwise', () => {
  expect(view('current').sideMark).toBeNull()
  expect(view('done', { sideDone: null }).sideMark).toBeNull()
  expect(view('pending', { sideDone: 'X' }).sideMark).toBeNull()
})

// A warm-up has no set number: it is named, shown as W, says no last time, and is done or open.
const warm = (status, over = {}) => setRowView({ number: null, warmup: true, weight: 45, reps: 10, status, ...over })
test('a warm-up is named, not numbered, and has no last time', () => {
  expect(warm('done').accessibilityLabel).toBe('Warm-up, 45 pounds, 10 reps, done')
  expect(warm('done', { perHand: true }).accessibilityLabel).toBe('Warm-up, 45 pounds each, 10 reps, done')
  expect(warm('current', { weight: null, reps: null, lastText: '–' }).accessibilityLabel).toBe('Warm-up, weight not set, reps not set, open')
  expect(warm('pending', { lastText: '75 × 10' }).accessibilityLabel).toBe('Warm-up, 45 pounds, 10 reps, open')
})
// Only the dock's work set is current: an open warm-up beside it must not look or sound current.
test('an open warm-up never looks or sounds like the current set', () => {
  expect(warm('current').fields).toBe('filled')
  expect(warm('current').fields).not.toBe(view('current').fields)
  expect(warm('current').marker).not.toBe(view('current').marker)
  expect(warm('current').accessibilityLabel).not.toMatch(/current/)
  const shapes = ['done', 'current', 'pending'].map(s => `${warm(s).marker}/${warm(s).fields}`)
  expect(new Set(shapes).size).toBe(3)
})

// The boxed numbers on an open row are buttons of their own, named in words.
test("an open row's boxes say their field and value", () => {
  const row = view('current', { weight: '75', reps: '8', perHand: true })
  expect([row.weightLabel, row.repsLabel]).toEqual(['Weight, 75 pounds each', 'Reps, 8'])
  const blank = warm('current', { weight: '–', reps: '–' })
  expect([blank.weightLabel, blank.repsLabel]).toEqual(['Weight, not set', 'Reps, not set'])
  expect(view('current', { reps: '20 / 18', perSide: true }).repsLabel).toBe('Reps, left 20, right 18')
})
