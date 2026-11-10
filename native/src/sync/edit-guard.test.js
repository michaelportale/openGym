import { expect, test } from 'vitest'
import { ROUTINE_DELETED, applyEdits, entryValue, isRoutineDeleted, routineContent, sameRoutine, stampOf } from './edit-guard.js'

// The routine edits among `edits` over a routines list (a non-array reads as empty), in 7C's shape:
// { next, done, rebased, applied, superseded }, next being the list itself when nothing applies or
// rebases. Production takes every kind through applyEdits; the routine guard tests read the
// routine rules through this.
function applyRoutineEdits(routines, edits) {
  const list = Array.isArray(routines) ? routines : []
  const mine = (Array.isArray(edits) ? edits : []).filter((e) => e?.kind === 'routine')
  const { state, ...settled } = applyEdits({ routines: list }, mine)
  return { next: state.routines, ...settled }
}

const routine = (id, name, extra = {}) => ({ id, name, slots: [{ ex: 'bench', sets: 3 }], ...extra })
const edit = (rid, routineValue, extra = {}) => ({ kind: 'routine', key: rid, baseTs: null, value: routineValue, sent: null, t: 1, ...extra })

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
  expect(r.done).toEqual([{ kind: 'routine', key: 'a', t: 7 }])
  expect(r.applied).toEqual([])
  expect(r.next).toEqual([copy])
  expect(r.next[0]).toBe(copy)
})

test('an edit on the base it saw applies and replaces the routine at its index', () => {
  const other = routine('b', 'B')
  const list = [other, routine('a', 'Old', { _ts: 3 })]
  const mine = routine('a', 'Mine')
  const r = applyRoutineEdits(list, [edit('a', mine, { baseTs: 3, t: 4 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 4 }])
  expect(r.next).toEqual([other, { ...mine, _ts: 3 }]) // on the copy's stamps
  expect(r.next[0]).toBe(other)
  expect(r.next).not.toBe(list)
  expect(list[1].name).toBe('Old')
})

test('a routine without _ts and baseTs null applies', () => {
  const r = applyRoutineEdits([routine('a', 'Old')], [edit('a', routine('a', 'Mine'))])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 1 }])
  expect(r.next[0].name).toBe('Mine')
})

test('a change on the web since the edit was based is superseded as changed', () => {
  const list = [routine('a', 'Web', { _ts: 8 })]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ kind: 'routine', key: 'a', t: 4, reason: 'changed' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(list)
})

test('a routine missing from the list is superseded as deleted and is not added', () => {
  const list = [routine('b', 'B')]
  const r = applyRoutineEdits(list, [edit('a', routine('a', 'Mine'), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ kind: 'routine', key: 'a', t: 4, reason: 'deleted' }])
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
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 5 }, { kind: 'routine', key: 'b', t: 6 }])
  expect(r.next.map((x) => x.name)).toEqual(['A2', 'B2'])
})

