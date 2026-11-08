import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { runStorageProbe, storageCheckLines } from './probe.js'

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

describe('storageCheckLines', () => {
  test('a passed probe with a failed cleanup shows both lines', () => {
    const lines = storageCheckLines({ ok: true, steps: [] }, [new Error('locked')])
    expect(lines).toEqual(['Storage check passed', 'cleanup failed: locked'])
  })

  test('a failed probe with a clean cleanup shows only the failure line', () => {
    const outcome = { ok: false, steps: [{ name: 'append', ok: false, detail: 'disk full' }] }
    expect(storageCheckLines(outcome)).toEqual(['Storage check failed at append: disk full'])
  })

  test('a probe that threw is reported as failed', () => {
    expect(storageCheckLines({ error: new Error('boom') })).toEqual(['Storage check failed: boom'])
  })
})
