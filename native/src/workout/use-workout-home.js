import { useCallback, useEffect, useRef, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteSessionStorage } from '../session/sqlite-storage'
import { localDate } from '../session/timing'
import { sessionState } from './history-state'
import { nextRoutineId } from './next-up'
import { buildSessionBase } from './start-session'

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const LOADING = { status: 'loading', error: null, db: null, state: null, workouts: [], nextId: null, base: null, openBase: null, sessionId: null }

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
      const workouts = await createSqliteFinishedWorkouts(db).list()
      const state = sessionState(snapshot, workouts)
      const stored = await createSqliteSessionStorage(db).readBase()
      if (stored) {
        next = { ...LOADING, status: 'session', db, state, workouts, base: stored, sessionId: stored.id }
      } else {
        const now = Date.now()
        next = { ...LOADING, status: 'start', db, state, workouts, nextId: nextRoutineId(state, localDate(now, deviceTimeZone()), now) }
      }
    } catch (error) {
      next = { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }
    }
    if (load === loads.current) setHome(next)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

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

  return { ...home, snapshot, reload, begin }
}
