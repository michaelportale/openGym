import { expect, test } from 'vitest'
import { progression } from '../shared/training.js'
import { NATIVE_REP_POLICY, nativePrescription, nativeProgressionWhy, nativeRepPolicy } from './native-progression.js'

const id = '0025'
const cfg = { id, sets: 3, reps: 12, repsMin: 8, weight: 40 }

function hist(rows, target = { sets: 3, reps: 12, weight: rows[0][0] }) {
  return {
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: `2026-01-0${i + 1}`,
      entries: [{
        id,
        target,
        sets: row.slice(1).map(r => ({ w: row[0], r, done: true }))
      }]
    }))
  }
}

test('reps with no named policy use double progression and the one-session trigger', () => {
  expect(NATIVE_REP_POLICY).toBe('double')
  expect(nativeRepPolicy(cfg, null)).toBe(NATIVE_REP_POLICY)
  const p = nativePrescription(hist([[40, 12, 12, 12]]), cfg)
  expect(p).toMatchObject({ policy: 'double', kind: 'up', weight: 42.5, reps: 8 })
})

test('the shared engine still treats that same plan as linear', () => {
  const linear = progression.nextPrescription(hist([[40, 12, 12, 12]]), cfg)
  expect(linear.policy).toBe('linear')
  expect(linear.reps).toBeUndefined()
})

test('an explicit policy on the exercise or the routine is kept', () => {
  expect(nativeRepPolicy({ ...cfg, prog: 'linear' }, { prog: 'double' })).toBe('linear')
  expect(nativeRepPolicy(cfg, { prog: 'greyskull' })).toBe('greyskull')
  const p = nativePrescription(hist([[40, 12, 12, 12]]), { ...cfg, prog: 'linear' })
  expect(p.policy).toBe('linear')
  expect(p.reps).toBeUndefined()
})

test('inside the range the weight holds and the aim climbs one rep', () => {
  const p = nativePrescription(hist([[40, 10, 9, 9]]), cfg)
  expect(p).toMatchObject({ policy: 'double', kind: 'hold', weight: 40, reps: 10 })
})

test('a heavy warm-up does not count as reaching the top of the range', () => {
  const S = {
    unit: 'kg',
    workouts: [{
      d: '2026-01-01',
      entries: [{
        id,
        target: { sets: 3, reps: 12, weight: 40 },
        sets: [
          { w: 200, r: 12, done: true, phase: 'warmup' },
          { w: 40, r: 10, done: true },
          { w: 40, r: 9, done: true },
          { w: 40, r: 9, done: true }
        ]
      }]
    }]
  }
  const p = nativePrescription(S, cfg)
  expect(p.kind).not.toBe('up')
  expect(p.weight).toBe(40)
})

test('timed work is not forced onto double progression', () => {
  expect(nativeRepPolicy({ id, mode: 'time', sets: 3, sec: 45 }, null)).not.toBe('double')
})

test('the suggestion can explain itself from the progression rule', () => {
  const why = nativeProgressionWhy()
  expect(why.ruleId).toBe('double-progression')
  expect(why.source).toContain('https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/')
  expect(why.reason.toLowerCase()).toContain('convention')
})
