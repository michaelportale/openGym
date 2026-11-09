// Local edits waiting to sync: routines, nutrition days and settings (edit-guard.js settles each
// kind). One row per kind and key holding what this phone last saved for it; acked_at is NULL until
// the push has settled it, superseded_at is set when the server moved on first (the outbox is the
// rows with both NULL). resent is 1 on an acked row resetAcked put back in the outbox (a resend to
// a restored server) until a put replaces it: that edit went out long ago, so if it no longer fits
// it is settled with no notice (markSuperseded acks it). value and sent are JSON text in SQLite and
// values here. The handle is injected. This file does not import expo-sqlite and does not send
// anything. Columns are snake_case; edits are camelCase: { kind, key, baseTs, value, sent, t }.

export const PENDING_EDITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS pending_edits (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  base_ts INTEGER,
  value TEXT NOT NULL,
  sent TEXT,
  t INTEGER NOT NULL,
  acked_at TEXT,
  superseded_at TEXT,
  superseded_kind TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0,
  resent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, key)
);
`.trim()

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
// What each kind's value is: a routine and a day are objects; a setting (nutritionTargets,
// supplements) an object or a list.
const VALUE_OK = { routine: isMap, nutritionDay: isMap, setting: v => !!v && typeof v === 'object' }
// A setting row replaces state[key] whole in a push (edit-guard.js): only the two the Nutrition
// screen owns, never a container such as routines, nutritionDays or edited.
const SETTING_KEYS = new Set(['nutritionTargets', 'supplements'])

function normalized(edit) {
  if (!isMap(edit)) throw new Error('pending edit must be an object')
  if (!Object.hasOwn(VALUE_OK, edit.kind)) throw new Error('pending edit needs a known kind')
  if (typeof edit.key !== 'string' || edit.key === '') throw new Error('pending edit needs a key')
  if (edit.kind === 'setting' && !SETTING_KEYS.has(edit.key)) throw new Error('pending setting edit needs nutritionTargets or supplements as its key')
  if (!VALUE_OK[edit.kind](edit.value)) throw new Error(`pending ${edit.kind} edit needs an object value`)
  if (!Number.isFinite(edit.t)) throw new Error('pending edit needs a time')
  if (edit.baseTs != null && !Number.isFinite(edit.baseTs)) throw new Error('pending edit baseTs must be a number')
  return { kind: edit.kind, key: edit.key, baseTs: edit.baseTs ?? null, value: JSON.parse(JSON.stringify(edit.value)), t: edit.t, fresh: edit.fresh === true }
}

const isPending = row => row.ackedAt == null && row.supersededAt == null
const publicEdit = row => ({ kind: row.kind, key: row.key, baseTs: row.baseTs, value: structuredClone(row.value), sent: row.sent == null ? null : structuredClone(row.sent), t: row.t })
// A routine is named by its name; a day by its date and a setting by its key (the screens word them).
const nameOf = row => (row.kind !== 'routine' ? row.key : typeof row.value.name === 'string' ? row.value.name : '')
const noticeOf = row => ({ kind: row.kind, key: row.key, name: nameOf(row), reason: row.reason, at: row.supersededAt })
const byT = (a, b) => a.t - b.t
const byAt = (a, b) => (a.supersededAt < b.supersededAt ? -1 : a.supersededAt > b.supersededAt ? 1 : 0)
const ofKind = kind => row => kind == null || row.kind === kind

// The row a put leaves (the memory store; the SQLite store's put states the same rules in SQL, and
// both run the same tests). A pending row keeps its baseTs and sent. An acked one takes the caller's
// baseTs, and its value, known to be on the server, as sent: a save made on a copy read before
// that ack is then rebased onto it, not taken for a change on the web. A superseded one starts
// fresh, and so does any row on a `fresh` put (an edit made with no server copy held, on the
// bundled snapshot: it was built on neither the old base nor the acked value). The same t with
// different content moves up one, so an older ack keyed on { kind, key, t } cannot settle the new content.
function merged({ fresh, ...s }, existing) {
  const keep = !fresh && existing && isPending(existing)
  const acked = !fresh && existing && existing.ackedAt != null && existing.supersededAt == null
  const next = { ...s, baseTs: keep ? existing.baseTs : s.baseTs, sent: keep ? existing.sent : acked ? existing.value : null,
    ackedAt: null, supersededAt: null, reason: null, dismissed: 0, resent: 0 }
  if (existing && existing.t === next.t &&
    (JSON.stringify(existing.value) !== JSON.stringify(next.value) || existing.baseTs !== next.baseTs)) next.t += 1
  return next
}

export function createMemoryPendingEdits() {
  const rows = new Map()
  const id = (kind, key) => JSON.stringify([kind, key])
  const live = (kind, key, t) => {
    const row = rows.get(id(kind, key))
    return row && row.t === t ? row : null
  }
  return {
    async put(edit) {
      const s = normalized(edit)
      const next = merged(s, rows.get(id(s.kind, s.key)))
      rows.set(id(s.kind, s.key), next)
      return { ok: true, kind: next.kind, key: next.key, t: next.t }
    },
    async get(kind, key) {
      const row = rows.get(id(kind, key))
      return row ? publicEdit(row) : null
    },
    // Every kind, or the one asked for.
    async listPending({ kind } = {}) {
      return [...rows.values()].filter(ofKind(kind)).filter(isPending).sort(byT).map(publicEdit)
    },
    // By key on any pending row, whatever its t: what went out is what went out, even when a
    // newer edit was saved after the push read the row. Only while the row's baseTs is the one the
    // push listed: a fresh put since (an edit on the snapshot) was not built on what went out.
    async markSent(items) {
      for (const { kind, key, baseTs, value } of items) {
        const row = rows.get(id(kind, key))
        if (row && isPending(row) && row.baseTs === (baseTs ?? null)) row.sent = JSON.parse(JSON.stringify(value))
      }
      return { ok: true }
    },
    async markAcked(items, at) {
      for (const { kind, key, t } of items) {
        const row = live(kind, key, t)
        if (row && row.ackedAt == null) row.ackedAt = at
      }
      return { ok: true }
    },
    async rebase(items) {
      for (const { kind, key, t, baseTs } of items) {
        const row = live(kind, key, t)
        if (row) { row.baseTs = baseTs ?? null; row.sent = null }
      }
      return { ok: true }
    },
    async markSuperseded(items, at) {
      for (const { kind, key, t, reason } of items) {
        const row = live(kind, key, t)
        if (row?.resent) { if (row.ackedAt == null) row.ackedAt = at } else if (row) { row.supersededAt = at; row.reason = reason }
      }
      return { ok: true }
    },
    async listNotices({ kind } = {}) {
      return [...rows.values()].filter(ofKind(kind)).filter(row => row.supersededAt != null && !row.dismissed).sort(byAt).map(noticeOf)
    },
    // A notice's Dismiss: superseded rows only, so a stale tap never hides a later notice.
    async dismiss(kind, key) {
      const row = rows.get(id(kind, key))
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
    throw new Error('SQLite pending edits need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema/migration run per db handle, shared by every store made on it.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = db.exec(PENDING_EDITS_SCHEMA).catch(error => {
      migrations.delete(db)
      throw error
    })
    migrations.set(db, opening)
  }
  return opening
}

function fromRow(row) {
  return {
    kind: row.kind, key: row.key, baseTs: row.base_ts, value: JSON.parse(row.value),
    sent: row.sent == null ? null : JSON.parse(row.sent), t: row.t,
    ackedAt: row.acked_at, supersededAt: row.superseded_at, reason: row.superseded_kind, dismissed: row.dismissed, resent: row.resent,
  }
}

export function createSqlitePendingEdits(db) {
  requireDb(db)
  const ready = () => migrate(db)
  const rowsOf = async (sql, args) => (await db.getAll(sql, args)).map(fromRow)
  // `AND kind = ?` with its argument when one kind is asked for.
  const kindClause = kind => (kind == null ? ['', []] : [' AND kind = ?', [kind]])

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
        `INSERT INTO pending_edits (kind, key, base_ts, value, sent, t, acked_at, superseded_at, superseded_kind, dismissed, resent)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, 0)
         ON CONFLICT(kind, key) DO UPDATE SET
           base_ts = ${base},
           sent = CASE WHEN ${keep} THEN sent WHEN NOT ? AND acked_at IS NOT NULL AND superseded_at IS NULL THEN value ELSE NULL END,
           t = CASE WHEN t = excluded.t AND (value IS NOT excluded.value OR base_ts IS NOT ${base}) THEN excluded.t + 1 ELSE excluded.t END,
           value = excluded.value, acked_at = NULL, superseded_at = NULL, superseded_kind = NULL, dismissed = 0, resent = 0
         RETURNING t`,
        [s.kind, s.key, s.baseTs, JSON.stringify(s.value), s.t, fresh, fresh, fresh, fresh],
      )
      return { ok: true, kind: s.kind, key: s.key, t: rows[0].t }
    },
    async get(kind, key) {
      await ready()
      const rows = await rowsOf('SELECT * FROM pending_edits WHERE kind = ? AND key = ?', [kind, key])
      return rows.length ? publicEdit(rows[0]) : null
    },
    async listPending({ kind } = {}) {
      await ready()
      const [only, args] = kindClause(kind)
      return (await rowsOf(`SELECT * FROM pending_edits WHERE acked_at IS NULL AND superseded_at IS NULL${only} ORDER BY t ASC, kind ASC, key ASC`, args)).map(publicEdit)
    },
    async markSent(items) {
      await ready()
      for (const { kind, key, baseTs, value } of items) {
        await db.run(
          'UPDATE pending_edits SET sent = ? WHERE kind = ? AND key = ? AND base_ts IS ? AND acked_at IS NULL AND superseded_at IS NULL',
          [JSON.stringify(value), kind, key, baseTs ?? null],
        )
      }
      return { ok: true }
    },
    async markAcked(items, at) {
      await ready()
      for (const { kind, key, t } of items) await db.run('UPDATE pending_edits SET acked_at = ? WHERE kind = ? AND key = ? AND t = ? AND acked_at IS NULL', [at, kind, key, t])
      return { ok: true }
    },
    async rebase(items) {
      await ready()
      for (const { kind, key, t, baseTs } of items) await db.run('UPDATE pending_edits SET base_ts = ?, sent = NULL WHERE kind = ? AND key = ? AND t = ?', [baseTs ?? null, kind, key, t])
      return { ok: true }
    },
    async markSuperseded(items, at) {
      await ready()
      // A resent row is acked instead (see the top of this file).
      for (const { kind, key, t, reason } of items) {
        await db.run(
          `UPDATE pending_edits SET acked_at = CASE WHEN resent = 1 THEN COALESCE(acked_at, ?) ELSE acked_at END,
             superseded_at = CASE WHEN resent = 1 THEN superseded_at ELSE ? END,
             superseded_kind = CASE WHEN resent = 1 THEN superseded_kind ELSE ? END
           WHERE kind = ? AND key = ? AND t = ?`,
          [at, at, reason, kind, key, t],
        )
      }
      return { ok: true }
    },
    async listNotices({ kind } = {}) {
      await ready()
      const [only, args] = kindClause(kind)
      return (await rowsOf(`SELECT * FROM pending_edits WHERE superseded_at IS NOT NULL AND dismissed = 0${only} ORDER BY superseded_at ASC, kind ASC, key ASC`, args)).map(noticeOf)
    },
    async dismiss(kind, key) {
      await ready()
      await db.run('UPDATE pending_edits SET dismissed = 1 WHERE kind = ? AND key = ? AND superseded_at IS NOT NULL', [kind, key])
      return { ok: true }
    },
    async resetAcked() {
      await ready()
      await db.run('UPDATE pending_edits SET acked_at = NULL, resent = 1 WHERE acked_at IS NOT NULL AND superseded_at IS NULL')
      return { ok: true }
    },
  }
}
