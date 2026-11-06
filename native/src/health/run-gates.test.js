import { expect, test } from 'vitest'
import { runWorkoutGates } from './run-gates.js'

function fake(opts = {}) {
  const store = []
  let n = 0
  const a = {
    deleteCalls: 0,
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
      return store.filter(w => w.id === id).map(({ uuid, syncVersion, volumeLb }) => ({ uuid, syncVersion, volumeLb }))
    },
    async deleteWorkout(uuid) {
      a.deleteCalls++
      if (opts.deleteNoop) return 0
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
