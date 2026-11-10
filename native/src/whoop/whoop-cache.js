// The last good WHOOP read (GET /api/whoop) this phone was sent, so the Progress card can show it
// offline or while WHOOP is down, with "As of". One row, in its own table (not sync_meta, which is
// the sync engine's and which Forget clears), tagged with the server and profile it came from so
// another pairing never shows it. The body is JSON.stringify(payload) and JSON.parse, unchanged.
// A memory twin for tests. The handle is injected; this file does not import expo-sqlite.

export const WHOOP_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS whoop_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server TEXT NOT NULL,
  profile TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
`.trim()

// Rows are { server, profile, savedAt, payload }.
const copyOf = row => ({ server: row.server, profile: row.profile, savedAt: row.savedAt, payload: JSON.parse(JSON.stringify(row.payload)) })

export function createMemoryWhoopCache() {
  let row = null
  return {
    async get() {
      return row ? copyOf(row) : null
    },
    async put(next) {
      row = copyOf(next)
    },
    async clear() {
      row = null
    },
  }
}

function opener(db) {
  let opening = null
  return () => {
    if (!opening) {
      opening = Promise.resolve(db.exec(WHOOP_CACHE_SCHEMA)).catch(error => {
        opening = null
        throw error
      })
    }
    return opening
  }
}

export function createSqliteWhoopCache(db) {
  const ready = opener(db)
  return {
    // The row, or null: none kept, or a body that will not parse (it is only a cache).
    async get() {
      await ready()
      const rows = await db.getAll('SELECT server, profile, saved_at, body FROM whoop_cache WHERE id = 1')
      if (!rows.length) return null
      try {
        return { server: rows[0].server, profile: rows[0].profile, savedAt: rows[0].saved_at, payload: JSON.parse(rows[0].body) }
      } catch {
        return null
      }
    },
    async put({ server, profile, savedAt, payload }) {
      await ready()
      await db.run(
        `INSERT INTO whoop_cache (id, server, profile, saved_at, body) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET server = excluded.server, profile = excluded.profile, saved_at = excluded.saved_at, body = excluded.body`,
        [server, profile, savedAt, JSON.stringify(payload)],
      )
    },
    async clear() {
      await ready()
      await db.run('DELETE FROM whoop_cache')
    },
  }
}
