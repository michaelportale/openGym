import { describe, it, expect } from 'vitest'
import { exercises } from '../shared/training.js'
import { liftRows, liftsCard, liftsView, strengthRows } from './lifts-view.js'

const NOW = Date.UTC(2026, 10, 9, 12)
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10)
const pool = Object.values(exercises.EXIDX).filter(e => !exercises.isAssisted(e) && !exercises.isCustomEx(e))
const [A, B, C] = pool.filter(e => e.eq === 'barbell')
const name = e => e.n[0].toUpperCase() + e.n.slice(1)
const wk = (n, entries, extra = {}) => ({ id: `w${n}`, d: day(n), start: NOW - n * 86400000, entries, ...extra })
const sets = (w, r = 5) => [{ done: true, w, r }]

describe('liftsView', () => {
  it('is empty for an empty state', () => {
    expect(liftsView({}, { now: NOW })).toEqual({ trend: [], lifts: [] })
    expect(liftsView({ workouts: [] }, { now: NOW })).toEqual({ trend: [], lifts: [] })
  })
  it('sorts two lifts by best, heaviest first', () => {
    const state = { workouts: [wk(3, [{ id: A.id, sets: sets(100) }, { id: B.id, sets: sets(150) }])] }
    const { lifts } = liftsView(state, { now: NOW })
    expect(lifts.map(l => [l.id, l.name, l.value, l.label])).toEqual([
      [B.id, name(B), 150, 'Best: 150 lb'],
      [A.id, name(A), 100, 'Best: 100 lb'],
    ])
  })
  it('breaks ties by name', () => {
    const state = { workouts: [wk(3, [{ id: B.id, sets: sets(100) }, { id: A.id, sets: sets(100) }])] }
    const names = liftsView(state, { now: NOW }).lifts.map(l => l.name)
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)))
  })
  it('labels a reps-only lift with n reps', () => {
    const state = { workouts: [wk(3, [{ id: C.id, sets: [{ done: true, w: 0, r: 12 }] }])] }
    const [lift] = liftsView(state, { now: NOW }).lifts
    expect(lift).toMatchObject({ id: C.id, value: 12, label: '12 reps' })
  })
  it('labels a timed lift in seconds and a cardio one in minutes', () => {
    const timed = { workouts: [wk(3, [{ id: C.id, sets: [{ done: true, sec: 45 }, { done: true, sec: 60 }] }])] }
    expect(liftsView(timed, { now: NOW }).lifts[0]).toMatchObject({ id: C.id, value: 60, label: '60 s' })
    const cardio = { workouts: [wk(3, [{ id: C.id, sets: [{ done: true, min: 20 }] }])] }
    expect(liftsView(cardio, { now: NOW }).lifts[0]).toMatchObject({ id: C.id, value: 20, label: '20 min' })
  })
  it('counts a workout with no id', () => {
    const w = { d: day(3), start: NOW - 3 * 86400000, entries: [{ id: A.id, sets: sets(120) }] }
    const [lift] = liftsView({ workouts: [w] }, { now: NOW }).lifts
    expect(lift.label).toBe('Best: 120 lb')
  })
  it('skips a deleted custom exercise', () => {
    const state = { customEx: [], workouts: [wk(3, [{ id: 'c-gone', sets: sets(50) }, { id: A.id, sets: sets(100) }])] }
    expect(liftsView(state, { now: NOW }).lifts.map(l => l.id)).toEqual([A.id])
  })
  it('names a stored custom exercise', () => {
    const custom = { id: 'c1', n: 'my curl', bp: 'upper arms', tg: 'biceps', eq: 'dumbbell', sm: [], custom: true }
    const state = { customEx: [custom], workouts: [wk(3, [{ id: 'c1', sets: sets(30) }])] }
    expect(liftsView(state, { now: NOW }).lifts[0]).toMatchObject({ id: 'c1', name: 'My curl' })
  })
  it('gives strength trend rows with exact lines', () => {
    const state = { workouts: [
      wk(14, [{ id: A.id, sets: sets(100, 5) }]),
      wk(7, [{ id: A.id, sets: sets(110, 5) }]),
      wk(1, [{ id: A.id, sets: sets(120, 5) }]),
    ] }
    const { trend } = liftsView(state, { now: NOW })
    expect(trend).toHaveLength(1)
    const t = trend[0]
    expect(t).toMatchObject({ id: A.id, name: name(A) })
    expect(t.line).toBe(`e1RM ${Math.round(t.now * 10) / 10} lb (+${Math.round(t.delta * 10) / 10} lb)`)
    expect(t.line).toMatch(/^e1RM 1\d\d(\.\d)? lb \(\+\d+(\.\d)? lb\)$/)
  })
  it('signs a falling estimate with the true minus', () => {
    const state = { workouts: [wk(14, [{ id: A.id, sets: sets(120, 5) }]), wk(1, [{ id: A.id, sets: sets(100, 5) }])] }
    expect(liftsView(state, { now: NOW }).trend[0].line).toMatch(/\(−\d+(\.\d)? lb\)$/)
  })
})

describe('liftRows on an assistance machine', () => {
  it('shows the least help as the best', () => {
    const M = Object.values(exercises.EXIDX).find(e => exercises.isAssisted(e) && !exercises.isCustomEx(e))
    const state = { workouts: [80, 60, 40].map((w, i) => wk(9 - i, [{ id: M.id, sets: sets(w, 8) }])) }
    expect(liftRows(state).map(l => [l.id, l.label])).toEqual([[M.id, 'Best: 40 lb']])
  })
})

describe('liftsCard', () => {
  it('reads as loading until the rows are worked out, when there is history', () => {
    const state = { workouts: [wk(3, [{ id: A.id, sets: sets(100) }])] }
    expect(liftsCard(state, null)).toEqual({ rows: [], loading: true })
    expect(liftsCard({ workouts: [] }, null)).toEqual({ rows: [], loading: false })
    expect(liftsCard(null, null).loading).toBe(false)
    const rows = liftRows(state)
    expect(liftsCard(state, rows)).toEqual({ rows, loading: false })
  })
  it('splits liftsView into its two halves', () => {
    const state = { workouts: [wk(14, [{ id: A.id, sets: sets(100, 5) }]), wk(1, [{ id: A.id, sets: sets(120, 5) }])] }
    expect(liftsView(state, { now: NOW })).toEqual({ trend: strengthRows(state, { now: NOW }), lifts: liftRows(state) })
  })
})
