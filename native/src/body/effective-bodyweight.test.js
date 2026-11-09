import { describe, it, expect } from 'vitest'
import { effectiveBodyweight } from './effective-bodyweight.js'

const copy = { state: { bodyweight: [{ d: '2026-11-08', w: 180, t: 1 }, { d: '2026-11-07', w: 181, t: 1 }], deleted: { bodyweight: {} } } }

describe('effectiveBodyweight', () => {
  it('lays a pending set over the copy and sorts by day', () => {
    const out = effectiveBodyweight({ copy, pending: [{ d: '2026-11-09', op: 'set', w: 179, t: 5 }], deleted: {} })
    expect(out.map(e => e.d)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09'])
    expect(out[2]).toEqual({ d: '2026-11-09', w: 179, t: 5 })
  })
  it('lets a pending remove drop a day the phone saw', () => {
    const out = effectiveBodyweight({ copy, pending: [{ d: '2026-11-08', op: 'remove', t: 9, baseT: 1 }], deleted: {} })
    expect(out.map(e => e.d)).toEqual(['2026-11-07'])
  })
  it('keeps the copy as it is with nothing pending', () => {
    expect(effectiveBodyweight({ copy, pending: [], deleted: {} })).toHaveLength(2)
  })
  it('uses the snapshot list when unpaired', () => {
    const snapshot = [{ d: '2026-11-01', w: 190, t: 1 }]
    expect(effectiveBodyweight({ copy: null, snapshot, pending: [], deleted: {} })).toEqual(snapshot)
    expect(effectiveBodyweight({ copy: null, pending: [], deleted: {} })).toEqual([])
  })
  it("takes the copy's deletion stamps when none are passed: an older pending set stays hidden, a newer one shows", () => {
    const removed = { state: { bodyweight: [{ d: '2026-11-07', w: 181, t: 1 }], deleted: { bodyweight: { '2026-11-08': 10 } } } }
    expect(effectiveBodyweight({ copy: removed, pending: [{ d: '2026-11-08', op: 'set', w: 180, t: 10 }] }).map(e => e.d)).toEqual(['2026-11-07'])
    expect(effectiveBodyweight({ copy: removed, pending: [{ d: '2026-11-08', op: 'set', w: 180, t: 11 }] }).map(e => e.d)).toEqual(['2026-11-07', '2026-11-08'])
  })
})
