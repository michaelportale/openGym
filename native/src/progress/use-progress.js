import { useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { effectiveBodyweight } from '../body/effective-bodyweight'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteServerCopy, readCopy } from '../sync/server-copy'
import { readScreenSource } from '../sync/source'
import { useFocusReload } from '../sync/use-focus-reload'

const LOADING = { status: 'loading', state: null, bodyweight: [], error: null }

// { status: 'loading'|'ready'|'error', state, bodyweight, error }. `state` is the Workout tab's
// screen source; `bodyweight` the effective weigh-in list (the server copy or snapshot with this
// phone's pending weigh-ins laid over it). Reloads when the tab is focused or a Health pass or
// sync changes something, coalesced.
export function useProgress() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => coalesced(async () => {
    try {
      const db = await openAppDatabase()
      const serverCopy = createSqliteServerCopy(db)
      const { state } = await readScreenSource({ finished: createSqliteFinishedWorkouts(db), serverCopy, bundled: snapshot })
      // Pending rows before the copy: a sync stores the copy, then acks the rows.
      const pending = await createSqliteWeighIns(db).listPending()
      const copy = await readCopy(serverCopy)
      const bodyweight = effectiveBodyweight({ copy, snapshot: snapshot?.state?.bodyweight, pending, deleted: copy?.state?.deleted?.bodyweight })
      setSource({ status: 'ready', state, bodyweight, error: null })
    } catch (error) {
      // A failed first load is an error; a failed reload keeps what the screen shows.
      setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
    }
  }))

  useFocusReload(reload)

  return source
}
