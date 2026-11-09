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
  if (op.src != null && op.src !== 'health') throw new Error("weigh-in src must be 'health' when present")
  if (op.baseT != null && !Number.isFinite(op.baseT)) throw new Error('weigh-in baseT must be a number')
  if (op.op === 'set' && !(Number.isFinite(op.w) && op.w > 0)) throw new Error('a set weigh-in needs a weight above zero')
}

function requireHealth(op) {
  requireOp(op)
  if (op.src !== 'health') throw new Error("putFromHealth takes only ops with src 'health'")
}

function sameContent(a, b) {
  return a.op === b.op && (a.w ?? null) === (b.w ?? null) && (a.src ?? null) === (b.src ?? null) &&
    (a.hk ?? null) === (b.hk ?? null) && (a.baseT ?? null) === (b.baseT ?? null)
}

// Same t but different content: the row takes t + 1, so an older ack keyed on { d, t }
// cannot settle the new content.
function bumped(stored, existing) {
  return existing && existing.t === stored.t && !sameContent(existing, stored) ? { ...stored, t: stored.t + 1 } : stored
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
      const stored = bumped(normalized(op), rows.get(op?.d))
      rows.set(stored.d, stored)
      acked.delete(stored.d)
      return { ok: true, d: stored.d, t: stored.t }
    },
    // A Health op never replaces a pending typed set (the owner's unsent weight). With no baseT
    // of its own it keeps the baseT of the pending row it replaces, so the entry an unsent typed
    // removal names stays named while the server copy is unknown (unpaired, after Forget).
    async putFromHealth(op) {
      requireHealth(op)
      const stored = normalized(op)
      const existing = rows.get(stored.d)
      const pending = existing && !acked.has(stored.d)
      if (pending && existing.op === 'set' && existing.src == null) return { written: false }
      if (pending && stored.baseT == null && existing.baseT != null) stored.baseT = existing.baseT
      const final = bumped(stored, existing)
      rows.set(final.d, final)
      acked.delete(final.d)
      return { written: true, t: final.t }
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
      let s = normalized(op)
      const found = await db.getAll('SELECT * FROM weigh_ins WHERE d = ?', [s.d])
      s = bumped(s, found.length ? fromRow(found[0]) : null)
      await db.run(
        `INSERT INTO weigh_ins (d, op, w, t, src, hk, base_t, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(d) DO UPDATE SET op = excluded.op, w = excluded.w, t = excluded.t, src = excluded.src,
           hk = excluded.hk, base_t = excluded.base_t, acked_at = NULL`,
        [s.d, s.op, s.w ?? null, s.t, s.src ?? null, s.hk ?? null, s.baseT ?? null],
      )
      return { ok: true, d: s.d, t: s.t }
    },
    // One conditional upsert, the memory store's rules: never over a pending typed set; an op
    // with no base_t keeps a pending row's (SET sees the old row's values).
    async putFromHealth(op) {
      requireHealth(op)
      await ready()
      const s = normalized(op)
      const finalBaseT = 'CASE WHEN excluded.base_t IS NULL AND weigh_ins.acked_at IS NULL THEN weigh_ins.base_t ELSE excluded.base_t END'
      const { changes } = await db.run(
        `INSERT INTO weigh_ins (d, op, w, t, src, hk, base_t, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(d) DO UPDATE SET op = excluded.op, w = excluded.w, src = excluded.src,
           hk = excluded.hk,
           t = CASE WHEN weigh_ins.t = excluded.t AND (weigh_ins.op IS NOT excluded.op OR weigh_ins.w IS NOT excluded.w
                      OR weigh_ins.src IS NOT excluded.src OR weigh_ins.hk IS NOT excluded.hk
                      OR weigh_ins.base_t IS NOT (${finalBaseT}))
                    THEN excluded.t + 1 ELSE excluded.t END,
           base_t = ${finalBaseT},
           acked_at = NULL
         WHERE NOT (weigh_ins.op = 'set' AND weigh_ins.src IS NULL AND weigh_ins.acked_at IS NULL)`,
        [s.d, s.op, s.w ?? null, s.t, s.src, s.hk ?? null, s.baseT ?? null],
      )
      if (!(changes > 0)) return { written: false }
      const rows = await db.getAll('SELECT t FROM weigh_ins WHERE d = ?', [s.d])
      return { written: true, t: rows[0].t }
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
