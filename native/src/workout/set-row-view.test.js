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
  expect(view('done', { lastText: '–' }).accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, completed')
})
test('uses singular words for one', () => {
  expect(view('done', { weight: 1, reps: 1 }).accessibilityLabel).toBe('Set 2, 1 pound, 1 rep, completed')
})
test('zero weight is a real value, and an unset one is not', () => {
  expect(view('pending', { weight: 0 }).weightText).toBe('0')
  expect(view('pending', { weight: 0 }).accessibilityLabel).toBe('Set 2, 0 pounds, 8 reps, not started')
  expect(view('pending', { weight: null }).weightText).toBe('–')
  expect(view('pending', { weight: null, reps: null }).accessibilityLabel).toBe('Set 2, no weight, no reps, not started')
})
test('an unknown status throws', () => {
  expect(() => view('skipped')).toThrow('skipped')
})
test('inherited object names throw rather than resolving to a bad row', () => {
  expect(() => view('constructor')).toThrow('constructor')
})
test('accepts the screen rows display text', () => {
  expect(view('current', { weight: '75', reps: '8' }).accessibilityLabel).toBe('Set 2, 75 pounds, 8 reps, current set')
  expect(view('pending', { weight: '–', reps: '20 / 18' }).accessibilityLabel).toBe('Set 2, no weight, 20 / 18 reps, not started')
  expect(view('pending', { weight: '–' }).weightText).toBe('–')
})

// A per-side set with one side logged is still not done; its done column says which side is.
test('one side done shows a partial mark and says which side', () => {
  const left = view('current', { weight: '7.5', reps: '20 / 18', sideDone: 'L' })
  expect(left.sideMark).toEqual({ text: 'L ✓', label: 'Left side done' })
  expect(left.accessibilityLabel).toBe('Set 2, 7.5 pounds, 20 / 18 reps, current set, left side done')
  const right = view('pending', { sideDone: 'R' })
  expect(right.sideMark).toEqual({ text: 'R ✓', label: 'Right side done' })
  expect(right.accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, not started, right side done')
})
test('no partial mark otherwise', () => {
  expect(view('current').sideMark).toBeNull()
  expect(view('done', { sideDone: null }).sideMark).toBeNull()
  expect(view('pending', { sideDone: 'X' }).sideMark).toBeNull()
})
