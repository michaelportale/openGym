import { useCallback, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteServerCopy } from '../sync/server-copy'
import { readScreenSource } from '../sync/source'
import { keyed, readSourceKey } from '../sync/source-key'
import { syncAfterFinish } from '../sync/use-sync'
import { useFocusReload } from '../sync/use-focus-reload'
import { editBase } from './plan-view'
import { createSqliteRoutineEdits } from './routine-edits'

const LOADING = { status: 'loading', state: null, names: null, copy: null, notices: [], error: null }

// One routine edit: the whole routine, on the base the server holds (copyRoutine: the copy's or
// the snapshot's routine, without the overlay), then the sync is asked to run, not awaited, as a
// weigh-in's write does. `fresh`: made with no copy held (editBase), so its row starts over.
// Throws when the write fails.
export async function savePlanEdit({ rid, routine, copyRoutine, fresh = false }) {
  const db = await openAppDatabase()
  await createSqliteRoutineEdits(db).put({ rid, baseTs: copyRoutine?._ts ?? null, routine, t: Date.now(), fresh })
  syncAfterFinish()
}

// { status: 'loading'|'ready'|'error', state, names, copy, notices, error, save, dismiss, baseOf }.
// `state` and `names` are the Workout tab's screen source (pending routine edits laid over it);
// `copy` the stored server copy or null; `notices` the edits that were not sent. Reloads on focus
// and on a Health pass or sync, coalesced; the source is keyed (sync/source-key.js) so an
// unchanged one is not built again. Notices are read on every reload: a Dismiss changes no
// pending row, so the key would not see it. save and dismiss resolve { ok } and never throw.
export function usePlan() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const load = keyed(readSourceKey, async stores => {
      const { state, names, copy } = await readScreenSource({ ...stores, bundled: snapshot })
      return { state, names, copy }
    })
    return coalesced(async () => {
      try {
        const db = await openAppDatabase()
        const routineEdits = createSqliteRoutineEdits(db)
        const notices = await routineEdits.listNotices()
        const built = await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          routineEdits,
          now: Date.now(),
        })
        setSource({ status: 'ready', ...built, notices, error: null })
      } catch (error) {
        // A failed first load is an error; a failed reload keeps what the screen shows.
        setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
      }
    })
  })

  useFocusReload(reload)

  const save = useCallback(async edit => {
    try {
      await savePlanEdit(edit)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  const dismiss = useCallback(async rid => {
    try {
      const db = await openAppDatabase()
      await createSqliteRoutineEdits(db).dismiss(rid)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  // { base, fresh } for an edit of routine rid (plan-view.js editBase).
  const baseOf = useCallback(rid => editBase({ copy: source.copy, bundled: snapshot }, rid), [source.copy])

  return { ...source, save, dismiss, baseOf }
}
