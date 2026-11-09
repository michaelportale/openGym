import { expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { applyDayOps } from './day-ops.js'
import { createMemoryWeighIns, createSqliteWeighIns } from './weigh-ins.js'

const typed = { d: '2026-01-02', op: 'set', w: 180.5, t: 10 }
const imported = { d: '2026-01-01', op: 'set', w: 181, t: 5, src: 'health', hk: 'uuid-1' }
const removal = { d: '2026-01-03', op: 'remove', t: 7, baseT: 3 }

async function roundTrip(store) {
  expect(await store.list()).toEqual([])
  expect(await store.get('2026-01-01')).toBeNull()
  await store.put(typed)
  await store.put(imported)
  await store.put(removal)
  expect(await store.list()).toEqual([imported, typed, removal])
  expect(await store.get('2026-01-03')).toEqual(removal)
  expect(await store.listPending()).toEqual([imported, typed, removal])

  // one row per day: put replaces and clears the ack
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at1')
  expect((await store.listPending()).map(o => o.d)).toEqual(['2026-01-01', '2026-01-03'])
  const newer = { ...typed, w: 179, t: 11 }
  await store.put(newer)
  expect((await store.list()).filter(o => o.d === typed.d)).toEqual([newer])
  expect((await store.listPending()).map(o => o.d)).toContain(typed.d)

  // a stale ack does not settle a newer op
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at2')
  expect((await store.listPending()).map(o => o.d)).toContain(typed.d)
  await store.markAcked([{ d: typed.d, t: 11 }, { d: 'no-such-day', t: 1 }], 'at3')
  expect((await store.listPending()).map(o => o.d)).not.toContain(typed.d)

  await store.resetAcked()
  expect(await store.listPending()).toHaveLength(3)
}

async function validation(store) {
  await expect(store.put({ ...typed, src: 'scale' })).rejects.toThrow()
  await expect(store.put({ ...typed, baseT: 'x' })).rejects.toThrow()
  await expect(store.put({ ...typed, baseT: Infinity })).rejects.toThrow()
  await expect(store.put({ ...typed, w: 0 })).rejects.toThrow()
  await expect(store.put({ ...typed, w: -3 })).rejects.toThrow()
  await expect(store.put({ ...typed, src: 'health', hk: 'u', baseT: 4 })).resolves.toBeTruthy()
  await expect(store.putFromHealth(typed)).rejects.toThrow()
  await expect(store.putFromHealth({ ...imported, w: 0 })).rejects.toThrow()
}

// Same t, different content: the stored t moves up one so an older ack cannot settle it.
async function sameTime(store) {
  await store.put(typed)
  await store.put({ ...typed })
  expect((await store.get(typed.d)).t).toBe(10)
  await store.put({ ...typed, w: 175 })
  expect(await store.get(typed.d)).toEqual({ ...typed, w: 175, t: 11 })
  await store.markAcked([{ d: typed.d, t: 10 }], 'at')
  expect((await store.listPending()).map(o => o.d)).toEqual([typed.d])
}

async function fromHealth(store) {
  // empty day
  expect(await store.putFromHealth(imported)).toMatchObject({ written: true })
  expect(await store.get(imported.d)).toEqual(imported)
  // over an acked or pending Health set
  await store.markAcked([{ d: imported.d, t: 5 }], 'at')
  const newer = { ...imported, w: 180, t: 6, hk: 'uuid-2' }
  expect(await store.putFromHealth(newer)).toMatchObject({ written: true })
  expect(await store.listPending()).toEqual([newer])
  // never over a pending typed set (the owner's unsent weight)
  await store.put(typed)
  const intruder = { d: typed.d, op: 'set', w: 150, t: 99, src: 'health', hk: 'x' }
  expect(await store.putFromHealth(intruder)).toEqual({ written: false })
  expect(await store.get(typed.d)).toEqual(typed)
  // over an acked one it writes (m2): the push guard keeps a typed entry the server still holds
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at')
  expect(await store.putFromHealth(intruder)).toEqual({ written: true, t: 99 })
  expect(await store.get(typed.d)).toEqual(intruder)
  expect((await store.listPending()).map(o => o.d)).toContain(typed.d)
  // over a pending typed remove: an op with no baseT keeps that remove's; the op's own baseT
  // (the server copy's entry the import saw) wins
  await store.put(removal)
  const over = { d: removal.d, op: 'set', w: 160, t: 20, src: 'health', hk: 'y' }
  expect(await store.putFromHealth(over)).toMatchObject({ written: true })
  expect(await store.get(removal.d)).toEqual({ ...over, baseT: 3 })
  expect((await store.listPending()).map(o => o.d)).toContain(removal.d)
  await store.put(removal)
  expect(await store.putFromHealth({ ...over, baseT: 77 })).toMatchObject({ written: true })
  expect(await store.get(removal.d)).toEqual({ ...over, baseT: 77 })
  // over an acked typed remove: the op's own baseT, or none
  await store.put({ d: '2026-01-09', op: 'remove', t: 7, baseT: 3 })
  await store.markAcked([{ d: '2026-01-09', t: 7 }], 'at')
  expect(await store.putFromHealth({ d: '2026-01-09', op: 'set', w: 160, t: 21, src: 'health', hk: 'z', baseT: 55 })).toMatchObject({ written: true })
  expect((await store.get('2026-01-09')).baseT).toBe(55)
  await store.put({ d: '2026-01-11', op: 'remove', t: 7, baseT: 3 })
  await store.markAcked([{ d: '2026-01-11', t: 7 }], 'at')
  await store.putFromHealth({ d: '2026-01-11', op: 'set', w: 160, t: 21, src: 'health', hk: 'z' })
  expect(await store.get('2026-01-11')).toEqual({ d: '2026-01-11', op: 'set', w: 160, t: 21, src: 'health', hk: 'z' })
  // a Health remove replaces too, and clears the ack
  await store.put({ d: '2026-01-10', op: 'set', w: 1, t: 1, src: 'health', hk: 'h' })
  await store.markAcked([{ d: '2026-01-10', t: 1 }], 'at')
  expect(await store.putFromHealth({ d: '2026-01-10', op: 'remove', t: 2, src: 'health' })).toMatchObject({ written: true })
  expect(await store.get('2026-01-10')).toEqual({ d: '2026-01-10', op: 'remove', t: 2, src: 'health' })
  expect((await store.listPending()).map(o => o.d)).toContain('2026-01-10')
}

async function healthEdges(store) {
  // a Health remove over a pending typed remove carries the owner's removal on (its baseT)
  await store.put(removal)
  expect(await store.putFromHealth({ d: removal.d, op: 'remove', t: 30, src: 'health' })).toEqual({ written: true, t: 30 })
  expect(await store.get(removal.d)).toEqual({ d: removal.d, op: 'remove', t: 30, src: 'health', baseT: 3 })
  // over an acked typed remove it writes as it is
  await store.put(removal)
  await store.markAcked([{ d: removal.d, t: removal.t }], 'at')
  expect((await store.putFromHealth({ d: removal.d, op: 'remove', t: 30, src: 'health' })).written).toBe(true)
  expect(await store.get(removal.d)).toEqual({ d: removal.d, op: 'remove', t: 30, src: 'health' })
  // equal t, different content: the stored t moves up one and is returned
  await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 150, t: 50, src: 'health', hk: 'a' })
  await store.markAcked([{ d: '2026-03-01', t: 50 }], 'at')
  expect(await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 151, t: 50, src: 'health', hk: 'b' })).toEqual({ written: true, t: 51 })
  expect((await store.get('2026-03-01')).t).toBe(51)
  await store.markAcked([{ d: '2026-03-01', t: 50 }], 'late')
  expect((await store.listPending()).map(o => o.d)).toContain('2026-03-01')
  // identical content keeps t
  expect(await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 151, t: 51, src: 'health', hk: 'b' })).toEqual({ written: true, t: 51 })
  // a Health set over a pending typed remove at the same t: the op changed, so t moves up
  await store.put({ d: '2026-03-02', op: 'remove', t: 60, baseT: 3 })
  expect((await store.putFromHealth({ d: '2026-03-02', op: 'set', w: 1, t: 60, src: 'health', hk: 'c', baseT: 9 })).t).toBe(61)
  // the bump compares the inherited baseT: the same op with no baseT over its pending self is identical
  await store.putFromHealth({ d: '2026-03-03', op: 'set', w: 1, t: 70, src: 'health', hk: 'c', baseT: 3 })
  expect(await store.putFromHealth({ d: '2026-03-03', op: 'set', w: 1, t: 70, src: 'health', hk: 'c' })).toEqual({ written: true, t: 70 })
  expect(await store.putFromHealth({ d: '2026-03-03', op: 'set', w: 1, t: 70, src: 'health', hk: 'c', baseT: 4 })).toEqual({ written: true, t: 71 })
}

