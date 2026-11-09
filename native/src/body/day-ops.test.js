import { expect, test } from 'vitest'
import { applyDayOps, entryFromOp, roundLb } from './day-ops.js'

const typed = (d, w, t, extra = {}) => ({ d, w, t, ...extra })
const health = (d, w, t, hk = 'u' + t) => ({ d, w, t, src: 'health', hk })
const set = (d, w, t, extra = {}) => ({ d, op: 'set', w, t, ...extra })
const remove = (d, t, extra = {}) => ({ d, op: 'remove', t, ...extra })

test('roundLb gives one decimal', () => {
  expect(roundLb(180.04)).toBe(180)
  expect(roundLb(180.06)).toBe(180.1)
})

test('entryFromOp carries src and hk only when present', () => {
  expect(entryFromOp(set('2026-01-01', 180, 5))).toEqual({ d: '2026-01-01', w: 180, t: 5 })
  expect(entryFromOp(set('2026-01-01', 180, 5, { src: 'health', hk: 'u', baseT: 3 }))).toEqual({ d: '2026-01-01', w: 180, t: 5, src: 'health', hk: 'u' })
  expect(Object.keys(entryFromOp(set('2026-01-01', 180, 5, { src: null, hk: null })))).toEqual(['d', 'w', 't'])
})

test('a Health set never overwrites a typed entry', () => {
  const r = applyDayOps([typed('2026-01-01', 181, 1)], [set('2026-01-01', 180, 5, { src: 'health', hk: 'u' })])
  expect(r.next).toEqual([typed('2026-01-01', 181, 1)])
  expect(r.superseded).toEqual([{ d: '2026-01-01', t: 5 }])
  expect(r.applied).toEqual([])
})

test('a Health set replaces an older Health entry and fills an absent day', () => {
  const r = applyDayOps([health('2026-01-01', 181, 1)], [set('2026-01-01', 180, 5, { src: 'health', hk: 'u5' }), set('2026-01-02', 179, 6, { src: 'health', hk: 'u6' })])
  expect(r.next).toEqual([health('2026-01-01', 180, 5, 'u5'), health('2026-01-02', 179, 6, 'u6')])
  expect(r.applied).toHaveLength(2)
})

test('a typed set replaces anything', () => {
  const r = applyDayOps([health('2026-01-01', 181, 1), typed('2026-01-02', 182, 2)], [set('2026-01-01', 180, 5), set('2026-01-02', 179, 6)])
  expect(r.next).toEqual([typed('2026-01-01', 180, 5), typed('2026-01-02', 179, 6)])
  expect(r.applied).toHaveLength(2)
})

test('a remove only removes the entry it saw', () => {
  const entries = [typed('2026-01-01', 181, 7)]
  const stale = applyDayOps(entries, [remove('2026-01-01', 9, { baseT: 3 })])
  expect(stale.next).toEqual(entries)
  expect(stale.superseded).toEqual([{ d: '2026-01-01', t: 9 }])
  const noBase = applyDayOps(entries, [remove('2026-01-01', 9)])
  expect(noBase.superseded).toHaveLength(1)
  const fresh = applyDayOps(entries, [remove('2026-01-01', 9, { baseT: 7 })])
  expect(fresh.next).toEqual([])
  expect(fresh.applied).toEqual([{ d: '2026-01-01', t: 9 }])
})

test('a Health remove never removes a typed entry but removes any Health one', () => {
  const kept = applyDayOps([typed('2026-01-01', 181, 1)], [remove('2026-01-01', 9, { src: 'health' })])
  expect(kept.next).toHaveLength(1)
  expect(kept.superseded).toHaveLength(1)
  const gone = applyDayOps([health('2026-01-01', 181, 1)], [remove('2026-01-01', 9, { src: 'health' })])
  expect(gone.next).toEqual([])
  expect(gone.applied).toHaveLength(1)
})

test('a Health set with baseT replaces the typed entry it names', () => {
  const op = set('2026-01-01', 180, 9, { src: 'health', hk: 'u', baseT: 1 })
  expect(applyDayOps([typed('2026-01-01', 181, 1)], [op]).next).toEqual([health('2026-01-01', 180, 9, 'u')])
  expect(applyDayOps([typed('2026-01-01', 181, 2)], [op]).superseded).toHaveLength(1)
})

test('a remove of an absent day is done', () => {
  for (const op of [remove('2026-01-01', 9, { baseT: 1 }), remove('2026-01-01', 9, { src: 'health' })]) {
    const r = applyDayOps([typed('2026-01-02', 181, 1)], [op])
    expect(r.done).toEqual([{ d: '2026-01-01', t: 9 }])
    expect(r.applied).toEqual([])
    expect(r.next).toHaveLength(1)
  }
})

test('an op already reflected is done', () => {
  const t1 = applyDayOps([typed('2026-01-01', 180, 5)], [set('2026-01-01', 180, 5)])
  expect(t1.done).toEqual([{ d: '2026-01-01', t: 5 }])
  const h1 = applyDayOps([health('2026-01-01', 180, 5, 'u')], [set('2026-01-01', 180, 5, { src: 'health', hk: 'u' })])
  expect(h1.done).toHaveLength(1)
  // same w and t but different source is not reflected
  const diff = applyDayOps([typed('2026-01-01', 180, 5)], [set('2026-01-01', 180, 5, { src: 'health', hk: 'u' })])
  expect(diff.done).toEqual([])
  expect(diff.superseded).toHaveLength(1)
})

test('unknown fields on untouched entries survive, as the same objects', () => {
  const a = { d: '2026-01-01', w: 180, t: 1, note: 'x', extra: { k: 1 } }
  const b = typed('2026-01-02', 181, 2)
  const r = applyDayOps([a, b], [set('2026-01-02', 179, 6)])
  expect(r.next[0]).toBe(a)
  expect(r.next[0].extra).toEqual({ k: 1 })
})

test('output is sorted with one entry per day, and inputs are not mutated', () => {
  const input = [typed('2026-01-03', 1, 1), typed('2026-01-01', 2, 2), typed('2026-01-01', 3, 9)]
  const snapshot = JSON.stringify(input)
  const ops = [set('2026-01-02', 4, 3)]
  const opsSnapshot = JSON.stringify(ops)
  const r = applyDayOps(input, ops)
  expect(r.next.map(e => e.d)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
  expect(r.next[0].t).toBe(9)
  expect(JSON.stringify(input)).toBe(snapshot)
  expect(JSON.stringify(ops)).toBe(opsSnapshot)
  expect(r.next).not.toBe(input)
})

test('a missing or malformed list is tolerated; non-objects are left out of next', () => {
  expect(applyDayOps(undefined, [set('2026-01-01', 1, 1)]).next).toEqual([typed('2026-01-01', 1, 1)])
  expect(applyDayOps('nope', []).next).toEqual([])
  const good = typed('2026-01-01', 1, 1)
  expect(applyDayOps([null, 5, 'x', [], { w: 1 }, good], []).next).toEqual([good])
})
