import { expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { applyMeasurementOps } from './measurement-ops.js'
import { createMemoryMeasurements, createSqliteMeasurements } from './measurement-store.js'

// A whole entry as a log writes it: cm values that are not round in inches, nulls, a custom field
// and a key this app does not know.
const logged = { d: '2026-01-02', t: 10, waist: 81.28, chest: 101.6, neck: null, hips: 99.06, other: [{ id: 'c1', name: 'Calf', value: 38.1 }], futureKey: { nested: [1, 'x'] } }
const typed = { d: '2026-01-02', op: 'set', entry: logged, t: 10 }
const earlier = { d: '2026-01-01', op: 'set', entry: { d: '2026-01-01', t: 5, waist: 82 }, t: 5 }
const removal = { d: '2026-01-03', op: 'remove', t: 7, baseT: 3 }

const both = [
  ['memory', () => createMemoryMeasurements()],
  ['real sqlite', () => createSqliteMeasurements(createNodeSqliteDb())],
]

async function roundTrip(store) {
  expect(await store.list()).toEqual([])
  expect(await store.get('2026-01-01')).toBeNull()
  expect(await store.put(typed)).toEqual({ ok: true, d: typed.d, t: 10 })
  await store.put(earlier)
  await store.put(removal)
  expect(await store.list()).toEqual([earlier, typed, removal])
  expect(await store.get('2026-01-03')).toEqual(removal)
  expect(await store.listPending()).toEqual([earlier, typed, removal])
  // the entry comes back byte for byte
  expect(JSON.stringify((await store.get(typed.d)).entry)).toBe(JSON.stringify(logged))

  // one row per day: put replaces and clears the ack
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at1')
  expect((await store.listPending()).map(o => o.d)).toEqual(['2026-01-01', '2026-01-03'])
  const newer = { ...typed, entry: { ...logged, waist: 80.01, t: 11 }, t: 11 }
  await store.put(newer)
  expect((await store.list()).filter(o => o.d === typed.d)).toEqual([newer])
  expect((await store.listPending()).map(o => o.d)).toContain(typed.d)
  // a remove replaces a set, and keeps no entry; the unacked set's t goes on in ownTs
  await store.put({ d: earlier.d, op: 'remove', t: 6, baseT: 5 })
  expect(await store.get(earlier.d)).toEqual({ d: earlier.d, op: 'remove', t: 6, baseT: 5, ownTs: [5] })

  // a stale ack does not settle a newer op
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at2')
  expect((await store.listPending()).map(o => o.d)).toContain(typed.d)
  await store.markAcked([{ d: typed.d, t: 11 }, { d: 'no-such-day', t: 1 }], 'at3')
  expect((await store.listPending()).map(o => o.d)).not.toContain(typed.d)

  await store.resetAcked()
  expect(await store.listPending()).toHaveLength(3)
}

async function validation(store) {
  for (const bad of [
    null, [], 'x',
    { ...typed, d: '' }, { ...typed, d: 5 },
    { ...typed, op: 'nope' },
    { ...typed, t: 'x' }, { ...typed, t: Infinity },
    { ...typed, baseT: 'x' }, { ...typed, baseT: Infinity },
    { ...typed, entry: undefined }, { ...typed, entry: null }, { ...typed, entry: [] }, { ...typed, entry: 'x' },
    { ...typed, entry: { ...logged, d: '2026-01-05' } }, // the entry is another day's
    { ...typed, entry: { ...logged, t: 9 } }, // the entry carries another time
    { ...removal, baseT: 'x' },
  ]) await expect(store.put(bad), JSON.stringify(bad)).rejects.toThrow()
  expect(await store.list()).toEqual([])
  // a remove's entry is not kept
  await store.put({ ...removal, entry: logged })
  expect(await store.get(removal.d)).toEqual(removal)
  // a set's baseT is kept, as a weigh-in's is
  await store.put({ ...typed, baseT: 4 })
  expect(await store.get(typed.d)).toEqual({ ...typed, baseT: 4 })
}

// Same t but different content: the stored t moves up one, in the op and its entry, so an older
// ack keyed on { d, t } cannot settle the new content.
async function sameTime(store) {
  await store.put(typed)
  await store.put(structuredClone(typed))
  expect((await store.get(typed.d)).t).toBe(10)
  // the same entry with its keys in another order is the same content
  expect(await store.put({ ...typed, entry: Object.fromEntries(Object.entries(logged).reverse()) })).toMatchObject({ t: 10 })
  expect(await store.put({ ...typed, entry: { ...logged, waist: 79.5 } })).toEqual({ ok: true, d: typed.d, t: 11 })
  expect(await store.get(typed.d)).toEqual({ ...typed, entry: { ...logged, waist: 79.5, t: 11 }, t: 11, ownTs: [10] })
  await store.markAcked([{ d: typed.d, t: 10 }], 'at')
  expect((await store.listPending()).map(o => o.d)).toEqual([typed.d])
  // a remove over a set of the same t moves up too
  expect(await store.put({ d: typed.d, op: 'remove', t: 11, baseT: 3 })).toMatchObject({ t: 12 })
  // and what is stored still applies as one consistent op
  await store.put({ ...typed, entry: { ...logged, t: 12 }, t: 12 })
  const [op] = await store.listPending()
  expect(op.t).toBe(13)
  expect(op.entry.t).toBe(13)
  expect(applyMeasurementOps([], [op]).next).toEqual([{ ...logged, t: 13 }])
}

// Fix round 1: ownTs, the t of every set this phone wrote for the day since its row was last acked.
// The store keeps it; a caller never passes it.
async function ownTimes(store) {
  const day = '2026-02-01'
  const s = (t, fields = {}) => ({ d: day, op: 'set', entry: { d: day, t, waist: 80, ...fields }, t })
  await store.put({ ...s(10), ownTs: [99] }) // the caller's is never taken
  expect(await store.get(day)).toEqual(s(10))
  // set -> set -> remove while unacked: each set's t accumulates
  await store.put(s(20, { waist: 79 }))
  expect(await store.get(day)).toEqual({ ...s(20, { waist: 79 }), ownTs: [10] })
  await store.put({ d: day, op: 'remove', t: 30, baseT: 5 })
  expect(await store.get(day)).toEqual({ d: day, op: 'remove', t: 30, baseT: 5, ownTs: [10, 20] })
  expect(await store.listPending()).toEqual([{ d: day, op: 'remove', t: 30, baseT: 5, ownTs: [10, 20] }])
  // a set over the unacked remove carries them on (the remove itself set nothing)
  await store.put(s(40))
  expect((await store.get(day)).ownTs).toEqual([10, 20])
  await store.put({ d: day, op: 'remove', t: 50 })
  expect(await store.get(day)).toEqual({ d: day, op: 'remove', t: 50, ownTs: [10, 20, 40] })
  // a same-t rewrite of new content records the old t once
  await store.put(s(60))
  await store.put(s(60, { waist: 70 }))
  expect(await store.get(day)).toEqual({ d: day, op: 'set', entry: { d: day, t: 61, waist: 70 }, t: 61, ownTs: [10, 20, 40, 60] })
  // after an ack, the next put starts with none
  await store.markAcked([{ d: day, t: 61 }], 'at')
  await store.put({ d: day, op: 'remove', t: 70, baseT: 61 })
  expect(await store.get(day)).toEqual({ d: day, op: 'remove', t: 70, baseT: 61 })
  await store.markAcked([{ d: day, t: 70 }], 'at')
  await store.put(s(80))
  expect(await store.get(day)).toEqual(s(80))

  // pair, forget and resendAll (resetAcked) keep it; a row pending again is replaced as unacked
  const other = '2026-02-02'
  const o = (t, fields = {}) => ({ d: other, op: 'set', entry: { d: other, t, waist: 81, ...fields }, t })
  await store.put(o(10))
  await store.put(o(20, { waist: 82 }))
  await store.markAcked([{ d: other, t: 20 }], 'at')
  await store.resetAcked()
  expect(await store.get(other)).toEqual({ ...o(20, { waist: 82 }), ownTs: [10] })
  await store.put({ d: other, op: 'remove', t: 30 })
  expect(await store.get(other)).toEqual({ d: other, op: 'remove', t: 30, ownTs: [10, 20] })
}

for (const [name, make] of both) {
  test(`${name}: ownTs gathers the phone's own set times until an ack, and resetAcked keeps it`, async () => { await ownTimes(make()) })
  test(`${name}: round trips, replaces per day and ignores a stale ack`, async () => { await roundTrip(make()) })
  test(`${name}: rejects bad ops`, async () => { await validation(make()) })
  test(`${name}: a same-t put of new content moves t up in the op and its entry`, async () => { await sameTime(make()) })
}

test('memory store hands out copies and keeps none of the caller\'s objects', async () => {
  const store = createMemoryMeasurements()
  const mine = structuredClone(typed)
  await store.put(mine)
  mine.entry.waist = 1
  mine.entry.other[0].value = 2
  ;(await store.get(typed.d)).entry.waist = 3
  ;(await store.list())[0].entry.other[0].value = 4
  ;(await store.listPending())[0].entry.chest = 5
  expect(await store.get(typed.d)).toEqual(typed)
})

test('real sqlite: survives a reopen, with the entry byte for byte', async () => {
  let db = createNodeSqliteFileDb()
  await roundTrip(createSqliteMeasurements(db))
  db = db.reopen()
  const again = createSqliteMeasurements(db)
  expect(await again.get('2026-01-03')).toEqual(removal)
  expect(await again.get('2026-01-01')).toEqual({ d: '2026-01-01', op: 'remove', t: 6, baseT: 5, ownTs: [5] })
  expect(JSON.stringify((await again.get(typed.d)).entry)).toBe(JSON.stringify({ ...logged, waist: 80.01, t: 11 }))
})

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteMeasurements(db), createSqliteMeasurements(db)]
  await Promise.all(stores.map(s => s.list()))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS measurement_ops/.test(sql))).toHaveLength(1)
  await stores[1].put(typed)
  expect(await stores[0].list()).toEqual([typed])
})

test('the SQLite store needs a db handle', () => {
  expect(() => createSqliteMeasurements({})).toThrow(/db handle/)
})
