// Health links and the on/off flag, in opengym.db. A link says which Health object a finished
// workout was written as, at what sync version, and whether the write finished. The handle is
// injected; this file does not import expo-sqlite and never touches Health.

export const HEALTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS health_links (
  kind TEXT,
  key TEXT,
  sync_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT,
  state TEXT NOT NULL,
  error TEXT,
  updated_at INTEGER,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS health_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`.trim()

function fromRow(row) {
  return {
    kind: row.kind,
    key: row.key,
    syncId: row.sync_id,
    version: row.version,
    hash: row.hash ?? null,
    state: row.state,
    error: row.error ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function copy(link) {
  return { ...link }
}

export function createMemoryHealthStore() {
  const links = new Map()
  const values = new Map()
  const id = (kind, key) => JSON.stringify([kind, key])
  return {
    links: {
      async list(kind) {
        return [...links.values()].filter(l => l.kind === kind).map(copy)
      },
      async put(link) {
        links.set(id(link.kind, link.key), {
          kind: link.kind,
          key: link.key,
          syncId: link.syncId,
          version: link.version,
          hash: link.hash ?? null,
          state: link.state,
          error: link.error ?? null,
          updatedAt: link.updatedAt ?? null,
        })
      },
      async remove(kind, key) {
        links.delete(id(kind, key))
      },
      async clear(kind) {
        for (const [k, l] of [...links]) if (l.kind === kind) links.delete(k)
      },
    },
    state: {
      async get(key) {
        return values.has(key) ? values.get(key) : null
      },
      async set(key, value) {
        values.set(key, value)
      },
    },
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite health store needs a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = db.exec(HEALTH_SCHEMA).catch(error => {
      migrations.delete(db)
      throw error
    })
    migrations.set(db, opening)
  }
  return opening
}

export function createSqliteHealthStore(db) {
  requireDb(db)
  const ready = () => migrate(db)
  return {
    links: {
      async list(kind) {
        await ready()
        const rows = await db.getAll('SELECT kind, key, sync_id, version, hash, state, error, updated_at FROM health_links WHERE kind = ? ORDER BY key', [kind])
        return rows.map(fromRow)
      },
      async put(link) {
        await ready()
        await db.run(
          `INSERT INTO health_links (kind, key, sync_id, version, hash, state, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(kind, key) DO UPDATE SET sync_id = excluded.sync_id, version = excluded.version, hash = excluded.hash,
             state = excluded.state, error = excluded.error, updated_at = excluded.updated_at`,
          [link.kind, link.key, link.syncId, link.version, link.hash ?? null, link.state, link.error ?? null, link.updatedAt ?? null],
        )
      },
      async remove(kind, key) {
        await ready()
        await db.run('DELETE FROM health_links WHERE kind = ? AND key = ?', [kind, key])
      },
      async clear(kind) {
        await ready()
        await db.run('DELETE FROM health_links WHERE kind = ?', [kind])
      },
    },
    state: {
      async get(key) {
        await ready()
        const rows = await db.getAll('SELECT value FROM health_state WHERE key = ?', [key])
        return rows.length ? rows[0].value : null
      },
      async set(key, value) {
        await ready()
        await db.run(
          'INSERT INTO health_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [key, value],
        )
      },
    },
  }
}
