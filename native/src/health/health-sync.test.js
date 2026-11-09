import { expect, test } from 'vitest'
import { applyDayOps } from '../body/day-ops.js'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { buildPush } from '../sync/outbox.js'
import { createMemoryHealthStore } from './health-store.js'
import { createHealthSync } from './health-sync.js'

const doc = (id, over = {}) => ({ id, d: '2026-11-0' + id.slice(-1), start: 1000, end: 5000, vol: 1200, entries: [], ...over })

function fakeAdapter() {
  const calls = []
  const adapter = {
    calls,
    failSave: null, // an Error to throw from every save
    failDelete: null,
    failAccess: null,
    write: 'on',
    gate: null, // a promise the next save waits on
    inFlight: 0,
    maxInFlight: 0,
    async requestHealthAccess() {
      calls.push(['access'])
      if (adapter.failAccess) throw adapter.failAccess
    },
    workoutWriteAccess() {
      if (adapter.write === 'throw') throw new Error('no')
      return adapter.write
    },
    async saveStrengthWorkout(args) {
      calls.push(['save', args])
      adapter.inFlight++
      adapter.maxInFlight = Math.max(adapter.maxInFlight, adapter.inFlight)
      try {
        if (adapter.gate) await adapter.gate
        if (adapter.failSave) throw adapter.failSave
        return { uuid: 'u-' + args.id }
      } finally {
        adapter.inFlight--
      }
    },
    async deleteWorkoutsBySyncId(syncId) {
      calls.push(['delete', syncId])
      if (adapter.failDelete) throw adapter.failDelete
      return 1
    },
    async deleteAllOwnWorkouts() {
      calls.push(['deleteAll'])
      if (adapter.failDelete) throw adapter.failDelete
      return 2
    },
    async saveBodyMass(args) {
      calls.push(['saveBW', args])
      if (adapter.failSaveBW) throw adapter.failSaveBW
      return { uuid: 'u-' + args.id }
    },
    async deleteBodyMassBySyncId(syncId) {
      calls.push(['deleteBW', syncId])
      return 1
    },
    async deleteAllOwnBodyMass() {
      calls.push(['deleteAllBW'])
      if (adapter.failDeleteBW) throw adapter.failDeleteBW
      return 1
    },
    async readBodyMassChanges(args) {
      calls.push(['readBodyMass', args])
      return { samples: [], deleted: [], anchor: 'a' }
    },
  }
  return adapter
}

// The weigh-in import's dependencies, with nothing to import.
const importDeps = () => ({
  weighIns: createMemoryWeighIns(),
  readCopy: async () => null,
  ownBundleId: async () => 'io.github.michaelportale.opengym',
  timeZone: () => 'UTC',
  onWeighIns: () => {},
})

async function setup(ids = ['w1'], over = {}) {
  const adapter = fakeAdapter()
  const store = createMemoryHealthStore()
  const workouts = createMemoryFinishedWorkouts()
  for (const id of ids) await workouts.put(doc(id))
  let t = 1000
  const health = createHealthSync({ adapter, store, workouts, now: () => (t += 10), ...importDeps(), ...over })
  return { adapter, store, workouts, health }
}
const saves = adapter => adapter.calls.filter(c => c[0] === 'save').map(c => c[1])

test('off: run writes nothing and reads nothing', async () => {
  const { adapter, store, health } = await setup()
  await health.run()
  expect(adapter.calls).toEqual([])
  expect(await store.links.list('w')).toEqual([])
  expect((await health.status()).on).toBe(false)
})

test('off: run and status never list the finished workouts', async () => {
  const { workouts, health } = await setup()
  let lists = 0
  const list = workouts.list.bind(workouts)
  workouts.list = async () => { lists++; return list() }
  await health.run()
  await health.status()
  expect(lists).toBe(0)
})

test('enable then run saves each finished workout once; a second run saves nothing', async () => {
  const { adapter, store, health } = await setup(['w1', 'w2'])
  await health.enable()
  expect(saves(adapter).map(s => s.id).sort()).toEqual(['opengym-w-w1', 'opengym-w-w2'])
  expect(saves(adapter)[0]).toMatchObject({ start: new Date(1000), end: new Date(5000), volumeLb: 1200, partial: false })
  expect((await store.links.list('w')).every(l => l.state === 'exported')).toBe(true)
  await health.run()
  expect(saves(adapter)).toHaveLength(2)
  expect(await health.status()).toMatchObject({ on: true, write: 'on', exported: 2, waiting: 0, skipped: 0, error: null })
})

