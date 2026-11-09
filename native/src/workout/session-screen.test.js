import { describe, expect, test } from 'vitest'
import { finishSummary, lastTimesFor, liveView, shownAfterComplete, withTargets } from './session-screen.js'

const slot = (setId, row, extra = {}) => ({ setId, completed: row.done === true, warmup: false, draft: null, row, ...extra })
const todo = (w, r) => ({ w, r, done: false })
const done = (w, r) => ({ w, r, done: true, at: 1 })
const sided = (w, L, R) => ({
  w, r: L.r + R.r, done: L.done && R.done,
  sides: { L: { w, r: L.r, done: L.done }, R: { w, r: R.r, done: R.done } },
})
const active = { kind: 'active', actions: [], suggestedEnd: null }
const view = (entries, extra = {}) => ({ status: 'active', disposition: active, rest: null, elapsedMs: 60_000, entries, ...extra })

describe('withTargets', () => {
  test('each view entry takes the target of the base entry with the same id', () => {
    const base = { entries: [{ id: 'a', target: { restSec: 120, dbLoad: 'each' } }, { id: 'b', target: { reps: 8 } }] }
    const v = view([{ id: 'b', sets: [] }, { id: 'a', sets: [] }, { id: 'added', sets: [] }])
    const out = withTargets(v, base)
    expect(out.entries.map(e => e.target)).toEqual([{ reps: 8 }, { restSec: 120, dbLoad: 'each' }, undefined])
    expect(v.entries[0].target).toBeUndefined()
  })
  test('no view stays no view', () => {
    expect(withTargets(null, { entries: [] })).toBeNull()
  })
})

describe('lastTimesFor', () => {
  test('one lookup per base entry, against the session routine', () => {
    const state = {
      workouts: [
        { id: 'p1', d: '2026-10-12', routineIds: ['push-a'], entries: [{ id: 'bench', sets: [done(75, 10)] }] },
        { id: 'u1', d: '2026-10-16', routineIds: ['other'], entries: [{ id: 'bench', sets: [done(80, 8)] }] },
      ],
    }
    const base = { routineIds: ['push-a'], entries: [{ id: 'bench' }, { id: 'curl' }] }
    const out = lastTimesFor(state, base)
    expect(out.bench).toMatchObject({ workoutId: 'p1', top: 75 })
    expect(out.curl).toBeNull()
  })
})

describe('liveView', () => {
  test('the rest counts down from its deadline and ends at zero', () => {
    const v = view([], { rest: { status: 'running', deadline: 100_000, remainingMs: 90_000, totalMs: 90_000 } })
    expect(liveView(v, 10_000, 40_000).rest).toMatchObject({ status: 'running', remainingMs: 60_000 })
    expect(liveView(v, 10_000, 100_000).rest).toMatchObject({ status: 'complete', remainingMs: 0 })
  })
  test('elapsed runs on from the engine read', () => {
    expect(liveView(view([]), 10_000, 25_000).elapsedMs).toBe(75_000)
  })
  test('elapsed does not run backwards, past the duration gap, overnight, or once finished', () => {
    expect(liveView(view([]), 10_000, 5_000).elapsedMs).toBe(60_000)
    expect(liveView(view([]), 0, 5 * 60 * 60 * 1000).elapsedMs).toBe(60_000)
    expect(liveView(view([], { disposition: { kind: 'overnight' } }), 0, 5000).elapsedMs).toBe(60_000)
    expect(liveView(view([], { status: 'finished' }), 0, 5000).elapsedMs).toBe(60_000)
  })
  test('a paused rest and no view are left as they are', () => {
    const paused = { status: 'paused', deadline: 1, remainingMs: 30_000, totalMs: 90_000 }
    expect(liveView(view([], { rest: paused }), 0, 50_000).rest).toBe(paused)
    expect(liveView(null, 0, 1)).toBeNull()
  })
})

describe('shownAfterComplete', () => {
  const v = view([
    { id: 'a', sets: [slot('a0', done(75, 10))] },
    { id: 'b', sets: [slot('b0', done(50, 10)), slot('b1', todo(50, 10))] },
    { id: 'c', sets: [slot('c0', done(20, 10))] },
  ])
  test('following the current exercise keeps following', () => {
    expect(shownAfterComplete(v, null)).toBeNull()
  })
  test('an exercise picked by hand stays while it has a set left', () => {
    expect(shownAfterComplete(v, 1)).toBe(1)
  })
  test('after its last set the screen follows the current exercise again', () => {
    expect(shownAfterComplete(v, 0)).toBeNull()
    expect(shownAfterComplete(v, 2)).toBeNull()
  })
  test('a per-side set with one side done is still a set left', () => {
    const half = view([{ id: 'l', sets: [slot('s', sided(7.5, { r: 10, done: true }, { r: 10, done: false }), { completed: true })] }])
    expect(shownAfterComplete(half, 0)).toBe(0)
  })
})

describe('finishSummary', () => {
  test('done sets, volume in pounds and the duration', () => {
    const v = view([
      { id: 'bench', target: {}, sets: [slot('b0', done(75, 10)), slot('b1', done(75, 8)), slot('b2', todo(75, 8))] },
      { id: 'lat', target: {}, sets: [slot('s', sided(10, { r: 10, done: true }, { r: 9, done: true }))] },
    ], { elapsedMs: 48 * 60_000 + 12_000 })
    expect(finishSummary(v)).toEqual({ setsText: '3 sets', volumeText: '1,540 lb', durationText: '48:12' })
  })
  test('a per-side set with one side done is not a done set, and one set is singular', () => {
    const v = view([
      { id: 'bench', target: {}, sets: [slot('b0', done(100, 5))] },
      { id: 'lat', target: {}, sets: [slot('s', sided(10, { r: 10, done: true }, { r: 10, done: false }), { completed: true })] },
    ])
    expect(finishSummary(v).setsText).toBe('1 set')
  })
  test('an empty workout still has a summary', () => {
    expect(finishSummary(view([], { elapsedMs: 0 }))).toEqual({ setsText: '0 sets', volumeText: '0 lb', durationText: '0:00' })
  })
})
