// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'
import { fmtDate, isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const point = (year, month, day, y) => ({
  d: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  t: new Date(year, month - 1, day, 12).getTime(),
  y
})

const firstPoints = [
  { t: Date.UTC(2026, 0, 1), y: 80, d: '2026-01-01' },
  { t: Date.UTC(2026, 0, 15), y: 82, d: '2026-01-15' },
]
const nextPoints = [
  { t: Date.UTC(2026, 1, 1), y: 78, d: '2026-02-01' },
  { t: Date.UTC(2026, 1, 15), y: 79, d: '2026-02-15' },
]

function renderChart(points) {
  act(() => root.render(<LineChart points={points} axes={false} unit="kg" />))
}

function hoverAt(clientX) {
  act(() => {
    container.querySelector('.chart-i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }))
  })
  return container.querySelector('.ctip').textContent
}

describe('LineChart hover date', () => {
  it('keeps same-year points in the compact format', () => {
    const first = point(2026, 1, 15, 70)
    renderChart([first, point(2026, 2, 15, 71)])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true)} · 70 kg`)
  })

  it('includes the calendar year at a short cross-year boundary', () => {
    const first = point(2025, 11, 30, 70)
    const last = point(2026, 2, 1, 71)
    renderChart([first, last])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true, true)} · 70 kg`)
    expect(hoverAt(340)).toBe(`${fmtDate(last.d, true, true)} · 71 kg`)
  })

  it('keeps a single point compact', () => {
    const only = point(2026, 7, 4, 70)
    renderChart([only])

    expect(hoverAt(170)).toBe(`${fmtDate(only.d, true)} · 70 kg`)
  })

  it('uses timestamp-only points when deciding whether to show the year', () => {
    const first = point(2025, 12, 31, 70)
    const last = point(2026, 1, 1, 71)
    const timestampOnly = [{ t: first.t, y: first.y }, { t: last.t, y: last.y }]
    renderChart(timestampOnly)

    const lastIso = isoOf(new Date(last.t))
    expect(hoverAt(340)).toBe(`${fmtDate(lastIso, true, true)} · 71 kg`)
  })
})

describe('LineChart hover state', () => {
  it('clears the tooltip and hover markers when points are replaced, then allows hovering again', () => {
    renderChart(firstPoints)
    hoverAt(170)

    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
    expect(container.querySelector('.chl')).toBeTruthy()

    renderChart(nextPoints)

    expect(container.querySelector('.ctip')).toBeNull()
    expect(container.querySelector('.cvl')).toBeNull()
    expect(container.querySelector('.chl')).toBeNull()

    hoverAt(170)
    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
  })
})

describe('LineChart y axis', () => {
  it('labels the zero line 0, never -0, when the range dips just below zero', () => {
    act(() => root.render(<LineChart points={[point(2026, 1, 1, 70), point(2026, 1, 8, 9999)]} axes unit="kg" />))
    const labels = [...container.querySelectorAll('text')].map(n => n.textContent)
    expect(labels).toContain('0')
    expect(labels.some(l => /^[-\u2212]0$/.test(l))).toBe(false)
  })
})

// The y axis spans the 7-day trend as well as the readings. A trend that averages readings from
// before the range can sit outside every reading the range shows, and was drawn off the chart.
describe('LineChart trend bounds', () => {
  const H = 160, TOP = 10, BOTTOM = H - 22 // the plot area with axes (P.t, H - P.b)
  const DAY = 86400000, NOW = Date.UTC(2026, 9, 23, 12)
  const at = (ago, y) => ({ t: NOW - ago * DAY, y })
  const ysOf = sel => [...container.querySelectorAll(sel)].flatMap(el =>
    el.tagName.toLowerCase() === 'circle' ? [Number(el.getAttribute('cy'))]
      : el.getAttribute('points').trim().split(/\s+/).map(xy => Number(xy.split(',')[1])))
  const inside = ys => ys.every(y => y >= TOP - 1e-6 && y <= BOTTOM + 1e-6)
  const draw = props => act(() => root.render(<LineChart h={H} unit="kg" {...props} />))

  it('keeps every trend point inside the plot when the average comes from before the range', () => {
    // 90 kg 31 days ago, then 80 kg on each of the three days after: in a 30-day view the
    // readings are all 80 while the trend is 85, 83.33 and 82.5.
    const points = [at(29, 80), at(28, 80), at(27, 80)]
    const trend = [at(29, 85), at(28, 83.33), at(27, 82.5)]
    draw({ points, trend })
    const ys = ysOf('polyline.trend')
    expect(ys).toHaveLength(3)
    expect(inside(ys)).toBe(true)
    expect(inside(ysOf('polyline.raw'))).toBe(true)
    expect(inside(ysOf('circle.raw'))).toBe(true)
  })

  it('leaves a chart without a trend spanning its readings as before', () => {
    draw({ points: [at(3, 80), at(2, 82), at(1, 81)] })
    expect(container.querySelector('polyline.trend')).toBeNull()
    const ys = ysOf('polyline')
    // The highest and lowest readings sit 12 % of the span inside the plot's top and bottom.
    const inset = (BOTTOM - TOP) * 0.12 / 1.24
    expect(Math.min(...ys)).toBeCloseTo(TOP + inset, 1)
    expect(Math.max(...ys)).toBeCloseTo(BOTTOM - inset, 1)
  })

  it('draws a flat trend over flat readings in the middle of the plot', () => {
    const points = [at(3, 80), at(2, 80), at(1, 80)]
    draw({ points, trend: points.map(p => ({ ...p })) })
    const ys = ysOf('polyline.trend')
    expect(inside(ys)).toBe(true)
    ys.forEach(y => expect(y).toBeCloseTo((TOP + BOTTOM) / 2, 1))
  })

  it('still includes the goal, with the trend, in the axis', () => {
    const points = [at(29, 80), at(28, 80), at(27, 80)]
    const trend = [at(29, 85), at(28, 83.33), at(27, 82.5)]
    draw({ points, trend, goal: 75 })
    expect(inside(ysOf('polyline.trend'))).toBe(true)
    const goal = [...container.querySelectorAll('line')].find(l => /--(yellow|goal)\b/.test(l.getAttribute('stroke') || ''))
    expect(goal).toBeTruthy()
    expect(inside([Number(goal.getAttribute('y1'))])).toBe(true)
  })

  it('keeps several series spanning only their own values', () => {
    const anchors = [at(3, 0), at(1, 0)]
    const series = [{ points: [at(3, 50), at(1, 60)], color: 'red' }]
    draw({ points: anchors, series, trend: [at(3, 500), at(1, 500)] })
    expect(container.querySelector('polyline.trend')).toBeNull()
    const ys = ysOf('circle')
    const inset = (BOTTOM - TOP) * 0.12 / 1.24
    expect(Math.min(...ys)).toBeCloseTo(TOP + inset, 1)
  })
})
