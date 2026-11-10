import { expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { createMemoryWhoopCache, createSqliteWhoopCache } from './whoop-cache.js'

const payload = {
  configured: true, connected: true, fetchedAt: '2026-11-09T12:00:00.000Z', stale: false,
  days: [{ d: '2026-11-09', recovery: 67, hrv: 55.5, rhr: 52, calibrating: false, strain: 12.34 }, { d: '2026-11-08', recovery: null, hrv: null, rhr: null, calibrating: false, strain: null }],
  workouts: [{ d: '2026-11-09', sport: 'running', start: '2026-11-09T07:00:00.000Z', minutes: 60, strain: 8.1, avgHr: 140, kcal: 500 }],
}
const row = { server: 'https://gym.example.com', profile: 'Mo', savedAt: 1_700_000_000_000, payload }

async function roundTrip(cache) {
  expect(await cache.get()).toBeNull()
  await cache.put(row)
  expect(await cache.get()).toEqual(row)
  const next = { server: 'http://192.168.1.5:3000', profile: '', savedAt: 5, payload: { ...payload, stale: true } }
  await cache.put(next) // one row: a put replaces it
  expect(await cache.get()).toEqual(next)
  await cache.clear()
  expect(await cache.get()).toBeNull()
  await cache.clear()
  expect(await cache.get()).toBeNull()
}

test('memory: empty, round trip, replace and clear', async () => {
  await roundTrip(createMemoryWhoopCache())
})

test('memory hands out copies, so a caller cannot change what is kept', async () => {
  const cache = createMemoryWhoopCache()
  const mine = structuredClone(row)
  await cache.put(mine)
  mine.payload.days[0].recovery = 1
  const got = await cache.get()
  got.payload.workouts.length = 0
  expect(await cache.get()).toEqual(row)
})

test('sqlite: empty, round trip, replace and clear', async () => {
  await roundTrip(createSqliteWhoopCache(createNodeSqliteDb()))
})

test('sqlite: the payload is kept verbatim in its own one-row table, and survives a kill', async () => {
  let db = createNodeSqliteFileDb()
  await createSqliteWhoopCache(db).put(row)
  const raw = await db.getAll('SELECT id, server, profile, saved_at, body FROM whoop_cache')
  expect(raw).toEqual([{ id: 1, server: row.server, profile: 'Mo', saved_at: row.savedAt, body: JSON.stringify(payload) }])
  const before = db.executed
  db = db.reopen()
  expect(await createSqliteWhoopCache(db).get()).toEqual(row)
  // Not in sync_meta: that table is the sync engine's, and Forget clears it.
  expect([...before, ...db.executed].some(sql => /sync_meta/.test(sql))).toBe(false)
})

test('sqlite: a corrupt body reads as nothing cached, not a throw', async () => {
  const db = createNodeSqliteDb()
  const cache = createSqliteWhoopCache(db)
  await cache.put(row)
  await db.run('UPDATE whoop_cache SET body = ?', ['{not json'])
  expect(await cache.get()).toBeNull()
})

test('sqlite: a failed schema run is tried again on the next call', async () => {
  const db = createNodeSqliteDb()
  const cache = createSqliteWhoopCache(db)
  db.failNext(/CREATE TABLE IF NOT EXISTS whoop_cache/, new Error('disk'))
  await expect(cache.get()).rejects.toThrow('disk')
  await cache.put(row)
  expect(await cache.get()).toEqual(row)
})