test('the adapter gets a missing volume as undefined and the partial flag as a boolean', async () => {
  const { adapter, workouts, health } = await setup([])
  await workouts.put(doc('w1', { vol: undefined, volumePartial: 1 }))
  await health.enable()
  expect(saves(adapter)[0].volumeLb).toBeUndefined()
  expect(saves(adapter)[0].partial).toBe(true)
})

test('a failed save keeps the plan version for the retry', async () => {
  const { adapter, store, health } = await setup()
  await store.state.set('on', '1')
  adapter.failSave = new Error('protected data unavailable')
  await health.run()
  const [pending] = await store.links.list('w')
  expect(pending).toMatchObject({ state: 'pending', error: 'protected data unavailable' })
  const version = pending.version
  expect((await health.status()).error).toBe('protected data unavailable')
  adapter.failSave = null
  await health.run()
  expect(saves(adapter).map(s => s.version)).toEqual([version, version])
  expect(await store.links.list('w')).toEqual([expect.objectContaining({ state: 'exported', error: null, version })])
  expect((await health.status()).error).toBeNull()
})

test('the pending link is stored before the adapter is called', async () => {
  const { adapter, store, health } = await setup()
  await store.state.set('on', '1')
  let seen = null
  const original = adapter.saveStrengthWorkout
  adapter.saveStrengthWorkout = async args => {
    seen = await store.links.list('w')
    return original(args)
  }
  await health.run()
  expect(seen).toEqual([expect.objectContaining({ state: 'pending', version: expect.any(Number) })])
})

test('stops at the first failure', async () => {
  const { adapter, store, health } = await setup(['w1', 'w2', 'w3'])
  await store.state.set('on', '1')
  adapter.failSave = new Error('denied')
  adapter.write = 'off'
  await health.run()
  expect(saves(adapter)).toHaveLength(1)
  const status = await health.status()
  expect(status.waiting).toBe(3)
  expect(status.write).toBe('off')
  expect(status.error).toBe('denied')
})

test('concurrent runs coalesce into exactly one follow-up pass', async () => {
  const { adapter, workouts, store, health } = await setup(['w1'])
  await store.state.set('on', '1')
  let emits = 0
  health.subscribe(() => { emits++ })
  let release
  adapter.gate = new Promise(resolve => (release = resolve))
  const first = health.run()
  await new Promise(r => setTimeout(r, 0))
  await workouts.put(doc('w2'))
  const p2 = health.run()
  const p3 = health.run()
  const p4 = health.run()
  expect(p3).toBe(p2)
  expect(p4).toBe(p2)
  expect(p2).not.toBe(first)
  await new Promise(r => setTimeout(r, 0))
  release()
  await Promise.all([first, p2, p3, p4])
  expect(emits).toBe(4) // two passes, each a start and an end
  expect(adapter.maxInFlight).toBe(1)
  expect(saves(adapter).map(s => s.id).sort()).toEqual(['opengym-w-w1', 'opengym-w-w2'])
})

test('disable without remove keeps links; enabling again saves nothing', async () => {
  const { adapter, store, health } = await setup()
  await health.enable()
  await health.disable({ remove: false })
  expect((await health.status()).on).toBe(false)
  expect(await store.links.list('w')).toHaveLength(1)
  expect(adapter.calls.some(c => c[0] === 'delete')).toBe(false)
  await health.enable()
  expect(saves(adapter)).toHaveLength(1)
})

test('disable with remove deletes everything the app wrote and clears links; finished workouts untouched', async () => {
  const { adapter, store, workouts, health } = await setup(['w1', 'w2'])
  await health.enable()
  const before = await workouts.list()
  await health.disable({ remove: true })
  expect(adapter.calls.filter(c => c[0] === 'deleteAll')).toHaveLength(1)
  expect(await store.links.list('w')).toEqual([])
  expect(await workouts.list()).toEqual(before)
  expect((await health.status()).on).toBe(false)
})

