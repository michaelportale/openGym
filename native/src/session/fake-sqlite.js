// A tiny database double for the session adapter and the finished-workout store.
// It understands only the statements those files send, including a single transaction
// so clear() can roll back.

function squeeze(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

function cloneTables(tables) {
  return {
    session_events: tables.session_events.map(row => ({ ...row })),
    session_drafts: tables.session_drafts.map(row => ({ ...row })),
    session_base: tables.session_base.map(row => ({ ...row })),
    finished_workouts: tables.finished_workouts.map(row => ({ ...row })),
  }
}

export function createFakeSqliteDb() {
  const tables = { session_events: [], session_drafts: [], session_base: [], finished_workouts: [] }
  let snapshot = null
  const failures = []
  const executed = []
  const holds = []
  const heldWaiters = []
  let releaseHeld = null

  function restore(saved) {
    tables.session_events = saved.session_events
    tables.session_drafts = saved.session_drafts
    tables.session_base = saved.session_base
    tables.finished_workouts = saved.finished_workouts
  }

  async function waitIfHeld(text) {
    const index = holds.findIndex(pattern => pattern.test(text))
    if (index < 0) return
    holds.splice(index, 1)
    await new Promise(resolve => {
      releaseHeld = resolve
      for (const waiter of heldWaiters.splice(0)) waiter()
    })
    releaseHeld = null
  }

  async function run(sql, params = []) {
    const text = squeeze(sql)
    const hit = failures.findIndex(item => item.pattern.test(text))
    if (hit >= 0) {
      executed.push(text)
      const [{ error }] = failures.splice(hit, 1)
      throw error
    }
    await waitIfHeld(text)
    executed.push(text)
    if (/^BEGIN$/i.test(text)) {
      if (snapshot) throw new Error('nested transaction')
      snapshot = cloneTables(tables)
      return { changes: 0 }
    }
    if (/^COMMIT$/i.test(text)) {
      snapshot = null
      return { changes: 0 }
    }
    if (/^ROLLBACK$/i.test(text)) {
      if (snapshot) restore(snapshot)
      snapshot = null
      return { changes: 0 }
    }
    if (/^CREATE TABLE IF NOT EXISTS /i.test(text)) return { changes: 0 }
    if (/^CREATE INDEX IF NOT EXISTS /i.test(text)) return { changes: 0 }
    if (/^INSERT INTO finished_workouts /i.test(text)) {
      const [id, d, body] = params
      const existing = tables.finished_workouts.find(row => row.id === id)
      if (existing) {
        existing.d = d
        existing.body = body
      } else {
        tables.finished_workouts.push({ id, d, body })
      }
      return { changes: 1 }
    }
    if (/^INSERT OR IGNORE INTO session_events /i.test(text)) {
      const [id, at, type, body] = params
      if (tables.session_events.some(row => row.id === id)) return { changes: 0 }
      tables.session_events.push({ id, at, type, body, rowid: tables.session_events.length + 1 })
      return { changes: 1 }
    }
    if (/^DELETE FROM session_events$/i.test(text)) {
      const changes = tables.session_events.length
      tables.session_events = []
      return { changes }
    }
    if (/^INSERT OR REPLACE INTO session_drafts /i.test(text)) {
      const [setId, body] = params
      const existing = tables.session_drafts.find(row => row.set_id === setId)
      if (existing) existing.body = body
      else tables.session_drafts.push({ set_id: setId, body, rowid: tables.session_drafts.length + 1 })
      return { changes: 1 }
    }
    if (/^DELETE FROM session_drafts WHERE set_id = \?$/i.test(text)) {
      const before = tables.session_drafts.length
      tables.session_drafts = tables.session_drafts.filter(row => row.set_id !== params[0])
      return { changes: before - tables.session_drafts.length }
    }
    if (/^DELETE FROM session_drafts$/i.test(text)) {
      const changes = tables.session_drafts.length
      tables.session_drafts = []
      return { changes }
    }
    if (/^INSERT OR REPLACE INTO session_base /i.test(text)) {
      const [id, body] = params
      const existing = tables.session_base.find(row => row.id === id)
      if (existing) existing.body = body
      else tables.session_base.push({ id, body })
      return { changes: 1 }
    }
    if (/^DELETE FROM session_base$/i.test(text)) {
      const changes = tables.session_base.length
      tables.session_base = []
      return { changes }
    }
    if (/^UPDATE session_base SET body = json_set\(body, '\$\._sessionLastSeen', \?, '\$\._sessionSeenTrail', json\(\?\)\) WHERE id = 1$/i.test(text)) {
      const row = tables.session_base.find(item => item.id === 1)
      if (!row) return { changes: 0 }
      const body = JSON.parse(row.body)
      body._sessionLastSeen = params[0]
      body._sessionSeenTrail = JSON.parse(params[1])
      row.body = JSON.stringify(body)
      return { changes: 1 }
    }
    throw new Error(`fake sqlite cannot run: ${text}`)
  }

  async function getAll(sql, params = []) {
    const text = squeeze(sql)
    executed.push(text)
    if (/FROM session_events/i.test(text)) {
      return [...tables.session_events]
        .sort((a, b) => a.rowid - b.rowid)
        .map(row => ({ id: row.id, at: row.at, type: row.type, body: row.body }))
    }
    if (/FROM session_drafts/i.test(text)) {
      const rows = [...tables.session_drafts].sort((a, b) => a.rowid - b.rowid)
      const matched = /WHERE set_id = \?/i.test(text) ? rows.filter(row => row.set_id === params[0]) : rows
      return matched.map(row => ({ set_id: row.set_id, body: row.body }))
    }
    if (/FROM finished_workouts/i.test(text)) {
      let rows = [...tables.finished_workouts]
      if (/WHERE id = \?/i.test(text)) rows = rows.filter(row => row.id === params[0])
      if (/ORDER BY d/i.test(text)) {
        rows.sort((a, b) => (a.d === b.d ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.d < b.d ? -1 : 1))
      }
      return rows.map(row => ({ id: row.id, d: row.d, body: row.body }))
    }
    if (/FROM session_base/i.test(text)) {
      return tables.session_base
        .filter(row => params.length === 0 || row.id === params[0])
        .map(row => ({ body: row.body }))
    }
    throw new Error(`fake sqlite cannot read: ${text}`)
  }

  return {
    executed,
    exec: async sql => {
      executed.push(sql)
      const parts = String(sql).split(';').map(part => part.trim()).filter(Boolean)
      for (const part of parts) await run(part)
    },
    run,
    getAll,
    failNext(pattern, error) {
      failures.push({ pattern, error })
    },
    holdNext(pattern) {
      holds.push(pattern)
    },
    held() {
      if (releaseHeld) return Promise.resolve()
      return new Promise(resolve => heldWaiters.push(resolve))
    },
    release() {
      const resume = releaseHeld
      releaseHeld = null
      if (resume) resume()
    },
  }
}
