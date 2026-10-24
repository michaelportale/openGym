// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { glanceRows, glanceOrder, setsLabel } from './CoverageGlance.jsx'

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

  it('puts the muscle most behind first, then work without a plan, and folds met aims away', () => {
    const rows = glanceRows({ chest: pair(10, 10), triceps: pair(2, 4), quads: pair(0, 6), biceps: pair(3, 0), glutes: pair(1, 2) })
    const { open, met } = glanceOrder(rows)
    expect(open.map(r => r.m)).toEqual(['quads', 'triceps', 'glutes', 'biceps'])
    expect(met.map(r => r.m)).toEqual(['chest'])
  })
})

describe('the coverage glance numbers', () => {
  it('shows whole sets, with ≈ when a half set was rounded', () => {
    expect(setsLabel(3, 4)).toBe('3 / 4')
    expect(setsLabel(1.5, 2)).toBe('≈2 / 2')
    expect(setsLabel(2, 2.5)).toBe('≈2 / 3')
    expect(setsLabel(4, 0)).toBe('4')
  })
})

