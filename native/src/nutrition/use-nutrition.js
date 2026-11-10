import { useCallback, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { progressLoader } from '../progress/progress-source'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqlitePendingEdits } from '../sync/pending-edits'
import { createSqliteServerCopy } from '../sync/server-copy'
import { keyed, readSourceKey } from '../sync/source-key'
import { useFocusReload } from '../sync/use-focus-reload'
import { syncAfterFinish } from '../sync/use-sync'
import { nutritionSaveArgs } from './nutrition-screen'

const LOADING = { status: 'loading', state: null, copy: null, bodyweight: [], notices: [], error: null }

// A new supplement's id, made the way the web makes one (format.js uid).
export const newSupplementId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// The notices the Nutrition screen shows: a day's and a setting's, never a routine's.
async function readNotices(edits) {
  return [...await edits.listNotices({ kind: 'nutritionDay' }), ...await edits.listNotices({ kind: 'setting' })]
}

// One nutrition edit: a day ({ kind: 'nutritionDay', key: iso, value }) or a setting ({ kind:
// 'setting', key: 'nutritionTargets' | 'supplements', value }), made on `copy` (the server copy the
// screen showed when the edit was made, or null when none was held: the snapshot's then). Its base
// is that copy's stamp (nutrition-screen.js nutritionSaveArgs). The sync is asked to run, not
// awaited, as a routine edit's is. Throws when the write fails.
export async function saveNutritionEdit({ kind, key, value, copy }) {
  const db = await openAppDatabase()
  await createSqlitePendingEdits(db).put(nutritionSaveArgs({ copy, bundled: snapshot }, { kind, key, value }, { t: Date.now() }))
  syncAfterFinish()
}

// { status: 'loading'|'ready'|'error', state, copy, bodyweight, notices, error, save, dismiss }.
// `state` is the screen source with this phone's pending edits laid over it, `copy` the stored
// server copy or null (bases are read from it, never from `state`), `bodyweight` the weigh-ins with
// this phone's pending ones (the week card's average), `notices` the nutrition-day and setting edits
// that were not sent. Reloads on focus and on a Health pass or sync, coalesced; the source is keyed
// (sync/source-key.js) so an unchanged one is not built again. Notices are read on every reload: a
// Dismiss changes no pending row. save and dismiss resolve { ok } and never throw.
export function useNutrition() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const loadProgress = progressLoader()
    const load = keyed(readSourceKey, stores => loadProgress(stores))
    return coalesced(async () => {
      try {
        const db = await openAppDatabase()
        const edits = createSqlitePendingEdits(db)
        const notices = await readNotices(edits)
        const built = await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          weighIns: createSqliteWeighIns(db),
          edits,
          bundled: snapshot,
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
      await saveNutritionEdit(edit)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  const dismiss = useCallback(async (kind, key) => {
    try {
      const db = await openAppDatabase()
      await createSqlitePendingEdits(db).dismiss(kind, key)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  return { ...source, save, dismiss }
}
