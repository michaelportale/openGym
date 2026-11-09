// Local weigh-in operations. One row per day holding what this phone last set or removed
// for that day; acked_at is NULL until the push has settled it (the outbox is the rows
// still NULL). The handle is injected. This file does not import expo-sqlite and does not
// send anything. Columns are snake_case; ops are camelCase (base_t is baseT).

export const WEIGH_INS_SCHEMA = `
CREATE TABLE IF NOT EXISTS weigh_ins (
  d TEXT PRIMARY KEY,
  op TEXT NOT NULL,
  w REAL,
  t INTEGER NOT NULL,
  src TEXT,
  hk TEXT,
  base_t INTEGER,
  acked_at TEXT
);
`.trim()

function requireOp(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('weigh-in must be an object')
  if (typeof op.d !== 'string' || op.d === '') throw new Error('weigh-in needs a day')
  if (op.op !== 'set' && op.op !== 'remove') throw new Error('weigh-in op must be set or remove')
  if (!Number.isFinite(op.t)) throw new Error('weigh-in needs a time')
  if (op.op === 'set' && !Number.isFinite(op.w)) throw new Error('a set weigh-in needs a weight')
}

// Op object from the fields; null src, hk and baseT are left out, and a remove has no w.
function toOp(d, op, w, t, src, hk, baseT) {
  const out = { d, op }
  if (op === 'set') out.w = w
  out.t = t
  if (src != null) out.src = src
  if (hk != null) out.hk = hk
  if (baseT != null) out.baseT = baseT
  return out
}

function normalized(op) {
  requireOp(op)
  return toOp(op.d, op.op, op.w, op.t, op.src ?? null, op.hk ?? null, op.baseT ?? null)
}

function fromRow(row) {
  return toOp(row.d, row.op, row.w, row.t, row.src, row.hk, row.base_t)
}

function byDay(a, b) {
  return a.d < b.d ? -1 : a.d > b.d ? 1 : 0
}

export function createMemoryWeighIns() {
  const rows = new Map()
  const acked = new Map()
  return {
    async put(op) {
      const stored = normalized(op)
      rows.set(stored.d, stored)
      acked.delete(stored.d)
      return { ok: true, d: stored.d }
    },
    async get(d) {
      const row = rows.get(d)
      return row ? { ...row } : null
    },
    async list() {
      return [...rows.values()].sort(byDay).map(row => ({ ...row }))
    },
    async listPending() {
      return [...rows.values()].filter(row => !acked.has(row.d)).sort(byDay).map(row => ({ ...row }))
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
    throw new Error('SQLite weigh-ins need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = db.exec(WEIGH_INS_SCHEMA).catch(error => {
      migrations.delete(db)
      throw error
    })
    migrations.set(db, opening)
  }
  return opening
}

export function createSqliteWeighIns(db) {
  requireDb(db)
  const ready = () => migrate(db)

  return {
    async put(op) {
      await ready()
      const s = normalized(op)
      await db.run(
        `INSERT INTO weigh_ins (d, op, w, t, src, hk, base_t, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(d) DO UPDATE SET op = excluded.op, w = excluded.w, t = excluded.t, src = excluded.src,
           hk = excluded.hk, base_t = excluded.base_t, acked_at = NULL`,
        [s.d, s.op, s.w ?? null, s.t, s.src ?? null, s.hk ?? null, s.baseT ?? null],
      )
      return { ok: true, d: s.d }
    },
    async get(d) {
      await ready()
      const rows = await db.getAll('SELECT * FROM weigh_ins WHERE d = ?', [d])
      return rows.length ? fromRow(rows[0]) : null
    },
    async list() {
      await ready()
      return (await db.getAll('SELECT * FROM weigh_ins ORDER BY d ASC')).map(fromRow)
    },
    async listPending() {
      await ready()
      return (await db.getAll('SELECT * FROM weigh_ins WHERE acked_at IS NULL ORDER BY d ASC')).map(fromRow)
    },
    // A row is acked only if its t is still the one acked: a newer op for the day waits.
    async markAcked(items, at) {
      await ready()
      for (const { d, t } of items) await db.run('UPDATE weigh_ins SET acked_at = ? WHERE d = ? AND t = ? AND acked_at IS NULL', [at, d, t])
      return { ok: true }
    },
    async resetAcked() {
      await ready()
      await db.run('UPDATE weigh_ins SET acked_at = NULL')
      return { ok: true }
    },
  }
}
