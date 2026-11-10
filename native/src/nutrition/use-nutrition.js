import { useCallback, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteWeighIns } from '../body/weigh-ins'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqlitePendingEdits } from '../sync/pending-edits'
import { createSqliteServerCopy } from '../sync/server-copy'
import { useFocusReload } from '../sync/use-focus-reload'
import { syncAfterFinish } from '../sync/use-sync'
import { nutritionSaveArgs } from './nutrition-screen'
import { nutritionLoader } from './nutrition-source'

const LOADING = { status: 'loading', state: null, copy: null, bodyweight: [], notices: [], error: null }

// A new supplement's id, made the way the web makes one (format.js uid).
export const newSupplementId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

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

// { status: 'loading'|'ready'|'error', state, copy, bodyweight, notices, error, save, dismiss, reload }.
// `state` is the screen source with this phone's pending edits laid over it, `copy` the stored
// server copy or null (bases are read from it, never from `state`), `bodyweight` the weigh-ins with
// this phone's pending ones (the week card's average), `notices` the nutrition-day and setting edits
// that were not sent. Reloads on focus and on a Health pass or sync, coalesced; the source is keyed
// (sync/source-key.js) so an unchanged one is not built again. Notices are read on every reload: a
// Dismiss changes no pending row. save and dismiss resolve { ok } and never throw. reload reads the
// stores again (joining or queuing behind one that runs) and resolves with what it read,
// nutrition-source.js's { ok, source } or { ok: false, error }; it never throws.
export function useNutrition() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const loadNutrition = nutritionLoader()
    return coalesced(async () => {
      let result
      try {
        const db = await openAppDatabase()
        result = await loadNutrition({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          weighIns: createSqliteWeighIns(db),
          edits: createSqlitePendingEdits(db),
          bundled: snapshot,
          now: Date.now(),
        })
      } catch (error) {
        result = { ok: false, error: { message: error?.message || String(error) } }
      }
      // A failed first load is an error; a failed reload keeps what the screen shows.
      if (result.ok) setSource(result.source)
      else setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: result.error }))
      return result
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

  return { ...source, save, dismiss, reload }
}
