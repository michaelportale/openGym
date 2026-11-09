// Writes finished workouts to Apple Health, one pass at a time. The adapter, the store and the
// finished-workouts store are injected. Nothing here throws to a caller, and the finished
// workouts are only ever listed, never changed.

import { exportHash, exportable, planWorkoutExport, workoutSyncId } from './workout-export.js'

const message = (error) => String(error?.message ?? error)

export function createHealthSync({ adapter, store, workouts, now }) {
  const { links, state } = store

  // run, enable and disable never interleave.
  let tail = Promise.resolve()
  function exclusive(fn) {
    const result = tail.then(fn)
    tail = result.then(() => {}, () => {})
    return result
  }

  const listeners = new Set()
  const emit = () => {
    for (const fn of [...listeners]) {
      try { fn() } catch { /* a screen's bug never stops a pass */ }
    }
  }
  function subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  let lastError = null // a failure no link carries: enable, or a pass that broke before saving

  const isOn = async () => (await state.get('on')) === '1'

  async function fail(link, error) {
    try {
      await links.put({ ...link, error: message(error), updatedAt: now() })
    } catch { /* the pass stops either way; the next one tries again */ }
  }

  async function pass() {
    if (!(await isOn())) return
    const rows = await workouts.list()
    const current = await links.list('w')
    const plan = planWorkoutExport({ rows, links: current, now: now() })
    const linkOf = new Map(current.map((l) => [l.key, l]))
    const docOf = new Map(rows.map((d) => [d.id, d]))

    for (const { key, syncId } of plan.remove) {
      try {
        await adapter.deleteWorkoutsBySyncId(syncId)
      } catch (error) {
        await fail(linkOf.get(key), error)
        return
      }
      await links.remove('w', key)
      linkOf.delete(key)
    }

    for (const { key } of plan.skip) {
      const doc = docOf.get(key)
      await links.put({
        kind: 'w',
        key,
        syncId: workoutSyncId(key),
        version: linkOf.get(key)?.version ?? now(),
        hash: exportHash(doc),
        state: 'skipped',
        error: null,
        updatedAt: now(),
      })
    }

    for (const { key, syncId, version, hash, doc } of plan.save) {
      const pending = { kind: 'w', key, syncId, version, hash, state: 'pending', error: null, updatedAt: now() }
      await links.put(pending)
      try {
        await adapter.saveStrengthWorkout({
          id: syncId,
          version,
          start: new Date(doc.start),
          end: new Date(doc.end),
          volumeLb: doc.vol,
          partial: !!doc.volumePartial,
        })
      } catch (error) {
        await fail(pending, error)
        return
      }
      await links.put({ ...pending, state: 'exported', updatedAt: now() })
    }
  }

  // A call while a pass waits its turn joins it. A call while one runs schedules exactly one
  // more after it, since a workout may have been finished meanwhile.
  let waiting = null
  function run() {
    if (!waiting) {
      waiting = exclusive(async () => {
        waiting = null
        lastError = null
        emit()
        try {
          await pass()
        } catch (error) {
          lastError = message(error)
        } finally {
          emit()
        }
      }).then(status)
    }
    return waiting
  }

  async function enable() {
    await exclusive(async () => {
      try {
        await adapter.requestHealthAccess()
        await state.set('error', '')
        await state.set('on', '1')
        lastError = null
      } catch (error) {
        lastError = message(error)
        try { await state.set('error', lastError) } catch { /* kept in memory */ }
      }
      emit()
    })
    return run()
  }

  async function disable({ remove } = {}) {
    await exclusive(async () => {
      try {
        await state.set('on', '0')
        if (remove) {
          const all = await links.list('w')
          for (const link of all) {
            if (link.state !== 'skipped') {
              try {
                await adapter.deleteWorkoutsBySyncId(link.syncId)
              } catch (error) {
                await fail(link, error)
                return
              }
            }
            await links.remove('w', link.key)
          }
        }
      } catch (error) {
        lastError = message(error)
      } finally {
        emit()
      }
    })
    return status()
  }

  async function status() {
    const result = { on: false, write: 'unknown', exported: 0, waiting: 0, skipped: 0, error: lastError }
    try {
      result.write = adapter.workoutWriteAccess()
    } catch {
      result.write = 'unknown'
    }
    try {
      result.on = await isOn()
      const current = await links.list('w')
      result.exported = current.filter((l) => l.state === 'exported').length
      const rows = await workouts.list()
      result.skipped = rows.filter((d) => !exportable(d)).length
      if (result.on) result.waiting = planWorkoutExport({ rows, links: current, now: now() }).save.length
      const failed = current.filter((l) => l.error).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
      result.error = failed ? failed.error : lastError || (await state.get('error')) || null
    } catch {
      // keep what was read so far
    }
    return result
  }

  return { run, enable, disable, status, subscribe }
}
