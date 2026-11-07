import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { effort } from '../shared/training.js'
import { effortProgressionNote, effortWhy, validateRir, withEffortNote } from './effort.js'

const FAR = 'This looks far from failure.'

test('a new log accepts a whole number of reps left from 0 to 10, or nothing', () => {
  expect(validateRir(undefined)).toEqual({ ok: true, rir: null })
  expect(validateRir(null)).toEqual({ ok: true, rir: null })
  expect(validateRir('')).toEqual({ ok: true, rir: null })
  expect(validateRir(' 4 ')).toEqual({ ok: true, rir: 4 })
  expect(validateRir(0).rir).toBe(0)
  expect(validateRir(10).rir).toBe(10)
  for (const bad of [2.5, -1, 11, 'lots', NaN, true]) {
    expect(validateRir(bad).ok).toBe(false)
  }
})

test('many reps left on a work set is far from failure and does not change the load', () => {
  expect(effort.HARD_RIR).toBe(3)
  expect(effortProgressionNote({ rir: 4 })).toBe(FAR)
  expect(effortProgressionNote({ rir: 3 })).toBe(null)
  expect(effortProgressionNote({ rpe: 6 })).toBe(FAR)
  expect(effortProgressionNote({ rir: 8, phase: 'warmup', warmup: true })).toBe(null)
  expect(effortProgressionNote({ failure: true })).toBe(null)
  expect(effortProgressionNote({})).toBe(null)

  const prescription = { policy: 'double', kind: 'hold', weight: 40, reps: 10 }
  const out = withEffortNote(prescription, [{ rir: 8 }, { rir: 2, phase: 'warmup', warmup: true }])
  expect(out.weight).toBe(40)
  expect(out.reps).toBe(10)
  expect(out.kind).toBe('hold')
  expect(out.changesLoad).toBe(false)
  expect(out.effortNote).toBe(FAR)
  expect(prescription.effortNote).toBeUndefined()
})

test('the note cites the effort rule and the journal handoff is written down', () => {
  const why = effortWhy()
  expect(why.ruleId).toBe('effort-proximity')
  expect(why.source).toContain('https://x-mol.com/paper/1810175950090465280')
  const decisions = readFileSync(new URL('../../../docs/science/decisions.md', import.meta.url), 'utf8')
  expect(decisions).toContain('validateRir')
  expect(decisions).toContain('effortProgressionNote')
  expect(decisions).toContain('does not change the load')
})
