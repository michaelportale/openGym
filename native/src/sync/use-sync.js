import { useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import { openAppDatabase } from '../storage/database'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { createSqliteMeasurements } from '../body/measurement-store'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqlitePendingEdits } from './pending-edits'
import { createApiClient } from './api-client'
import { createCredentials } from './credentials'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy'
import { createSync } from './sync-engine'
import { shouldSyncOnForeground } from './sync-triggers'
import { statusText } from './sync-status'

// The one sync engine for the app, built on first use from the app database. A failed build is
// not remembered: the next call tries again. The engine never touches the session journal.
let engine = null
let current = null // the latest status, or null before the first read
let readNo = 0
let lastAttemptAt = null
const watchers = new Set()

export function getSync() {
  if (!engine) {
    engine = openAppDatabase()
      .then(db => {
        const sync = createSync({
          client: createApiClient({ fetch: (...args) => fetch(...args) }),
          credentials: createCredentials(SecureStore),
          copy: createSqliteServerCopy(db),
          meta: createSqliteSyncMeta(db),
          workouts: createSqliteFinishedWorkouts(db),
          weighIns: createSqliteWeighIns(db),
          routineEdits: createSqlitePendingEdits(db),
          measurements: createSqliteMeasurements(db),
          now: Date.now,
        })
        sync.subscribe(refresh)
        return sync
      })
      .catch(error => {
        engine = null
        throw error
      })
  }
  return engine
}

// Read the status again and tell the screens. Only the newest read counts.
export function refresh() {
  const no = ++readNo
  return getSync()
    .then(sync => sync.status())
    .then(status => {
      if (no !== readNo) return
      current = status
      for (const fn of [...watchers]) fn(status)
    })
    .catch(() => {})
}

// After a durable Finish. Not throttled; never awaited by the caller's write.
export function syncAfterFinish() {
  lastAttemptAt = Date.now()
  return getSync().then(sync => sync.syncNow()).catch(() => {})
}

// Back in the app: paired only, at most once a minute (shouldSyncOnForeground).
export async function syncOnForeground() {
  try {
    const sync = await getSync()
    const status = await sync.status()
    const now = Date.now()
    if (!shouldSyncOnForeground({ paired: status.paired, lastAt: lastAttemptAt, now })) return
    lastAttemptAt = now
    await sync.syncNow()
  } catch {
    // Syncing is never a reason to disturb the app.
  }
}

const call = name => (...args) => getSync().then(sync => sync[name](...args))

// { status, text, pair, forget, syncNow, resendAll }. status is null until first read. `fresh`
// starts from null rather than the last status read, so the screen shows nothing older than its
// own first read (the saved screen, whose workout the earlier status does not know about).
export function useSync({ fresh = false } = {}) {
  const [status, setStatus] = useState(fresh ? null : current)
  useEffect(() => {
    watchers.add(setStatus)
    refresh()
    return () => { watchers.delete(setStatus) }
  }, [])
  return {
    status,
    text: status ? statusText(status, { now: Date.now() }) : '',
    pair: call('pair'),
    forget: call('forget'),
    syncNow: call('syncNow'),
    resendAll: call('resendAll'),
  }
}
