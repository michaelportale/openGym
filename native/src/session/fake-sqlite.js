// A tiny database double for the session adapter. It understands only the statements
// sqlite-storage.js sends, including a single transaction so clear() can roll back.

function squeeze(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

function cloneTables(tables) {
  return {
    session_events: tables.session_events.map(row => ({ ...row })),
    session_drafts: tables.session_drafts.map(row => ({ ...row })),
    session_base: tables.session_base.map(row => ({ ...row })),
  }
}

export function createFakeSqliteDb() {
  const tables = { session_events: [], session_drafts: [], session_base: [] }
  let snapshot = null
  let pending = null
  const executed = []

  function restore(saved) {
    tables.session_events = saved.session_events
    tables.session_drafts = saved.session_drafts
    tables.session_base = saved.session_base
  }

  async function run(sql, params = []) {
    const text = squeeze(sql)
    executed.push(text)
    if (pending && pending.pattern.test(text)) {
      const error = pending.error
      pending = null
      throw error
    }
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
      pending = { pattern, error }
    },
  }
}
