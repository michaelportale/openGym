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
 * was first stored, `_sessionLastSeen`, the latest instant the timer counted, and
 * `_sessionSeenTrail`, the counted instants a reopen needs so that instant does not
 * rewind. readBase leaves these keys out so they never become part of the workout.
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
export const SESSION_LAST_SEEN_KEY = '_sessionLastSeen'
export const SESSION_SEEN_TRAIL_KEY = '_sessionSeenTrail'

export function baseWithoutTimeZone(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const copy = clone(value)
  delete copy[SESSION_TIME_ZONE_KEY]
  delete copy[SESSION_LAST_SEEN_KEY]
  delete copy[SESSION_SEEN_TRAIL_KEY]
  return copy
}

export function lastSeenFromBase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const at = value[SESSION_LAST_SEEN_KEY]
  return Number.isFinite(at) ? at : null
}

export function seenTrailFromBase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const trail = value[SESSION_SEEN_TRAIL_KEY]
  if (!Array.isArray(trail)) return []
  return trail.filter(at => Number.isFinite(at))
}

export function timeZoneFromBase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const zone = value[SESSION_TIME_ZONE_KEY]
  return typeof zone === 'string' ? zone : ''
}

// A rewrite that does not pass timeZone keeps the zone already stored. An explicit
// string replaces it, and an empty string clears it.
export function timeZoneForWrite(options, existing) {
  if (options && typeof options.timeZone === 'string') return options.timeZone
  return typeof existing === 'string' ? existing : ''
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
      const seen = lastSeenFromBase(base)
      const trail = seenTrailFromBase(base)
      const body = baseWithoutTimeZone(value)
      const zone = timeZoneForWrite(options, timeZoneFromBase(base))
      if (zone) body[SESSION_TIME_ZONE_KEY] = zone
      if (seen != null) body[SESSION_LAST_SEEN_KEY] = seen
      if (trail.length) body[SESSION_SEEN_TRAIL_KEY] = trail
      base = body
    },
    async readBase() {
      return base == null ? null : baseWithoutTimeZone(base)
    },
    async readTimeZone() {
      return timeZoneFromBase(base)
    },
    async putLastSeen(at, trail) {
      if (!base || !Number.isFinite(at)) return
      const points = Array.isArray(trail) ? trail.filter(item => Number.isFinite(item)) : [at]
      base[SESSION_LAST_SEEN_KEY] = at
      base[SESSION_SEEN_TRAIL_KEY] = points.length ? points : [at]
    },
    async readLastSeen() {
      return lastSeenFromBase(base)
    },
    async readSeenTrail() {
      return seenTrailFromBase(base)
    },
    failAppends(error) {
      fail = error || null
    },
  }
}
