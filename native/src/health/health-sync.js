// Writes finished workouts to Apple Health and imports body-mass readings as weigh-ins, one pass
// at a time. The adapter, the stores, the server copy reader and the sync trigger are injected.
// Nothing here throws to a caller, and the finished workouts are only ever listed, never changed.

import { applyDayOps } from '../body/day-ops.js'
import { localDate } from '../session/timing.js'
import { dayOpsFromReadings, isExternal, startOfLocalDay } from './weight-import.js'
import { planWeightExport } from './weight-export.js'
import { exportHash, exportable, planWorkoutExport, workoutSyncId } from './workout-export.js'

const message = (error) => String(error?.message ?? error)

const BW_SINCE = 'bwSince' // health_state: the start of the local day the import first ran
const BW_ANCHOR = 'bwAnchor' // health_state: the anchored body-mass query's anchor

// weighIns: the weigh-in store (createSqliteWeighIns); readCopy: () => the server copy or null;
// ownBundleId: () => the app's own Health bundle id; timeZone: () => the local days' zone, read
// once per import pass;
// onWeighIns: called when an import wrote an op (the server sync), never awaited.
export function createHealthSync({ adapter, store, workouts, now, weighIns, readCopy, ownBundleId, timeZone, onWeighIns }) {
  const missing = Object.entries({ weighIns, readCopy, ownBundleId, timeZone, onWeighIns })
    .filter(([k, v]) => (k === 'weighIns' ? !v : typeof v !== 'function'))
    .map(([k]) => k)
  if (missing.length) throw new Error('createHealthSync needs ' + missing.join(', '))
  const { links, state, readings } = store

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

  async function exportWorkouts(mine) {
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

  // The day -> entry the server copy plus this phone's pending ops give (no copy: the ops alone).
  // known is false when the copy is unreadable.
  async function effectiveEntries() {
    // This phone's rows before the copy: the sync engine stores the copy, then acks the rows, so a sync
    // landing between the two reads leaves a pending op the new copy already holds (applying it twice is harmless).
    const pending = await weighIns.listPending()
    const copy = await readCopy()
    const doc = copy?.state ?? {}
    const removals = doc.deleted?.bodyweight
    const deleted = removals && typeof removals === 'object' && !Array.isArray(removals) ? removals : {}
    const byDay = {}
    for (const entry of applyDayOps(doc.bodyweight, pending, deleted).next) byDay[entry.d] = entry
    return { byDay, known: !!copy, pendingDays: new Set(pending.map((o) => o.d)) }
  }

  // Typed weigh-ins out: a day is in Health only while this phone's typed entry is the day's entry.
  async function exportWeighIns(mine) {
    const rows = await weighIns.list()
    const current = await links.list('bw')
    const { byDay, known, pendingDays } = await effectiveEntries()
    const plan = planWeightExport({ rows, effectiveByDay: byDay, links: current, now: now(), copyKnown: known, pendingDays })
    const linkOf = new Map(current.map((l) => [l.key, l]))
    const removing = new Set(plan.remove.map((r) => r.key))
    // A failed remove leaves its error on the link; once the day qualifies again nothing else clears it.
    for (const l of current) {
      if (l.error && l.state === 'exported' && !removing.has(l.key) && !plan.save.some((x) => x.key === l.key)) {
        await links.put({ ...l, error: null, updatedAt: now() })
      }
    }

    for (const { key, syncId } of plan.remove) {
      if (generation !== mine) return
      try {
        await adapter.deleteBodyMassBySyncId(syncId)
      } catch (error) {
        await fail(linkOf.get(key), error)
        return
      }
      await links.remove('bw', key)
      linkOf.delete(key)
    }

    for (const { key, syncId, version, hash, w, at } of plan.save) {
      const pending = { kind: 'bw', key, syncId, version, hash, state: 'pending', error: null, updatedAt: now() }
      await links.put(pending)
      if (generation !== mine) return
      try {
        await adapter.saveBodyMass({ id: syncId, version, lb: w, at: new Date(at) })
      } catch (error) {
        await fail(pending, error)
        return
      }
      await links.put({ ...pending, state: 'exported', updatedAt: now() })
    }
  }

  let own = null // the app's own bundle id, looked up once
  async function ownId() {
    if (own === null) {
      const id = await ownBundleId()
      if (typeof id !== 'string' || id === '') throw new Error("the app's own Health bundle id is unknown")
      own = id
    }
    return own
  }

  // { read, full }: the anchored read, or a read without an anchor (full: every sample from
  // `since`). A throw with a stored anchor reads once without it; the stored anchor stays until
  // a pass's ops are written. null when Health was turned off meanwhile.
  async function readChanges(mine, since) {
    const anchor = (await state.get(BW_ANCHOR)) || null
    try {
      return { read: await adapter.readBodyMassChanges({ anchor, since }), full: !anchor }
    } catch (error) {
      if (generation !== mine) return null
      if (!anchor) throw error
      return { read: await adapter.readBodyMassChanges({ anchor: null, since }), full: true }
    }
  }

  function notifyWeighIns() {
    try {
      Promise.resolve(onWeighIns()).catch(() => {})
    } catch { /* the server sync is never a reason to fail a pass */ }
  }

  // Body-mass readings from other sources become weigh-in ops, written only through
  // putFromHealth so a weight typed meanwhile is never replaced. The anchor moves only after
  // the ops are written and the cache updated, so a failure reads the same changes again.
  async function importWeighIns(mine) {
    const zone = timeZone()
    let since = Number((await state.get(BW_SINCE)) || NaN)
    if (!Number.isFinite(since)) {
      since = startOfLocalDay(now(), zone)
      await state.set(BW_SINCE, String(since))
    }
    if (generation !== mine) return
    const ownBundle = await ownId()
    if (generation !== mine) return
    const changes = await readChanges(mine, new Date(since))
    if (!changes || generation !== mine) return
    const { read, full } = changes

    // New readings go in now (a cached one keeps its day, whatever the zone is now); deleted ones
    // leave the cache only after the ops are written, so a deletion read again after a failed
    // write still finds its day.
    const days = new Set()
    for (const sample of read.samples) {
      if (!isExternal(sample, ownBundle)) continue
      const d = (await readings.get(sample.uuid))?.d ?? localDate(sample.at, zone)
      await readings.put({ uuid: sample.uuid, d, lb: sample.lb, at: sample.at })
      days.add(d)
    }
    const gone = new Set()
    let blind = false
    if (full) {
      // A full read reports no deletions: a cached reading it did not return is gone. Unless it
      // returned no external reading at all over a non-empty cache: HealthKit hides revoked read
      // access as no data, so that read cannot see. It reconciles nothing and moves no anchor.
      const cache = await readings.list()
      blind = cache.length > 0 && !read.samples.some((s) => isExternal(s, ownBundle))
      const returned = new Set(read.samples.map((s) => s.uuid))
      for (const cached of blind ? [] : cache) {
        if (returned.has(cached.uuid)) continue
        gone.add(cached.uuid)
        days.add(cached.d)
      }
    }
    for (const uuid of read.deleted) {
      const cached = await readings.get(uuid)
      if (!cached) continue // not an external reading this import kept
      gone.add(uuid)
      days.add(cached.d)
    }

    // Rows before the copy (see effectiveEntries).
    const rows = await weighIns.list()
    const pending = await weighIns.listPending()
    const copy = await readCopy()
    const doc = copy?.state ?? {}
    const removals = doc.deleted?.bodyweight
    const deleted = removals && typeof removals === 'object' && !Array.isArray(removals) ? removals : {}
    const copyByDay = {}
    for (const entry of applyDayOps(doc.bodyweight, [], deleted).next) copyByDay[entry.d] = entry
    // Unknown is not deleted: with no readable copy, this phone's acked ops count too, so a synced
    // typed weight still wins its day. With no copy at all (unpaired, after Forget) none is acked.
    const entryByDay = {}
    for (const entry of applyDayOps(doc.bodyweight, copy ? pending : rows, deleted).next) entryByDay[entry.d] = entry
    const unacked = new Set(pending.map((o) => o.d + '@' + o.t))
    const firstDay = localDate(since, zone)
    const localOpByDay = {}
    for (const row of rows) {
      localOpByDay[row.d] = { ...row, acked: !unacked.has(row.d + '@' + row.t) }
      // This phone's own typed removal lets the day's readings back in (no reading predates bwSince).
      if (row.op === 'remove' && row.src == null && row.d >= firstDay && !entryByDay[row.d]) days.add(row.d)
    }
    const readingsByDay = {}
    const lbByHk = {} // the weights the days' Health entries name, remembered even for deleted readings
    for (const d of days) {
      readingsByDay[d] = (await readings.listDay(d)).filter((r) => !gone.has(r.uuid))
      const hk = entryByDay[d]?.src === 'health' ? entryByDay[d].hk : null
      const lb = hk != null ? await readings.seenLb(hk) : null
      if (lb != null) lbByHk[hk] = lb
    }
    const ops = dayOpsFromReadings({ days: [...days], readingsByDay, entryByDay, copyByDay, lbByHk, localOpByDay, deleted, now: now() })

    let written = 0
    try {
      for (const op of ops) if ((await weighIns.putFromHealth(op)).written) written++
      for (const uuid of gone) await readings.remove(uuid)
      if (read.anchor && !blind) await state.set(BW_ANCHOR, read.anchor)
    } finally {
      if (written > 0) notifyWeighIns()
    }
  }

  // Each list runs even when an earlier one failed; the first failure is the pass's error.
  async function pass() {
    const mine = generation
    if (!(await isOn())) return
    let broke = null
    for (const step of [exportWorkouts, exportWeighIns, importWeighIns]) {
      if (generation !== mine) return
      try {
        await step(mine)
      } catch (error) {
        if (!broke) broke = error
      }
    }
    if (broke) throw broke
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
          await links.clear('bw')
          // Both deletes are tried; the first failure is the one reported.
          const results = await Promise.allSettled([adapter.deleteAllOwnWorkouts(), adapter.deleteAllOwnBodyMass()])
          const failure = results.find((r) => r.status === 'rejected')
          if (failure) throw failure.reason
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
    const result = { on: false, write: 'unknown', exported: 0, weighInsInHealth: 0, waiting: 0, skipped: 0, error: lastError || heldError }
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
      const bwLinks = await links.list('bw')
      result.weighInsInHealth = bwLinks.filter((l) => l.state === 'exported').length
      if (result.on) {
        const rows = await workouts.list()
        result.skipped = rows.filter((d) => !exportable(d)).length
        // Only links a fresh plan would act on: a failure that no longer matters does not stick.
        const plan = planWorkoutExport({ rows, links: current, now: now() })
        result.waiting = plan.save.length
        const removing = new Set(plan.remove.map((r) => r.key))
        failed = [
          ...current.filter((l) => l.error && (l.state === 'pending' || removing.has(l.key))),
          ...bwLinks.filter((l) => l.error),
        ].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
      }
      result.error = failed ? failed.error : lastError || (await state.get('error')) || heldError || null
    } catch {
      // keep what was read so far
    }
    return result
  }

  return { run, enable, disable, status, subscribe }
}
