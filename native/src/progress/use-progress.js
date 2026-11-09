import { useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteServerCopy } from '../sync/server-copy'
import { keyed, readSourceKey } from '../sync/source-key'
import { useFocusReload } from '../sync/use-focus-reload'
import { loadProgress } from './progress-source'

const LOADING = { status: 'loading', state: null, bodyweight: [], error: null }

// { status: 'loading'|'ready'|'error', state, bodyweight, error }. `state` is the Workout tab's
// screen source; `bodyweight` the effective weigh-in list (the server copy or snapshot with this
// phone's pending weigh-ins laid over it). Reloads when the tab is focused or a Health pass or
// sync changes something, coalesced. A reload whose source key (sync/source-key.js) is unchanged
// keeps the same object, so nothing is parsed or worked out again.
export function useProgress() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const load = keyed(readSourceKey, async stores => ({ status: 'ready', ...(await loadProgress(stores)), error: null }))
    return coalesced(async () => {
      try {
        const db = await openAppDatabase()
        setSource(await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          weighIns: createSqliteWeighIns(db),
          bundled: snapshot,
          now: Date.now(),
        }))
      } catch (error) {
        // A failed first load is an error; a failed reload keeps what the screen shows.
        setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
      }
    })
  })

  useFocusReload(reload)

  return source
}