test('a failed remove on disable leaves no stale links; enabling again re-saves each workout once and clears the error', async () => {
  const { adapter, store, health } = await setup(['w1', 'w2'])
  await health.enable()
  adapter.failDelete = new Error('locked')
  await health.disable({ remove: true })
  expect(await store.links.list('w')).toEqual([])
  expect((await health.status()).error).toBe('locked')
  adapter.failDelete = null
  adapter.calls.length = 0
  await health.enable()
  expect(saves(adapter).map(s => s.id).sort()).toEqual(['opengym-w-w1', 'opengym-w-w2'])
  expect(await health.status()).toMatchObject({ on: true, error: null, exported: 2, waiting: 0 })
})

test('a disable that succeeds clears the error an earlier failed disable left', async () => {
  const { adapter, health } = await setup(['w1'])
  await health.enable()
  adapter.failDelete = new Error('locked')
  await health.disable({ remove: true })
  expect((await health.status()).error).toBe('locked')
  adapter.failDelete = null
  await health.disable({ remove: true })
  expect((await health.status()).error).toBeNull()
})

test('a later disable without remove does not cancel an earlier disable that removes', async () => {
  const { adapter, store, health } = await setup(['w1'])
  await health.enable()
  const a = health.disable({ remove: true })
  const b = health.disable({ remove: false })
  await Promise.all([a, b])
  expect(adapter.calls.filter(c => c[0] === 'deleteAll')).toHaveLength(1)
  expect(await store.links.list('w')).toEqual([])
})

test('disable during a slow save switches off at once and no further save happens', async () => {
  const { adapter, store, health } = await setup(['w1', 'w2', 'w3'])
  await store.state.set('on', '1')
  let release
  adapter.gate = new Promise(resolve => (release = resolve))
  const running = health.run()
  await new Promise(r => setTimeout(r, 0))
  expect(saves(adapter)).toHaveLength(1)
  const off = health.disable({ remove: false })
  expect(await store.state.get('on')).toBe('0') // before disable is awaited
  release()
  await Promise.all([running, off])
  expect(saves(adapter)).toHaveLength(1)
  expect(await store.state.get('on')).toBe('0')
})

test('disable during a slow remove stops the pass before its next remove', async () => {
  const { adapter, store, health } = await setup([])
  await store.state.set('on', '1')
  for (const key of ['o1', 'o2']) {
    await store.links.put({ kind: 'w', key, syncId: 'opengym-w-' + key, version: 1, hash: 'h', state: 'exported', error: null, updatedAt: 1 })
  }
  let release
  const slow = new Promise(resolve => (release = resolve))
  const original = adapter.deleteWorkoutsBySyncId
  adapter.deleteWorkoutsBySyncId = async syncId => {
    const result = await original(syncId)
    await slow
    return result
  }
  const running = health.run()
  await new Promise(r => setTimeout(r, 0))
  expect(adapter.calls.filter(c => c[0] === 'delete')).toHaveLength(1)
  const off = health.disable({ remove: false })
  release()
  await Promise.all([running, off])
  expect(adapter.calls.filter(c => c[0] === 'delete')).toHaveLength(1)
})

test('enable then disable without awaiting ends off with no saves', async () => {
  const { adapter, store, health } = await setup(['w1'])
  const a = health.enable()
  const b = health.disable({ remove: false })
  await Promise.all([a, b])
  expect(await store.state.get('on')).toBe('0')
  expect(saves(adapter)).toHaveLength(0)
})

test('disable with remove then enable without awaiting ends on, removes nothing and exports once', async () => {
  const { adapter, store, health } = await setup(['w1'])
  await health.enable()
  const b = health.disable({ remove: true })
  const a = health.enable()
  await Promise.all([a, b])
  expect(await store.state.get('on')).toBe('1')
  expect(adapter.calls.some(c => c[0] === 'deleteAll')).toBe(false)
  expect(saves(adapter)).toHaveLength(1)
})

test('a request-access failure leaves Health off with the error in status', async () => {
  const { adapter, store, health } = await setup()
  adapter.failAccess = new Error('not available')
  await health.enable()
  expect(await store.state.get('on')).not.toBe('1')
  expect(saves(adapter)).toHaveLength(0)
  expect(await health.status()).toMatchObject({ on: false, error: 'not available' })
  adapter.failAccess = null
  await health.enable()
  expect(await health.status()).toMatchObject({ on: true, error: null })
})

test('an enable error survives the run that follows, even when health_state cannot be written', async () => {
  const { adapter, store, health } = await setup()
  adapter.failAccess = new Error('not available')
  const set = store.state.set
  store.state.set = async (key, value) => {
    if (key === 'error') throw new Error('disk')
    return set(key, value)
  }
  await health.enable()
  expect((await health.status()).error).toBe('not available')
})

