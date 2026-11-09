import { useEffect, useState } from 'react'
import { openAppDatabase } from '../storage/database'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createHealthSync } from './health-sync'
import { createSqliteHealthStore } from './health-store'
import * as adapter from './healthkit'
import { shouldSyncOnForeground } from '../sync/sync-triggers'

// The one Health engine for the app, built on first use from the app database. A failed build is
// not remembered: the next call tries again. Nothing here reaches the session journal.
let engine = null
let current = null // the latest status, or null before the first read
let readNo = 0
let lastAttemptAt = null
const watchers = new Set()

export function getHealth() {
  if (!engine) {
    engine = openAppDatabase()
      .then(db => {
        const health = createHealthSync({
          adapter,
          store: createSqliteHealthStore(db),
          workouts: createSqliteFinishedWorkouts(db),
          now: Date.now,
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

// Back in the app: at most once a minute, like the server sync (shouldSyncOnForeground). A pass
// with nothing to do makes no HealthKit call.
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