test('in flight: the copy equals what was sent while the routine is newer, so the edit is rebased onto it', () => {
  const sent = routine('a', 'Sent')
  const newer = routine('a', 'Newer')
  const copy = routine('a', 'Sent', { _ts: 12 })
  const r = applyRoutineEdits([copy], [edit('a', newer, { baseTs: 3, sent, t: 8 })])
  expect(r.rebased).toEqual([{ kind: 'routine', key: 'a', t: 8, baseTs: 12 }])
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
  expect(r.superseded).toEqual([{ kind: 'routine', key: 'a', t: 4, reason: 'unsafe' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(list)
  const sent = routine('a', 'Sent')
  const rebasing = applyRoutineEdits([{ ...sent, _ts: 2 }, routine('a', 'Second')], [edit('a', routine('a', 'Mine'), { baseTs: 1, sent, t: 5 })])
  expect(rebasing.superseded).toEqual([{ kind: 'routine', key: 'a', t: 5, reason: 'unsafe' }])
  expect(rebasing.rebased).toEqual([])
  expect(applyRoutineEdits(list, [edit('a', routine('a', 'First'), { baseTs: 0, t: 6 })]).done).toEqual([{ kind: 'routine', key: 'a', t: 6 }])
})

test('a non-array routines reads as empty; nothing applying returns the input array itself', () => {
  expect(applyRoutineEdits(undefined, []).next).toEqual([])
  expect(applyRoutineEdits({}, [edit('a', routine('a', 'A'))]).superseded[0].reason).toBe('deleted')
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
  expect(r.superseded).toEqual([{ kind: 'routine', key: 'a', t: 4, reason: 'unsafe' }])
  expect(r.applied).toEqual([])
  expect(r.next).toBe(twins)
  // no exercise twice on either side: row becomes bench while bench becomes incline
  const plain = [withEx([heavy, row], { _ts: 3 })]
  const cross = applyRoutineEdits(plain, [edit('a', withEx([swapTo(heavy, 'incline'), swapTo(row, 'bench')]), { baseTs: 3, t: 5 })])
  expect(cross.superseded).toEqual([{ kind: 'routine', key: 'a', t: 5, reason: 'unsafe' }])
  expect(cross.next).toBe(plain)
})

test('a sets-only edit in a routine holding the same exercise twice applies', () => {
  const list = [withEx([heavy, backoff, row], { _ts: 3 })]
  const mine = withEx([heavy, { ...backoff, sets: 4 }, row])
  const r = applyRoutineEdits(list, [edit('a', mine, { baseTs: 3, t: 4 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 4 }])
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
  expect(done.done).toEqual([{ kind: 'routine', key: 'a', t: 1 }])
  expect(done.superseded).toEqual([])
  const sent = withEx([heavy, { ...backoff, sets: 4 }, row])
  const rebasing = applyRoutineEdits([{ ...sent, _ts: 9 }], [edit('a', withEx([backoff, heavy, row]), { baseTs: 3, sent, t: 6 })])
  expect(rebasing.superseded).toEqual([{ kind: 'routine', key: 'a', t: 6, reason: 'unsafe' }])
  expect(rebasing.rebased).toEqual([])
})

test('an edit that could not go anyway keeps its own kind: changed or deleted, not unsafe', () => {
  const moved = withEx([backoff, heavy, row])
  expect(applyRoutineEdits([withEx([heavy, backoff, row], { _ts: 8 })], [edit('a', moved, { baseTs: 3 })]).superseded[0].reason).toBe('changed')
  expect(applyRoutineEdits([], [edit('a', moved, { baseTs: 3 })]).superseded[0].reason).toBe('deleted')
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
  expect(r.rebased).toEqual([{ kind: 'routine', key: 'a', t: 8, baseTs: 12 }])
  expect(r.next[0]).toEqual({ ...routine('a', 'Newer'), _ts: 12, _f: { name: 12 } })
})

// applyEdits: every kind over the whole document. A pending edit of any kind is the row
// pending-edits.js lists: { kind, key, baseTs, value, sent, t }.
const pending = (kind, key, value, extra = {}) => ({ kind, key, baseTs: null, value, sent: null, t: 1, ...extra })
const day = (kcal, extra = {}) => ({ kcal, protein: 160, carbs: 220, fat: 70, fiber: 30, dayType: 'training', ...extra })
const D = '2026-11-09'

test('applyEdits: a routine edit goes into routines; the other keys, and the input, are untouched', () => {
  const list = [routine('b', 'B'), routine('a', 'Old', { _ts: 3 })]
  const state = { unit: 'lb', routines: list, nutritionDays: { [D]: day(2000) } }
  const before = JSON.stringify(state)
  const r = applyEdits(state, [pending('routine', 'a', routine('a', 'Mine'), { baseTs: 3, t: 4 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 4 }])
  expect(r.state).toEqual({ ...state, routines: [list[0], { ...routine('a', 'Mine'), _ts: 3 }] })
  expect(r.state.routines[0]).toBe(list[0])
  expect(r.state.nutritionDays).toBe(state.nutritionDays)
  expect(JSON.stringify(state)).toBe(before)
  // nothing applying hands back the state itself
  expect(applyEdits(state, [pending('routine', 'a', routine('a', 'Web'), { baseTs: 1 })]).state).toBe(state)
  expect(applyEdits(state, []).state).toBe(state)
  expect(applyEdits(state, undefined).state).toBe(state)
})

test('nutritionDay: a day the copy already holds is done, and a _ts or key-order difference alone is the same day', () => {
  const state = { nutritionDays: { [D]: { ...day(2000), _ts: 9 } } }
  const r = applyEdits(state, [pending('nutritionDay', D, day(2000), { baseTs: 3, t: 7 })])
  expect(r.done).toEqual([{ kind: 'nutritionDay', key: D, t: 7 }])
  expect(r.state).toBe(state)
  const { kcal, ...rest } = day(2000)
  const reordered = { ...rest, kcal, _ts: 1 }
  expect(applyEdits(state, [pending('nutritionDay', D, reordered, { baseTs: 3 })]).done).toHaveLength(1)
  expect(applyEdits(state, [pending('nutritionDay', D, day(2001), { baseTs: 3 })]).done).toEqual([])
})

test('nutritionDay: a null base applies to a day the copy does not have, which goes in with no _ts', () => {
  const other = { ...day(1800), _ts: 5 }
  const state = { unit: 'lb', nutritionDays: { '2026-11-08': other } }
  const r = applyEdits(state, [pending('nutritionDay', D, day(2100), { t: 4 })])
  expect(r.applied).toEqual([{ kind: 'nutritionDay', key: D, t: 4 }])
  expect(r.state).toEqual({ unit: 'lb', nutritionDays: { '2026-11-08': other, [D]: day(2100) } })
  expect(r.state.nutritionDays['2026-11-08']).toBe(other)
  expect(state.nutritionDays[D]).toBeUndefined()
  // no nutritionDays at all, or not a map (the web's own withNutritionDay reads it as empty)
  expect(applyEdits({ unit: 'lb' }, [pending('nutritionDay', D, day(2100))]).state).toEqual({ unit: 'lb', nutritionDays: { [D]: day(2100) } })
  expect(applyEdits({ nutritionDays: [] }, [pending('nutritionDay', D, day(2100))]).state).toEqual({ nutritionDays: { [D]: day(2100) } })
})

test('nutritionDay: a day missing from the copy with a non-null base was changed, not deleted', () => {
  const state = { nutritionDays: {} }
  const r = applyEdits(state, [pending('nutritionDay', D, day(2100), { baseTs: 5, t: 4 })])
  expect(r.superseded).toEqual([{ kind: 'nutritionDay', key: D, t: 4, reason: 'changed' }])
  expect(r.state).toBe(state)
})

test('nutritionDay: an edit on the base it saw applies on the copy\'s _ts; a stale _ts on the edit is replaced, a missing one is not added', () => {
  const state = { nutritionDays: { [D]: { ...day(2000), _ts: 5 } } }
  const r = applyEdits(state, [pending('nutritionDay', D, { ...day(2200), _ts: 1 }, { baseTs: 5 })])
  expect(r.applied).toHaveLength(1)
  expect(r.state.nutritionDays[D]).toEqual({ ...day(2200), _ts: 5 })
  const bare = applyEdits({ nutritionDays: { [D]: day(2000) } }, [pending('nutritionDay', D, { ...day(2200), _ts: 1 })])
  expect(bare.applied).toHaveLength(1)
  expect(bare.state.nutritionDays[D]).toEqual(day(2200))
  // a cleared day is a value like any other: { supps } goes in, never a delete
  const cleared = applyEdits(state, [pending('nutritionDay', D, { supps: ['s1'] }, { baseTs: 5 })])
  expect(cleared.state.nutritionDays[D]).toEqual({ supps: ['s1'], _ts: 5 })
})

test('nutritionDay: the copy holding what this phone sent, with a newer day waiting, rebases it onto the landed _ts', () => {
  const state = { nutritionDays: { [D]: { ...day(2000), _ts: 12 } } }
  const r = applyEdits(state, [pending('nutritionDay', D, day(2300), { baseTs: 3, sent: day(2000), t: 8 })])
  expect(r.rebased).toEqual([{ kind: 'nutritionDay', key: D, t: 8, baseTs: 12 }])
  expect(r.applied).toEqual([])
  expect(r.state.nutritionDays[D]).toEqual({ ...day(2300), _ts: 12 })
})

test('nutritionDay: a day the web changed since the base is superseded as changed', () => {
  const state = { nutritionDays: { [D]: { ...day(1500), _ts: 8 } } }
  const r = applyEdits(state, [pending('nutritionDay', D, day(2100), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ kind: 'nutritionDay', key: D, t: 4, reason: 'changed' }])
  expect(r.state).toBe(state)
})

// A setting's stamp is the document's edited[key], not anything in the value.
const targets = (kcal = 2400) => ({ training: { kcal, protein: 170, fiber: 30 }, rest: { kcal: 2000, protein: 160, fiber: 30 } })

test('setting: a value the copy already holds is done, whatever the key order and the stamp', () => {
  const state = { nutritionTargets: targets(), edited: { nutritionTargets: 9 } }
  const { rest, training } = targets()
  const r = applyEdits(state, [pending('setting', 'nutritionTargets', { rest, training }, { baseTs: 3, t: 7 })])
  expect(r.done).toEqual([{ kind: 'setting', key: 'nutritionTargets', t: 7 }])
  expect(r.state).toBe(state)
})

test('setting: an edit on the stamp it saw applies, and only that key changes: edited is the server\'s to move', () => {
  const supps = [{ id: 's1', name: 'Creatine' }]
  const state = { unit: 'lb', nutritionTargets: targets(), supplements: supps, edited: { nutritionTargets: 5, unit: 1 } }
  const r = applyEdits(state, [pending('setting', 'nutritionTargets', targets(2600), { baseTs: 5, t: 4 })])
  expect(r.applied).toEqual([{ kind: 'setting', key: 'nutritionTargets', t: 4 }])
  expect(r.state).toEqual({ ...state, nutritionTargets: targets(2600) })
  expect(r.state.edited).toBe(state.edited)
  expect(r.state.supplements).toBe(supps)
})

test('setting: with no edited stamp, a null base applies, to a missing key too; a non-null base on a missing key was changed', () => {
  const supps = [{ id: 's1', name: 'Creatine' }]
  expect(applyEdits({ nutritionTargets: targets() }, [pending('setting', 'nutritionTargets', targets(2600))]).state).toEqual({ nutritionTargets: targets(2600) })
  const r = applyEdits({ unit: 'lb' }, [pending('setting', 'supplements', supps, { t: 2 })])
  expect(r.applied).toEqual([{ kind: 'setting', key: 'supplements', t: 2 }])
  expect(r.state).toEqual({ unit: 'lb', supplements: supps })
  const missing = { unit: 'lb' }
  const changed = applyEdits(missing, [pending('setting', 'supplements', supps, { baseTs: 4, t: 2 })])
  expect(changed.superseded).toEqual([{ kind: 'setting', key: 'supplements', t: 2, reason: 'changed' }])
  expect(changed.state).toBe(missing)
})

test('setting: the copy holding what this phone sent rebases the newer value onto edited[key]', () => {
  const state = { nutritionTargets: targets(2500), edited: { nutritionTargets: 12 } }
  const r = applyEdits(state, [pending('setting', 'nutritionTargets', targets(2600), { baseTs: 3, sent: targets(2500), t: 8 })])
  expect(r.rebased).toEqual([{ kind: 'setting', key: 'nutritionTargets', t: 8, baseTs: 12 }])
  expect(r.state.nutritionTargets).toEqual(targets(2600))
  expect(r.state.edited).toBe(state.edited)
})

test('setting: a value the web changed since the base is superseded as changed, by edited[key] alone', () => {
  const state = { nutritionTargets: targets(), edited: { nutritionTargets: 8 } }
  const r = applyEdits(state, [pending('setting', 'nutritionTargets', targets(2600), { baseTs: 3, t: 4 })])
  expect(r.superseded).toEqual([{ kind: 'setting', key: 'nutritionTargets', t: 4, reason: 'changed' }])
  expect(r.state).toBe(state)
  // another key's stamp, or none for this one, does not count against it
  expect(applyEdits({ nutritionTargets: targets(), edited: { supplements: 8 } }, [pending('setting', 'nutritionTargets', targets(2600))]).applied).toHaveLength(1)
})

test('mixed kinds in one call: each settles by its own rules, in order, and the state carries every one that goes', () => {
  const r1 = routine('r1', 'Push', { _ts: 3 })
  const d1 = { ...day(1800), _ts: 4 }
  const supps = [{ id: 's1', name: 'Creatine' }]
  const state = {
    unit: 'lb',
    routines: [r1],
    nutritionDays: { '2026-11-08': d1 },
    nutritionTargets: targets(),
    supplements: supps,
    edited: { nutritionTargets: 5, supplements: 6 },
  }
  const before = JSON.stringify(state)
  const r = applyEdits(state, [
    pending('routine', 'r1', routine('r1', 'Push day'), { baseTs: 3, t: 1 }),
    pending('nutritionDay', '2026-11-08', day(1900), { baseTs: 2, t: 2 }),
    pending('nutritionDay', D, day(2100), { t: 3 }),
    pending('setting', 'nutritionTargets', targets(), { baseTs: 1, t: 4 }),
    pending('setting', 'supplements', [...supps, { id: 's2', name: 'Fish oil' }], { baseTs: 1, sent: supps, t: 5 }),
    pending('workout', 'w1', { id: 'w1' }, { t: 6 }), // a kind the guard does not know is left alone
  ])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'r1', t: 1 }, { kind: 'nutritionDay', key: D, t: 3 }])
  expect(r.superseded).toEqual([{ kind: 'nutritionDay', key: '2026-11-08', t: 2, reason: 'changed' }])
  expect(r.done).toEqual([{ kind: 'setting', key: 'nutritionTargets', t: 4 }])
  expect(r.rebased).toEqual([{ kind: 'setting', key: 'supplements', t: 5, baseTs: 6 }])
  expect(r.state).toEqual({
    ...state,
    routines: [{ ...routine('r1', 'Push day'), _ts: 3 }],
    nutritionDays: { '2026-11-08': d1, [D]: day(2100) },
    supplements: [...supps, { id: 's2', name: 'Fish oil' }],
  })
  expect(r.state.nutritionDays['2026-11-08']).toBe(d1)
  expect(r.state.nutritionTargets).toBe(state.nutritionTargets)
  expect(JSON.stringify(state)).toBe(before)
})

test('unsafe is the routine\'s alone: applyRoutineEdits sees only routine edits', () => {
  const list = [routine('a', 'Old', { _ts: 3 })]
  const r = applyRoutineEdits(list, [pending('nutritionDay', 'a', day(2000)), pending('routine', 'a', routine('a', 'Mine'), { baseTs: 3 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 1 }])
  expect(r.next).toEqual([{ ...routine('a', 'Mine'), _ts: 3 }])
})

test('stampOf is the stamp the guard compares a base with, null when there is none', () => {
  const state = { routines: [{ id: 'r', _ts: 3 }, { id: 's' }], nutritionDays: { '2026-11-09': { kcal: 1, _ts: 7 }, '2026-11-08': { kcal: 1 } }, edited: { supplements: 9 } }
  expect(stampOf(state, 'routine', 'r')).toBe(3)
  expect(stampOf(state, 'routine', 's')).toBeNull()
  expect(stampOf(state, 'nutritionDay', '2026-11-09')).toBe(7)
  expect(stampOf(state, 'nutritionDay', '2026-11-08')).toBeNull()
  expect(stampOf(state, 'setting', 'supplements')).toBe(9)
  expect(stampOf(state, 'setting', 'nutritionTargets')).toBeNull()
  for (const junk of [undefined, null, [], 'x']) expect(stampOf(junk, 'nutritionDay', '2026-11-09')).toBeNull()
  expect(stampOf(state, 'nope', 'r')).toBeNull()
  // the same stamp the guard applies an edit on
  const edit = { kind: 'nutritionDay', key: '2026-11-09', baseTs: stampOf(state, 'nutritionDay', '2026-11-09'), value: { kcal: 2 }, sent: null, t: 1 }
  expect(applyEdits(state, [edit]).applied).toEqual([{ kind: 'nutritionDay', key: '2026-11-09', t: 1 }])
})

// Creating and deleting a routine (7E-A). A create is a routine row on base 0: it goes while the
// copy lacks the id and the server never deleted it ("tombstoned": deleted.routines or
// resetIds.routines holds it). A delete is a routine row holding ROUTINE_DELETED on the routine's
// _ts. One test per row of the behaviour table.
const verdictOf = (r) => {
  const kinds = ['applied', 'done', 'rebased'].filter((k) => r[k].length)
  return [...kinds, ...r.superseded.map((s) => `superseded ${s.reason}`)].join(', ')
}
const R = routine('a', 'Mine')
const doc = (routines, extra = {}) => ({ routines, ...extra })
const gone = { deleted: { routines: { a: 6 } } }
const wiped = { resetIds: { routines: ['a'] } }

test.each([
  ['an edit on the base it saw applies', edit('a', R, { baseTs: 5 }), doc([routine('a', 'Old', { _ts: 5 })]), 'applied'],
  ['an edit the copy already holds is done', edit('a', R, { baseTs: 5 }), doc([{ ...R, _ts: 9 }]), 'done'],
  ['an edit whose sent the copy holds is rebased', edit('a', R, { baseTs: 5, sent: routine('a', 'Sent') }), doc([routine('a', 'Sent', { _ts: 9 })]), 'rebased'],
  ['an edit over a web change is superseded as changed', edit('a', R, { baseTs: 5 }), doc([routine('a', 'Web', { _ts: 9 })]), 'superseded changed'],
  ['an edit of a routine the copy lacks is superseded as deleted', edit('a', R, { baseTs: 5 }), doc([]), 'superseded deleted'],
  ['an edit of a routine the server deleted is superseded as deleted', edit('a', R, { baseTs: 5 }), doc([], gone), 'superseded deleted'],
  ['a seed routine edit (base null) of a routine the server deleted is superseded as deleted', edit('a', R), doc([], gone), 'superseded deleted'],
  ['a create applies while the id is absent and never deleted', edit('a', R, { baseTs: 0 }), doc([routine('b', 'B', { _ts: 1 })]), 'applied'],
  ['a create of an id the server deleted is superseded as deleted', edit('a', R, { baseTs: 0 }), doc([], gone), 'superseded deleted'],
  ['a create of an id a reset wiped is superseded as deleted', edit('a', R, { baseTs: 0 }), doc([], wiped), 'superseded deleted'],
  ['a create the copy already holds is done', edit('a', R, { baseTs: 0 }), doc([{ ...R, _ts: 9 }]), 'done'],
  ['a create whose sent the copy holds is rebased', edit('a', routine('a', 'Newer'), { baseTs: 0, sent: R }), doc([{ ...R, _ts: 9 }]), 'rebased'],
  ['a create over another routine with that id is superseded as changed', edit('a', R, { baseTs: 0 }), doc([routine('a', 'Web', { _ts: 9 })]), 'superseded changed'],
  ['a delete of a routine the copy lacks is done', edit('a', ROUTINE_DELETED, { baseTs: 5 }), doc([]), 'done'],
  ['a delete of a routine the server deleted is done', edit('a', ROUTINE_DELETED, { baseTs: 5 }), doc([], gone), 'done'],
  ['a delete on the base it saw applies', edit('a', ROUTINE_DELETED, { baseTs: 5 }), doc([routine('a', 'Old', { _ts: 5 })]), 'applied'],
  ['a delete over a web change is superseded as changed', edit('a', ROUTINE_DELETED, { baseTs: 5 }), doc([routine('a', 'Web', { _ts: 7 })]), 'superseded changed'],
  ['a delete of a seed routine (base null, no _ts) applies', edit('a', ROUTINE_DELETED), doc([routine('a', 'Old')]), 'applied'],
  ['a create then a delete before any sync is done', edit('a', ROUTINE_DELETED, { baseTs: 0 }), doc([]), 'done'],
  ['a seed routine edit (base null) of a routine with no _ts applies', edit('a', R), doc([routine('a', 'Old')]), 'applied'],
])('%s', (_name, row, state, verdict) => {
  expect(verdictOf(applyEdits(state, [row]))).toBe(verdict)
})

test('a create goes in at the end of the list with its _ts, _f and _u taken off; the copy is not changed', () => {
  const list = [routine('b', 'B', { _ts: 1 }), null, 'x']
  const state = { unit: 'lb', routines: list }
  const before = JSON.stringify(state)
  // a copied routine carries its source's stamps (routines.js copyRoutine)
  const made = { ...routine('n', 'New'), _ts: 4, _f: { name: 4 }, _u: { name: [1] } }
  const r = applyEdits(state, [edit('n', made, { baseTs: 0, t: 3 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'n', t: 3 }])
  expect(r.state.routines).toEqual([...list, routine('n', 'New')])
  expect(r.state.routines[0]).toBe(list[0])
  expect(JSON.stringify(state)).toBe(before)
  expect(entryValue(r.state, 'routine', 'n')).toEqual(routine('n', 'New'))
  // a document with no routines yet starts the list
  expect(applyEdits({ unit: 'lb' }, [edit('n', made, { baseTs: 0 })]).state).toEqual({ unit: 'lb', routines: [routine('n', 'New')] })
})

test('a delete runs the shared deleteRoutine on a clone: the routine, its weekdays (an emptied one dropped) and its dayPlan pins go; the loop and the queue stay', () => {
  const state = {
    unit: 'lb',
    routines: [routine('a', 'Old', { _ts: 5 }), routine('b', 'B', { _ts: 2 })],
    week: { 1: ['a', 'b'], 3: ['a'], 5: 'b' },
    dayPlan: { '2026-11-12': 'a', '2026-11-13': 'b', '2026-11-14': 'rest' },
    rotation: { id: 'loop', sequence: ['a', 'b'] },
    queue: { ids: ['a', 'b'], since: '2026-11-01' },
  }
  const before = structuredClone(state)
  const r = applyEdits(state, [edit('a', ROUTINE_DELETED, { baseTs: 5, t: 2 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 2 }])
  expect(r.state).toEqual({
    ...before,
    routines: [before.routines[1]],
    week: { 1: ['b'], 5: 'b' },
    dayPlan: { '2026-11-13': 'b', '2026-11-14': 'rest' },
  })
  expect(state).toEqual(before)
  expect(entryValue(r.state, 'routine', 'a')).toBe(ROUTINE_DELETED)
})

test('a delete keeps every entry that is not a routine where it was', () => {
  const list = [null, routine('a', 'A', { _ts: 1 }), 'x', routine('b', 'B')]
  const r = applyEdits({ routines: list }, [edit('a', ROUTINE_DELETED, { baseTs: 1 })])
  expect(r.state.routines).toEqual([null, 'x', routine('b', 'B')])
})

// A delete takes a routine out of the list: a later edit in the same call must still land on its
// own routine, not on the one that moved into its place.
test('a delete, an edit and a create in one call each land on their own routine', () => {
  const state = { routines: [routine('a', 'A', { _ts: 1 }), routine('b', 'B', { _ts: 2 }), routine('c', 'C', { _ts: 3 })] }
  const r = applyEdits(state, [
    edit('a', ROUTINE_DELETED, { baseTs: 1, t: 1 }),
    edit('c', routine('c', 'C2'), { baseTs: 3, t: 2 }),
    edit('n', routine('n', 'N'), { baseTs: 0, t: 3 }),
  ])
  expect(r.applied.map((x) => x.key)).toEqual(['a', 'c', 'n'])
  expect(r.state.routines).toEqual([routine('b', 'B', { _ts: 2 }), routine('c', 'C2', { _ts: 3 }), routine('n', 'N')])
})

test('unsafe is false for a create and for a delete: a create of any routine goes, and a delete takes every copy of an id held twice', () => {
  const twinsFirst = withEx([backoff, heavy, row])
  expect(applyEdits({ routines: [] }, [edit('a', twinsFirst, { baseTs: 0 })]).applied).toHaveLength(1)
  const list = [routine('a', 'First', { _ts: 1 }), routine('b', 'B'), routine('a', 'Second', { _ts: 1 })]
  const r = applyEdits({ routines: list }, [edit('a', ROUTINE_DELETED, { baseTs: 1, t: 4 })])
  expect(r.applied).toEqual([{ kind: 'routine', key: 'a', t: 4 }])
  expect(r.state.routines).toEqual([routine('b', 'B')])
})

test('entryValue of a routine the document lacks is the marker, never undefined; stampOf it is 0, deleted on the server or not', () => {
  for (const state of [{ routines: [] }, {}, { routines: [], ...gone }, { routines: [], ...wiped }]) {
    expect(entryValue(state, 'routine', 'a')).toBe(ROUTINE_DELETED)
    expect(stampOf(state, 'routine', 'a')).toBe(0)
  }
  expect(entryValue({ routines: [R] }, 'routine', 'a')).toBe(R)
})

test('isRoutineDeleted knows the marker, and a copy of it read back from the store, and nothing else', () => {
  expect(isRoutineDeleted(ROUTINE_DELETED)).toBe(true)
  expect(isRoutineDeleted(JSON.parse(JSON.stringify(ROUTINE_DELETED)))).toBe(true)
  expect(Object.isFrozen(ROUTINE_DELETED)).toBe(true)
  for (const v of [R, { id: 'a', deleted: true }, { deleted: 'yes' }, [], null, undefined, true]) expect(isRoutineDeleted(v)).toBe(false)
})
