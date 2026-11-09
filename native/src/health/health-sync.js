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

  let lastError = null // a pass that broke before it could store the error on a link
  let heldError = null // an enable or disable failure whose write to health_state failed
  // Bumped by every enable and disable the moment it is called. A pass, an enable's queued work
  // or a disable's queued remove that sees a newer number belongs to an earlier call: it stops.
  let generation = 0
  let enables = 0 // only an enable cancels an earlier disable's remove

  async function keepError(text) {
    heldError = text
    try { await state.set('error', text); heldError = null } catch { /* kept in memory */ }
  }

  const isOn = async () => (await state.get('on')) === '1'

  async function fail(link, error) {
    try {
      await links.put({ ...link, error: message(error), updatedAt: now() })
    } catch { /* the pass stops either way; the next one tries again */ }
  }

  async function pass() {
    const mine = generation
    if (!(await isOn())) return
    const rows = await workouts.list()
    const current = await links.list('w')
    const plan = planWorkoutExport({ rows, links: current, now: now() })
    const linkOf = new Map(current.map((l) => [l.key, l]))
    const docOf = new Map(rows.map((d) => [d.id, d]))

    for (const { key, syncId } of plan.remove) {
      if (generation !== mine) return
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
      if (generation !== mine) return
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
    const mine = ++generation
    enables++
    await exclusive(async () => {
      if (generation !== mine) return
      try {
        await adapter.requestHealthAccess()
        if (generation !== mine) return
        await state.set('on', '1')
        if (generation !== mine) await state.set('on', '0')
        else {
          heldError = null
          await state.set('error', '')
        }
      } catch (error) {
        if (generation === mine) await keepError(message(error))
      }
      emit()
    })
    return generation === mine ? run() : status()
  }

  async function disable({ remove } = {}) {
    ++generation
    const enablesThen = enables
    // Queued first, so a later enable's work runs after this one's.
    const queued = exclusive(async () => {
      try {
        await state.set('on', '0')
        if (remove && enables === enablesThen) {
          // Links first: if the delete then fails or the app dies, nothing claims a workout is in Health that is not.
          await links.clear('w')
          await adapter.deleteAllOwnWorkouts()
        }
        heldError = null
        await state.set('error', '')
      } catch (error) {
        await keepError(message(error))
      } finally {
        emit()
      }
    })
    // Off at once, outside the queue, so a kill during a running pass cannot lose it.
    const early = (async () => state.set('on', '0'))().catch(() => {})
    emit()
    await Promise.all([early, queued])
    return status()
  }

  async function status() {
    const result = { on: false, write: 'unknown', exported: 0, waiting: 0, skipped: 0, error: lastError || heldError }
    try {
      result.write = adapter.workoutWriteAccess()
    } catch {
      result.write = 'unknown'
    }
    try {
      result.on = await isOn()
      let failed = null
      const current = await links.list('w')
      result.exported = current.filter((l) => l.state === 'exported').length
      if (result.on) {
        const rows = await workouts.list()
        result.skipped = rows.filter((d) => !exportable(d)).length
        // Only links a fresh plan would act on: a failure that no longer matters does not stick.
        const plan = planWorkoutExport({ rows, links: current, now: now() })
        result.waiting = plan.save.length
        const removing = new Set(plan.remove.map((r) => r.key))
        failed = current
          .filter((l) => l.error && (l.state === 'pending' || removing.has(l.key)))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
      }
      result.error = failed ? failed.error : lastError || (await state.get('error')) || heldError || null
    } catch {
      // keep what was read so far
    }
    return result
  }

  return { run, enable, disable, status, subscribe }
}
