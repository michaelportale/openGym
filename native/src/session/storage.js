// Storage boundary for the active session. The phone adapter is SQLite; this phase ships the
// interface and an in-memory fake. Tests and the pure session log talk only to these methods.
// A failed append must throw. Callers are not allowed to treat a thrown append as a saved set.

/**
 * Proposed SQLite shape for the later adapter. Do not import expo-sqlite in this phase.
 *
 * session_events(id TEXT PRIMARY KEY, at INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL)
 * session_drafts(set_id TEXT PRIMARY KEY, body TEXT NOT NULL)
 * session_base(id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)
 *
 * append inserts a new event id. A repeated id is a no-op at this layer too (INSERT OR IGNORE),
 * so a replayed tap cannot create a second row. readAll returns events in insert order.
 * clear drops events, drafts, and the base snapshot together.
 */
export const SQLITE_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_drafts (
  set_id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_base (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL
);
`.trim()

export function createSqliteSessionStorage() {
  throw new Error('SQLite session storage is not implemented. Phase 2 ships the interface and the in-memory fake only.')
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

export function createMemoryStorage() {
  const events = []
  const drafts = new Map()
  let base = null
  let fail = null

  return {
    async append(event) {
      if (fail) throw fail
      if (!event || event.id == null) throw new Error('event id required')
      if (events.some(existing => existing.id === event.id)) return { duplicate: true }
      events.push(clone(event))
      return { ok: true }
    },
    async readAll() {
      return events.map(event => clone(event))
    },
    async clear() {
      events.length = 0
      drafts.clear()
      base = null
    },
    async getDraft(key) {
      return drafts.has(key) ? clone(drafts.get(key)) : null
    },
    async putDraft(key, value) {
      if (value == null) drafts.delete(key)
      else drafts.set(key, clone(value))
    },
    async readDrafts() {
      return Object.fromEntries([...drafts].map(([key, value]) => [key, clone(value)]))
    },
    async writeBase(value) {
      base = value == null ? null : clone(value)
    },
    async readBase() {
      return base == null ? null : clone(base)
    },
    failAppends(error) {
      fail = error || null
    },
  }
}
