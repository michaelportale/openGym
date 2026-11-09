import { expect, test } from 'vitest'
import { applyRoutineEdits, routineContent, sameRoutine } from './routine-guard.js'

const routine = (id, name, extra = {}) => ({ id, name, slots: [{ ex: 'bench', sets: 3 }], ...extra })
const edit = (rid, routineValue, extra = {}) => ({ rid, baseTs: null, routine: routineValue, sent: null, t: 1, ...extra })

test('routineContent drops only the top-level _ts, _f and _u', () => {
  const r = { id: 'a', name: 'A', _ts: 5, _f: 1, _u: 2, slots: [{ ex: 'x', _ts: 9 }] }
  expect(routineContent(r)).toEqual({ id: 'a', name: 'A', slots: [{ ex: 'x', _ts: 9 }] })
  expect(r._ts).toBe(5)
})

test('sameRoutine ignores key order and undefined keys, but not array order or slot keys', () => {
  expect(sameRoutine({ id: 'a', x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 }, id: 'a' })).toBe(true)
  expect(sameRoutine({ id: 'a', y: undefined }, { id: 'a' })).toBe(true)
  expect(sameRoutine({ id: 'a', s: [1, 2] }, { id: 'a', s: [2, 1] })).toBe(false)
  expect(sameRoutine({ id: 'a', _ts: 1, _f: 2, _u: 3 }, { id: 'a' })).toBe(true)
  expect(sameRoutine({ id: 'a', s: [{ _ts: 1 }] }, { id: 'a', s: [{ _ts: 2 }] })).toBe(false)
  expect(sameRoutine({ id: 'a', s: [1] }, { id: 'a', s: { 0: 1 } })).toBe(false)
})

test('an edit the server copy already holds is done', () => {
  const copy = routine('a', 'New', { _ts: 9 })
  const r = applyRoutineEdits([copy], [edit('a', routine('a', 'New'), { baseTs: 3, t: 7 })])
  expect(r.done).toEqual([{ rid: 'a', t: 7 }])
  expect(r.applied).toEqual([])
  expect(r.next).toEqual([copy])
  expect(r.next[0]).toBe(copy)
})

test('an edit on the base it saw applies and replaces the routine at its index', () => {
  const other = routine('b', 'B')
  const list = [other, routine('a', 'Old', { _ts: 3 })]
  const mine = routine('a', 'Mine')
  const r = applyRoutineEdits(list, [edit('a', mine, { baseTs: 3, t: 4 })])
  expect(r.applied).toEqual([{ rid: 'a', t: 4 }])
  expect(r.next).toEqual([other, mine])
  expect(r.next[0]).toBe(other)
  expect(r.next).not.toBe(list)
  expect(list[1].name).toBe('Old')
})

test('a routine without _ts and baseTs null applies', () => {
  const r = applyRoutineEdits([routine('a', 'Old')], [edit('a', routine('a', 'Mine'))])
  expect(r.applied).toEqual([{ rid: 'a', t: 1 }])
  expect(r.next[0].name).toBe('Mine')
})

test('a change on the web since the edit was based is superseded as changed', () => {
  const list = [routine('a', 'Web', { _ts: 8 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ rid: 'a', t: 4, kind: 'changed' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(list)
})

test('a routine missing from the list is superseded as deleted and is not added', () => {
  const list = [routine('b', 'B')]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ rid: 'a', t: 4, kind: 'deleted' }])
  expect(r.next).toBe(list)
})

test('_ts and _f differences alone still count as the same routine', () => {
  const copy = routine('a', 'Same', { _ts: 20, _f: 1 })
  const r = applyRoutineEdits([copy], [edit('a', routine('a', 'Same', { _ts: 1 }), { baseTs: 3 })])
  expect(r.done).toHaveLength(1)
})

test('two edits to two routines both apply', () => {
  const list = [routine('a', 'A', { _ts: 1 }), routine('b', 'B', { _ts: 2 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'A2'), { baseTs: 1, t: 5 }), edit('b', routine('b', 'B2'), { baseTs: 2, t: 6 })])
  expect(r.applied).toEqual([{ rid: 'a', t: 5 }, { rid: 'b', t: 6 }])
  expect(r.next.map((x) => x.name)).toEqual(['A2', 'B2'])
})

test('in flight: the copy equals what was sent while the routine is newer, so the edit is rebased onto it', () => {
  const sent = routine('a', 'Sent')
  const newer = routine('a', 'Newer')
  const copy = routine('a', 'Sent', { _ts: 12 })
  const r = applyRoutineEdits([copy], [edit('a', newer, { baseTs: 3, sent, t: 8 })])
  expect(r.rebased).toEqual([{ rid: 'a', t: 8, baseTs: 12 }])
  expect(r.applied).toEqual([])
  expect(r.next).toEqual([newer])
})

test('rebased reports a null baseTs when the copy has no _ts', () => {
  const sent = routine('a', 'Sent')
  const r = applyRoutineEdits([routine('a', 'Sent')], [edit('a', routine('a', 'Newer'), { baseTs: 3, sent })])
  expect(r.rebased[0].baseTs).toBeNull()
})

test('done is checked before rebased, and rebased before applied', () => {
  const sent = routine('a', 'Sent')
  const copy = routine('a', 'Sent', { _ts: 3 })
  const r = applyRoutineEdits([copy], [edit('a', routine('a', 'Newer'), { baseTs: 3, sent })])
  expect(r.rebased).toHaveLength(1)
  expect(r.applied).toEqual([])
  const same = applyRoutineEdits([copy], [edit('a', routine('a', 'Sent'), { baseTs: 3, sent })])
  expect(same.done).toHaveLength(1)
  expect(same.rebased).toEqual([])
})

test('non-object entries are kept and never match; the first routine with an id counts', () => {
  const list = [null, 'x', routine('a', 'First', { _ts: 1 }), routine('a', 'Second', { _ts: 1 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 1 })])
  expect(r.next[0]).toBeNull()
  expect(r.next[1]).toBe('x')
  expect(r.next[2].name).toBe('Mine')
  expect(r.next[3].name).toBe('Second')
})

test('a non-array routines reads as empty; nothing applying returns the input array itself', () => {
  expect(applyRoutineEdits(undefined, []).next).toEqual([])
  expect(applyRoutineEdits({}, [edit('a', routine('a', 'A'))]).superseded[0].kind).toBe('deleted')
  const list = [routine('a', 'A')]
  expect(applyRoutineEdits(list, []).next).toBe(list)
  expect(applyRoutineEdits(list, undefined).next).toBe(list)
})
