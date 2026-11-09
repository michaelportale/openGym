import { expect, test } from 'vitest'
import { applyDayOps } from './day-ops.js'
import { applyMeasurementOps } from './measurement-ops.js'

const D = '2026-11-08'
// A measurement entry as the web stores it: cm, nulls for fields not measured, custom fields in
// `other`, and a key this app does not know.
const entry = (d, t, fields = {}) => ({ d, t, waist: 81.3, chest: 101.6, neck: null, other: [{ id: 'c1', name: 'Calf pump', value: null }], futureKey: { x: 1 }, ...fields })
const set = (e, extra = {}) => ({ d: e.d, op: 'set', entry: e, t: e.t, ...extra })
const remove = (d, t, baseT) => ({ d, op: 'remove', t, ...(baseT === undefined ? {} : { baseT }) })
const outcome = (list, op, deleted) => {
  const r = applyMeasurementOps(list, [op], deleted)
  return r.applied.length ? 'applied' : r.done.length ? 'done' : 'superseded'
}

test('a set fills an absent day, and replaces an older or same-t entry; a later entry wins', () => {
  const mine = entry(D, 5, { waist: 80.5 })
  expect(applyMeasurementOps([], [set(mine)])).toEqual({ next: [mine], applied: [{ d: D, t: 5 }], done: [], superseded: [] })
  expect(applyMeasurementOps([entry(D, 4)], [set(mine)]).next).toEqual([mine])
  expect(applyMeasurementOps([entry(D, 5)], [set(mine)]).next).toEqual([mine])
  const later = entry(D, 6, { waist: 82 })
  const r = applyMeasurementOps([later], [set(mine)])
  expect(r.next).toEqual([later])
  expect(r.next[0]).toBe(later)
  expect(r).toMatchObject({ applied: [], done: [], superseded: [{ d: D, t: 5 }] })
})

test('a removal on record at or after a set beats it on a day with no entry', () => {
  const op = set(entry(D, 100))
  expect(outcome([], op, { [D]: 150 })).toBe('superseded')
  expect(outcome([], op, { [D]: 100 })).toBe('superseded') // equal counts
  expect(outcome([], op, { [D]: 50 })).toBe('applied') // deleted before the set
  expect(outcome([], op, { [D]: -150 })).toBe('applied') // negative: added back
  expect(outcome([], op, { '2026-11-09': 150 })).toBe('applied') // another day
  for (const junk of [undefined, null, 'junk', [], 7]) expect(outcome([], op, junk)).toBe('applied')
  // a day with an entry is decided by the entry, as for a weigh-in
  expect(outcome([entry(D, 10)], op, { [D]: 150 })).toBe('applied')
})

test('a remove takes out only the entry it saw; an absent day is done', () => {
  const seen = entry(D, 7)
  const r = applyMeasurementOps([seen], [remove(D, 9, 7)])
  expect(r).toEqual({ next: [], applied: [{ d: D, t: 9 }], done: [], superseded: [] })
  expect(outcome([seen], remove(D, 9, 3))).toBe('superseded') // the web changed it since
  expect(outcome([seen], remove(D, 9))).toBe('superseded') // names no entry
  expect(outcome([{ ...seen, t: '7' }], remove(D, 9, 7))).toBe('superseded') // strict, as a typed weigh-in remove
  expect(applyMeasurementOps([entry('2026-11-07', 1)], [remove(D, 9, 7)])).toMatchObject({ done: [{ d: D, t: 9 }], applied: [] })
  expect(outcome([], remove(D, 9, 7), { [D]: 20 })).toBe('done')
})

test('a set is done when the day already holds that entry, whatever the order of its keys', () => {
  const held = entry(D, 5)
  const reordered = Object.fromEntries(Object.entries(entry(D, 5)).reverse())
  const r = applyMeasurementOps([held], [set(reordered)])
  expect(r).toMatchObject({ applied: [], done: [{ d: D, t: 5 }], superseded: [] })
  expect(r.next[0]).toBe(held)
  // any difference, however deep, is not done: on the same t it applies
  for (const change of [{ waist: 81.4 }, { neck: 38 }, { other: [{ id: 'c1', name: 'Calf pump', value: 30.5 }] }, { futureKey: { x: 2 } }, { extra: null }]) {
    expect(outcome([held], set(entry(D, 5, change)))).toBe('applied')
  }
  const { neck, ...fewer } = entry(D, 5)
  expect(outcome([held], set(fewer))).toBe('applied')
})

