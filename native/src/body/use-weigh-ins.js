import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { openAppDatabase } from '../storage/database'
import { createSqliteWeighIns } from './weigh-ins'
import { applyDayOps } from './day-ops'
import { coalesced } from './coalesce'
import { readCopy, createSqliteServerCopy } from '../sync/server-copy'
import { localDate } from '../session/timing'
import { getHealth, healthAfterFinish } from '../health/use-health'
import { getSync, syncAfterFinish } from '../sync/use-sync'
import { afterWeighIn, canRemove, saveOp, todayLine } from './weigh-in-view'

const CHANGED = "That weight changed. Check today's weight and try again."

const today = () => localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

// Today's effective entry (the server copy with this phone's pending ops laid over it) and
// this phone's row for today. Today is resolved at the moment of the read.
async function readToday(db) {
  const d = today()
  const weighIns = createSqliteWeighIns(db)
  // This phone's rows before the copy: a sync lands as store the copy, then ack the rows.
  const pending = await weighIns.listPending()
  const copy = await readCopy(createSqliteServerCopy(db))
  const deleted = copy?.state?.deleted?.bodyweight ?? {}
  const { next } = applyDayOps(copy?.state?.bodyweight ?? [], pending, deleted)
  return {
    d,
    deleted,
    entry: next.find(e => e.d === d) ?? null,
    // The day's row whether or not the server has acked it: a synced typed weight stays removable.
    row: await weighIns.get(d),
  }
}

// { entry, line, removable, save(w), remove() }. save and remove resolve { ok } and never throw;
// the Health pass, then the server sync, run after the write and are never awaited. While the tab is
// focused, a Health pass or a server sync that changes something reloads the line. Reloads are
// coalesced (one at a time, at most one waiting), so back-to-back changes read the copy once.
export function useWeighIns() {
  const [view, setView] = useState({ entry: null, row: null })

  const [reload] = useState(() => coalesced(async () => {
    try {
      const db = await openAppDatabase()
      const { entry, row } = await readToday(db)
      setView({ entry, row })
    } catch {
      // Keep what the screen shows.
    }
  }))

  useFocusEffect(useCallback(() => {
    let focused = true
    const offs = []
    const listen = engine => engine
      .then(e => {
        const off = e.subscribe(() => { reload() })
        if (focused) offs.push(off)
        else off() // blurred while the engine was being built
      })
      .catch(() => {})
    reload()
    listen(getHealth())
    listen(getSync())
    return () => {
      focused = false
      for (const off of offs.splice(0)) off()
    }
  }, [reload]))

  const write = async build => {
    try {
      const db = await openAppDatabase()
      const op = build(await readToday(db))
      if (!op) return { ok: false, error: CHANGED }
      await createSqliteWeighIns(db).put(op)
    } catch {
      return { ok: false }
    }
    // Not awaited. The Health pass goes first: its fallback must replace an unsent remove before the
    // push is built, or the server's deletion stamp beats it and the reading is refused for good.
    afterWeighIn(healthAfterFinish, syncAfterFinish)
    await reload()
    return { ok: true }
  }

  const save = w => write(({ d, deleted, entry }) => saveOp({ d, w, now: Date.now(), entry, deleted }))

  const remove = () => write(({ d, entry, row }) => {
    if (!canRemove(entry, row)) return null
    return { d, op: 'remove', t: Date.now(), baseT: entry.t }
  })

  return { entry: view.entry, line: todayLine(view.entry), removable: canRemove(view.entry, view.row), save, remove }
}