// I1: the owner's typed removal of a synced weight is unsent; Health changes for that day land
// before the push. Every Health op keeps naming the removed entry, so the push still removes it.
async function typedRemovalThenHealth(make) {
  const D = '2026-11-09'
  const T1 = 1000 // the typed weight, synced
  const synced = async () => {
    const s = make()
    await s.put({ d: D, op: 'set', w: 182.4, t: T1 })
    await s.markAcked([{ d: D, t: T1 }], 'a')
    await s.put({ d: D, op: 'remove', t: 2000, baseT: T1 })
    await s.putFromHealth({ d: D, op: 'set', w: 185, t: 3000, src: 'health', hk: 'X' })
    return s
  }
  const copy = [{ d: D, w: 182.4, t: T1 }]
  // a second reading
  const a = await synced()
  await a.putFromHealth({ d: D, op: 'set', w: 186, t: 4000, src: 'health', hk: 'Y' })
  expect(await a.get(D)).toEqual({ d: D, op: 'set', w: 186, t: 4000, src: 'health', hk: 'Y', baseT: T1 })
  expect(applyDayOps(copy, await a.listPending(), {}).next).toEqual([{ d: D, w: 186, t: 4000, src: 'health', hk: 'Y' }])
  // the reading deleted in Health
  const b = await synced()
  await b.putFromHealth({ d: D, op: 'remove', t: 4000, src: 'health' })
  expect(await b.get(D)).toEqual({ d: D, op: 'remove', t: 4000, src: 'health', baseT: T1 })
  expect(applyDayOps(copy, await b.listPending(), {})).toMatchObject({ next: [], applied: [{ d: D, t: 4000 }] })
}

