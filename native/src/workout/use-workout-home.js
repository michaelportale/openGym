import { useCallback, useEffect, useRef, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteSessionStorage } from '../session/sqlite-storage'
import { homeKey, homeKeyStep } from '../sync/sync-triggers'
import { useSync } from '../sync/use-sync'
import { createSqliteServerCopy } from '../sync/server-copy'
import { createSqliteRoutineEdits } from '../plan/routine-edits'
import { readScreenSource } from '../sync/source'
import { nextRoutineId } from './next-up'
import { buildSessionBase } from './start-session'

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const LOADING = { status: 'loading', error: null, db: null, state: null, workouts: [], names: null, nextId: null, base: null, openBase: null, sessionId: null }

// What the Workout tab opens on. An open journal always wins ('session', openBase null: the
// engine restores it). Otherwise 'start', with next-up from the snapshot plus the phone's
// finished workouts. `base` is the session's base (stored or new) for targets and the title.
export function useWorkoutHome() {
  const [home, setHome] = useState(LOADING)
  const loads = useRef(0)
  const starting = useRef(false)

  const reload = useCallback(async () => {
    const load = ++loads.current
    starting.current = false
    setHome(LOADING)
    let next
    try {
      const db = await openAppDatabase()
      // Paired: the server copy, plus the workouts it has not acked. Not paired: as before.
      const { state, names, example, workouts } = await readScreenSource({
        finished: createSqliteFinishedWorkouts(db),
        serverCopy: createSqliteServerCopy(db),
        routineEdits: createSqliteRoutineEdits(db),
        bundled: snapshot,
      })
      const stored = await createSqliteSessionStorage(db).readBase()
      if (stored) {
        next = { ...LOADING, status: 'session', db, state, workouts, names, example, base: stored, sessionId: stored.id }
      } else {
        const now = Date.now()
        next = { ...LOADING, status: 'start', db, state, workouts, names, example, nextId: nextRoutineId(state, now) }
      }
    } catch (error) {
      next = { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }
    }
    if (load === loads.current) setHome(next)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

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
