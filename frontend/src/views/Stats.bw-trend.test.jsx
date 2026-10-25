// @vitest-environment happy-dom
// Body weight on Stats: the chart draws a 7-day average over the faded weigh-ins, and the line
// under it names that average and how far it moved in a week.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import Stats from './Stats.jsx'
import chartSrc from '../components/LineChart.jsx?raw'
import statsSrc from './Stats.jsx?raw'

let host, root
const NOW = new Date('2026-10-23T12:00:00').getTime()
const day = 86400000
const wi = (ago, w) => ({ d: new Date(NOW - ago * day).toISOString().slice(0, 10), t: NOW - ago * day, w })
function mount(bodyweight, extra = {}) {
  const st = JSON.parse(JSON.stringify(DEF))
  Object.assign(st, { workouts: [], bodyweight, unit: 'kg' }, extra)
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

  it('shows two weigh-ins as dots with a nudge to log one more', () => {
    const el = mount([wi(8, 82), wi(1, 80)])
    expect(el.querySelector('.chart polyline.trend')).toBeNull()
    expect(el.querySelector('.chart polyline')).toBeNull()
    expect(el.querySelectorAll('.chart circle.raw').length).toBe(2)
    expect(el.querySelector('.bw-trend-line').textContent).toBe('Log 1 more weigh-in to see your trend')
  })

  it('names the average without a change when nothing is a week back', () => {
    const el = mount([wi(5, 81), wi(3, 81), wi(1, 80)])
    const line = el.querySelector('.bw-trend-line').textContent
    expect(line).toContain('7-day average')
    expect(line).not.toContain('this week')
  })

  it('keeps the change neutral and says "toward goal" in words', () => {
    const el = mount([wi(10, 82), wi(8, 82), wi(3, 81), wi(1, 80)], { targetW: 77 })
    const week = el.querySelector('.bw-trend-week')
    expect(week.getAttribute('style') || '').not.toMatch(/acc|danger|yellow|pr\b/)
    expect(week.textContent).toContain('−1.5 kg this week')
    expect(week.textContent).toContain('toward goal')
    expect(el.querySelector('.chart text').closest('svg').textContent).toContain('Goal 77 kg')
    const tile = [...el.querySelectorAll('.tile')].find(n => n.textContent.includes('Weight 30d'))
    expect(tile.querySelector('.v').getAttribute('style') || '').not.toMatch(/acc|danger/)
  })

  it('leaves Weight 30d empty when the only weigh-ins are years old', () => {
    const el = mount([{ d: '2020-01-10', t: Date.parse('2020-01-10T12:00:00'), w: 80 }, { d: '2020-01-15', t: Date.parse('2020-01-15T12:00:00'), w: 79 }])
    const tile = [...el.querySelectorAll('.tile')].find(n => n.textContent.includes('Weight 30d'))
    expect(tile?.querySelector('.v').textContent ?? '–').toBe('–')
  })

  it('does not say toward goal when the change heads away from it', () => {
    const el = mount([wi(10, 78), wi(8, 78), wi(3, 79), wi(1, 80)], { targetW: 77 })
    expect(el.querySelector('.bw-trend-week').textContent).not.toContain('toward goal')
  })

  it('is one named image to a screen reader, with the last seven weigh-ins as a hidden table', () => {
    const el = mount(Array.from({ length: 9 }, (_, i) => wi(20 - i * 2, 82 - i * 0.2)))
    const img = el.querySelector('.chart [role="img"]')
    expect(img.getAttribute('aria-label')).toMatch(/^Body weight, last 90 days: 7-day average .* kg/)
    const table = el.querySelector('table.vh')
    expect(table.querySelector('caption').textContent).toBe('Last 7 weigh-ins')
    expect(table.querySelectorAll('tbody tr').length).toBe(7)
  })

  it('draws three y labels on a 180 px chart', () => {
    const el = mount([wi(10, 82), wi(8, 82), wi(3, 81), wi(1, 80)])
    const ys = [...el.querySelectorAll('.chart text[text-anchor="end"][font-size="11"]')].filter(n => n.getAttribute('class') === 'lc-text')
    expect(ys.length).toBe(3)
  })

  const weightTile = el => [...el.querySelectorAll('.tile')].find(n => n.textContent.includes('Weight 30d'))
  const oneWorkout = { workouts: [{ id: 'w1', d: wi(2, 0).d, start: NOW - 2 * day, end: NOW - 2 * day + 3600000, entries: [] }] }

  it('says "No weigh-ins yet" on the Weight 30d tile only when there are none', () => {
    const el = mount([], oneWorkout)
    expect(weightTile(el).querySelector('.v').textContent).toBe('No weigh-ins yet')
  })

  it('with exactly one weigh-in the Weight 30d tile asks for a second, not for a first', () => {
    const el = mount([wi(1, 80)], oneWorkout)
    const tile = weightTile(el)
    expect(tile.querySelector('.v').textContent).toBe('Needs two weigh-ins within 30 days')
    expect(tile.textContent).not.toContain('No weigh-ins yet')
    expect(tile.querySelector('button').textContent).toContain('Log weight')
  })

  it('says the same when the other weigh-ins are more than 30 days before the latest', () => {
    const el = mount([wi(60, 82), wi(1, 80)], oneWorkout)
    expect(weightTile(el).querySelector('.v').textContent).toBe('Needs two weigh-ins within 30 days')
  })

  it('keeps the trend inside the chart in a 1M view when the week before it was heavier', () => {
    const el = mount([wi(31, 90), wi(29, 80), wi(28, 80), wi(27, 80)])
    const seg = el.querySelector('polyline.trend').closest('.chart').previousElementSibling
    act(() => { [...seg.querySelectorAll('button')].find(b => b.textContent === '1M').click() })
    const trend = el.querySelector('polyline.trend')
    expect(trend).toBeTruthy()
    const h = Number(trend.closest('svg').getAttribute('viewBox').split(' ')[3])
    const ys = trend.getAttribute('points').trim().split(/\s+/).map(xy => Number(xy.split(',')[1]))
    expect(ys).toHaveLength(3)
    ys.forEach(y => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(h) })
  })

  it('offers Log weight when there are no weigh-ins, and Set goal without a goal', () => {
    const el = mount([])
    expect(el.querySelector('.bw-empty').textContent).toContain('No weigh-ins yet')
    expect(el.querySelector('.bw-empty button').textContent).toContain('Log weight')
    expect(el.querySelector('.chart [role="img"]')).toBeNull()
    expect([...el.querySelectorAll('button')].some(b => b.textContent.includes('Set goal'))).toBe(true)
  })
})

describe('chart sources stay neutral', () => {
  it('LineChart and the Stats body-weight card use no yellow, PR or danger colours', () => {
    const chart = chartSrc
    expect(chart).not.toMatch(/--(yellow|pr|danger)\b/)
    const stats = statsSrc
    const card = stats.slice(stats.indexOf("t('Body weight')"), stats.indexOf("t('All weigh-ins')"))
    expect(card.length).toBeGreaterThan(500)
    expect(card).not.toMatch(/--(yellow|pr|danger)\b|bwDeltaColor/)
  })
})
