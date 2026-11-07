import { describe, expect, test } from 'vitest'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { SQLITE_SESSION_SCHEMA, createMemoryStorage } from './storage.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'

function event(id, at = 1) {
  return { id, type: 'set.commit', at, exerciseId: 'bench', setId: 'plan:bench:0', fields: { w: 60, r: 5 } }
}

function storageContract(title, open) {
  describe(title, () => {
    test('keeps insert order, ignores a duplicate id, and does not share returned rows', async () => {
      const { storage } = await open()
      expect(await storage.append(event('a', 1))).toMatchObject({ ok: true })
      expect(await storage.append(event('b', 2))).toMatchObject({ ok: true })
      expect(await storage.append({ ...event('a', 9), fields: { w: 1, r: 1 } })).toMatchObject({ duplicate: true })
      const rows = await storage.readAll()
      expect(rows.map(row => [row.id, row.at, row.fields.w])).toEqual([['a', 1, 60], ['b', 2, 60]])
      rows[0].fields.w = 999
      expect((await storage.readAll())[0].fields.w).toBe(60)
    })

    test('rejects an append with no id', async () => {
      const { storage } = await open()
      await expect(storage.append({ type: 'set.commit', at: 1 })).rejects.toThrow(/id/)
      expect(await storage.readAll()).toEqual([])
    })

    test('keeps drafts out of the event log', async () => {
      const { storage } = await open()
      const draft = { w: 70, r: 4 }
      await storage.putDraft('plan:bench:0', draft)
      draft.w = 1
      expect(await storage.getDraft('plan:bench:0')).toEqual({ w: 70, r: 4 })
      expect(await storage.readDrafts()).toEqual({ 'plan:bench:0': { w: 70, r: 4 } })
      expect(await storage.getDraft('missing')).toBeNull()
      await storage.putDraft('plan:bench:0', null)
      expect(await storage.getDraft('plan:bench:0')).toBeNull()
      expect(await storage.readDrafts()).toEqual({})
      expect(await storage.readAll()).toEqual([])
    })

    test('stores one base snapshot', async () => {
      const { storage } = await open()
      const base = { id: 'w1', entries: [] }
      await storage.writeBase(base)
      base.id = 'changed'
      expect(await storage.readBase()).toEqual({ id: 'w1', entries: [] })
      await storage.writeBase(null)
      expect(await storage.readBase()).toBeNull()
    })

    test('clear drops events, drafts, and the base together', async () => {
      const { storage } = await open()
      await storage.append(event('a', 1))
      await storage.putDraft('plan:bench:0', { r: 3 })
      await storage.writeBase({ id: 'w1' })
      await storage.clear()
      expect(await storage.readAll()).toEqual([])
      expect(await storage.readDrafts()).toEqual({})
      expect(await storage.readBase()).toBeNull()
    })

    test('a failed append throws and leaves the log unchanged', async () => {
      const { storage, failAppend } = await open()
      await storage.append(event('a', 1))
      failAppend(new Error('disk full'))
      await expect(storage.append(event('b', 2))).rejects.toThrow(/disk full/)
      expect((await storage.readAll()).map(row => row.id)).toEqual(['a'])
    })
  })
}

storageContract('memory storage', async () => {
  const storage = createMemoryStorage()
  return { storage, failAppend: error => storage.failAppends(error) }
})

storageContract('sqlite storage', async () => {
  const db = createFakeSqliteDb()
  const storage = createSqliteSessionStorage(db)
  return {
    storage,
    failAppend: error => db.failNext(/INSERT OR IGNORE INTO session_events/, error),
  }
})

test('sqlite clear is one transaction, so a failure partway through removes nothing', async () => {
  const db = createFakeSqliteDb()
  const storage = createSqliteSessionStorage(db)
  await storage.append(event('a', 1))
  await storage.putDraft('plan:bench:0', { r: 3 })
  await storage.writeBase({ id: 'w1', name: 'Push' })
  db.failNext(/^DELETE FROM session_drafts$/, new Error('locked'))
  await expect(storage.clear()).rejects.toThrow(/locked/)
  expect(db.executed.some(sql =>
    /BEGIN/i.test(sql)
    && /DELETE FROM session_events/i.test(sql)
    && /DELETE FROM session_drafts/i.test(sql)
    && /DELETE FROM session_base/i.test(sql)
    && /COMMIT/i.test(sql)
  )).toBe(true)
  expect((await storage.readAll()).map(row => row.id)).toEqual(['a'])
  expect(await storage.getDraft('plan:bench:0')).toEqual({ r: 3 })
  expect(await storage.readBase()).toEqual({ id: 'w1', name: 'Push' })
  expect(await storage.append(event('b', 2))).toMatchObject({ ok: true })
  expect((await storage.readAll()).map(row => row.id)).toEqual(['a', 'b'])
})

test('a rollback that reports no transaction still rejects with the original clear error', async () => {
  const db = createFakeSqliteDb()
  const storage = createSqliteSessionStorage(db)
  await storage.append(event('a', 1))
  await storage.putDraft('plan:bench:0', { r: 3 })
  await storage.writeBase({ id: 'w1' })
  const exec = db.exec.bind(db)
  db.exec = async sql => {
    if (/^\s*ROLLBACK\b/i.test(sql)) throw new Error('no transaction')
    return exec(sql)
  }
  db.failNext(/^DELETE FROM session_drafts$/, new Error('locked'))
  await expect(storage.clear()).rejects.toThrow(/locked/)
})

test('sqlite storage applies SQLITE_SESSION_SCHEMA and rolls clear back when a delete fails', async () => {
  const db = createFakeSqliteDb()
  const storage = createSqliteSessionStorage(db)
  await storage.append(event('a', 1))
  expect(db.executed[0]).toBe(SQLITE_SESSION_SCHEMA)
  await storage.putDraft('plan:bench:0', { r: 3 })
  await storage.writeBase({ id: 'w1' })
  db.failNext(/^DELETE FROM session_drafts$/, new Error('locked'))
  await expect(storage.clear()).rejects.toThrow(/locked/)
  expect((await storage.readAll()).map(row => row.id)).toEqual(['a'])
  expect(await storage.getDraft('plan:bench:0')).toEqual({ r: 3 })
  expect(await storage.readBase()).toEqual({ id: 'w1' })
})

test('sqlite append stays saved when the driver does not report a change count', async () => {
  const db = createFakeSqliteDb()
  const run = db.run.bind(db)
  db.run = async (sql, params) => {
    const result = await run(sql, params)
    if (/INSERT OR IGNORE INTO session_events/.test(squeeze(sql))) return {}
    return result
  }
  const storage = createSqliteSessionStorage(db)
  const saved = await storage.append(event('a', 1))
  expect(saved.ok).toBe(true)
  expect(saved.duplicate).toBeUndefined()
  expect((await storage.readAll()).map(row => row.id)).toEqual(['a'])
})

function squeeze(sql) {
  return String(sql).replace(/\s+/g, ' ')
}

test('sqlite storage requires an injected db handle', () => {
  expect(() => createSqliteSessionStorage()).toThrow(/expo-sqlite/)
})
