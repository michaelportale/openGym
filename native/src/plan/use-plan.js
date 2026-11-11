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
import { editBase, planNotices, routineCreateEdit, routineDeleteEdit, routineOrderEdit } from './plan-view'
import { createSqlitePendingEdits } from '../sync/pending-edits'

const LOADING = { status: 'loading', state: null, names: null, copy: null, notices: [], error: null }

// One routine edit: the whole routine, on the base the server holds (copyRoutine: the copy's or
// the snapshot's routine, without the overlay), then the sync is asked to run, not awaited, as a
// weigh-in's write does. `fresh`: made with no copy held (editBase), so its row starts over.
// Throws when the write fails.
export async function savePlanEdit({ rid, routine, copyRoutine, fresh = false }) {
  const db = await openAppDatabase()
  await createSqlitePendingEdits(db).put({ kind: 'routine', key: rid, baseTs: copyRoutine?._ts ?? null, value: routine, t: Date.now(), fresh })
  syncAfterFinish()
}

// One of the Plan's authoring edits (plan-view.js routineCreateEdit, routineDeleteEdit,
// routineOrderEdit), then the sync is asked to run, as savePlanEdit does. The edit is spread into
// the put, so a fresh flag on it reaches the store. A delete carries one (routineDeleteEdit); a
// later change here must not drop that flag. Throws when the write fails.
async function saveAuthoring(edit) {
  const db = await openAppDatabase()
  await createSqlitePendingEdits(db).put({ ...edit, t: Date.now() })
  syncAfterFinish()
}

// A new routine (routine-edit.js newRoutine or duplicateRoutine), on base 0.
export const saveRoutineCreate = routine => saveAuthoring(routineCreateEdit(routine))
// Routine rid deleted, on the base the server holds (copyRoutine: the copy's routine). The edit
// is fresh, so the put replaces a pending row's base with that routine's _ts, or null when there
// is no copy routine. The guard still reads a create-then-delete as done.
export const saveRoutineDelete = (rid, copyRoutine) => saveAuthoring(routineDeleteEdit(rid, copyRoutine))
// The routines' order: every id as the Plan lists them, on the copy's edited.routineOrder.
export const saveRoutineOrder = (ids, copy) => saveAuthoring(routineOrderEdit(ids, copy))

// { status: 'loading'|'ready'|'error', state, names, copy, notices, error, save, create, remove,
// reorder, dismiss, baseOf }.
// `state` and `names` are the Workout tab's screen source (pending routine edits laid over it);
// `copy` the stored server copy or null; `notices` the routine and order edits that were not sent
// (plan-view.js planNotices: each with its `op`, a delete named from `state`). Reloads on focus
// and on a Health pass or sync, coalesced; the source is keyed (sync/source-key.js) so an
// unchanged one is not built again. Notices are read on every reload: a Dismiss changes no
// pending row, so the key would not see it. save (savePlanEdit's edit), create (saveRoutineCreate),
// remove (saveRoutineDelete), reorder (saveRoutineOrder) and dismiss(key, kind = 'routine') resolve
// { ok } once the screen has reloaded, and never throw.
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
        const edits = createSqlitePendingEdits(db)
        const listed = (await edits.listNotices()).filter(n => n.kind === 'routine' || n.kind === 'routineOrder')
        // What each routine notice's edit was (a create, a delete or an edit) is in its row.
        const rows = []
        for (const n of listed) if (n.kind === 'routine') rows.push(await edits.get(n.kind, n.key))
        const built = await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          edits,
          now: Date.now(),
        })
        setSource({ status: 'ready', ...built, notices: planNotices(listed, rows, built.state), error: null })
      } catch (error) {
        // A failed first load is an error; a failed reload keeps what the screen shows.
        setSource(prev => (prev.status === 'ready' ? prev : { ...LOADING, status: 'error', error: { message: error?.message || String(error) } }))
      }
    })
  })

  useFocusReload(reload)

  // A write, then the screen reloads before it resolves { ok }.
  const settle = useCallback(async write => {
    try {
      await write()
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])
  const save = useCallback(edit => settle(() => savePlanEdit(edit)), [settle])
  const create = useCallback(routine => settle(() => saveRoutineCreate(routine)), [settle])
  const remove = useCallback((rid, copyRoutine) => settle(() => saveRoutineDelete(rid, copyRoutine)), [settle])
  const reorder = useCallback((ids, copy) => settle(() => saveRoutineOrder(ids, copy)), [settle])

  const dismiss = useCallback(async (key, kind = 'routine') => {
    try {
      const db = await openAppDatabase()
      await createSqlitePendingEdits(db).dismiss(kind, key)
    } catch {
      return { ok: false }
    }
    await reload()
    return { ok: true }
  }, [reload])

  // { base, fresh } for an edit of routine rid (plan-view.js editBase).
  const baseOf = useCallback(rid => editBase({ copy: source.copy, bundled: snapshot }, rid), [source.copy])

  return { ...source, save, create, remove, reorder, dismiss, baseOf }
}
