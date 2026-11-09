// Local finished workouts. One row per workout id, with the date indexed, holding the
// same JSON the API stores. The handle is injected. This file does not import expo-sqlite
// and does not send anything.

export const FINISHED_WORKOUTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS finished_workouts (
  id TEXT PRIMARY KEY,
  d TEXT NOT NULL,
  body TEXT NOT NULL
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
  }
}

function requireDb(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.run !== 'function' || typeof db.getAll !== 'function') {
    throw new Error('SQLite finished workouts need a db handle with exec, run, and getAll (see storage/db-handle.js)')
  }
}

export function createSqliteFinishedWorkouts(db) {
  requireDb(db)
  let opening = null

  function ready() {
    if (!opening) {
      opening = Promise.resolve(db.exec(FINISHED_WORKOUTS_SCHEMA)).catch(error => {
        opening = null
        throw error
      })
    }
    return opening
  }

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
  }
}
