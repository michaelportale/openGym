import { expect, test } from 'vitest'
import { applyDayOps, entryFromOp, roundLb } from './day-ops.js'

const typed = (d, w, t, extra = {}) => ({ d, w, t, ...extra })
const health = (d, w, t, hk = 'u' + t) => ({ d, w, t, src: 'health', hk })
const set = (d, w, t, extra = {}) => ({ d, op: 'set', w, t, ...extra })
const remove = (d, t, extra = {}) => ({ d, op: 'remove', t, ...extra })

test('roundLb gives one decimal and NaN for a non-number', () => {
  expect(roundLb(180.04)).toBe(180)
  expect(roundLb(180.06)).toBe(180.1)
  for (const bad of [null, '', false, undefined]) expect(roundLb(bad)).toBeNaN()
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

test('a Health set replaces the older Health entry it names and fills an absent day', () => {
  const r = applyDayOps([health('2026-01-01', 181, 1)], [set('2026-01-01', 180, 5, { src: 'health', hk: 'u5', baseT: 1 }), set('2026-01-02', 179, 6, { src: 'health', hk: 'u6' })])
  expect(r.next).toEqual([health('2026-01-01', 180, 5, 'u5'), health('2026-01-02', 179, 6, 'u6')])
  expect(r.applied).toHaveLength(2)
})

test('a Health set never touches an entry it did not see: no baseT, or another t, is superseded', () => {
  for (const op of [set('2026-01-01', 180, 5, { src: 'health', hk: 'u5' }), set('2026-01-01', 180, 5, { src: 'health', hk: 'u5', baseT: 2 })]) {
    const r = applyDayOps([health('2026-01-01', 181, 1)], [op])
    expect(r.next).toEqual([health('2026-01-01', 181, 1)])
    expect(r.superseded).toEqual([{ d: '2026-01-01', t: 5 }])
  }
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

test('a Health remove removes only the entry it names, whatever its source', () => {
  const kept = applyDayOps([typed('2026-01-01', 181, 1)], [remove('2026-01-01', 9, { src: 'health' })])
  expect(kept.next).toHaveLength(1)
  expect(kept.superseded).toHaveLength(1)
  for (const other of [remove('2026-01-01', 9, { src: 'health' }), remove('2026-01-01', 9, { src: 'health', baseT: 2 })]) {
    const r = applyDayOps([health('2026-01-01', 181, 1)], [other])
    expect(r.next).toEqual([health('2026-01-01', 181, 1)])
    expect(r.superseded).toEqual([{ d: '2026-01-01', t: 9 }])
  }
  const gone = applyDayOps([health('2026-01-01', 181, 1)], [remove('2026-01-01', 9, { src: 'health', baseT: 1 })])
  expect(gone.next).toEqual([])
  expect(gone.applied).toHaveLength(1)
  // The owner's typed removal, carried by a Health remove that names the typed entry.
  const typedGone = applyDayOps([typed('2026-01-01', 181, 1)], [remove('2026-01-01', 9, { src: 'health', baseT: 1 })])
  expect(typedGone.next).toEqual([])
  expect(typedGone.applied).toHaveLength(1)
})

test('C1: a Health entry the web edited in place survives Health ops that name its old t', () => {
  // Imported at t 5, then edited on the web: same src and hk, new w and t.
  const edited = { d: '2026-01-01', w: 182, t: 9, src: 'health', hk: 'X' }
  const r = applyDayOps([edited], [set('2026-01-01', 186, 12, { src: 'health', hk: 'Y', baseT: 5 })])
  expect(r.next[0]).toBe(edited)
  expect(r.superseded).toEqual([{ d: '2026-01-01', t: 12 }])
  const gone = applyDayOps([edited], [remove('2026-01-01', 12, { src: 'health', baseT: 5 })])
  expect(gone.next[0]).toBe(edited)
  expect(gone.superseded).toEqual([{ d: '2026-01-01', t: 12 }])
})

test('Health ops compare the entry t as a number', () => {
  const entry = { d: '2026-01-01', w: 181, t: '7', src: 'health', hk: 'u' }
  expect(applyDayOps([entry], [set('2026-01-01', 180, 9, { src: 'health', hk: 'v', baseT: 7 })]).applied).toHaveLength(1)
  expect(applyDayOps([entry], [remove('2026-01-01', 9, { src: 'health', baseT: 7 })]).applied).toHaveLength(1)
})

test('typed ops are unchanged: set by t between typed entries, over any Health one; remove by exact t', () => {
  const D = '2026-01-01'
  const days = {
    absent: [],
    typedOlder: [typed(D, 181, 4)],
    typedSame: [typed(D, 181, 5)],
    typedNewer: [typed(D, 181, 6)],
    healthNewer: [health(D, 181, 6)],
    healthSame: [health(D, 181, 5)],
  }
  const outcome = (entries, op, deleted) => {
    const r = applyDayOps(entries, [op], deleted)
    return r.applied.length ? 'applied' : r.done.length ? 'done' : 'superseded'
  }
  const setOp = set(D, 180, 5)
  expect(Object.fromEntries(Object.entries(days).map(([k, e]) => [k, outcome(e, setOp)]))).toEqual({
    absent: 'applied', typedOlder: 'applied', typedSame: 'applied', typedNewer: 'superseded', healthNewer: 'applied', healthSame: 'applied',
  })
  expect(outcome([], setOp, { [D]: 5 })).toBe('superseded')
  expect(outcome([], setOp, { [D]: 4 })).toBe('applied')
  const removeOp = remove(D, 9, { baseT: 5 })
  expect(Object.fromEntries(Object.entries(days).map(([k, e]) => [k, outcome(e, removeOp)]))).toEqual({
    absent: 'done', typedOlder: 'superseded', typedSame: 'applied', typedNewer: 'superseded', healthNewer: 'superseded', healthSame: 'applied',
  })
  expect(outcome([typed(D, 181, 5)], remove(D, 9))).toBe('superseded')
  expect(outcome([{ d: D, w: 181, t: '5' }], removeOp)).toBe('superseded') // strict, as before
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

test('only non-objects and entries with no d are dropped; others pass through', () => {
  const odd = { d: 20260101, w: 1, t: 1 }
  const r = applyDayOps([{ d: null, w: 1 }, odd], [])
  expect(r.next).toEqual([odd])
  expect(r.next[0]).toBe(odd)
})

test('duplicate days keep the larger t, and the first on equal t', () => {
  const first = { d: '2026-01-01', w: 1, t: 5, tag: 'first' }
  const second = { d: '2026-01-01', w: 2, t: 5, tag: 'second' }
  expect(applyDayOps([first, second], []).next[0]).toBe(first)
  const later = { d: '2026-01-01', w: 3, t: 6 }
  expect(applyDayOps([first, later], []).next[0]).toBe(later)
  expect(applyDayOps([later, first], []).next[0]).toBe(later)
})

test('a typed set loses to a typed entry with a larger t, wins on equal or smaller t', () => {
  const older = applyDayOps([typed('2026-01-01', 181, 9)], [set('2026-01-01', 180, 5)])
  expect(older.next).toEqual([typed('2026-01-01', 181, 9)])
  expect(older.superseded).toEqual([{ d: '2026-01-01', t: 5 }])
  expect(applyDayOps([typed('2026-01-01', 181, 5)], [set('2026-01-01', 180, 5)]).applied).toHaveLength(1)
  const newer = applyDayOps([typed('2026-01-01', 181, 2)], [set('2026-01-01', 180, 5)])
  expect(newer.next).toEqual([typed('2026-01-01', 180, 5)])
  expect(newer.applied).toHaveLength(1)
  const overHealth = applyDayOps([health('2026-01-01', 181, 99)], [set('2026-01-01', 180, 5)])
  expect(overHealth.next).toEqual([typed('2026-01-01', 180, 5)])
  expect(overHealth.applied).toHaveLength(1)
})

test('a reflected op keeps the original entry object', () => {
  const entry = { d: '2026-01-01', w: 180, t: 5, note: 'x' }
  const r = applyDayOps([entry], [set('2026-01-01', 180, 5)])
  expect(r.done).toHaveLength(1)
  expect(r.next[0]).toBe(entry)
})

test('a typed remove removes a Health entry whose t equals baseT', () => {
  const r = applyDayOps([health('2026-01-01', 181, 4)], [remove('2026-01-01', 9, { baseT: 4 })])
  expect(r.next).toEqual([])
  expect(r.applied).toHaveLength(1)
})

test('one call can mix applied, done and superseded', () => {
  const r = applyDayOps(
    [typed('2026-01-01', 181, 9), typed('2026-01-02', 180, 5)],
    [set('2026-01-01', 170, 2), set('2026-01-02', 180, 5), set('2026-01-03', 179, 6)],
  )
  expect(r.superseded).toEqual([{ d: '2026-01-01', t: 2 }])
  expect(r.done).toEqual([{ d: '2026-01-02', t: 5 }])
  expect(r.applied).toEqual([{ d: '2026-01-03', t: 6 }])
  expect(r.next.map(e => e.d)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
})

test('mixed-type days sort consistently by String(d)', () => {
  const entries = ['2026-01-03', 20260101, '2026-01-01', '2026-01-02'].map(d => ({ d, w: 1, t: 1 }))
  const next = applyDayOps(entries, []).next.map(e => String(e.d))
  expect(next).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '20260101'])
})

test('a removal on record beats a set made before it, only when the day has no entry', () => {
  const set = { d: '2026-11-08', op: 'set', w: 180, t: 100 }
  expect(applyDayOps([], [set], { '2026-11-08': 150 })).toMatchObject({ applied: [], superseded: [{ d: '2026-11-08', t: 100 }] })
  expect(applyDayOps([], [set], { '2026-11-08': 100 }).superseded).toHaveLength(1) // equal counts
  expect(applyDayOps([], [{ ...set, src: 'health', hk: 'u' }], { '2026-11-08': 150 }).superseded).toHaveLength(1)
  expect(applyDayOps([], [set], { '2026-11-08': 50 }).applied).toHaveLength(1) // deleted before the op
  expect(applyDayOps([], [set], { '2026-11-08': -150 }).applied).toHaveLength(1) // negative = re-added
  expect(applyDayOps([], [set], { '2026-11-09': 150 }).applied).toHaveLength(1) // another day
  expect(applyDayOps([], [set], undefined).applied).toHaveLength(1)
  expect(applyDayOps([], [set], 'junk').applied).toHaveLength(1)
  // an entry on the day decides by the entry guards, not the record
  expect(applyDayOps([{ d: '2026-11-08', w: 1, t: 10 }], [set], { '2026-11-08': 150 }).applied).toHaveLength(1)
  // removes are unchanged: absent is done
  expect(applyDayOps([], [{ d: '2026-11-08', op: 'remove', t: 100 }], { '2026-11-08': 150 }).done).toHaveLength(1)
})
