import { expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'

const state = {
  unit: 'lb',
  futureFeature: { a: [1, 2, { b: null }] },
  workouts: [{ id: 'w1', d: '2026-11-01', entries: [{ id: 'bench', sets: [{ w: 1, r: 2, type: 'someNewType' }] }] }],
  _rev: 7,
}

test.each(SQLITE_DRIVERS)('%s: the server copy is empty, round-trips verbatim and survives a kill', async (_n, createDb) => {
  let db = createDb()
  const copy = createSqliteServerCopy(db)
  expect(await copy.get()).toBeNull()

  const value = { state, rev: 7, wid: 'wid-9', pulledAt: '2026-11-09T10:00:00.000Z' }
  await copy.put(value)
  expect(await copy.get()).toEqual(value)
  const raw = await db.getAll('SELECT body FROM server_copy')
  expect(raw[0].body).toBe(JSON.stringify(state))

  const next = { ...value, state: { ...state, unit: 'kg' }, rev: 8 }
  await copy.put(next)
  db = db.reopen()
  expect(await createSqliteServerCopy(db).get()).toEqual(next)

  await createSqliteServerCopy(db).clear()
  expect(await createSqliteServerCopy(db).get()).toBeNull()
})

test.each(SQLITE_DRIVERS)('%s: sync_meta stores, replaces and clears keys', async (_n, createDb) => {
  let db = createDb()
  const meta = createSqliteSyncMeta(db)
  expect(await meta.get('server')).toBeNull()
  await meta.set('server', 'http://192.168.1.5:3000')
  await meta.set('profile', 'owner')
  await meta.set('server', 'http://10.0.0.2:3000')
  db = db.reopen()
  const again = createSqliteSyncMeta(db)
  expect(await again.get('server')).toBe('http://10.0.0.2:3000')
  expect(await again.get('profile')).toBe('owner')
  await again.clear()
  expect(await again.get('server')).toBeNull()
  expect(await again.get('profile')).toBeNull()
})
