import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteSessionStorage } from '../session/sqlite-storage'
import { focusReloads, homeKey, homeKeyStep, reloadsOnFocus } from '../sync/sync-triggers'
import { useSync } from '../sync/use-sync'
import { createSqliteServerCopy } from '../sync/server-copy'
import { createSqliteRoutineEdits } from '../plan/routine-edits'
import { readScreenSource } from '../sync/source'
import { readSourceKey } from '../sync/source-key'
import { nextRoutineId } from './next-up'
import { buildSessionBase } from './start-session'

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const LOADING = { status: 'loading', error: null, db: null, state: null, workouts: [], names: null, nextId: null, base: null, openBase: null, sessionId: null }

// The stores the start screen is built from, so its source key reads the same ones.
const sourceStores = db => ({
  finished: createSqliteFinishedWorkouts(db),
  serverCopy: createSqliteServerCopy(db),
  routineEdits: createSqliteRoutineEdits(db),
})

// What the Workout tab opens on. An open journal always wins ('session', openBase null: the
// engine restores it). Otherwise 'start', with next-up from the snapshot plus the phone's
// finished workouts. `base` is the session's base (stored or new) for targets and the title.
export function useWorkoutHome() {
  const [home, setHome] = useState(LOADING)
  const loads = useRef(0)
  const starting = useRef(false)
  // The source key (sync/source-key.js) of the load the screen shows; null when that load failed.
  const loadedKey = useRef(null)

  const reload = useCallback(async () => {
    const load = ++loads.current
    starting.current = false
    setHome(LOADING)
    let next
    let key = null
    try {
      const db = await openAppDatabase()
      const stores = sourceStores(db)
      const now = Date.now()
      // The key before the source: a change landing in between costs one more load, never a missed one.
      key = await readSourceKey({ ...stores, now })
      // Paired: the server copy, plus the workouts it has not acked. Not paired: as before.
      const { state, names, example, workouts } = await readScreenSource({ ...stores, bundled: snapshot })
      const stored = await createSqliteSessionStorage(db).readBase()
      if (stored) {
        next = { ...LOADING, status: 'session', db, state, workouts, names, example, base: stored, sessionId: stored.id }
      } else {
        next = { ...LOADING, status: 'start', db, state, workouts, names, example, nextId: nextRoutineId(state, now) }
      }
    } catch (error) {
      key = null
      next = { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }
    }
    if (load === loads.current) {
      loadedKey.current = key
      setHome(next)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Back on the tab: the start screen reads again when its source key moved since the load it
  // shows (focusReloads), so a routine edit made on the Plan tab shows (unpaired, nothing else moves
  // the sync key below) and an unchanged tab keeps what it built. The error screen always reads
  // again. Never while a session is open.
  const status = useRef(home.status)
  status.current = home.status
  useFocusEffect(useCallback(() => {
    if (!reloadsOnFocus(status.current)) return
    let focused = true
    openAppDatabase()
      .then(db => readSourceKey({ ...sourceStores(db), now: Date.now() }))
      .catch(() => null)
      .then(key => {
        if (focused && focusReloads({ homeStatus: status.current, loadedKey: loadedKey.current, key })) reload()
      })
    return () => { focused = false }
  }, [reload]))

  // A sync that pulled (or a pairing, or forgetting) while the start screen is showing reloads it,
  // so routines and next-up reflect the server; one that lands while it loads, once the load is
  // done (homeKeyStep). Never while a session is open: leaving it reloads.
  const { status: syncStatus } = useSync()
  const seenKey = useRef(undefined)
  useEffect(() => {
    const step = homeKeyStep({ seen: seenKey.current, next: homeKey(syncStatus), homeStatus: home.status })
    seenKey.current = step.seen
    if (step.reload) reload()
  }, [syncStatus, home.status, reload])

  // One tap starts one session: a second tap before the screen changes is ignored.
  const begin = useCallback(routineId => {
    if (home.status !== 'start' || starting.current) return
    const routine = (home.state.routines ?? []).find(r => r.id === routineId)
    if (!routine) return
    starting.current = true
    try {
      const base = buildSessionBase({ state: home.state, routine, now: Date.now(), timeZone: deviceTimeZone() })
      setHome({ ...home, status: 'session', base, openBase: base, sessionId: base.id })
    } catch (error) {
      setHome({ ...LOADING, status: 'error', error: { message: error?.message || String(error) } })
    }
  }, [home])

  // The banner follows what was loaded: never over the server copy (screenSource's example).
  return { ...home, snapshot: home.names ? { ...snapshot, names: home.names, example: home.example } : snapshot, reload, begin }
}
