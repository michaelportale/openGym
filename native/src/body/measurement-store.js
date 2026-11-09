// Local body-measurement operations, the weigh-in store's pattern (weigh-ins.js) with no Health
// path. One row per day holding what this phone last set or removed for that day: a set keeps the
// whole entry (JSON, so every value goes back byte for byte), a remove the t of the entry it takes
// out (base_t). acked_at is NULL until the push has settled the row (the outbox is the rows still
// NULL). The handle is injected. This file does not import expo-sqlite and does not send anything.
// Ops are { d, op, entry (set only), t, baseT (when present) }.
import { sameValue } from './measurement-ops.js'

export const MEASUREMENT_OPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS measurement_ops (
  d TEXT PRIMARY KEY,
  op TEXT NOT NULL,
  entry TEXT,
  t INTEGER NOT NULL,
  base_t INTEGER,
  acked_at TEXT
);
`.trim()

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

function requireOp(op) {
  if (!isMap(op)) throw new Error('measurement op must be an object')
  if (typeof op.d !== 'string' || op.d === '') throw new Error('measurement op needs a day')
  if (op.op !== 'set' && op.op !== 'remove') throw new Error('measurement op must be set or remove')
  if (!Number.isFinite(op.t)) throw new Error('measurement op needs a time')
  if (op.baseT != null && !Number.isFinite(op.baseT)) throw new Error('measurement baseT must be a number')
  if (op.op === 'set') {
    if (!isMap(op.entry)) throw new Error('a set measurement needs its entry')
    // The entry is what the push sends for the day, so its d and t are the op's own.
    if (op.entry.d !== op.d || op.entry.t !== op.t) throw new Error("a set measurement's entry carries the op's d and t")
  }
}

// Op object from the fields; a remove has no entry, a null baseT is left out. The entry is a copy,
// as it would come back from SQLite.
function toOp(d, op, entry, t, baseT) {
  const out = { d, op }
  if (op === 'set') out.entry = JSON.parse(typeof entry === 'string' ? entry : JSON.stringify(entry))
  out.t = t
  if (baseT != null) out.baseT = baseT
  return out
}

function normalized(op) {
  requireOp(op)
  return toOp(op.d, op.op, op.entry, op.t, op.baseT ?? null)
}

function fromRow(row) {
  return toOp(row.d, row.op, row.entry, row.t, row.base_t)
}

function sameContent(a, b) {
  return a.op === b.op && (a.baseT ?? null) === (b.baseT ?? null) && sameValue(a.entry ?? null, b.entry ?? null)
}

// Same t but different content: the row takes t + 1, in the op and its entry, so an older ack
// keyed on { d, t } cannot settle the new content.
function bumped(stored, existing) {
  if (!existing || existing.t !== stored.t || sameContent(existing, stored)) return stored
  const t = stored.t + 1
  return { ...stored, ...(stored.entry ? { entry: { ...stored.entry, t } } : {}), t }
}

function byDay(a, b) {
  return a.d < b.d ? -1 : a.d > b.d ? 1 : 0
}

const copyOf = row => toOp(row.d, row.op, row.entry, row.t, row.baseT ?? null)

export function createMemoryMeasurements() {
  const rows = new Map()
  const acked = new Map()
  return {
    async put(op) {
      const stored = bumped(normalized(op), rows.get(op?.d))
      rows.set(stored.d, stored)
      acked.delete(stored.d)
      return { ok: true, d: stored.d, t: stored.t }
    },
    async get(d) {
      const row = rows.get(d)
      return row ? copyOf(row) : null
    },
    async list() {
      return [...rows.values()].sort(byDay).map(copyOf)
    },
    async listPending() {
      return [...rows.values()].filter(row => !acked.has(row.d)).sort(byDay).map(copyOf)
    },
    async markAcked(items, at) {
      for (const { d, t } of items) {
        const row = rows.get(d)
        if (row && row.t === t && !acked.has(d)) acked.set(d, at)
      }
      return { ok: true }
    },
    async resetAcked() {
      acked.clear()
      return { ok: true }
    },
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite measurements need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = db.exec(MEASUREMENT_OPS_SCHEMA).catch(error => {
      migrations.delete(db)
      throw error
    })
    migrations.set(db, opening)
  }
  return opening
}

export function createSqliteMeasurements(db) {
  requireDb(db)
  const ready = () => migrate(db)

  return {
    async put(op) {
      await ready()
      let s = normalized(op)
      const found = await db.getAll('SELECT * FROM measurement_ops WHERE d = ?', [s.d])
      s = bumped(s, found.length ? fromRow(found[0]) : null)
      await db.run(
        `INSERT INTO measurement_ops (d, op, entry, t, base_t, acked_at) VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(d) DO UPDATE SET op = excluded.op, entry = excluded.entry, t = excluded.t,
           base_t = excluded.base_t, acked_at = NULL`,
        [s.d, s.op, s.entry ? JSON.stringify(s.entry) : null, s.t, s.baseT ?? null],
      )
      return { ok: true, d: s.d, t: s.t }
    },
    async get(d) {
      await ready()
      const rows = await db.getAll('SELECT * FROM measurement_ops WHERE d = ?', [d])
      return rows.length ? fromRow(rows[0]) : null
    },
    async list() {
      await ready()
      return (await db.getAll('SELECT * FROM measurement_ops ORDER BY d ASC')).map(fromRow)
    },
    async listPending() {
      await ready()
      return (await db.getAll('SELECT * FROM measurement_ops WHERE acked_at IS NULL ORDER BY d ASC')).map(fromRow)
    },
    // A row is acked only if its t is still the one acked: a newer op for the day waits.
    async markAcked(items, at) {
      await ready()
      for (const { d, t } of items) await db.run('UPDATE measurement_ops SET acked_at = ? WHERE d = ? AND t = ? AND acked_at IS NULL', [at, d, t])
      return { ok: true }
    },
    async resetAcked() {
      await ready()
      await db.run('UPDATE measurement_ops SET acked_at = NULL')
      return { ok: true }
    },
  }
}
