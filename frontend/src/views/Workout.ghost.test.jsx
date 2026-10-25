// @vitest-environment happy-dom
// Last time under each work row, and "Beat it" on the next set to do (lib/beat-it.js).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const SQUAT = '0043'
let root, container

// The routine's range is stored as its top and bottom (reps 12, repsMin 8: double progression's
// 8–12); a session's target carries that and the reps it aims at today.
const RANGE = { sets: 2, reps: 12, repsMin: 8 }
function mount({ history = true, sets, id = SQUAT, target = RANGE, planned = RANGE, last = [{ w: 80, r: 10, done: true }, { w: 80, r: 9, done: true }] } = {}) {
  if (root) unmount()
  const S = JSON.parse(JSON.stringify(DEF))
  S.unit = 'kg'
  if (history) S.workouts = [{ id: 'w1', d: '2026-10-20', start: 1, end: 2, entries: [{ id, target: { ...target }, ...(planned ? { planned: { ...planned } } : {}), sets: last }] }]
  S.active = {
    id: 'ghost-test', d: '2026-10-23', start: Date.now(), routineId: null, name: 'Legs', bw: null, cur: 0,
    entries: [{ id, target: { ...target }, ...(planned ? { planned: { ...planned } } : {}), sets: sets || [{ w: 80, r: 8, done: false }, { w: 80, r: 8, done: false }] }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function unmount() { act(() => root.unmount()); container.remove(); root = null }
afterEach(() => { if (root) unmount() })

const ghosts = () => [...container.querySelectorAll('.setghost')]
const row = i => useStore.getState().S.active.entries[0].sets[i]
const beat = () => container.querySelector('.setghost-beat')

describe('last time per row', () => {
  it('shows each work set\'s last time under its row', () => {
    mount()
    expect(ghosts().map(g => g.querySelector('span').textContent)).toEqual(['Last: 80 × 10', 'Last: 80 × 9'])
  })

  it('puts Beat it on the next set only, and it fills the row without logging it', () => {
    mount()
    expect(container.querySelectorAll('.setghost-beat')).toHaveLength(1)
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 80, r: 11, done: false })
  })

  it('offers Undo after Beat it, which puts the values back', () => {
    mount()
    act(() => beat().click())
    expect(beat().textContent).toBe('Undo')
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 80, r: 8 })
  })

  it('says a row is ahead once its values beat last time, and drops the chip', () => {
    mount({ sets: [{ w: 82.5, r: 10, done: false }, { w: 80, r: 8, done: false }] })
    expect(ghosts()[0].textContent).toContain('Ahead of last time')
    expect(beat()).toBeNull()
  })

  it('asks for a baseline the first time', () => {
    mount({ history: false })
    expect(ghosts()).toHaveLength(1)
    expect(ghosts()[0].textContent).toBe('First time — set a baseline')
  })

  it('marks a logged set heavier than the best before as a record, on the row', () => {
    mount({ sets: [{ w: 85, r: 8, done: true }, { w: 80, r: 8, done: false }] })
    const rec = container.querySelector('.set-record')
    expect(rec.textContent).toBe('New PR · +5 kg')
    expect(container.querySelectorAll('.set-record')).toHaveLength(1)
  })
})

// Beat it through the row, with the plan shapes a session really carries (lib/beat-it.js): a
// weighted range climbs its reps to the top, then takes the next weight at the bottom.
describe('Beat it follows double progression', () => {
  it('adds a rep while the last set was below the top of the range', () => {
    mount({ target: { ...RANGE, reps: 10 }, last: [{ w: 80, r: 9, done: true }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 80, r: 10, done: false })
  })

  it('takes the next weight at the bottom of the range once the top was reached', () => {
    mount({ last: [{ w: 80, r: 12, done: true }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 85, r: 8 }) // the squat's own 5 kg step
  })

  it('takes the next weight at the plan\'s reps without a range', () => {
    const plain = { sets: 2, reps: 10 }
    mount({ target: plain, planned: plain, last: [{ w: 80, r: 10, done: true }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 85, r: 10 })
  })

  it('reads the range from the target when the session has no stamped plan', () => {
    mount({ planned: null, last: [{ w: 80, r: 9, done: true }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ w: 80, r: 10 })
  })

  it('still adds one rep to a bodyweight set and five seconds to a hold', () => {
    const bw = { sets: 2, reps: 10, repsMax: 15, bodyweight: true }
    mount({ id: '0662', target: bw, planned: bw, last: [{ w: 0, r: 12, done: true }], sets: [{ w: 0, r: 10, done: false }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ r: 13 })
    const hold = { sets: 1, sec: 30, mode: 'time' }
    mount({ id: '0464', target: hold, planned: hold, last: [{ sec: 30, done: true }], sets: [{ sec: 30, done: false }] })
    act(() => beat().click())
    expect(row(0)).toMatchObject({ sec: 35 })
  })
})
