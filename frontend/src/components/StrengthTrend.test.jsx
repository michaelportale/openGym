// @vitest-environment happy-dom
// Stats' lead card: the most-trained lifts of the last 8 weeks with their estimated 1RM and its
// change; a row opens the lift in Exercise progress on the estimated-1RM chart.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import Stats from '../views/Stats.jsx'
import StrengthTrend, { deltaText } from './StrengthTrend.jsx'

const DAY = 86400000
const NOW = new Date('2026-10-23T12:00:00').getTime()
const BENCH = '0025', SQUAT = '0043'
const session = (daysAgo, sets) => {
  const t = NOW - daysAgo * DAY
  return { id: 'w' + daysAgo, d: new Date(t).toISOString().slice(0, 10), start: t, end: t + 3600e3, name: 'Gym', prs: [],
    entries: Object.entries(sets).map(([id, [w, r]]) => ({ id, target: { mode: 'reps', sets: 1, reps: r, weight: w }, sets: [{ w, r, done: true }] })) }
}
let host, root
const render = el => { act(() => root.render(el)); return host }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const st = JSON.parse(JSON.stringify(DEF))
  st.workouts = [
    session(40, { [BENCH]: [60, 5], [SQUAT]: [100, 5] }),
    session(20, { [BENCH]: [62.5, 5], [SQUAT]: [97.5, 5] }),
    session(3, { [BENCH]: [65, 5] }),
  ]
  useStore.setState({ S: st, user: null })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('strength trend card', () => {
  it('lists the most-trained lift first with its estimate and change', () => {
    const el = render(<StrengthTrend S={useStore.getState().S} />)
    const rows = [...el.querySelectorAll('.st-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.st-n').textContent).toMatch(/bench press/i)
    expect(rows[0].classList.contains('up')).toBe(true)
    expect(rows[0].querySelector('.st-d').textContent).toMatch(/^\+\d/)
    expect(rows[1].classList.contains('down')).toBe(true)
    expect(rows[1].querySelector('.st-d').textContent).toMatch(/^−\d/)
    expect(rows[0].getAttribute('role')).toBe('button')
  })

  it('is hidden until a lift has two estimates in the window', () => {
    useStore.getState().S.workouts = [session(3, { [BENCH]: [65, 5] })]
    expect(render(<StrengthTrend S={{ ...useStore.getState().S }} />).querySelector('.strength-trend')).toBeNull()
  })

  it('opens the lift in Exercise progress on the estimated 1RM chart', () => {
    const el = render(<MemoryRouter><Stats /></MemoryRouter>)
    const squat = [...el.querySelectorAll('.st-row')].find(r => /squat/i.test(r.textContent))
    act(() => { squat.click() })
    const progress = el.querySelector('#exercise-progress')
    expect(progress.textContent).toMatch(/squat/i)
    expect(progress.textContent).toContain('Estimated 1RM per workout')
  })

  it('writes the change with its sign, rounded to the half', () => {
    expect(deltaText(2.4, 'kg')).toBe('+2.5 kg')
    expect(deltaText(-5, 'kg')).toBe('−5 kg')
    expect(deltaText(0.1, 'lb')).toBe('±0 lb')
  })
})
