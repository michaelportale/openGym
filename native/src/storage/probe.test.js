import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { createFakeSqliteDb } from '../session/fake-sqlite.js'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'
import { runStorageCheck, runStorageProbe, storageCheckLines } from './probe.js'

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

// The scratch database as expo-sqlite keeps it, by name: opening creates it, deleting one that
// is not there throws, and its rows outlive a kill.
function scratchFiles() {
  const files = new Map()
  const calls = []
  return {
    files,
    calls,
    open: async () => {
      calls.push('open')
      if (!files.has('probe')) files.set('probe', createFakeSqliteDb())
      const handle = files.get('probe')
      return { handle, close: async () => { calls.push('close') } }
    },
    remove: async () => {
      calls.push('remove')
      if (!files.delete('probe')) throw new Error('Database not found')
    },
  }
}

describe('runStorageCheck', () => {
  test('a scratch database a killed check left behind is deleted before the check opens it', async () => {
    const scratch = scratchFiles()
    // A check killed after its first step: the probe's own event is still in the file.
    const stale = createFakeSqliteDb()
    await createSqliteSessionStorage(stale).append({ id: 'probe-1', type: 'probe', at: 1 })
    scratch.files.set('probe', stale)
    expect(await runStorageCheck(scratch)).toEqual(['Storage check passed'])
    expect(scratch.calls).toEqual(['remove', 'open', 'close', 'remove'])
    expect(scratch.files.has('probe')).toBe(false)
  })

  test('with no scratch database there, the first delete failing is not a failure', async () => {
    const scratch = scratchFiles()
    expect(await runStorageCheck(scratch)).toEqual(['Storage check passed'])
    expect(scratch.calls).toEqual(['remove', 'open', 'close', 'remove'])
  })

  test('a close or delete that fails after the check is its own line under the verdict', async () => {
    const scratch = scratchFiles()
    const open = scratch.open
    scratch.open = async () => ({ ...(await open()), close: async () => { throw new Error('locked') } })
    expect(await runStorageCheck(scratch)).toEqual(['Storage check passed', 'cleanup failed: locked'])
    const gone = scratchFiles()
    const remove = gone.remove
    let removes = 0
    gone.remove = async () => {
      removes += 1
      if (removes === 2) throw new Error('busy')
      return remove()
    }
    expect(await runStorageCheck(gone)).toEqual(['Storage check passed', 'cleanup failed: busy'])
  })

  test('a probe that throws is the verdict, and the scratch database is still closed and deleted', async () => {
    const scratch = scratchFiles()
    const open = scratch.open
    scratch.open = async () => ({ ...(await open()), handle: { exec: async () => { throw new Error('boom') } } })
    const lines = await runStorageCheck(scratch)
    expect(lines[0]).toMatch(/^Storage check failed/)
    expect(scratch.calls).toEqual(['remove', 'open', 'close', 'remove'])
  })
})
