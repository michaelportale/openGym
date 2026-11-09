// Local routine edits waiting to sync. One row per routine holding what this phone last
// saved for it; acked_at is NULL until the push has settled it, superseded_at is set when
// the server moved on first (the outbox is the rows with both NULL). resent is 1 on an acked
// row resetAcked put back in the outbox (a resend to a restored server) until a put replaces
// it: that edit went out long ago, so if it no longer fits it is settled with no notice
// (markSuperseded acks it). routine and sent are
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
  dismissed INTEGER NOT NULL DEFAULT 0,
  resent INTEGER NOT NULL DEFAULT 0
);
`.trim()

function normalized(edit) {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new Error('routine edit must be an object')
  if (typeof edit.rid !== 'string' || edit.rid === '') throw new Error('routine edit needs a rid')
  if (!edit.routine || typeof edit.routine !== 'object' || Array.isArray(edit.routine)) throw new Error('routine edit needs a routine object')
  if (!Number.isFinite(edit.t)) throw new Error('routine edit needs a time')
  if (edit.baseTs != null && !Number.isFinite(edit.baseTs)) throw new Error('routine edit baseTs must be a number')
  return { rid: edit.rid, baseTs: edit.baseTs ?? null, routine: JSON.parse(JSON.stringify(edit.routine)), t: edit.t, fresh: edit.fresh === true }
}

const isPending = row => row.ackedAt == null && row.supersededAt == null
const publicEdit = row => ({ rid: row.rid, baseTs: row.baseTs, routine: structuredClone(row.routine), sent: row.sent == null ? null : structuredClone(row.sent), t: row.t })
const noticeOf = row => ({ rid: row.rid, name: typeof row.routine.name === 'string' ? row.routine.name : '', kind: row.supersededKind, at: row.supersededAt })
const byT = (a, b) => a.t - b.t
const byAt = (a, b) => (a.supersededAt < b.supersededAt ? -1 : a.supersededAt > b.supersededAt ? 1 : 0)

// The row a put leaves (the memory store; the SQLite store's put states the same rules in SQL, and
// both run the same tests). A pending row keeps its baseTs and sent. An acked one takes the caller's
// baseTs, and its routine, known to be on the server, as sent: a save made on a copy read before
// that ack is then rebased onto it, not taken for a change on the web. A superseded one starts
// fresh, and so does any row on a `fresh` put (an edit made with no server copy held, on the
// bundled snapshot: it was built on neither the old base nor the acked routine). The same t with
// different content moves up one, so an older ack keyed on { rid, t } cannot settle the new content.
function merged({ fresh, ...s }, existing) {
  const keep = !fresh && existing && isPending(existing)
  const acked = !fresh && existing && existing.ackedAt != null && existing.supersededAt == null
  const next = { ...s, baseTs: keep ? existing.baseTs : s.baseTs, sent: keep ? existing.sent : acked ? existing.routine : null,
    ackedAt: null, supersededAt: null, supersededKind: null, dismissed: 0, resent: 0 }
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
    // newer edit was saved after the push read the row. Only while the row's baseTs is the one the
    // push listed: a fresh put since (an edit on the snapshot) was not built on what went out.
    async markSent(items) {
      for (const { rid, baseTs, routine } of items) {
        const row = rows.get(rid)
        if (row && isPending(row) && row.baseTs === (baseTs ?? null)) row.sent = JSON.parse(JSON.stringify(routine))
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
        if (row?.resent) { if (row.ackedAt == null) row.ackedAt = at } else if (row) { row.supersededAt = at; row.supersededKind = kind }
      }
      return { ok: true }
    },
    async listNotices() {
      return [...rows.values()].filter(row => row.supersededAt != null && !row.dismissed).sort(byAt).map(noticeOf)
    },
    // A notice's Dismiss: superseded rows only, so a stale tap never hides a later notice.
    async dismiss(rid) {
      const row = rows.get(rid)
      if (row && row.supersededAt != null) row.dismissed = 1
      return { ok: true }
    },
    async resetAcked() {
      for (const row of rows.values()) if (row.ackedAt != null && row.supersededAt == null) { row.ackedAt = null; row.resent = 1 }
      return { ok: true }
    },
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite routine edits need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema/migration run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = (async () => {
      await db.exec(ROUTINE_EDITS_SCHEMA)
      // A table made before the resent flag: add it once, its rows not resent.
      const columns = await db.getAll('PRAGMA table_info(routine_edits)')
      if (!columns.some(column => column.name === 'resent')) {
        try {
          await db.run('ALTER TABLE routine_edits ADD COLUMN resent INTEGER NOT NULL DEFAULT 0')
        } catch (error) {
          if (!/duplicate column/i.test(String(error?.message))) throw error
        }
      }
    })().catch(error => {
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
    ackedAt: row.acked_at, supersededAt: row.superseded_at, supersededKind: row.superseded_kind, dismissed: row.dismissed, resent: row.resent,
  }
}

export function createSqliteRoutineEdits(db) {
  requireDb(db)
  const ready = () => migrate(db)
  const rowsOf = async (sql, args) => (await db.getAll(sql, args)).map(fromRow)

  return {
    // merged's rules in one statement, which reads the row and writes it with nothing in between:
    // a markSent landing while the put is on its way in is kept. (A BEGIN/COMMIT around a read and
    // a write would not do: every other query on this connection joins an open transaction.) Each
    // SET expression sees the row as it was before the update.
    async put(edit) {
      const s = normalized(edit)
      await ready()
      const fresh = s.fresh ? 1 : 0
      const keep = 'NOT ? AND acked_at IS NULL AND superseded_at IS NULL'
      const base = `CASE WHEN ${keep} THEN base_ts ELSE excluded.base_ts END`
      const rows = await db.getAll(
        `INSERT INTO routine_edits (rid, base_ts, routine, sent, t, acked_at, superseded_at, superseded_kind, dismissed, resent)
         VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, 0)
         ON CONFLICT(rid) DO UPDATE SET
           base_ts = ${base},
           sent = CASE WHEN ${keep} THEN sent WHEN NOT ? AND acked_at IS NOT NULL AND superseded_at IS NULL THEN routine ELSE NULL END,
           t = CASE WHEN t = excluded.t AND (routine IS NOT excluded.routine OR base_ts IS NOT ${base}) THEN excluded.t + 1 ELSE excluded.t END,
           routine = excluded.routine, acked_at = NULL, superseded_at = NULL, superseded_kind = NULL, dismissed = 0, resent = 0
         RETURNING t`,
        [s.rid, s.baseTs, JSON.stringify(s.routine), s.t, fresh, fresh, fresh, fresh],
      )
      return { ok: true, rid: s.rid, t: rows[0].t }
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
      for (const { rid, baseTs, routine } of items) {
        await db.run(
          'UPDATE routine_edits SET sent = ? WHERE rid = ? AND base_ts IS ? AND acked_at IS NULL AND superseded_at IS NULL',
          [JSON.stringify(routine), rid, baseTs ?? null],
        )
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
      // A resent row is acked instead (see the top of this file).
      for (const { rid, t, kind } of items) {
        await db.run(
          `UPDATE routine_edits SET acked_at = CASE WHEN resent = 1 THEN COALESCE(acked_at, ?) ELSE acked_at END,
             superseded_at = CASE WHEN resent = 1 THEN superseded_at ELSE ? END,
             superseded_kind = CASE WHEN resent = 1 THEN superseded_kind ELSE ? END
           WHERE rid = ? AND t = ?`,
          [at, at, kind, rid, t],
        )
      }
      return { ok: true }
    },
    async listNotices() {
      await ready()
      return (await rowsOf('SELECT * FROM routine_edits WHERE superseded_at IS NOT NULL AND dismissed = 0 ORDER BY superseded_at ASC, rid ASC')).map(noticeOf)
    },
    async dismiss(rid) {
      await ready()
      await db.run('UPDATE routine_edits SET dismissed = 1 WHERE rid = ? AND superseded_at IS NOT NULL', [rid])
      return { ok: true }
    },
    async resetAcked() {
      await ready()
      await db.run('UPDATE routine_edits SET acked_at = NULL, resent = 1 WHERE acked_at IS NOT NULL AND superseded_at IS NULL')
      return { ok: true }
    },
  }
}
