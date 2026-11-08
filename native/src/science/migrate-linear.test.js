import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { nativePrescription, nativeRepPolicy } from './native-progression.js'
import { migrateLinearRoutines } from './migrate-linear.js'

const id = '0025'
const cfg = { id, sets: 3, reps: 12, repsMin: 8, weight: 40 }

function hist() {
  return {
    unit: 'kg',
    workouts: [{
      d: '2026-01-01',
      entries: [{
        id,
        target: { sets: 3, reps: 12, weight: 40 },
        sets: [12, 12, 12].map(r => ({ w: 40, r, done: true }))
      }]
    }]
  }
}

test('a stored linear routine stays linear until the helper is called', () => {
  const routine = { id: 'push', prog: 'linear', exercises: [{ id, prog: 'linear' }] }
  expect(nativeRepPolicy(cfg, routine)).toBe('linear')
  expect(nativePrescription(hist(), cfg, routine).policy).toBe('linear')

  const [next] = migrateLinearRoutines([routine])
  expect(routine.prog).toBe('linear')
  expect(routine.exercises[0].prog).toBe('linear')
  expect(next).not.toBe(routine)
  expect(next.prog).toBe('double')
  expect(next.exercises[0]).toBe(routine.exercises[0])
  expect(nativeRepPolicy(cfg, next)).toBe('double')
  expect(nativePrescription(hist(), cfg, next).policy).toBe('double')
  expect(nativeRepPolicy({ ...cfg, prog: 'linear' }, next)).toBe('linear')
})

test('a second call leaves an already migrated routine as the same object', () => {
  const routine = { id: 'push', prog: 'linear', exercises: [{ id, prog: 'linear' }] }
  const doubled = { prog: 'double', name: 'Pull' }
  const once = migrateLinearRoutines([routine, doubled])
  const twice = migrateLinearRoutines(once)
  expect(once[0].prog).toBe('double')
  expect(once[0].exercises[0].prog).toBe('linear')
  expect(twice[0]).toBe(once[0])
  expect(twice[1]).toBe(doubled)
  expect(migrateLinearRoutines(twice)[0]).toBe(twice[0])
  expect(twice[0].exercises[0].prog).toBe('linear')
})

test('other policies and unnamed routines are copied through unchanged', () => {
  const greyskull = { prog: 'greyskull' }
  const unnamed = { name: 'Push' }
  const [a, b, c] = migrateLinearRoutines([greyskull, unnamed, null])
  expect(a).toBe(greyskull)
  expect(b).toBe(unnamed)
  expect(c).toBe(null)
  expect(migrateLinearRoutines(null)).toEqual([])
})

test('the helper does not run from prescription and the choice is written down', () => {
  const src = readFileSync(new URL('./native-progression.js', import.meta.url), 'utf8')
  expect(src).not.toContain('migrateLinear')
  const decisions = readFileSync(new URL('../../../docs/science/decisions.md', import.meta.url), 'utf8')
  expect(decisions).toContain('migrateLinearRoutines')
  expect(decisions).toContain('does not run on its own')
})