test('an invalid workout is skipped, shown as skipped and not retried', async () => {
  const { adapter, workouts, store, health } = await setup(['w1'])
  await workouts.put(doc('w2', { end: 10 }))
  await health.enable()
  expect(saves(adapter).map(s => s.id)).toEqual(['opengym-w-w1'])
  expect((await store.links.list('w')).find(l => l.key === 'w2')).toMatchObject({ state: 'skipped' })
  await health.run()
  expect(saves(adapter)).toHaveLength(1)
  expect(await health.status()).toMatchObject({ skipped: 1, waiting: 0, exported: 1 })
})

test('a workout that became invalid after export is removed from Health and skipped', async () => {
  const { adapter, workouts, store, health } = await setup(['w1'])
  await health.enable()
  await workouts.put(doc('w1', { end: 10 }))
  await health.run()
  expect(adapter.calls.filter(c => c[0] === 'delete')).toEqual([['delete', 'opengym-w-w1']])
  expect(await store.links.list('w')).toEqual([expect.objectContaining({ key: 'w1', state: 'skipped' })])
})

test('status never throws and write is unknown when the adapter throws', async () => {
  const { adapter, health } = await setup()
  adapter.write = 'throw'
  expect((await health.status()).write).toBe('unknown')
  const broken = createHealthSync({
    adapter,
    store: { links: { list: async () => { throw new Error('db') } }, state: { get: async () => { throw new Error('db') } } },
    workouts: { list: async () => [] },
    now: () => 1,
    ...importDeps(),
  })
  await expect(broken.status()).resolves.toMatchObject({ on: false, write: 'unknown' })
  await expect(broken.run()).resolves.toBeDefined()
  await expect(broken.enable()).resolves.toBeDefined()
  await expect(broken.disable({ remove: true })).resolves.toBeDefined()
})

test('subscribers hear about runs, enable and disable, and can unsubscribe', async () => {
  const { health } = await setup()
  let n = 0
  const off = health.subscribe(() => { n++ })
  await health.enable()
  const afterEnable = n
  expect(afterEnable).toBeGreaterThan(1)
  await health.disable({ remove: false })
  expect(n).toBeGreaterThan(afterEnable)
  off()
  const settled = n
  await health.enable()
  expect(n).toBe(settled)
})

test('the import runs after the workout export, even when a save fails', async () => {
  const { adapter, store, health } = await setup(['w1'])
  await store.state.set('on', '1')
  await health.run()
  expect(adapter.calls.map(c => c[0])).toEqual(['save', 'readBodyMass'])
  adapter.calls.length = 0
  adapter.failSave = new Error('denied')
  await store.links.clear('w')
  await health.run()
  expect(adapter.calls.map(c => c[0])).toEqual(['save', 'readBodyMass'])
  expect((await health.status()).error).toBe('denied')
})

test('the engine needs every weigh-in import dependency', () => {
  const base = { adapter: fakeAdapter(), store: createMemoryHealthStore(), workouts: createMemoryFinishedWorkouts(), now: () => 1, ...importDeps() }
  expect(() => createHealthSync(base)).not.toThrow()
  for (const key of ['weighIns', 'readCopy', 'ownBundleId', 'timeZone', 'onWeighIns']) {
    expect(() => createHealthSync({ ...base, [key]: undefined }), key).toThrow(key)
  }
  expect(() => createHealthSync({ ...base, timeZone: 'UTC' })).toThrow('timeZone')
})

test('a workout export that throws does not stop the import; its error shows', async () => {
  const { adapter, store, workouts, health } = await setup(['w1'])
  await store.state.set('on', '1')
  workouts.list = async () => { throw new Error('db locked') }
  await health.run()
  expect(adapter.calls.map(c => c[0])).toEqual(['readBodyMass'])
  expect((await health.status()).error).toBe('db locked')
})

// Typed weigh-ins
const bwSaves = adapter => adapter.calls.filter(c => c[0] === 'saveBW').map(c => c[1])
const typed = (d, w, t) => ({ d, op: 'set', w, t })

async function bwSetup(over = {}) {
  const weighIns = createMemoryWeighIns()
  const env = await setup([], { ...importDeps(), weighIns, ...over })
  await env.store.state.set('on', '1')
  return { ...env, weighIns }
}

