import { expect, test } from 'vitest'
import { SQLITE_DRIVERS, createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { buildPush } from './outbox.js'
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

  const value = { state, rev: 7, wid: 'wid-9' }
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

test.each(SQLITE_DRIVERS)('%s: put, get, then buildPush keeps everything but workouts', async (_n, createDb) => {
  const doc = {
    ...state,
    deleted: { workouts: ['gone'] },
    edited: { w1: { at: 5 } },
    _wid: 'wid-9',
    _wids: ['wid-9', 'wid-8'],
  }
  const copy = createSqliteServerCopy(createDb())
  await copy.put({ state: doc, rev: 7, wid: 'wid-9' })
  const got = await copy.get()
  const push = buildPush(got, [{ id: 'new', d: '2026-11-09' }])
  const { workouts, ...rest } = push.state
  const { workouts: original, ...restOriginal } = doc
  expect(rest).toEqual(restOriginal)
  expect(workouts).toEqual([...original, { id: 'new', d: '2026-11-09' }])
  expect(push.baseRev).toBe(7)
  expect(push.baseWid).toBe('wid-9')
})

test.each(SQLITE_DRIVERS)('%s: key() is the rev and wid alone, read without the body', async (_n, createDb) => {
  const db = createDb()
  const copy = createSqliteServerCopy(db)
  expect(await copy.key()).toBeNull()
  await copy.put({ state, rev: 7, wid: 'wid-9' })
  expect(await copy.key()).toEqual({ rev: 7, wid: 'wid-9' })
  await copy.put({ state, rev: 8, wid: null })
  expect(await copy.key()).toEqual({ rev: 8, wid: null })
  await copy.clear()
  expect(await copy.key()).toBeNull()
})

test('key() never parses the body: a corrupt one still has its key', async () => {
  const db = createNodeSqliteDb()
  const copy = createSqliteServerCopy(db)
  await copy.put({ state, rev: 7, wid: 'wid-9' })
  await db.run('UPDATE server_copy SET body = ?', ['{not json'])
  expect(await copy.key()).toEqual({ rev: 7, wid: 'wid-9' })
  await expect(copy.get()).rejects.toThrow()
})
