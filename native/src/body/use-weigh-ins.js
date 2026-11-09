import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { openAppDatabase } from '../storage/database'
import { createSqliteWeighIns } from './weigh-ins'
import { applyDayOps, roundLb } from './day-ops'
import { readCopy, createSqliteServerCopy } from '../sync/server-copy'
import { localDate } from '../session/timing'
import { healthAfterFinish } from '../health/use-health'
import { syncAfterFinish } from '../sync/use-sync'
import { canRemove, todayLine } from './weigh-in-view'

const today = () => localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

// Today's effective entry (the server copy with this phone's pending ops laid over it) and
// this phone's row for today. Today is resolved at the moment of the read.
async function readToday(db) {
  const d = today()
  const copy = await readCopy(createSqliteServerCopy(db))
  const deleted = copy?.state?.deleted?.bodyweight ?? {}
  const pending = await createSqliteWeighIns(db).listPending()
  const { next } = applyDayOps(copy?.state?.bodyweight ?? [], pending, deleted)
  return {
    d,
    deleted,
    entry: next.find(e => e.d === d) ?? null,
    row: pending.find(r => r.d === d) ?? null,
  }
}

// { entry, line, removable, save(w), remove() }. save and remove resolve { ok } and never throw;
// the Health pass and the server sync run after the write and are never awaited.
export function useWeighIns() {
  const [view, setView] = useState({ entry: null, row: null })
  const readNo = useRef(0)

  const reload = useCallback(async () => {
    const no = ++readNo.current
    try {
      const db = await openAppDatabase()
      const { entry, row } = await readToday(db)
      if (no === readNo.current) setView({ entry, row })
    } catch {
      // Keep what the screen shows.
    }
  }, [])

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const write = async build => {
    try {
      const db = await openAppDatabase()
      const now = await readToday(db)
      await createSqliteWeighIns(db).put(build(now))
    } catch {
      return { ok: false }
    }
    healthAfterFinish()
    syncAfterFinish()
    await reload()
    return { ok: true }
  }

  const save = w => write(({ d, deleted }) => {
    const gone = Number(deleted[d])
    const t = gone > 0 ? Math.max(Date.now(), gone + 1) : Date.now()
    return { d, op: 'set', w: roundLb(w), t }
  })

  const remove = () => write(({ d, entry, row }) => {
    if (!canRemove(entry, row)) throw new Error('nothing of this phone to remove')
    return { d, op: 'remove', t: Date.now(), baseT: entry.t }
  })

  return { entry: view.entry, line: todayLine(view.entry), removable: canRemove(view.entry, view.row), save, remove }
}
