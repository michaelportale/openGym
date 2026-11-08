import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { runStorageProbe } from './probe.js'

describe('runStorageProbe', () => {
  test('a working database passes every step', async () => {
    const result = await runStorageProbe(createNodeSqliteDb())
    expect(result.ok).toBe(true)
    expect(result.steps.map(s => s.name)).toEqual(['append', 'duplicate', 'draft', 'read back', 'clear'])
    expect(result.steps.every(s => s.ok)).toBe(true)
  })

  test('a database whose append fails reports which step failed', async () => {
    const db = createNodeSqliteDb()
    db.failNext(/INSERT OR IGNORE INTO session_events/, new Error('disk full'))
    const result = await runStorageProbe(db)
    expect(result.ok).toBe(false)
    expect(result.steps).toEqual([{ name: 'append', ok: false, detail: 'disk full' }])
  })
})
