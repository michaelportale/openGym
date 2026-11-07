import { SQLITE_SESSION_SCHEMA } from './storage.js'

// SQLite adapter for the session journal. The handle is injected so this file does not import
// expo-sqlite. native/package.json does not depend on it yet. When the app adds it, open the
// database and pass:
//   exec: sql => db.execAsync(sql)
//   run: (sql, params) => db.runAsync(sql, params)
//   getAll: (sql, params) => db.getAllAsync(sql, params)
// runAsync's { changes } is how a duplicate id (INSERT OR IGNORE) is told apart from a new row.

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite session storage needs a db handle with exec, run, and getAll. expo-sqlite is not installed yet; pass the app database in once it is.')
  }
}

function parse(body) {
  return JSON.parse(body)
}

export function createSqliteSessionStorage(db) {
  requireDb(db)
  let opening = null

  function ready() {
    if (!opening) {
      opening = Promise.resolve(db.exec(SQLITE_SESSION_SCHEMA)).catch(error => {
        opening = null
        throw error
      })
    }
    return opening
  }

  return {
    async append(event) {
      await ready()
      if (!event || event.id == null) throw new Error('event id required')
      const result = await db.run(
        'INSERT OR IGNORE INTO session_events (id, at, type, body) VALUES (?, ?, ?, ?)',
        [String(event.id), Number.isFinite(event.at) ? event.at : 0, event.type == null ? '' : String(event.type), JSON.stringify(event)],
      )
      // changes === 0 is INSERT OR IGNORE skipping an id already stored. A driver that
      // omits changes did not report a skip, so the append still counts as saved.
      if (result && result.changes === 0) return { duplicate: true }
      return { ok: true }
    },

    async readAll() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_events ORDER BY rowid ASC')
      return rows.map(row => parse(row.body))
    },

    async clear() {
      await ready()
      // One script, so a driver that commits each run() cannot drop events and then fail on
      // drafts or the base. A throw leaves the transaction open; roll it back before rethrowing.
      try {
        await db.exec(`
          BEGIN;
          DELETE FROM session_events;
          DELETE FROM session_drafts;
          DELETE FROM session_base;
          COMMIT;
        `)
      } catch (error) {
        try {
          await db.exec('ROLLBACK')
        } catch {
          // ROLLBACK can fail with "no transaction" or its own driver error.
          // Neither one may replace the original clear failure.
        }
        throw error
      }
    },

    async getDraft(key) {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_drafts WHERE set_id = ?', [key])
      return rows.length ? parse(rows[0].body) : null
    },

    async putDraft(key, value) {
      await ready()
      if (value == null) {
        await db.run('DELETE FROM session_drafts WHERE set_id = ?', [key])
        return
      }
      await db.run(
        'INSERT OR REPLACE INTO session_drafts (set_id, body) VALUES (?, ?)',
        [key, JSON.stringify(value)],
      )
    },

    async readDrafts() {
      await ready()
      const rows = await db.getAll('SELECT set_id, body FROM session_drafts ORDER BY rowid ASC')
      return Object.fromEntries(rows.map(row => [row.set_id, parse(row.body)]))
    },

    async writeBase(value) {
      await ready()
      if (value == null) {
        await db.run('DELETE FROM session_base')
        return
      }
      await db.run(
        'INSERT OR REPLACE INTO session_base (id, body) VALUES (?, ?)',
        [1, JSON.stringify(value)],
      )
    },

    async readBase() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_base WHERE id = ?', [1])
      return rows.length ? parse(rows[0].body) : null
    },
  }
}
