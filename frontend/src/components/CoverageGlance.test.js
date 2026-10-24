// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { glanceRows } from './CoverageGlance.jsx'

const pair = (done, planned) => ({ actual: { combinedEstimate: done }, planned: { combinedEstimate: planned } })

describe('the coverage glance rows', () => {
  it('keeps the body map order, drops muscles with nothing done or planned, and marks met aims', () => {
    const rows = glanceRows({ triceps: pair(2, 4), chest: pair(10, 10), calves: pair(0, 0), quads: pair(0, 6) })
    expect(rows.map(r => r.m)).toEqual(['chest', 'triceps', 'quads'])
    expect(rows[0]).toMatchObject({ met: true, fill: 1 })
    expect(rows[1]).toMatchObject({ met: false, fill: 0.5 })
    expect(rows[2]).toMatchObject({ met: false, fill: 0 })
  })
  it('fills an unplanned muscle all the way without calling it met, and keeps unknown muscles last', () => {
    const rows = glanceRows({ mystery: pair(1, 0), chest: pair(3, 0) })
    expect(rows.map(r => r.m)).toEqual(['chest', 'mystery'])
    expect(rows[0]).toMatchObject({ met: false, fill: 1 })
    expect(glanceRows(undefined)).toEqual([])
  })
})
