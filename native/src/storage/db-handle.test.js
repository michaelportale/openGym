import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'
import { toSessionDbHandle } from './db-handle.js'

// An expo-sqlite-shaped database over node:sqlite, so the mapping is tested against real SQLite.
function createExpoShapedDb() {
  const db = new DatabaseSync(':memory:')
  return {
    async execAsync(sql) {
      db.exec(sql)
    },
    async runAsync(sql, params) {
      const result = db.prepare(sql).run(...params)
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes }
    },
    async getAllAsync(sql, params) {
      return db.prepare(sql).all(...params).map(row => ({ ...row }))
    },
  }
}

function createStorage() {
  return createSqliteSessionStorage(toSessionDbHandle(createExpoShapedDb()))
}

describe('toSessionDbHandle', () => {
  test('appending the same event id twice reports a duplicate through the handle', async () => {
    const storage = createStorage()
    await storage.append({ id: 'a', type: 'set.commit', at: 1 })
    expect(await storage.append({ id: 'a', type: 'set.commit', at: 1 })).toEqual({ duplicate: true })
    expect(await storage.readAll()).toHaveLength(1)
  })

  test('clear empties events, drafts and base through the handle', async () => {
    const storage = createStorage()
    await storage.append({ id: 'a', type: 'set.commit', at: 1 })
    await storage.putDraft('plan:x:0', { r: 3 })
    await storage.writeBase({ id: 'w1' })
    await storage.clear()
    expect(await storage.readAll()).toEqual([])
    expect(await storage.readDrafts()).toEqual({})
    expect(await storage.readBase()).toBeNull()
  })
})
