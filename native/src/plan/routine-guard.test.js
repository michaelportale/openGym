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
  expect(r.next).toEqual([other, { ...mine, _ts: 3 }]) // on the copy's stamps
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
  expect(r.next).toEqual([{ ...newer, _ts: 12 }])
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

test('non-object entries are kept and never match', () => {
  const list = [null, 'x', routine('a', 'First', { _ts: 1 }), routine('b', 'Other', { _ts: 1 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 1 })])
  expect(r.next[0]).toBeNull()
  expect(r.next[1]).toBe('x')
  expect(r.next[2].name).toBe('Mine')
  expect(r.next[3]).toBe(list[3])
})

// The API pairs the last routine with an id and the guard the first: never send an edit of one.
test('a routine id twice in the copy makes an edit that would go unsafe; one already there is done, and the first counts for that', () => {
  const list = [routine('a', 'First', { _ts: 1 }), routine('a', 'Second', { _ts: 1 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 1, t: 4 })])
  expect(r.superseded).toEqual([{ rid: 'a', t: 4, kind: 'unsafe' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(list)
  const sent = routine('a', 'Sent')
  const rebasing = applyRoutineEdits([{ ...sent, _ts: 2 }, routine('a', 'Second')], [edit('a', routine('a', 'Mine'), { baseTs: 1, sent, t: 5 })])
  expect(rebasing.superseded).toEqual([{ rid: 'a', t: 5, kind: 'unsafe' }])
  expect(rebasing.rebased).toEqual([])
  expect(applyRoutineEdits(list, [edit('a', routine('a', 'First'), { baseTs: 0, t: 6 })]).done).toEqual([{ rid: 'a', t: 6 }])
})

test('a non-array routines reads as empty; nothing applying returns the input array itself', () => {
  expect(applyRoutineEdits(undefined, []).next).toEqual([])
  expect(applyRoutineEdits({}, [edit('a', routine('a', 'A'))]).superseded[0].kind).toBe('deleted')
  const list = [routine('a', 'A')]
  expect(applyRoutineEdits(list, []).next).toBe(list)
  expect(applyRoutineEdits(list, undefined).next).toBe(list)
})

// Routines as the web keeps them: slots in `ex`, each with its exercise id. The API puts back a
// slot key the phone's push lacks, pairing the slots as api/sync-stamps.js pairItems does
// (server-put-back.js); an edit it would change that way is held back as unsafe.
const heavy = { id: 'bench', sets: 3, reps: 5, pyramid: [{ w: 60, r: 8 }], stationId: 'rack-2' }
const backoff = { id: 'bench', sets: 3, reps: 10 }
const row = { id: 'row', sets: 3, reps: 8 }
const withEx = (ex, extra = {}) => ({ id: 'a', name: 'Push', ex, ...extra })
const swapTo = (slot, id) => {
  const { stationId, ...rest } = slot
  return { ...rest, id }
}

test('an edit the API would put keys back into is unsafe and is not in next: a twin swap, a cross-swap', () => {
  const twins = [withEx([heavy, backoff, row], { _ts: 3 })]
  const r = applyRoutineEdits(twins, [edit('a', withEx([backoff, heavy, row]), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ rid: 'a', t: 4, kind: 'unsafe' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(twins)
  // no exercise twice on either side: row becomes bench while bench becomes incline
  const plain = [withEx([heavy, row], { _ts: 3 })]
  const cross = applyRoutineEdits(plain, [edit('a', withEx([swapTo(heavy, 'incline'), swapTo(row, 'bench')]), { baseTs: 3, t: 5 })])
  expect(cross.superseded).toEqual([{ rid: 'a', t: 5, kind: 'unsafe' }])
  expect(cross.next).toBe(plain)
})

test('a sets-only edit in a routine holding the same exercise twice applies', () => {
  const list = [withEx([heavy, backoff, row], { _ts: 3 })]
  const mine = withEx([heavy, { ...backoff, sets: 4 }, row])
  const r = applyRoutineEdits(list, [edit('a', mine, { baseTs: 3, t: 4 })])
  expect(r.applied).toEqual([{ rid: 'a', t: 4 }])
  expect(r.next).toEqual([{ ...mine, _ts: 3 }])
})

test('edits the API stores as sent apply: a move with unique ids, a swap to a new exercise, prog and repsMin off, twins told apart only by edit fields', () => {
  const list = [withEx([{ ...heavy, prog: 'linear', repsMin: 4 }, row], { _ts: 3 })]
  for (const mine of [withEx([row, list[0].ex[0]]), withEx([list[0].ex[0], swapTo(row, 'pullup')]), withEx([heavy, row])]) {
    expect(applyRoutineEdits(list, [edit('a', mine, { baseTs: 3 })]).applied).toHaveLength(1)
  }
  const a = { id: 'bench', sets: 3, reps: 5 }
  const b = { id: 'bench', sets: 4, reps: 10 }
  expect(applyRoutineEdits([withEx([a, b], { _ts: 3 })], [edit('a', withEx([b, a]), { baseTs: 3 })]).applied).toHaveLength(1)
})

test('an unsafe edit already on the server is still done; a rebased one is unsafe against the copy it would go on', () => {
  const moved = withEx([backoff, heavy, row])
  const done = applyRoutineEdits([{ ...moved, _ts: 9 }], [edit('a', moved, { baseTs: 3 })])
  expect(done.done).toEqual([{ rid: 'a', t: 1 }])
  expect(done.superseded).toEqual([])
  const sent = withEx([heavy, { ...backoff, sets: 4 }, row])
  const rebasing = applyRoutineEdits([{ ...sent, _ts: 9 }], [edit('a', withEx([backoff, heavy, row]), { baseTs: 3, sent, t: 6 })])
  expect(rebasing.superseded).toEqual([{ rid: 'a', t: 6, kind: 'unsafe' }])
  expect(rebasing.rebased).toEqual([])
})

test('an edit that could not go anyway keeps its own kind: changed or deleted, not unsafe', () => {
  const moved = withEx([backoff, heavy, row])
  expect(applyRoutineEdits([withEx([heavy, backoff, row], { _ts: 8 })], [edit('a', moved, { baseTs: 3 })]).superseded[0].kind).toBe('changed')
  expect(applyRoutineEdits([], [edit('a', moved, { baseTs: 3 })]).superseded[0].kind).toBe('deleted')
})

// The API reads a routine's _f as the version its writer worked on (sync-stamps.js stampUnstamped):
// stale stamps on a rebased push could make it put the phone's earlier value back.
test('an applied routine goes in on the copy\'s _ts, _f and _u, each in its place, and the edit is not changed', () => {
  const copy = { ...routine('a', 'Old'), _ts: 3, _f: { name: 2 }, _u: { name: [1, 2, 3] } }
  const mine = { ...routine('a', 'Mine'), _ts: 1, _f: { slots: 1 } } // stamps of an older base
  const r = applyRoutineEdits([copy], [edit('a', mine, { baseTs: 3 })])
  expect(r.next[0]).toEqual({ ...routine('a', 'Mine'), _ts: 3, _f: { name: 2 }, _u: { name: [1, 2, 3] } })
  expect(Object.keys(r.next[0])).toEqual([...Object.keys(mine), '_u'])
  expect(mine).toEqual({ ...routine('a', 'Mine'), _ts: 1, _f: { slots: 1 } })
})

test('a stamp the copy lacks is taken off the routine that goes in', () => {
  const mine = { ...routine('a', 'Mine'), _ts: 1, _f: { slots: 1 }, _u: { name: [1, 2] } }
  const r = applyRoutineEdits([{ ...routine('a', 'Old'), _ts: 3 }], [edit('a', mine, { baseTs: 3 })])
  expect(r.next[0]).toEqual({ ...routine('a', 'Mine'), _ts: 3 })
  expect(Object.keys(r.next[0])).not.toContain('_f')
  const bare = applyRoutineEdits([routine('a', 'Old')], [edit('a', mine, { baseTs: null })])
  expect(bare.next[0]).toEqual(routine('a', 'Mine'))
})

test('a rebased routine goes in on the stamps of the phone\'s own landed push', () => {
  const sent = routine('a', 'Sent')
  const landed = { ...routine('a', 'Sent'), _ts: 12, _f: { name: 12 } }
  const newer = { ...routine('a', 'Newer'), _ts: 3 }
  const r = applyRoutineEdits([landed], [edit('a', newer, { baseTs: 3, sent, t: 8 })])
  expect(r.rebased).toEqual([{ rid: 'a', t: 8, baseTs: 12 }])
  expect(r.next[0]).toEqual({ ...routine('a', 'Newer'), _ts: 12, _f: { name: 12 } })
})
