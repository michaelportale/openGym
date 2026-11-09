// Local finished workouts. One row per workout id, with the date indexed, holding the
// same JSON the API stores. acked_at is NULL until the server has the workout (the outbox
// is the rows still NULL). The handle is injected. This file does not import expo-sqlite
// and does not send anything.

export const FINISHED_WORKOUTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS finished_workouts (
  id TEXT PRIMARY KEY,
  d TEXT NOT NULL,
  body TEXT NOT NULL,
  acked_at TEXT
);
CREATE INDEX IF NOT EXISTS finished_workouts_d ON finished_workouts (d);
`.trim()

function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

function requireWorkout(workout) {
  if (!workout || typeof workout !== 'object' || Array.isArray(workout)) {
    throw new Error('finished workout must be an object')
  }
  if (typeof workout.id !== 'string' || workout.id === '') throw new Error('finished workout needs an id')
  if (typeof workout.d !== 'string' || workout.d === '') throw new Error('finished workout needs a date')
}

function byDateThenId(a, b) {
  if (a.d === b.d) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  return a.d < b.d ? -1 : 1
}

export function createMemoryFinishedWorkouts() {
  const rows = new Map()
  const acked = new Map()
  return {
    async put(workout) {
      requireWorkout(workout)
      const stored = copy(workout)
      rows.set(stored.id, stored)
      return { ok: true, id: stored.id }
    },
    async get(id) {
      const row = rows.get(id)
      return row ? copy(row) : null
    },
    async list() {
      return [...rows.values()].sort(byDateThenId).map(copy)
    },
    async listPending() {
      return [...rows.values()].filter(row => !acked.has(row.id)).sort(byDateThenId).map(copy)
    },
    async markAcked(ids, at) {
      for (const id of ids) if (rows.has(id) && !acked.has(id)) acked.set(id, at)
      return { ok: true }
    },
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite finished workouts need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

// One schema/migration run per db handle, shared by every store made on it (several screens
// each make their own), so two opens cannot both try the ALTER.
const migrations = new WeakMap()

function migrate(db) {
  let opening = migrations.get(db)
  if (!opening) {
    opening = (async () => {
      await db.exec(FINISHED_WORKOUTS_SCHEMA)
      // A table made before Phase 5 has no acked_at: add it once. Its rows stay NULL, so
      // every workout already on the phone is still to be sent.
      const columns = await db.getAll('PRAGMA table_info(finished_workouts)')
      if (!columns.some(column => column.name === 'acked_at')) {
        try {
          await db.run('ALTER TABLE finished_workouts ADD COLUMN acked_at TEXT')
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

export function createSqliteFinishedWorkouts(db) {
  requireDb(db)
  const ready = () => migrate(db)

  return {
    async put(workout) {
      await ready()
      requireWorkout(workout)
      const stored = copy(workout)
      await db.run(
        `INSERT INTO finished_workouts (id, d, body) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET d = excluded.d, body = excluded.body`,
        [stored.id, stored.d, JSON.stringify(stored)],
      )
      return { ok: true, id: stored.id }
    },
    async get(id) {
      await ready()
      const rows = await db.getAll('SELECT body FROM finished_workouts WHERE id = ?', [id])
      return rows.length ? JSON.parse(rows[0].body) : null
    },
    async list() {
      await ready()
      const rows = await db.getAll('SELECT body FROM finished_workouts ORDER BY d ASC, id ASC')
      return rows.map(row => JSON.parse(row.body))
    },
    async listPending() {
      await ready()
      const rows = await db.getAll('SELECT body FROM finished_workouts WHERE acked_at IS NULL ORDER BY d ASC, id ASC')
      return rows.map(row => JSON.parse(row.body))
    },
    async markAcked(ids, at) {
      await ready()
      for (const id of ids) await db.run('UPDATE finished_workouts SET acked_at = ? WHERE id = ? AND acked_at IS NULL', [at, id])
      return { ok: true }
    },
  }
}
