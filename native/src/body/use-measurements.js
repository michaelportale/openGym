import { useCallback, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqlitePendingEdits } from '../sync/pending-edits'
import { createSqliteServerCopy } from '../sync/server-copy'
import { readScreenSource } from '../sync/source'
import { keyed, readSourceKey } from '../sync/source-key'
import { useFocusReload } from '../sync/use-focus-reload'
import { syncAfterFinish } from '../sync/use-sync'
import { coalesced } from './coalesce'
import { measurementSaveArgs } from './measurement-screen'
import { createSqliteMeasurements } from './measurement-store'

const LOADING = { status: 'loading', state: null, copy: null, error: null }

// One measurement op: a set ({ op: 'set', entry }, the entry applyLogForm built) or a remove
// ({ op: 'remove', d }) made on `copy` (the server copy the screen showed when Delete was tapped, or
// null when none was held: the snapshot's then), through measurementSaveArgs. The sync is asked to
// run, not awaited, as a weigh-in's is. Throws when the write fails.
export async function saveMeasurement({ edit, copy }) {
  const db = await openAppDatabase()
  await createSqliteMeasurements(db).put(measurementSaveArgs({ copy, bundled: snapshot }, edit, { now: Date.now() }))
  syncAfterFinish()
}

// { status: 'loading'|'ready'|'error', state, copy, error, save }. `state` is the screen source
// with this phone's pending measurements (and edits) laid over it, `copy` the stored server copy
// or null (a remove's base is read from it, never from `state`). Reloads on focus and on a Health
// pass or sync, coalesced; the source is keyed (sync/source-key.js), the pending measurements
// included, so an unchanged one is not built again. save resolves { ok } and never throws.
export function useMeasurements() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const load = keyed(readSourceKey, async stores => {
      const { state, copy } = await readScreenSource({ ...stores, bundled: snapshot })
      return { state, copy }
    })
    return coalesced(async () => {
      try {
        const db = await openAppDatabase()
        const built = await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          routineEdits: createSqlitePendingEdits(db),
          measurements: createSqliteMeasurements(db),
          now: Date.now(),
        })
        setSource({ status: 'ready', ...built, error: null })
      } catch (error) {
        // A failed first load is an error; a failed reload keeps what the screen shows.
        setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
      }
    })
  })

  useFocusReload(reload)

  const save = useCallback(async op => {
    try {
      await saveMeasurement(op)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  return { ...source, save }
}
