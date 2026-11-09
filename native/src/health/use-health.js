import { useEffect, useState } from 'react'
import { openAppDatabase } from '../storage/database'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createHealthSync } from './health-sync'
import { createSqliteHealthStore } from './health-store'
import * as adapter from './healthkit'
import { readCopy, createSqliteServerCopy } from '../sync/server-copy'
import { shouldSyncOnForeground } from '../sync/sync-triggers'
import { getSync } from '../sync/use-sync'

// The one Health engine for the app, built on first use from the app database. A failed build is
// not remembered: the next call tries again. Nothing here reaches the session journal. Imported
// weigh-ins go to the server through the one sync engine (getSync).
let engine = null
let current = null // the latest status, or null before the first read
let readNo = 0
let lastAttemptAt = null
const watchers = new Set()

export function getHealth() {
  if (!engine) {
    engine = openAppDatabase()
      .then(db => {
        const copy = createSqliteServerCopy(db)
        const health = createHealthSync({
          adapter,
          store: createSqliteHealthStore(db),
          workouts: createSqliteFinishedWorkouts(db),
          now: Date.now,
          weighIns: createSqliteWeighIns(db),
          readCopy: () => readCopy(copy),
          ownBundleId: adapter.ownBundleId, // the engine keeps the first answer
          timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          // An import that wrote an op sends it to the server on its own; the Health pass and
          // the server sync otherwise stay independent.
          onWeighIns: () => getSync().then(sync => sync.syncNow()).catch(() => {}),
        })
        health.subscribe(refresh)
        return health
      })
      .catch(error => {
        engine = null
        throw error
      })
  }
  return engine
}

// Read the status again and tell the screens. Only the newest read counts.
function refresh() {
  if (watchers.size === 0) return Promise.resolve() // nobody is looking: no read
  const no = ++readNo
  return getHealth()
    .then(health => health.status())
    .then(status => {
      if (no !== readNo) return
      current = status
      for (const fn of [...watchers]) fn(status)
    })
    .catch(() => {})
}

// After a durable Finish. Never awaited by the caller's write.
export function healthAfterFinish() {
  lastAttemptAt = Date.now()
  return getHealth().then(health => health.run()).catch(() => {})
}

// Back in the app: at most once a minute, like the server sync (shouldSyncOnForeground). With
// Health on, every pass reads body-mass changes from HealthKit, even with no workout to write.
export function healthOnForeground() {
  const now = Date.now()
  // Throttled: no pass, but a watching screen still re-reads, so a changed write access shows at once.
  if (!shouldSyncOnForeground({ paired: true, lastAt: lastAttemptAt, now })) return refresh()
  lastAttemptAt = now
  return getHealth().then(health => health.run()).catch(() => {})
}

const call = name => (...args) => getHealth().then(health => health[name](...args))

// { status, enable, disable, retry }. status is null until first read.
export function useHealth() {
  const [status, setStatus] = useState(current)
  useEffect(() => {
    watchers.add(setStatus)
    refresh()
    return () => { watchers.delete(setStatus) }
  }, [])
  return { status, enable: call('enable'), disable: call('disable'), retry: call('run') }
}
