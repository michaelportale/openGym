// Storage boundary for the active session. createMemoryStorage is the in-memory fake.
// createSqliteSessionStorage lives in sqlite-storage.js and takes an injected db handle.
// A failed append must throw. Callers are not allowed to treat a thrown append as a saved set.

/**
 * Proposed SQLite shape for the later adapter. Do not import expo-sqlite in this phase.
 *
 * session_events(id TEXT PRIMARY KEY, at INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL)
 * session_drafts(set_id TEXT PRIMARY KEY, body TEXT NOT NULL)
 * session_base(id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)
 *
 * The base body may include `_sessionTimeZone`, the zone captured when the journal
 * was first stored. readBase leaves that key out so it never becomes part of the workout.
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

export { createSqliteSessionStorage } from './sqlite-storage.js'

function clone(value) {
  // Plain JSON only. Hermes on device may not provide structuredClone.
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export const SESSION_TIME_ZONE_KEY = '_sessionTimeZone'

export function baseWithoutTimeZone(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const copy = clone(value)
  delete copy[SESSION_TIME_ZONE_KEY]
  return copy
}

export function timeZoneFromBase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const zone = value[SESSION_TIME_ZONE_KEY]
  return typeof zone === 'string' ? zone : ''
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
    async writeBase(value, options = {}) {
      if (value == null) {
        base = null
        return
      }
      const body = baseWithoutTimeZone(value)
      const zone = options && typeof options.timeZone === 'string' ? options.timeZone : ''
      if (zone) body[SESSION_TIME_ZONE_KEY] = zone
      base = body
    },
    async readBase() {
      return base == null ? null : baseWithoutTimeZone(base)
    },
    async readTimeZone() {
      return timeZoneFromBase(base)
    },
    failAppends(error) {
      fail = error || null
    },
  }
}
