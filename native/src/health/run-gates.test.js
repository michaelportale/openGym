import { expect, test } from 'vitest'
import { removeGateWorkouts, runWorkoutGates } from './run-gates.js'

function fake(opts = {}) {
  const store = []
  let n = 0
  const a = {
    deleteCalls: 0,
    store,
    async saveStrengthWorkout({ id, version, volumeLb }) {
      if (opts.rejectSave) throw opts.rejectSave
      const same = store.find(w => w.id === id)
      if (same && version === same.syncVersion) {
        if (opts.sameVersionThrows) throw new Error('same version')
        if (opts.duplicatesOnRetry) {
          store.push({ id, uuid: 'u' + ++n, syncVersion: version, volumeLb })
          return { uuid: 'u' + n }
        }
        return { uuid: same.uuid }
      }
      if (same && version > same.syncVersion && !opts.replaceKeepsOld) {
        same.syncVersion = version
        same.volumeLb = volumeLb
        return { uuid: same.uuid }
      }
      store.push({ id, uuid: 'u' + ++n, syncVersion: version, volumeLb })
      return { uuid: 'u' + n }
    },
    async findWorkoutsBySyncId(id) {
      if (opts.findThrows) throw new Error('read denied')
      return store.filter(w => w.id === id).map(({ uuid, syncVersion, volumeLb }) => ({ uuid, syncVersion, volumeLb }))
    },
    async deleteWorkout(uuid) {
      a.deleteCalls++
      if (opts.deleteNoop) return 0
      if (opts.deleteFailsOnce && a.deleteCalls === 1) return 0
      const i = store.findIndex(w => w.uuid === uuid)
      if (i < 0) return 0
      store.splice(i, 1)
      return 1
    }
  }
  return a
}

const statuses = r => Object.fromEntries(r.gates.map(g => [g.name, g.status]))

test('all gates pass and nothing is left over', async () => {
  const r = await runWorkoutGates(fake(), { nowMs: 1 })
  expect(statuses(r)).toEqual({ save: 'pass', retry: 'pass', replace: 'pass', delete: 'pass' })
  expect(r.leftovers).toBe(0)
})
test('a same-version retry that throws still passes when one workout exists', async () => {
  const r = await runWorkoutGates(fake({ sameVersionThrows: true }), { nowMs: 1 })
  expect(statuses(r).retry).toBe('pass')
})
test('a retry that creates a second workout fails', async () => {
  const r = await runWorkoutGates(fake({ duplicatesOnRetry: true }), { nowMs: 1 })
  expect(statuses(r).retry).toBe('fail')
})
test('replace fails unless one workout remains at version 2 with the new volume', async () => {
  const r = await runWorkoutGates(fake({ replaceKeepsOld: true }), { nowMs: 1 })
  expect(statuses(r).replace).toBe('fail')
})
test('a refused save fails, skips later gates and does not throw', async () => {
  const r = await runWorkoutGates(fake({ rejectSave: new Error('denied') }), { nowMs: 1 })
  expect(statuses(r)).toEqual({ save: 'fail', retry: 'skipped', replace: 'skipped', delete: 'skipped' })
})
test('cleanup runs after a midway failure and leftovers are counted', async () => {
  const a = fake({ duplicatesOnRetry: true })
  const r = await runWorkoutGates(a, { nowMs: 1 })
  expect(a.deleteCalls).toBeGreaterThan(0)
  expect(r.leftovers).toBe(0)
})
test('a delete that removes nothing fails and reports the leftover', async () => {
  const r = await runWorkoutGates(fake({ deleteNoop: true }), { nowMs: 1 })
  expect(statuses(r).delete).toBe('fail')
  expect(r.leftovers).toBe(1)
})
test('an unreadable store reports unknown leftovers, never a pass or zero', async () => {
  const a = fake({ findThrows: true })
  const r = await runWorkoutGates(a, { nowMs: 1 })
  expect(r.leftovers).toBeNull()
  expect(r.gates.some(g => g.status === 'pass')).toBe(false)
  expect(a.store).toHaveLength(0)
})
test('cleanup alone removes a workout the delete gate failed to remove', async () => {
  const r = await runWorkoutGates(fake({ deleteFailsOnce: true }), { nowMs: 1 })
  expect(statuses(r).delete).toBe('fail')
  expect(r.leftovers).toBe(0)
})

const OWN = 'io.github.michaelportale.opengym'
const row = (uuid, syncId, bundleId = OWN) => ({ uuid, bundleId, syncId })
const ownStore = (rows, { findThrows, deleteThrows = [], deleteNoop = [] } = {}) => {
  const store = [...rows]
  const a = {
    deleted: [],
    async findOwnWorkouts(bundleId) {
      expect(bundleId).toBe(OWN)
      if (findThrows) throw new Error('read denied')
      return [...store]
    },
    async deleteWorkout(uuid) {
      a.deleted.push(uuid)
      if (deleteThrows.includes(uuid)) throw new Error('refused')
      if (deleteNoop.includes(uuid)) return 0
      store.splice(store.findIndex(w => w.uuid === uuid), 1)
      return 1
    }
  }
  return a
}

test('sweeps gate workouts from any run and touches nothing else', async () => {
  const a = ownStore([
    row('old-run', 'opengym-phase0-gate-1730000000000'),
    row('manual', 'opengym-phase0-gate-manual'),
    row('real', 'workout-123'),
    row('foreign', 'opengym-phase0-gate-1', 'com.example.other')
  ])
  expect(await removeGateWorkouts(a, OWN)).toEqual({ removed: 2, left: 0, other: 1 })
  expect(a.deleted).toEqual(['old-run', 'manual'])
})

test('a failed delete does not stop the rest and is reported as left', async () => {
  const a = ownStore([row('stuck', 'opengym-phase0-gate-1'), row('fine', 'opengym-phase0-gate-2')], { deleteThrows: ['stuck'] })
  expect(await removeGateWorkouts(a, OWN)).toEqual({ removed: 1, left: 1, other: 0, error: 'refused' })
  expect(a.deleted).toEqual(['stuck', 'fine'])
})

test('a delete that removes nothing counts as left, not removed', async () => {
  const a = ownStore([row('stuck', 'opengym-phase0-gate-1')], { deleteNoop: ['stuck'] })
  expect(await removeGateWorkouts(a, OWN)).toEqual({ removed: 0, left: 1, other: 0 })
})

test('an unreadable store rejects instead of claiming there is nothing to remove', async () => {
  const a = ownStore([row('old-run', 'opengym-phase0-gate-1')], { findThrows: true })
  await expect(removeGateWorkouts(a, OWN)).rejects.toThrow('read denied')
  expect(a.deleted).toEqual([])
})