// The weigh-in typed path decides every case (day-ops.js): the same guard, so the same outcome
// for every day, removal record and op, measured on both lists.
test('every outcome is the weigh-in typed path\'s', () => {
  const days = { absent: null, older: 4, same: 5, newer: 6 }
  const records = [undefined, { [D]: 4 }, { [D]: 5 }, { [D]: 6 }, { [D]: -9 }]
  const ops = {
    set: { m: set(entry(D, 5, { waist: 70 })), w: { d: D, op: 'set', w: 170, t: 5 } },
    setHeld: { m: set(entry(D, 5)), w: { d: D, op: 'set', w: 181, t: 5 } },
    removeSeen: { m: remove(D, 9, 5), w: remove(D, 9, 5) },
    removeOther: { m: remove(D, 9, 4), w: remove(D, 9, 4) },
    removeBlind: { m: remove(D, 9), w: remove(D, 9) },
  }
  let compared = 0
  for (const [day, t] of Object.entries(days)) {
    for (const deleted of records) {
      for (const [name, { m, w }] of Object.entries(ops)) {
        const measured = outcome(t == null ? [] : [entry(D, t)], m, deleted)
        const r = applyDayOps(t == null ? [] : [{ d: D, w: 181, t }], [w], deleted)
        const weighed = r.applied.length ? 'applied' : r.done.length ? 'done' : 'superseded'
        expect(measured, `${day} ${JSON.stringify(deleted)} ${name}`).toBe(weighed)
        compared++
      }
    }
  }
  expect(compared).toBe(100)
})

test('two entries on one day: the later is the day\'s entry, the first on equal t', () => {
  const a = entry(D, 5, { waist: 80 })
  const b = entry(D, 8, { chest: 100, waist: null })
  for (const list of [[a, b], [b, a]]) {
    expect(outcome(list, set(entry(D, 6)))).toBe('superseded') // between them: loses to the later
    expect(outcome(list, remove(D, 10, 5))).toBe('superseded') // names the earlier one
    expect(outcome(list, set(structuredClone(b)))).toBe('done')
  }
  const c = entry(D, 8, { chest: 99 })
  expect(outcome([b, c], set(structuredClone(b)))).toBe('done')
  expect(outcome([b, c], set(structuredClone(c)))).toBe('applied')
})

test('two entries on one day: an applied op replaces or removes both rows', () => {
  const a = entry(D, 5, { waist: 80 })
  const b = entry(D, 8, { chest: 100, waist: null })
  const mine = entry(D, 9, { waist: 80, chest: 100 })
  expect(applyMeasurementOps([a, b], [set(mine)]).next).toEqual([mine])
  expect(applyMeasurementOps([a, b], [remove(D, 10, 8)])).toMatchObject({ next: [], applied: [{ d: D, t: 10 }] })
})

test('a day no op changes keeps every row as the same object, two rows of one day included', () => {
  const a = entry('2026-11-01', 5, { waist: 80 })
  const b = entry('2026-11-01', 8, { chest: 100 })
  const c = entry('2026-11-03', 2, { mystery: [1, { y: 2 }] })
  const mine = entry('2026-11-02', 9)
  const r = applyMeasurementOps([a, b, c], [set(mine), set(entry('2026-11-03', 1))])
  expect(r.next).toEqual([a, b, mine, c])
  expect(r.next[0]).toBe(a)
  expect(r.next[1]).toBe(b)
  expect(r.next[3]).toBe(c)
  expect(r.superseded).toEqual([{ d: '2026-11-03', t: 1 }])
})

test('next is sorted by day; inputs are never mutated', () => {
  const list = [entry('2026-11-05', 1), entry('2026-11-01', 2), entry('2026-11-03', 3)]
  const ops = [set(entry('2026-11-02', 4)), remove('2026-11-03', 5, 3)]
  const before = JSON.stringify([list, ops])
  const r = applyMeasurementOps(list, ops)
  expect(r.next.map(e => e.d)).toEqual(['2026-11-01', '2026-11-02', '2026-11-05'])
  expect(JSON.stringify([list, ops])).toBe(before)
  expect(r.next).not.toBe(list)
})

test('a missing or malformed list is tolerated; elements on no day are left out, as the web leaves them', () => {
  const mine = entry(D, 1)
  expect(applyMeasurementOps(undefined, [set(mine)]).next).toEqual([mine])
  expect(applyMeasurementOps('nope', []).next).toEqual([])
  expect(applyMeasurementOps(entry(D, 1), undefined)).toEqual({ next: [], applied: [], done: [], superseded: [] })
  const good = entry('2026-11-01', 1)
  expect(applyMeasurementOps([null, 5, 'x', [], { waist: 1 }, good], [set(mine)]).next).toEqual([good, mine])
})