test('a typed set is saved once, user entered, at its time; a second pass saves nothing', async () => {
  const { adapter, store, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180.4, 5000))
  await health.run()
  await health.run()
  expect(bwSaves(adapter)).toEqual([{ id: 'opengym-bw-2026-11-09', version: expect.any(Number), lb: 180.4, at: new Date(5000) }])
  expect(await store.links.list('bw')).toEqual([expect.objectContaining({ key: '2026-11-09', state: 'exported' })])
  expect((await health.status()).weighInsInHealth).toBe(1)
})

test('the pass order is workouts, typed weigh-ins out, then the import', async () => {
  const { adapter, workouts, weighIns, health } = await bwSetup()
  await workouts.put(doc('w1'))
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  expect(adapter.calls.map(c => c[0])).toEqual(['save', 'saveBW', 'readBodyMass'])
})

test('a failed save keeps the pending link and its version for the retry', async () => {
  const { adapter, store, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  adapter.failSaveBW = new Error('denied')
  await health.run()
  const [pending] = await store.links.list('bw')
  expect(pending).toMatchObject({ state: 'pending', error: 'denied' })
  adapter.failSaveBW = null
  await health.run()
  expect(bwSaves(adapter).map(s => s.version)).toEqual([pending.version, pending.version])
  expect((await store.links.list('bw'))[0].state).toBe('exported')
})

test('an edit saves a greater version', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  await weighIns.put(typed('2026-11-09', 181, 6000))
  await health.run()
  const [a, b] = bwSaves(adapter)
  expect(b.lb).toBe(181)
  expect(b.version).toBeGreaterThan(a.version)
})

test('a typed removal deletes by sync id and drops the link', async () => {
  const { adapter, store, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  await weighIns.put({ d: '2026-11-09', op: 'remove', t: 6000, baseT: 5000 })
  await health.run()
  expect(adapter.calls.filter(c => c[0] === 'deleteBW')).toEqual([['deleteBW', 'opengym-bw-2026-11-09']])
  expect(await store.links.list('bw')).toEqual([])
})

test('an imported weigh-in is never saved to Health', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.putFromHealth({ d: '2026-11-09', op: 'set', w: 180, t: 5000, src: 'health', hk: 'u1' })
  await health.run()
  expect(bwSaves(adapter)).toEqual([])
})

test('a typed set the server superseded with a newer web edit is not saved; if it was, it is removed', async () => {
  let copy = null
  const { adapter, store, weighIns, health } = await bwSetup({ readCopy: async () => copy })
  await weighIns.put(typed('2026-11-09', 180, 5000))
  copy = { state: { bodyweight: [{ d: '2026-11-09', w: 175, t: 9000 }] } }
  await health.run()
  expect(bwSaves(adapter)).toEqual([])
  copy = null
  await health.run()
  expect(bwSaves(adapter)).toHaveLength(1)
  copy = { state: { bodyweight: [{ d: '2026-11-09', w: 175, t: 9000 }] } }
  await health.run()
  expect(adapter.calls.filter(c => c[0] === 'deleteBW')).toHaveLength(1)
  expect(await store.links.list('bw')).toEqual([])
})

test('a day deleted on the server is removed from Health', async () => {
  let copy = null
  const { adapter, weighIns, health } = await bwSetup({ readCopy: async () => copy })
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  copy = { state: { bodyweight: [], deleted: { bodyweight: { '2026-11-09': 8000 } } } }
  await health.run()
  expect(adapter.calls.filter(c => c[0] === 'deleteBW')).toEqual([['deleteBW', 'opengym-bw-2026-11-09']])
})

test('a failed weigh-in save stops that list but the import still runs', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-08', 180, 5000))
  await weighIns.put(typed('2026-11-09', 181, 6000))
  adapter.failSaveBW = new Error('denied')
  await health.run()
  expect(bwSaves(adapter)).toHaveLength(1)
  expect(adapter.calls.map(c => c[0])).toEqual(['saveBW', 'readBodyMass'])
  expect((await health.status()).error).toBe('denied')
})

test('turning Health off mid-export stops further adapter calls', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-08', 180, 5000))
  await weighIns.put(typed('2026-11-09', 181, 6000))
  let release
  const gate = new Promise(resolve => (release = resolve))
  const original = adapter.saveBodyMass
  adapter.saveBodyMass = async args => { await gate; return original(args) }
  const running = health.run()
  await new Promise(r => setTimeout(r, 5))
  const off = health.disable({ remove: false })
  release()
  await Promise.all([running, off])
  expect(bwSaves(adapter)).toHaveLength(1)
  expect(adapter.calls.some(c => c[0] === 'readBodyMass')).toBe(false)
})

