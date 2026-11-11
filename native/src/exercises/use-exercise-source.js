import { useCallback, useState } from 'react'
import snapshot from '../data/snapshot'
import { openAppDatabase } from '../storage/database'
import { coalesced } from '../body/coalesce'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { createSqliteSessionStorage } from '../session/sqlite-storage'
import { createSqliteServerCopy, createSqliteSyncMeta } from '../sync/server-copy'
import { createSqlitePendingEdits } from '../sync/pending-edits'
import { readScreenSource } from '../sync/source'
import { keyed, readSourceKey } from '../sync/source-key'
import { syncAfterFinish } from '../sync/use-sync'
import { useFocusReload } from '../sync/use-focus-reload'
import { exerciseNoticeLines } from './exercise-notices'

const LOADING = { status: 'loading', state: null, server: null, copy: null, notices: [], openEntries: [], error: null }

// One custom-exercise edit, then the sync is asked to run, not awaited, as a routine save is.
// The edit is spread into the put, so a fresh flag on a delete reaches the store. Create and
// edit do not set one. Throws when the write fails.
async function writeCustom(edit) {
  const db = await openAppDatabase()
  await createSqlitePendingEdits(db).put({ ...edit, t: Date.now() })
  syncAfterFinish()
}

// { status: 'loading'|'ready'|'error', state, server, copy, notices, openEntries, error, saveCustom, dismiss }.
// `state` is the same screen source the Workout tab reads. `server` is the paired server's address,
// or null. `copy` is the stored server copy, or null when unpaired or unreadable. `notices` are the
// customEx edits that were not sent (exercise-notices.js). `openEntries` is the open session's
// entries, or [] when there is no session. Reloads on focus and on a Health pass or sync, coalesced;
// the source is keyed so an unchanged one is not built again. Notices and the open session are read
// on every reload: a Dismiss changes no source key, and a session opening does not either.
// saveCustom and dismiss resolve { ok } once the screen has reloaded, and never throw.
export function useExerciseSource() {
  const [source, setSource] = useState(LOADING)

  const [reload] = useState(() => {
    const load = keyed(async s => `${await readSourceKey(s)}|${(await s.meta.get('server')) || ''}`, async ({ finished, serverCopy, edits, meta }) => {
      const { state, copy } = await readScreenSource({ finished, serverCopy, edits, bundled: snapshot })
      const server = (await meta.get('server')) || null
      return { state, server, copy }
    })
    return coalesced(async () => {
      try {
        const db = await openAppDatabase()
        // A throw while reading the session is this load's error, as it is for the Plan tab.
        const session = await createSqliteSessionStorage(db).readBase()
        const openEntries = session == null || !Array.isArray(session.entries) ? [] : session.entries
        const edits = createSqlitePendingEdits(db)
        const listed = (await edits.listNotices()).filter(n => n && n.kind === 'customEx')
        const rows = []
        for (const n of listed) rows.push(await edits.get(n.kind, n.key))
        const built = await load({
          finished: createSqliteFinishedWorkouts(db),
          serverCopy: createSqliteServerCopy(db),
          edits,
          meta: createSqliteSyncMeta(db),
          now: Date.now(),
        })
        setSource({
          status: 'ready',
          ...built,
          notices: exerciseNoticeLines(listed, rows, built.state),
          openEntries,
          error: null,
        })
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
  const saveCustom = useCallback(edit => settle(() => writeCustom(edit)), [settle])
  const dismiss = useCallback(key => settle(async () => {
    const db = await openAppDatabase()
    await createSqlitePendingEdits(db).dismiss('customEx', key)
  }), [settle])

  return { ...source, saveCustom, dismiss }
}
