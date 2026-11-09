import { expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { plannedSetId } from '../session/session.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { activeSessionController } from '../session/use-active-session.js'
import { createCredentials } from './credentials.js'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'
import { createSync } from './sync-engine.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const BASE = 'https://gym.example.com'

const base = () => ({
  id: 'session-1', d: '2026-11-07', start: T0, name: 'Push', routineIds: ['routine-1'],
  entries: [{ id: 'bench', target: { sets: 2, reps: 5 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] }],
})

// Everything the session owns, as stored.
const journal = async db => ({
  events: await db.getAll('SELECT * FROM session_events ORDER BY rowid'),
  drafts: await db.getAll('SELECT * FROM session_drafts ORDER BY 1'),
  base: await db.getAll('SELECT * FROM session_base ORDER BY 1'),
})

test.each(SQLITE_DRIVERS)('%s: a sync that runs mid-session leaves the journal and its fold exactly as they were', async (_n, createDb) => {
  const db = createDb()
  const controller = activeSessionController({ db, base: base(), now: () => T0 + 60_000, timeZone: 'UTC' })
  await controller.open()
  await controller.call('commitSet', { eventId: 'bench-0', exerciseId: 'bench', setId: plannedSetId('bench', 0), fields: { w: 60, r: 5 } })
  await controller.call('putDraft', plannedSetId('bench', 1), { w: 62.5, r: 4 })

  const before = await journal(db)
  const foldBefore = JSON.stringify(controller.getState().view)
  expect(before.events.length).toBeGreaterThan(0)

  const store = new Map()
  const keychain = { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x', getItemAsync: async k => store.get(k) ?? null, setItemAsync: async (k, v) => { store.set(k, v) }, deleteItemAsync: async k => { store.delete(k) } }
  const credentials = createCredentials(keychain)
  const meta = createSqliteSyncMeta(db)
  await credentials.set({ token: 'T1' })
  await meta.set('server', BASE)
  const doc = { unit: 'kg', routines: [], workouts: [], _rev: 1, _wid: 'w1', _wids: [] }
  const client = {
    me: async () => ({ ok: true, user: { id: 'u1', name: 'Mo' } }),
    rev: async () => ({ ok: true, rev: 1, wid: 'w1' }),
    pull: async () => ({ ok: true, state: JSON.parse(JSON.stringify(doc)), rev: 1 }),
    push: async () => ({ ok: true, rev: 2, wid: 'w2' }),
  }
  const finished = createSqliteFinishedWorkouts(db)
  await finished.put({ id: 'old-1', d: '2026-11-01', start: T0, end: T0 + 1000, name: 'Pull', entries: [], vol: 0 })
  const sync = createSync({ client, credentials, copy: createSqliteServerCopy(db), workouts: finished, meta, now: () => T0 + 120_000 })

  const status = await sync.syncNow()
  expect(status).toMatchObject({ paired: true, state: 'idle' })
  expect(await sync.forget()).toMatchObject({ paired: false })

  expect(await journal(db)).toEqual(before)
  await controller.refresh()
  expect(JSON.stringify(controller.getState().view)).toBe(foldBefore)
})