test('disable with remove clears bw links and deletes the app\'s own body mass', async () => {
  const { adapter, store, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  await health.disable({ remove: true })
  expect(await store.links.list('bw')).toEqual([])
  expect(adapter.calls.filter(c => c[0] === 'deleteAllBW')).toHaveLength(1)
  expect(adapter.calls.filter(c => c[0] === 'deleteAll')).toHaveLength(1)
})

test('disable without remove keeps bw links and deletes nothing', async () => {
  const { adapter, store, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  await health.disable({ remove: false })
  expect(await store.links.list('bw')).toHaveLength(1)
  expect(adapter.calls.some(c => c[0] === 'deleteAllBW')).toBe(false)
})

test('a typed weigh-in written to Health and read back makes no day op', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  const own = 'io.github.michaelportale.opengym'
  adapter.readBodyMassChanges = async () => ({
    samples: [{ uuid: 'echo', lb: 180, at: 5000, bundleId: own, syncId: 'opengym-bw-2026-11-09' }],
    deleted: [],
    anchor: 'b',
  })
  await health.run()
  expect(await weighIns.list()).toEqual([typed('2026-11-09', 180, 5000)])
  // The same sample under another bundle id is still not external: the sync id marks it.
  adapter.readBodyMassChanges = async () => ({
    samples: [{ uuid: 'echo2', lb: 180, at: 5000, bundleId: 'other', syncId: 'opengym-bw-2026-11-09' }],
    deleted: [],
    anchor: 'c',
  })
  await health.run()
  expect(await weighIns.list()).toEqual([typed('2026-11-09', 180, 5000)])
})

test('an unreadable copy removes nothing for an acked typed row and saves nothing new', async () => {
  let copy = { state: { bodyweight: [{ d: '2026-11-09', w: 180, t: 5000 }] } }
  const { adapter, weighIns, health } = await bwSetup({ readCopy: async () => copy })
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  await weighIns.markAcked([{ d: '2026-11-09', t: 5000 }], 'x')
  copy = null
  adapter.calls.length = 0
  await health.run()
  expect(adapter.calls.filter(c => c[0] === 'deleteBW' || c[0] === 'saveBW')).toEqual([])
})

test('status reads no copy and no weigh-in list while Health is on', async () => {
  let copyReads = 0
  const weighIns = createMemoryWeighIns()
  const { health } = await setup([], { ...importDeps(), weighIns, readCopy: async () => { copyReads++; return null } })
  await weighIns.put(typed('2026-11-09', 180, 5000))
  const list = weighIns.list
  let lists = 0
  weighIns.list = async () => { lists++; return list() }
  await health.enable()
  copyReads = 0
  lists = 0
  await health.status()
  expect([copyReads, lists]).toEqual([0, 0])
})

test('a bw link error shows in status, newest first, from the links alone', async () => {
  const { adapter, weighIns, health } = await bwSetup()
  await weighIns.put(typed('2026-11-09', 180, 5000))
  adapter.failSaveBW = new Error('denied')
  await health.run()
  expect((await health.status()).error).toBe('denied')
})

test('a failed remove leaves no stale error once the day qualifies again', async () => {
  let copy = null
  const { adapter, store, weighIns, health } = await bwSetup({ readCopy: async () => copy })
  await weighIns.put(typed('2026-11-09', 180, 5000))
  await health.run()
  copy = { state: { bodyweight: [{ d: '2026-11-09', w: 175, t: 9000 }] } }
  const original = adapter.deleteBodyMassBySyncId
  adapter.deleteBodyMassBySyncId = async () => { throw new Error('locked') }
  await health.run()
  expect((await store.links.list('bw'))[0].error).toBe('locked')
  adapter.deleteBodyMassBySyncId = original
  copy = null
  await health.run()
  expect((await store.links.list('bw'))[0].error).toBeNull()
  expect((await health.status()).error).toBeNull()
})

test('disable with remove tries both deletes even when the first throws, and reports the first error', async () => {
  const { adapter, store, health } = await bwSetup()
  const original = adapter.deleteAllOwnWorkouts
  adapter.deleteAllOwnWorkouts = async () => { adapter.calls.push(['deleteAll']); throw new Error('first') }
  adapter.failDeleteBW = new Error('second')
  await health.disable({ remove: true })
  expect(adapter.calls.filter(c => c[0] === 'deleteAll' || c[0] === 'deleteAllBW').length).toBe(2)
  expect((await health.status()).error).toBe('first')
  expect(await store.links.list('bw')).toEqual([])
  adapter.deleteAllOwnWorkouts = original
})

// C1 residual: a weight the owner typed on the web over an imported day, then a Health deletion
// the app-open pass plans on a stale copy.
const OWN = 'io.github.michaelportale.opengym'
const DAY = '2026-11-09'
const atHour = h => Date.parse(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`)
const scale = (uuid, lb, at) => ({ uuid, lb, at, bundleId: 'com.withings', syncId: null })

async function webEditSetup() {
  const reads = []
  const adapter = fakeAdapter()
  adapter.readBodyMassChanges = async () => reads.shift() ?? { samples: [], deleted: [], anchor: 'a' }
  const store = createMemoryHealthStore()
  await store.state.set('on', '1')
  await store.state.set('bwSince', String(atHour(0)))
  const weighIns = createMemoryWeighIns()
  const w = { clock: atHour(8), copy: { state: { bodyweight: [] } }, server: { bodyweight: [] } }
  const health = createHealthSync({
    adapter, store, workouts: createMemoryFinishedWorkouts(), now: () => w.clock, weighIns,
    readCopy: async () => w.copy, ownBundleId: async () => OWN, timeZone: () => 'UTC', onWeighIns: () => {},
  })
  // the sync engine, reduced: pull, reconcile, push, pull, reconcile
  const reconcile = async () => {
    const r = applyDayOps(w.copy.state.bodyweight, await weighIns.listPending(), w.copy.state.deleted?.bodyweight)
    await weighIns.markAcked([...r.done, ...r.superseded], 'ack')
  }
  const pull = async () => {
    w.copy = { state: structuredClone(w.server) }
    await reconcile()
  }
  const sync = async () => {
    await pull()
    const plan = buildPush(w.copy, [], await weighIns.listPending())
    if (plan) {
      w.server = structuredClone(plan.state)
      await pull()
    }
  }
  const editOnWeb = () => {
    const entry = w.server.bodyweight.find(b => b.d === DAY)
    entry.w = 182
    entry.t = atHour(9)
  }
  return { reads, health, w, sync, pull, editOnWeb }
}

test('C1 residual: a deleted reading, a stale-copy pass and a later reading leave the web-typed weight alone', async () => {
  const { reads, health, w, sync, pull, editOnWeb } = await webEditSetup()
  reads.push({ samples: [scale('X', 185, atHour(7))], deleted: [], anchor: 'a1' })
  await health.run()
  await sync()
  expect(w.server.bodyweight).toEqual([expect.objectContaining({ d: DAY, w: 185, hk: 'X' })])
  editOnWeb()
  w.clock = atHour(10)
  reads.push({ samples: [], deleted: ['X'], anchor: 'a2' })
  await health.run() // plans on the copy from before the web edit
  await sync()
  await pull() // the copy catches up
  w.clock = atHour(12)
  reads.push({ samples: [scale('Y', 186, atHour(11))], deleted: [], anchor: 'a3' })
  await health.run()
  await sync()
  expect(w.server.bodyweight).toEqual([expect.objectContaining({ d: DAY, w: 182 })])
})

test('C1 residual: the deletion and the next reading in one stale pass, then a third reading', async () => {
  const { reads, health, w, sync, pull, editOnWeb } = await webEditSetup()
  reads.push({ samples: [scale('X', 185, atHour(7))], deleted: [], anchor: 'a1' })
  await health.run()
  await sync()
  editOnWeb()
  w.clock = atHour(12)
  reads.push({ samples: [scale('Y', 186, atHour(11))], deleted: ['X'], anchor: 'a2' })
  await health.run() // plans on the copy from before the web edit
  await sync()
  await pull()
  w.clock = atHour(14)
  reads.push({ samples: [scale('Z', 187, atHour(13))], deleted: [], anchor: 'a3' })
  await health.run()
  await sync()
  expect(w.server.bodyweight).toEqual([expect.objectContaining({ d: DAY, w: 182 })])
})
