import { expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
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
  // never over a typed set, acked or not
  await store.put(typed)
  const intruder = { d: typed.d, op: 'set', w: 150, t: 99, src: 'health', hk: 'x' }
  expect(await store.putFromHealth(intruder)).toEqual({ written: false })
  await store.markAcked([{ d: typed.d, t: typed.t }], 'at')
  expect(await store.putFromHealth(intruder)).toEqual({ written: false })
  expect(await store.get(typed.d)).toEqual(typed)
  // over a pending typed remove: keeps that remove's baseT
  await store.put(removal)
  const over = { d: removal.d, op: 'set', w: 160, t: 20, src: 'health', hk: 'y', baseT: 77 }
  expect(await store.putFromHealth(over)).toMatchObject({ written: true })
  expect(await store.get(removal.d)).toEqual({ ...over, baseT: 3 })
  expect((await store.listPending()).map(o => o.d)).toContain(removal.d)
  // over an acked typed remove: uses the op's own baseT
  await store.put({ d: '2026-01-09', op: 'remove', t: 7, baseT: 3 })
  await store.markAcked([{ d: '2026-01-09', t: 7 }], 'at')
  expect(await store.putFromHealth({ d: '2026-01-09', op: 'set', w: 160, t: 21, src: 'health', hk: 'z', baseT: 55 })).toMatchObject({ written: true })
  expect((await store.get('2026-01-09')).baseT).toBe(55)
  // a Health remove replaces too, and clears the ack
  await store.put({ d: '2026-01-10', op: 'set', w: 1, t: 1, src: 'health', hk: 'h' })
  await store.markAcked([{ d: '2026-01-10', t: 1 }], 'at')
  expect(await store.putFromHealth({ d: '2026-01-10', op: 'remove', t: 2, src: 'health' })).toMatchObject({ written: true })
  expect(await store.get('2026-01-10')).toEqual({ d: '2026-01-10', op: 'remove', t: 2, src: 'health' })
  expect((await store.listPending()).map(o => o.d)).toContain('2026-01-10')
}

async function healthEdges(store) {
  // a Health remove never replaces a pending typed remove (the owner's removal stays)
  await store.put(removal)
  expect(await store.putFromHealth({ d: removal.d, op: 'remove', t: 30, src: 'health' })).toEqual({ written: false })
  expect(await store.get(removal.d)).toEqual(removal)
  // but over an acked typed remove it writes
  await store.markAcked([{ d: removal.d, t: removal.t }], 'at')
  expect((await store.putFromHealth({ d: removal.d, op: 'remove', t: 30, src: 'health' })).written).toBe(true)
  // equal t, different content: the stored t moves up one and is returned
  await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 150, t: 50, src: 'health', hk: 'a' })
  await store.markAcked([{ d: '2026-03-01', t: 50 }], 'at')
  expect(await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 151, t: 50, src: 'health', hk: 'b' })).toEqual({ written: true, t: 51 })
  expect((await store.get('2026-03-01')).t).toBe(51)
  await store.markAcked([{ d: '2026-03-01', t: 50 }], 'late')
  expect((await store.listPending()).map(o => o.d)).toContain('2026-03-01')
  // identical content keeps t
  expect(await store.putFromHealth({ d: '2026-03-01', op: 'set', w: 151, t: 51, src: 'health', hk: 'b' })).toEqual({ written: true, t: 51 })
  // a Health set over a pending typed remove: bump compares the inherited baseT
  await store.put({ d: '2026-03-02', op: 'remove', t: 60, baseT: 3 })
  expect((await store.putFromHealth({ d: '2026-03-02', op: 'set', w: 1, t: 60, src: 'health', hk: 'c', baseT: 9 })).t).toBe(61)
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
