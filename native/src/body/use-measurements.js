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
import { putMeasurement } from './measurement-screen'
import { createSqliteMeasurements } from './measurement-store'

const LOADING = { status: 'loading', state: null, error: null }

// One measurement op: a set ({ op: 'set', entry }, the entry applyLogForm built) or a remove
// ({ op: 'remove', d }), through putMeasurement: a remove's base is the stored copy read right
// before the put (the snapshot's when none is held). The sync is asked to run, not awaited, as a
// weigh-in's is. Throws when the write fails.
export async function saveMeasurement(edit) {
  const db = await openAppDatabase()
  await putMeasurement({ measurements: createSqliteMeasurements(db), serverCopy: createSqliteServerCopy(db), bundled: snapshot }, edit, { now: Date.now() })
  syncAfterFinish()
}

// { status: 'loading'|'ready'|'error', state, error, save, remove }. `state` is the screen source
// with this phone's pending measurements (and edits) laid over it. Reloads on focus and on a Health
// pass or sync, coalesced; the source is keyed (sync/source-key.js), the pending measurements
// included, so an unchanged one is not built again. save(entry) and remove(d) resolve { ok } and
// never throw; remove reads its base from the stored copy itself (saveMeasurement).
export function useMeasurements() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const load = keyed(readSourceKey, async stores => {
      const { state } = await readScreenSource({ ...stores, bundled: snapshot })
      return { state }
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

  const write = useCallback(async edit => {
    try {
      await saveMeasurement(edit)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])
  const save = useCallback(entry => write({ op: 'set', entry }), [write])
  const remove = useCallback(d => write({ op: 'remove', d }), [write])

  return { ...source, save, remove }
}
