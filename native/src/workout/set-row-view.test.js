import { expect, test } from 'vitest'
import { setRowView } from './set-row-view.js'

const view = (status, over = {}) => setRowView({ number: 2, weight: 135, reps: 8, status, ...over })

test('each status differs without relying on colour', () => {
  const shapes = ['done', 'active', 'pending'].map(s => `${view(s).marker}/${view(s).fields}`)
  expect(new Set(shapes).size).toBe(3)
})
test('only the active set shows boxed fields', () => {
  expect(view('active').fields).toBe('boxed')
  expect(view('done').fields).toBe('plain')
  expect(view('pending').fields).toBe('plain')
})
test('names the set, load, reps and state for VoiceOver', () => {
  expect(view('active').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, current set')
  expect(view('done').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, completed')
  expect(view('pending').accessibilityLabel).toBe('Set 2, 135 pounds, 8 reps, not started')
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
