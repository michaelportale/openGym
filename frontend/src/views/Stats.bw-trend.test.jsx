// @vitest-environment happy-dom
// Body weight on Stats: the chart draws a 7-day average over the faded weigh-ins, and the line
// under it names that average and how far it moved in a week.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import Stats from './Stats.jsx'

let host, root
const NOW = new Date('2026-10-23T12:00:00').getTime()
const day = 86400000
const wi = (ago, w) => ({ d: new Date(NOW - ago * day).toISOString().slice(0, 10), t: NOW - ago * day, w })
function mount(bodyweight) {
  const st = JSON.parse(JSON.stringify(DEF))
  Object.assign(st, { workouts: [], bodyweight, unit: 'kg' })
  useStore.setState({ S: st, user: null })
  act(() => root.render(<MemoryRouter initialEntries={['/stats']}><Routes><Route path="/stats" element={<Stats />} /></Routes></MemoryRouter>))
  return host
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('Stats body-weight trend', () => {
  it('draws the trend over the faded weigh-ins and names its average and weekly change', () => {
    const el = mount([wi(10, 82), wi(8, 82), wi(3, 81), wi(1, 80)])
    expect(el.querySelector('.chart polyline.trend')).toBeTruthy()
    expect(el.querySelectorAll('.chart circle.raw').length).toBe(4)
    const line = el.querySelector('.bw-trend-line').textContent
    expect(line).toContain('7-day average 80.5 kg')
    expect(line).toContain('−1.5 kg this week')
  })

  it('leaves the plain line for two weigh-ins or fewer', () => {
    const el = mount([wi(8, 82), wi(1, 80)])
    expect(el.querySelector('.chart polyline.trend')).toBeNull()
    expect(el.querySelector('.bw-trend-line')).toBeNull()
  })

  it('names the average without a change when nothing is a week back', () => {
    const el = mount([wi(5, 81), wi(3, 81), wi(1, 80)])
    const line = el.querySelector('.bw-trend-line').textContent
    expect(line).toContain('7-day average')
    expect(line).not.toContain('this week')
  })
})
