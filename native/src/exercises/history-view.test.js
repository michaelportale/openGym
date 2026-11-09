import { describe, it, expect } from 'vitest'
import { exercises } from '../shared/training.js'
import { exerciseHistoryView } from './history-view.js'

const NOW = Date.UTC(2026, 10, 9, 12)
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10)
const pool = Object.values(exercises.EXIDX).filter(e => !exercises.isAssisted(e) && !exercises.isCustomEx(e))
const lift = pool.find(e => e.eq === 'barbell')
const wk = (n, entries) => ({ id: `w${n}`, d: day(n), start: NOW - n * 86400000, entries })
const set = (w, r) => ({ done: true, w, r })

describe('exerciseHistoryView', () => {
  it('is null when the exercise has no history', () => {
    expect(exerciseHistoryView({}, lift.id)).toBeNull()
    expect(exerciseHistoryView({ workouts: [wk(1, [{ id: 'other', sets: [set(50, 5)] }])] }, lift.id)).toBeNull()
  })

  it('reads a weighted lift: top points, e1RM toggle, set strings and the PR', () => {
    const state = { workouts: [
      wk(14, [{ id: lift.id, sets: [set(135, 5)] }]),
      wk(7, [{ id: lift.id, sets: [set(185, 5), set(185, 5), set(185, 4)] }]),
      wk(1, [{ id: lift.id, sets: [set(175, 5)] }]),
    ] }
    const v = exerciseHistoryView(state, lift.id)
    expect(v.metric).toBe('top')
    expect(v.canToggle).toBe(true)
    expect(v.chart.points.map(p => p.y)).toEqual([135, 185, 175])
    expect(v.sessions.map(s => s.sets)).toEqual(['175 × 5', '185 × 5, 185 × 5, 185 × 4', '135 × 5'])
    expect(v.sessions.map(s => s.pr)).toEqual([false, true, false])
    expect(v.sessions[0].label).toBe('Nov 8')
    const e = exerciseHistoryView(state, lift.id, { metric: 'e1rm' })
    expect(e.metric).toBe('e1rm')
    expect(e.chart.points).toHaveLength(3)
    expect(e.chart.points[0].y).toBeGreaterThan(135)
  })

  it('cannot toggle a reps-only lift', () => {
    const state = { workouts: [wk(3, [{ id: lift.id, sets: [set(0, 12), set(0, 10)] }])] }
    const v = exerciseHistoryView(state, lift.id, { metric: 'e1rm' })
    expect(v.canToggle).toBe(false)
    expect(v.metric).toBe('top')
    expect(v.sessions[0].sets).toBe('12, 10')
  })

  it('writes timed sets as seconds and cardio as minutes', () => {
    const state = { workouts: [wk(3, [{ id: lift.id, sets: [{ done: true, sec: 45 }, { done: true, sec: 60 }] }])] }
    const v = exerciseHistoryView(state, lift.id)
    expect(v.sessions[0].sets).toBe('45 s, 60 s')
    const cardio = { workouts: [wk(3, [{ id: lift.id, sets: [{ done: true, min: 20 }] }])] }
    expect(exerciseHistoryView(cardio, lift.id).sessions[0].sets).toBe('20 min')
  })
})
