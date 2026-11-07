import { DatabaseSync } from 'node:sqlite'
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

    test('rewriting the base without options keeps the stored time zone', async () => {
      const { storage } = await open()
      await storage.writeBase({ id: 'w1', name: 'Push' }, { timeZone: 'America/New_York' })
      await storage.writeBase({ id: 'w1', name: 'Pull' })
      expect(await storage.readBase()).toEqual({ id: 'w1', name: 'Pull' })
      expect(await storage.readTimeZone()).toBe('America/New_York')
    })

    test('the first stored time zone stays when a later write passes another', async () => {
      const { storage } = await open()
      await storage.writeBase({ id: 'w1', name: 'Push' })
      await storage.writeBase({ id: 'w1', name: 'Push' }, { timeZone: 'UTC' })
      await storage.writeBase({ id: 'w1', name: 'Pull' }, { timeZone: 'America/New_York' })
      expect(await storage.readBase()).toEqual({ id: 'w1', name: 'Pull' })
      expect(await storage.readTimeZone()).toBe('UTC')
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

storageContract('node sqlite storage', async () => {
  const db = createNodeSqliteDb()
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

test('clear rejects with the original error when rollback also fails', async () => {
  const db = createFakeSqliteDb()
  const storage = createSqliteSessionStorage(db)
  await storage.append(event('a', 1))
  await storage.putDraft('plan:bench:0', { r: 3 })
  await storage.writeBase({ id: 'w1' })
  db.failNext(/^DELETE FROM session_drafts$/, new Error('locked'))
  db.failNext(/ROLLBACK/, new Error('rollback failed'))
  await expect(storage.clear()).rejects.toThrow(/^locked$/)
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
  return String(sql).replace(/\s+/g, ' ').trim()
}

// Real SQLite for the session_base statements. Built in, no package. Hold and fail
// pause or throw before the statement runs, so the SQL itself decides the row.
function createNodeSqliteDb() {
  const db = new DatabaseSync(':memory:')
  const executed = []
  const failures = []
  const holds = []
  const heldWaiters = []
  let releaseHeld = null

  async function waitIfHeld(text) {
    const index = holds.findIndex(pattern => pattern.test(text))
    if (index < 0) return
    holds.splice(index, 1)
    await new Promise(resolve => {
      releaseHeld = resolve
      for (const waiter of heldWaiters.splice(0)) waiter()
    })
    releaseHeld = null
  }

  async function run(sql, params = []) {
    const text = squeeze(sql)
    const hit = failures.findIndex(item => item.pattern.test(text))
    if (hit >= 0) {
      executed.push(text)
      const [{ error }] = failures.splice(hit, 1)
      throw error
    }
    await waitIfHeld(text)
    executed.push(text)
    const result = db.prepare(text).run(...params)
    return { changes: result.changes }
  }

  return {
    executed,
    exec: async sql => {
      executed.push(sql)
      const parts = String(sql).split(';').map(part => part.trim()).filter(Boolean)
      for (const part of parts) await run(part)
    },
    run,
    getAll: async (sql, params = []) => {
      const text = squeeze(sql)
      executed.push(text)
      return db.prepare(text).all(...params)
    },
    failNext(pattern, error) {
      failures.push({ pattern, error })
    },
    holdNext(pattern) {
      holds.push(pattern)
    },
    held() {
      if (releaseHeld) return Promise.resolve()
      return new Promise(resolve => heldWaiters.push(resolve))
    },
    release() {
      const resume = releaseHeld
      releaseHeld = null
      if (resume) resume()
    },
  }
}

function baseRaceTests(title, createDb) {
  test(`${title}: putLastSeen does not clobber a writeBase that lands while it is in flight`, async () => {
    const db = createDb()
    const storage = createSqliteSessionStorage(db)
    const stamp = Date.parse('2026-11-08T00:05:00.000Z')
    await storage.writeBase({ id: 'w1', title: 'before' }, { timeZone: 'UTC' })
    db.holdNext(/json_set\(body, '\$\._sessionLastSeen'|INSERT OR REPLACE INTO session_base/)
    const pending = storage.putLastSeen(stamp)
    await db.held()
    await storage.writeBase({ id: 'w1', title: 'after' }, { timeZone: 'America/New_York' })
    db.release()
    await pending
    expect(await storage.readBase()).toEqual({ id: 'w1', title: 'after' })
    expect(await storage.readTimeZone()).toBe('UTC')
    expect(await storage.readLastSeen()).toBe(stamp)
  })

  test(`${title}: writeBase keeps a last seen saved while the base replace is in flight`, async () => {
    const db = createDb()
    const storage = createSqliteSessionStorage(db)
    const earlier = Date.parse('2026-11-08T00:05:00.000Z')
    const later = Date.parse('2026-11-08T00:30:00.000Z')
    const earlierTrail = [earlier - 60_000, earlier]
    const laterTrail = [earlier - 60_000, earlier, later]
    await storage.writeBase({ id: 'w1', title: 'before' }, { timeZone: 'UTC' })
    await storage.putLastSeen(earlier, earlierTrail)
    db.holdNext(/INSERT OR REPLACE INTO session_base|ON CONFLICT\(id\) DO UPDATE/)
    const pending = storage.writeBase({ id: 'w1', title: 'after' })
    await db.held()
    await storage.putLastSeen(later, laterTrail)
    db.release()
    await pending
    expect(await storage.readBase()).toEqual({ id: 'w1', title: 'after' })
    expect(await storage.readTimeZone()).toBe('UTC')
    expect(await storage.readLastSeen()).toBe(later)
    const kept = await storage.readSeenTrail()
    expect(Array.isArray(kept)).toBe(true)
    expect(kept).toEqual(laterTrail)
  })

  test(`${title}: writeBase keeps the first time zone when another lands during the replace`, async () => {
    const db = createDb()
    const storage = createSqliteSessionStorage(db)
    await storage.writeBase({ id: 'w1', title: 'before' })
    db.holdNext(/ON CONFLICT\(id\) DO UPDATE/)
    const pending = storage.writeBase({ id: 'w1', title: 'after' }, { timeZone: 'America/New_York' })
    await db.held()
    await storage.writeBase({ id: 'w1', title: 'mid' }, { timeZone: 'UTC' })
    db.release()
    await pending
    expect(await storage.readBase()).toEqual({ id: 'w1', title: 'after' })
    expect(await storage.readTimeZone()).toBe('UTC')
  })
}

baseRaceTests('fake sqlite', createFakeSqliteDb)
baseRaceTests('node sqlite', createNodeSqliteDb)

test('sqlite storage requires an injected db handle', () => {
  expect(() => createSqliteSessionStorage()).toThrow(/expo-sqlite/)
})
