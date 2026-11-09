import { useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteServerCopy, createSqliteSyncMeta } from '../sync/server-copy'
import { readScreenSource } from '../sync/source'
import { useFocusReload } from '../sync/use-focus-reload'

const LOADING = { status: 'loading', state: null, server: null, error: null }

// { status: 'loading'|'ready'|'error', state, server, error }. `state` is the same screen source the
// Workout tab reads (the server copy when paired, else the bundled snapshot); `server` is the paired
// server's address, or null. While the tab is focused a Health pass or a server sync that changes
// something reloads it. Reloads are coalesced (one at a time, at most one waiting).
export function useExerciseSource() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => coalesced(async () => {
    try {
      const db = await openAppDatabase()
      const { state } = await readScreenSource({
        finished: createSqliteFinishedWorkouts(db),
        serverCopy: createSqliteServerCopy(db),
        bundled: snapshot,
      })
      const server = (await createSqliteSyncMeta(db).get('server')) || null
      setSource({ status: 'ready', state, server, error: null })
    } catch (error) {
      // A failed first load is an error; a failed reload keeps what the list shows.
      setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
    }
  }))

  useFocusReload(reload)

  return source
}
