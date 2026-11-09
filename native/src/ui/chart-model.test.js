import { expect, test } from 'vitest'
import { chartModel } from './chart-model.js'

const DAY = 86400000
const finite = (m) => {
  const nums = [m.yMin, m.yMax, ...m.dots.flatMap((d) => [d.x, d.y])]
  if (m.goalY !== null) nums.push(m.goalY)
  if (m.line) nums.push(...m.line.split(/[ ,]/).map(Number))
  return nums.every(Number.isFinite)
}
const pts = (ys) => ys.map((y, i) => ({ t: i * DAY, y, d: `2026-01-${String(i + 1).padStart(2, '0')}` }))

test('no points gives no chart', () => {
  expect(chartModel({ points: [], width: 300, height: 100 })).toBeNull()
})

test('one point sits centred', () => {
  const m = chartModel({ points: pts([100]), width: 300, height: 100 })
  expect(m.dots).toEqual([{ x: 150, y: 50 }])
  expect(m.yMin).toBeLessThan(m.yMax)
  expect(finite(m)).toBe(true)
})

test('a flat series has a non-zero span', () => {
  const m = chartModel({ points: pts([80, 80, 80]), width: 300, height: 100 })
  expect(m.yMin).toBe(79)
  expect(m.yMax).toBe(81)
  expect(m.dots.every((d) => d.y === 50)).toBe(true)
  expect(finite(m)).toBe(true)
})

test('time maps to pad..width-pad, higher values sit higher', () => {
  const m = chartModel({ points: pts([10, 20, 30]), width: 300, height: 100, pad: 8 })
  expect(m.dots[0].x).toBe(8)
  expect(m.dots[2].x).toBe(292)
  expect(m.dots[1].x).toBe(150)
  expect(m.dots[0].y).toBe(92)
  expect(m.dots[2].y).toBe(8)
  expect(m.xFirst).toBe('2026-01-01')
  expect(m.xLast).toBe('2026-01-03')
})

test('uneven spacing is by time, not index', () => {
  const points = [{ t: 0, y: 1 }, { t: DAY, y: 2 }, { t: 4 * DAY, y: 3 }]
  const m = chartModel({ points, width: 108, height: 100, pad: 8 })
  expect(m.dots[1].x).toBe(31)
})

test('the goal widens the domain', () => {
  const m = chartModel({ points: pts([10, 20]), goal: 40, width: 300, height: 100 })
  expect(m.yMax).toBe(40)
  expect(m.goalY).toBe(8)
  const below = chartModel({ points: pts([10, 20]), goal: 0, width: 300, height: 100 })
  expect(below.yMin).toBe(0)
  expect(below.goalY).toBe(92)
})

test('the trend drives the line and the domain', () => {
  const points = pts([10, 20, 30])
  const trend = [{ t: 0, y: 15 }, { t: DAY, y: 20 }, { t: 2 * DAY, y: 25 }]
  const m = chartModel({ points, trend, width: 300, height: 100 })
  expect(m.line.split(' ')).toHaveLength(3)
  expect(m.line).not.toBe(chartModel({ points, width: 300, height: 100 }).line)
  const wide = chartModel({ points, trend: [{ t: 0, y: 0 }, { t: DAY, y: 20 }, { t: 2 * DAY, y: 25 }], width: 300, height: 100 })
  expect(wide.yMin).toBe(0)
  expect(finite(m)).toBe(true)
})

test('without a trend the line comes from the points', () => {
  const m = chartModel({ points: pts([10, 30]), width: 300, height: 100 })
  expect(m.line).toBe('8,92 292,8')
})

test('a single point has no line', () => {
  expect(chartModel({ points: pts([5]), width: 300, height: 100 }).line).toBeNull()
})

test('coordinates round to 0.1 and stay finite', () => {
  const m = chartModel({ points: pts([1, 2, 4, 7, 3]), goal: 5.55, width: 317, height: 163 })
  for (const d of m.dots) {
    expect(Math.round(d.x * 10) / 10).toBe(d.x)
    expect(Math.round(d.y * 10) / 10).toBe(d.y)
  }
  expect(finite(m)).toBe(true)
})

test('a zero or tiny width stays finite', () => {
  expect(finite(chartModel({ points: pts([1, 2]), width: 0, height: 0 }))).toBe(true)
  expect(finite(chartModel({ points: [{ t: 5, y: 3 }, { t: 5, y: 4 }], width: 100, height: 100 }))).toBe(true)
})
