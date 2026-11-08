import { createSqliteSessionStorage } from '../session/sqlite-storage.js'

// Writes, re-reads and clears a few rows to show SQLite works on the device. The caller passes a
// handle on a scratch database, never the app's own, so this can clear without losing data.
const EVENT = { id: 'probe-1', type: 'probe', at: 1 }
const DRAFT_KEY = 'probe:draft'
const DRAFT = { reps: 5 }

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export async function runStorageProbe(handle) {
  const storage = createSqliteSessionStorage(handle)
  const steps = [
    ['append', async () => {
      const r = await storage.append(EVENT)
      if (!r || r.ok !== true) throw new Error('first append was not stored')
    }],
    ['duplicate', async () => {
      const r = await storage.append(EVENT)
      if (!r || r.duplicate !== true) throw new Error('repeat id was not reported as a duplicate')
    }],
    ['draft', async () => {
      await storage.putDraft(DRAFT_KEY, DRAFT)
      if (!same(await storage.getDraft(DRAFT_KEY), DRAFT)) throw new Error('draft did not read back')
    }],
    ['read back', async () => {
      const events = await storage.readAll()
      if (!same(events, [EVENT])) throw new Error('expected 1 event, got ' + events.length)
    }],
    ['clear', async () => {
      await storage.clear()
      const events = await storage.readAll()
      const drafts = await storage.readDrafts()
      if (events.length || Object.keys(drafts).length) throw new Error('rows remained after clear')
    }],
  ]
  const results = []
  for (const [name, step] of steps) {
    try {
      await step()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, detail: (e && e.message) || String(e) })
      return { ok: false, steps: results }
    }
  }
  return { ok: true, steps: results }
}

const messageOf = e => (e && e.message) || String(e)

// The lines the screen shows. The verdict comes first and always shows; a cleanup failure
// (closing or deleting the scratch database) is a separate line and never replaces it.
// outcome is runStorageProbe's result, or { error } if the probe itself threw.
export function storageCheckLines(outcome, cleanupErrors = []) {
  const lines = []
  if (outcome.error !== undefined) {
    lines.push('Storage check failed: ' + messageOf(outcome.error))
  } else if (outcome.ok) {
    lines.push('Storage check passed')
  } else {
    const failed = outcome.steps[outcome.steps.length - 1]
    lines.push('Storage check failed at ' + failed.name + ': ' + failed.detail)
  }
  for (const e of cleanupErrors) lines.push('cleanup failed: ' + messageOf(e))
  return lines
}
