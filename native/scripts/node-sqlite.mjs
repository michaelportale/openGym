// Real SQLite for tests, from Node's built-in node:sqlite. No package. It lives in scripts/
// because app code under src/ may not import node: modules (symbol-names.test.mjs checks).
// It takes the same exec, run, and getAll calls as the expo-sqlite handle
// described in sqlite-storage.js, and the same failNext and holdNext hooks as fake-sqlite.js.
//
// createNodeSqliteDb() keeps the database in memory. createNodeSqliteFileDb() keeps it in a
// temp file, and reopen() closes the connection and opens a new one on that file. Closing
// rolls back an open transaction, so a write that was never committed is gone after reopen,
// as it would be after the app is killed.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { onTestFinished } from 'vitest'
import { createFakeSqliteDb } from '../src/session/fake-sqlite.js'

function squeeze(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

function connect(path, onOpen = () => {}) {
  const db = new DatabaseSync(path)
  let open = true
  const executed = []
  const failures = []
  const holds = []
  const heldWaiters = []
  let releaseHeld = null

  // A failure or hold is matched against the whole statement, or the whole script for exec,
  // and acts before SQLite sees it. A failure partway through a script has to come from
  // SQLite itself, for example a trigger that raises.
  async function before(text) {
    const hit = failures.findIndex(item => item.pattern.test(text))
    if (hit >= 0) {
      executed.push(text)
      const [{ error }] = failures.splice(hit, 1)
      throw error
    }
    const index = holds.findIndex(pattern => pattern.test(text))
    if (index >= 0) {
      holds.splice(index, 1)
      await new Promise(resolve => {
        releaseHeld = resolve
        for (const waiter of heldWaiters.splice(0)) waiter()
      })
      releaseHeld = null
    }
    executed.push(text)
  }

  const handle = {
    executed,
    // One native call runs the whole script, as expo-sqlite's execAsync does. SQLite stops
    // at the first failing statement and leaves an open transaction open.
    async exec(sql) {
      await before(squeeze(sql))
      db.exec(String(sql))
    },
    async run(sql, params = []) {
      await before(squeeze(sql))
      const result = db.prepare(String(sql)).run(...params)
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getAll(sql, params = []) {
      await before(squeeze(sql))
      return db.prepare(String(sql)).all(...params).map(row => ({ ...row }))
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
    close() {
      if (!open) return
      open = false
      db.close()
    },
    reopen() {
      if (path === ':memory:') throw new Error('an in-memory database cannot be reopened; use createNodeSqliteFileDb')
      handle.close()
      return connect(path, onOpen)
    },
  }
  onOpen(handle)
  return handle
}

export function createNodeSqliteDb() {
  return connect(':memory:')
}

// Call inside a test. The file and its folder are removed when the test finishes.
export function createNodeSqliteFileDb() {
  const dir = mkdtempSync(join(tmpdir(), 'opengym-sqlite-'))
  let latest = null
  onTestFinished(() => {
    latest?.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return connect(join(dir, 'session.db'), handle => { latest = handle })
}

// For tests that kill the app with db.reopen(): the fake, and real SQLite on a file.
export const SQLITE_DRIVERS = [
  ['fake sqlite', createFakeSqliteDb],
  ['node sqlite file', createNodeSqliteFileDb],
]