test('memory store: validation, same-t puts and putFromHealth', async () => {
  await validation(createMemoryWeighIns())
  await sameTime(createMemoryWeighIns())
  await fromHealth(createMemoryWeighIns())
  await healthEdges(createMemoryWeighIns())
})

test('real sqlite: validation, same-t puts and putFromHealth', async () => {
  await validation(createSqliteWeighIns(createNodeSqliteDb()))
  await sameTime(createSqliteWeighIns(createNodeSqliteDb()))
  await fromHealth(createSqliteWeighIns(createNodeSqliteDb()))
  await healthEdges(createSqliteWeighIns(createNodeSqliteDb()))
})

test('I1, memory and real sqlite: Health changes after an unsent typed removal still remove the typed weight', async () => {
  await typedRemovalThenHealth(() => createMemoryWeighIns())
  await typedRemovalThenHealth(() => createSqliteWeighIns(createNodeSqliteDb()))
})

test('memory store round trips, replaces per day and ignores a stale ack', async () => {
  await roundTrip(createMemoryWeighIns())
})

test('memory store hands out copies and rejects bad ops', async () => {
  const store = createMemoryWeighIns()
  await store.put(typed)
  ;(await store.get(typed.d)).w = 1
  expect((await store.get(typed.d)).w).toBe(180.5)
  await expect(store.put({ ...typed, op: 'nope' })).rejects.toThrow()
  await expect(store.put({ ...typed, w: undefined })).rejects.toThrow()
})

test('real sqlite: round trips and survives a reopen with null columns left out', async () => {
  let db = createNodeSqliteFileDb()
  await roundTrip(createSqliteWeighIns(db))
  await createSqliteWeighIns(db).put({ d: '2026-02-01', op: 'set', w: 170, t: 1, src: null, hk: null, baseT: null })
  db = db.reopen()
  const again = createSqliteWeighIns(db)
  expect(await again.get('2026-02-01')).toEqual({ d: '2026-02-01', op: 'set', w: 170, t: 1 })
  expect(await again.get('2026-01-03')).toEqual(removal)
  expect(await again.get('2026-01-01')).toEqual(imported)
})

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteWeighIns(db), createSqliteWeighIns(db)]
  await Promise.all(stores.map(s => s.list()))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS weigh_ins/.test(sql))).toHaveLength(1)
  await stores[1].put(typed)
  expect(await stores[0].list()).toEqual([typed])
})
