import { expect, test } from 'vitest'
import { whyThis } from '../science/rules.js'
import { whyEntry } from './why-entry.js'

const KINDS = {
  rest: 'rest-defaults',
  increments: 'load-increments',
  'warmup-loads': 'warmup-loads',
  'warmup-prompt': 'warmup-prompt',
  progression: 'double-progression',
  effort: 'effort-proximity',
  deload: 'deload-after-misses'
}

test('every kind maps to a register id that whyThis resolves', () => {
  for (const [kind, id] of Object.entries(KINDS)) {
    const entry = whyEntry(kind)
    expect(entry.id).toBe(id)
    expect(entry.title.length).toBeGreaterThan(0)
    expect(whyThis(entry.id).ruleId).toBe(id)
    expect(entry.payload()).toEqual(whyThis(id))
  }
})

test('an unknown kind has no entry', () => {
  expect(whyEntry('nope')).toBeNull()
  expect(whyEntry(undefined)).toBeNull()
  expect(whyEntry('toString')).toBeNull()
})

test('the load-steps sheet is titled like the button that opens it', () => {
  expect(whyEntry('increments').title).toBe('About load steps')
})
