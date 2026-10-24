// @vitest-environment happy-dom
// Stats before the first workout: one card says what will show up and leads to the Start
// screen; the count tiles wait unless a weigh-in gives the weight tile something to say; the
// activity grid stays, since a tap on a past day is one way to log it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import Stats from './Stats.jsx'

let host, root
const NOW = new Date('2026-10-23T12:00:00').getTime()
function Where() { return <div id="where">{useLocation().pathname}</div> }
function mount(extra = {}) {
  const st = JSON.parse(JSON.stringify(DEF))
  Object.assign(st, { workouts: [], bodyweight: [] }, extra)
  useStore.setState({ S: st, user: null })
  act(() => root.render(<MemoryRouter initialEntries={['/stats']}><Where /><Routes><Route path="/stats" element={<Stats />} /><Route path="*" element={null} /></Routes></MemoryRouter>))
  return host
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('Stats before the first workout', () => {
  it('leads with one card that opens the Start screen', () => {
    const el = mount()
    const card = el.querySelector('.stats-empty')
    expect(card.textContent).toContain('Finish your first workout and your progress curves will show up here.')
    const start = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start workout')
    act(() => { start.click() })
    expect(el.querySelector('#where').textContent).toBe('/workout')
  })

  it('holds back the count tiles and the empty Exercise progress card, and keeps the activity grid', () => {
    const el = mount()
    expect(el.querySelector('.tiles')).toBeNull()
    expect(el.querySelector('#exercise-progress')).toBeNull()
    expect(el.textContent).toContain('Activity (last 12 months)')
    expect(el.textContent).toContain('Body weight')
  })

  it('shows the tiles when a weigh-in gives the weight tile a change to show', () => {
    const day = 86400000
    const el = mount({ bodyweight: [{ d: '2026-10-03', t: NOW - 20 * day, w: 80 }, { d: '2026-10-22', t: NOW - day, w: 79 }] })
    expect(el.querySelector('.tiles').textContent).toContain('-1 kg')
  })

  it('is replaced by the usual Stats once a workout is logged', () => {
    const el = mount({ workouts: [{ id: 'w', d: '2026-10-20', start: NOW - 3 * 86400000, end: NOW - 3 * 86400000 + 3600e3, name: 'Gym', prs: [], entries: [] }] })
    expect(el.querySelector('.stats-empty')).toBeNull()
    expect(el.querySelector('.tiles')).toBeTruthy()
    expect(el.querySelector('#exercise-progress')).toBeTruthy()
  })
})
