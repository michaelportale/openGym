import { SESSION_LAST_SEEN_KEY, SESSION_SEEN_TRAIL_KEY, SESSION_TIME_ZONE_KEY, SQLITE_SESSION_SCHEMA, baseWithoutTimeZone, lastSeenFromBase, seenTrailFromBase, timeZoneFromBase } from './storage.js'

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

    async writeBase(value, options = {}) {
      await ready()
      if (value == null) {
        await db.run('DELETE FROM session_base')
        return
      }
      const body = baseWithoutTimeZone(value)
      // An explicit zone, including '', is the caller's. When timeZone is absent the
      // statement copies the current row, so a zone saved while this replace is in
      // flight is not overwritten by a value read earlier.
      if (options && typeof options.timeZone === 'string') body[SESSION_TIME_ZONE_KEY] = options.timeZone
      // Stamp and trail are copied from the current row inside the statement, and only
      // when that key is present. json() keeps the trail an array. A bare json_extract
      // is TEXT, and json_set would store it as a quoted string.
      // On-device JSON1 checklist: this copy must stay json()-wrapped.
      const seen = `'$.${SESSION_LAST_SEEN_KEY}'`
      const trail = `'$.${SESSION_SEEN_TRAIL_KEY}'`
      const zone = `'$.${SESSION_TIME_ZONE_KEY}'`
      const trailJson = `json(json_extract(session_base.body, ${trail}))`
      const kept = `CASE
        WHEN json_extract(session_base.body, ${trail}) IS NULL THEN
          CASE
            WHEN json_extract(session_base.body, ${seen}) IS NULL THEN excluded.body
            ELSE json_set(excluded.body, ${seen}, json_extract(session_base.body, ${seen}))
          END
        WHEN json_extract(session_base.body, ${seen}) IS NULL THEN
          json_set(excluded.body, ${trail}, ${trailJson})
        ELSE json_set(excluded.body, ${seen}, json_extract(session_base.body, ${seen}), ${trail}, ${trailJson})
      END`
      await db.run(
        `INSERT INTO session_base (id, body) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET body = (
           SELECT CASE
             WHEN json_type(excluded.body, ${zone}) IS NOT NULL THEN kept
             WHEN json_extract(session_base.body, ${zone}) IS NULL THEN kept
             ELSE json_set(kept, ${zone}, json_extract(session_base.body, ${zone}))
           END
           FROM (SELECT ${kept} AS kept)
         )`,
        [JSON.stringify(body)],
      )
    },

    async readBase() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_base WHERE id = ?', [1])
      return rows.length ? baseWithoutTimeZone(parse(rows[0].body)) : null
    },

    async readTimeZone() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_base WHERE id = ?', [1])
      return rows.length ? timeZoneFromBase(parse(rows[0].body)) : ''
    },

    async putLastSeen(at, trail) {
      await ready()
      if (!Number.isFinite(at)) return
      const points = Array.isArray(trail) ? trail.filter(item => Number.isFinite(item)) : [at]
      const stored = points.length ? points : [at]
      // One statement. A read of the whole body, then a later replace, would wipe a
      // writeBase that committed in between.
      await db.run(
        `UPDATE session_base SET body = json_set(body, '$.${SESSION_LAST_SEEN_KEY}', ?, '$.${SESSION_SEEN_TRAIL_KEY}', json(?)) WHERE id = 1`,
        [at, JSON.stringify(stored)],
      )
    },

    async readLastSeen() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_base WHERE id = ?', [1])
      return rows.length ? lastSeenFromBase(parse(rows[0].body)) : null
    },

    async readSeenTrail() {
      await ready()
      const rows = await db.getAll('SELECT body FROM session_base WHERE id = ?', [1])
      return rows.length ? seenTrailFromBase(parse(rows[0].body)) : []
    },
  }
}
