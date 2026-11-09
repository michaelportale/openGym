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
