// Local routine edits waiting to sync. One row per routine holding what this phone last
// saved for it; acked_at is NULL until the push has settled it, superseded_at is set when
// the server moved on first (the outbox is the rows with both NULL). routine and sent are
// JSON text in SQLite and objects here. The handle is injected. This file does not import
// expo-sqlite and does not send anything. Columns are snake_case; edits are camelCase.

export const ROUTINE_EDITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS routine_edits (
  rid TEXT PRIMARY KEY,
  base_ts INTEGER,
  routine TEXT NOT NULL,
  sent TEXT,
  t INTEGER NOT NULL,
  acked_at TEXT,
  superseded_at TEXT,
  superseded_kind TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0
);
`.trim()

function normalized(edit) {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new Error('routine edit must be an object')
  if (typeof edit.rid !== 'string' || edit.rid === '') throw new Error('routine edit needs a rid')
  if (!edit.routine || typeof edit.routine !== 'object' || Array.isArray(edit.routine)) throw new Error('routine edit needs a routine object')
  if (!Number.isFinite(edit.t)) throw new Error('routine edit needs a time')
  if (edit.baseTs != null && !Number.isFinite(edit.baseTs)) throw new Error('routine edit baseTs must be a number')
  return { rid: edit.rid, baseTs: edit.baseTs ?? null, routine: JSON.parse(JSON.stringify(edit.routine)), t: edit.t }
}

const isPending = row => row.ackedAt == null && row.supersededAt == null
const publicEdit = row => ({ rid: row.rid, baseTs: row.baseTs, routine: structuredClone(row.routine), sent: row.sent == null ? null : structuredClone(row.sent), t: row.t })
const noticeOf = row => ({ rid: row.rid, name: typeof row.routine.name === 'string' ? row.routine.name : '', kind: row.supersededKind, at: row.supersededAt })
const byT = (a, b) => a.t - b.t
const byAt = (a, b) => (a.supersededAt < b.supersededAt ? -1 : a.supersededAt > b.supersededAt ? 1 : 0)

// The row a put leaves. A pending row keeps its baseTs and sent; an acked or superseded one
// starts fresh. The same t with different content moves up one, so an older ack keyed on
// { rid, t } cannot settle the new content.
function merged(s, existing) {
  const keep = existing && isPending(existing)
  const next = { ...s, baseTs: keep ? existing.baseTs : s.baseTs, sent: keep ? existing.sent : null,
    ackedAt: null, supersededAt: null, supersededKind: null, dismissed: 0 }
  if (existing && existing.t === next.t &&
    (JSON.stringify(existing.routine) !== JSON.stringify(next.routine) || existing.baseTs !== next.baseTs)) next.t += 1
  return next
}

export function createMemoryRoutineEdits() {
  const rows = new Map()
  const live = (rid, t) => {
    const row = rows.get(rid)
    return row && row.t === t ? row : null
  }
  return {
    async put(edit) {
      const next = merged(normalized(edit), rows.get(edit.rid))
      rows.set(next.rid, next)
      return { ok: true, rid: next.rid, t: next.t }
    },
    async get(rid) {
      const row = rows.get(rid)
      return row ? publicEdit(row) : null
    },
    async list() {
      return [...rows.values()].sort(byT).map(publicEdit)
    },
    async listPending() {
      return [...rows.values()].filter(isPending).sort(byT).map(publicEdit)
    },
    // By rid on any pending row, whatever its t: what went out is what went out, even when a
    // newer edit was saved after the push read the row.
    async markSent(items) {
      for (const { rid, routine } of items) {
        const row = rows.get(rid)
        if (row && isPending(row)) row.sent = JSON.parse(JSON.stringify(routine))
      }
      return { ok: true }
    },
    async markAcked(items, at) {
      for (const { rid, t } of items) {
        const row = live(rid, t)
        if (row && row.ackedAt == null) row.ackedAt = at
      }
      return { ok: true }
    },
    async rebase(items) {
      for (const { rid, t, baseTs } of items) {
        const row = live(rid, t)
        if (row) { row.baseTs = baseTs ?? null; row.sent = null }
      }
      return { ok: true }
    },
    async markSuperseded(items, at) {
      for (const { rid, t, kind } of items) {
        const row = live(rid, t)
        if (row) { row.supersededAt = at; row.supersededKind = kind }
      }
      return { ok: true }
    },
    async listNotices() {
      return [...rows.values()].filter(row => row.supersededAt != null && !row.dismissed).sort(byAt).map(noticeOf)
    },
    async dismiss(rid) {
      const row = rows.get(rid)
      if (row) row.dismissed = 1
      return { ok: true }
    },
    async resetAcked() {
      for (const row of rows.values()) if (row.ackedAt != null && row.supersededAt == null) row.ackedAt = null
      return { ok: true }
    },
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite routine edits need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = db.exec(ROUTINE_EDITS_SCHEMA).catch(error => {
      migrations.delete(db)
      throw error
    })
    migrations.set(db, opening)
  }
  return opening
}

function fromRow(row) {
  return {
    rid: row.rid, baseTs: row.base_ts, routine: JSON.parse(row.routine),
    sent: row.sent == null ? null : JSON.parse(row.sent), t: row.t,
    ackedAt: row.acked_at, supersededAt: row.superseded_at, supersededKind: row.superseded_kind, dismissed: row.dismissed,
  }
}

export function createSqliteRoutineEdits(db) {
  requireDb(db)
  const ready = () => migrate(db)
  const rowsOf = async (sql, args) => (await db.getAll(sql, args)).map(fromRow)

  return {
    async put(edit) {
      const s = normalized(edit)
      await ready()
      const found = await rowsOf('SELECT * FROM routine_edits WHERE rid = ?', [s.rid])
      const next = merged(s, found[0])
      await db.run(
        `INSERT INTO routine_edits (rid, base_ts, routine, sent, t, acked_at, superseded_at, superseded_kind, dismissed)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0)
         ON CONFLICT(rid) DO UPDATE SET base_ts = excluded.base_ts, routine = excluded.routine, sent = excluded.sent,
           t = excluded.t, acked_at = NULL, superseded_at = NULL, superseded_kind = NULL, dismissed = 0`,
        [next.rid, next.baseTs, JSON.stringify(next.routine), next.sent == null ? null : JSON.stringify(next.sent), next.t],
      )
      return { ok: true, rid: next.rid, t: next.t }
    },
    async get(rid) {
      await ready()
      const rows = await rowsOf('SELECT * FROM routine_edits WHERE rid = ?', [rid])
      return rows.length ? publicEdit(rows[0]) : null
    },
    async list() {
      await ready()
      return (await rowsOf('SELECT * FROM routine_edits ORDER BY t ASC, rid ASC')).map(publicEdit)
    },
    async listPending() {
      await ready()
      return (await rowsOf('SELECT * FROM routine_edits WHERE acked_at IS NULL AND superseded_at IS NULL ORDER BY t ASC, rid ASC')).map(publicEdit)
    },
    async markSent(items) {
      await ready()
      for (const { rid, routine } of items) {
        await db.run('UPDATE routine_edits SET sent = ? WHERE rid = ? AND acked_at IS NULL AND superseded_at IS NULL', [JSON.stringify(routine), rid])
      }
      return { ok: true }
    },
    async markAcked(items, at) {
      await ready()
      for (const { rid, t } of items) await db.run('UPDATE routine_edits SET acked_at = ? WHERE rid = ? AND t = ? AND acked_at IS NULL', [at, rid, t])
      return { ok: true }
    },
    async rebase(items) {
      await ready()
      for (const { rid, t, baseTs } of items) await db.run('UPDATE routine_edits SET base_ts = ?, sent = NULL WHERE rid = ? AND t = ?', [baseTs ?? null, rid, t])
      return { ok: true }
    },
    async markSuperseded(items, at) {
      await ready()
      for (const { rid, t, kind } of items) await db.run('UPDATE routine_edits SET superseded_at = ?, superseded_kind = ? WHERE rid = ? AND t = ?', [at, kind, rid, t])
      return { ok: true }
    },
    async listNotices() {
      await ready()
      return (await rowsOf('SELECT * FROM routine_edits WHERE superseded_at IS NOT NULL AND dismissed = 0 ORDER BY superseded_at ASC, rid ASC')).map(noticeOf)
    },
    async dismiss(rid) {
      await ready()
      await db.run('UPDATE routine_edits SET dismissed = 1 WHERE rid = ?', [rid])
      return { ok: true }
    },
    async resetAcked() {
      await ready()
      await db.run('UPDATE routine_edits SET acked_at = NULL WHERE acked_at IS NOT NULL AND superseded_at IS NULL')
      return { ok: true }
    },
  }
}
