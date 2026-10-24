// @vitest-environment happy-dom
// Home's "Share your week": shown under the streak card once the week has a workout, and opens
// the week's share card.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { weekRecapSheet } from '../sheets.jsx'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(), weekRecapSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const workout = d => ({ id: 'w' + d, d, name: 'Gym', start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }] }] })
const setS = workouts => useStore.setState(s => ({ S: { ...s.S, routines: [], workouts, active: null, weighIn: false, dayPlan: {}, week: {} }, user: null }))
const button = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Share your week'))

describe('Home — Share your week', () => {
  it('is not offered before the week has a workout', () => {
    setS([workout('2020-01-06')]); act(() => root.render(<Home />))
    expect(button()).toBeUndefined()
  })
  it('opens the week card once there is a workout this week', () => {
    setS([workout(todayISO())]); act(() => root.render(<Home />))
    act(() => button().click())
    expect(weekRecapSheet).toHaveBeenCalled()
  })
})
