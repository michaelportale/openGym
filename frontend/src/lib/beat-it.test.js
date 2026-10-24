import { describe, it, expect } from 'vitest'
import { ghostFor, beatTarget, aheadOf } from './beat-it.js'

const step = w => w + 2.5
const last = { sets: [{ w: 40, r: 10, warmup: true }, { w: 80, r: 10 }, { w: 80, r: 9 }] }

describe('ghostFor', () => {
  it('reads the same work set last time, skipping warm-ups', () => {
    expect(ghostFor(last, 0, 'reps')).toEqual({ w: 80, r: 10 })
    expect(ghostFor(last, 1, 'reps')).toEqual({ w: 80, r: 9 })
  })
  it('falls back to the last logged set when today has more sets', () => {
    expect(ghostFor(last, 4, 'reps')).toEqual({ w: 80, r: 9 })
  })
  it('is null without history, or with history in another mode', () => {
    expect(ghostFor(null, 0, 'reps')).toBeNull()
    expect(ghostFor({ sets: [{ sec: 30 }] }, 0, 'reps')).toBeNull()
    expect(ghostFor({ sets: [{ w: 0, r: 8 }] }, 0, 'time')).toBeNull()
    expect(ghostFor({ sets: [{ sec: 30 }] }, 0, 'time')).toEqual({ sec: 30, w: 0 })
  })
})

describe('beatTarget', () => {
  it('adds a rep inside a rep range whose top was not reached', () => {
    expect(beatTarget({ w: 80, r: 9 }, { mode: 'reps', reps: 8, repsMax: 12, step })).toEqual({ w: 80, r: 10 })
  })
  it('adds the weight step at the plan\'s reps once the top is reached', () => {
    expect(beatTarget({ w: 80, r: 12 }, { mode: 'reps', reps: 8, repsMax: 12, step })).toEqual({ w: 82.5, r: 8 })
  })
  it('adds the weight step at last time\'s reps without a plan', () => {
    expect(beatTarget({ w: 80, r: 10 }, { mode: 'reps', step })).toEqual({ w: 82.5, r: 10 })
  })
  it('adds five seconds to a hold', () => {
    expect(beatTarget({ sec: 30, w: 0 }, { mode: 'time', step })).toEqual({ sec: 35 })
  })
  it('adds a rep to a bodyweight set', () => {
    expect(beatTarget({ w: 0, r: 12 }, { mode: 'reps', reps: 10, repsMax: 12, step })).toEqual({ r: 13 })
  })
  it('has nothing to beat without a ghost', () => {
    expect(beatTarget(null, { mode: 'reps', step })).toBeNull()
  })
})

describe('aheadOf', () => {
  it('more reps at the same weight, or more weight, is ahead', () => {
    expect(aheadOf({ w: 80, r: 10 }, { w: 80, r: 11 }, 'reps')).toBe(true)
    expect(aheadOf({ w: 80, r: 10 }, { w: 82.5, r: 8 }, 'reps')).toBe(true)
    expect(aheadOf({ w: 80, r: 10 }, { w: 80, r: 10 }, 'reps')).toBe(false)
    expect(aheadOf({ w: 80, r: 10 }, { w: 75, r: 12 }, 'reps')).toBe(false)
    expect(aheadOf({ sec: 30 }, { sec: 35 }, 'time')).toBe(true)
  })
})
