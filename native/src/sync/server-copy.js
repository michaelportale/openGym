// The owner's state document as the server last sent it, kept whole so a push can send back
// every part of it. The body is JSON.stringify(state) and JSON.parse, with no transformation.
// sync_meta holds small facts: server, profile, lastSyncedAt, problem. The handle is injected.

export const SERVER_COPY_SCHEMA = `
CREATE TABLE IF NOT EXISTS server_copy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rev,
  wid,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`.trim()

// The stored copy, or null if reading it fails (a corrupt body): the screen then shows the
// phone's own workouts and the sync engine re-pulls to repair.
export async function readCopy(serverCopy) {
  try {
    return await serverCopy.get()
  } catch {
    return null
  }
}

function opener(db) {
  let opening = null
  return () => {
    if (!opening) {
      opening = Promise.resolve(db.exec(SERVER_COPY_SCHEMA)).catch(error => {
        opening = null
        throw error
      })
    }
    return opening
  }
}

export function createSqliteServerCopy(db) {
  const ready = opener(db)
  return {
    async get() {
      await ready()
      const rows = await db.getAll('SELECT rev, wid, body FROM server_copy WHERE id = 1')
      if (!rows.length) return null
      const row = rows[0]
      return { state: JSON.parse(row.body), rev: row.rev, wid: row.wid }
    },
    // The copy's rev and wid without its body, or null: what status() needs, at no parse.
    async key() {
      await ready()
      const rows = await db.getAll('SELECT rev, wid FROM server_copy WHERE id = 1')
      return rows.length ? { rev: rows[0].rev, wid: rows[0].wid } : null
    },
    async put({ state, rev, wid }) {
      await ready()
      await db.run(
        `INSERT INTO server_copy (id, rev, wid, body) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, wid = excluded.wid, body = excluded.body`,
        [rev, wid, JSON.stringify(state)],
      )
    },
    async clear() {
      await ready()
      await db.run('DELETE FROM server_copy')
    },
  }
}

export function createSqliteSyncMeta(db) {
  const ready = opener(db)
  return {
    async get(key) {
      await ready()
      const rows = await db.getAll('SELECT value FROM sync_meta WHERE key = ?', [key])
      return rows.length ? rows[0].value : null
    },
    async set(key, value) {
      await ready()
      await db.run(
        'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      )
    },
    async clear() {
      await ready()
      await db.run('DELETE FROM sync_meta')
    },
  }
}
