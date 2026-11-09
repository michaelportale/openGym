import { expect, test } from 'vitest'
import { applyDayOps } from '../body/day-ops.js'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { createMemoryHealthStore } from './health-store.js'
import { createHealthSync } from './health-sync.js'
import { dayOpsFromReadings, isExternal, startOfLocalDay } from './weight-import.js'

const OWN = 'io.github.michaelportale.opengym'
const SCALE = 'com.withings.wiScaleNG'
const DAY = '2026-11-09'
const hour = (h, d = DAY) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`)
const NOW = hour(12)
const MIDNIGHT = hour(0)

// ---- pure rules ----

test('own samples are not external: own bundle id, or an opengym-bw- sync id from anywhere', () => {
  expect(isExternal({ bundleId: SCALE, syncId: null }, OWN)).toBe(true)
  expect(isExternal({ bundleId: SCALE, syncId: 'withings-123' }, OWN)).toBe(true)
  expect(isExternal({ bundleId: OWN, syncId: null }, OWN)).toBe(false)
  expect(isExternal({ bundleId: 'com.apple.Health', syncId: 'opengym-bw-2026-11-09' }, OWN)).toBe(false)
  expect(isExternal({ bundleId: SCALE, syncId: null }, '')).toBe(false)
  expect(isExternal({ bundleId: SCALE, syncId: null }, undefined)).toBe(false)
})

test('the start of the local day, including a day whose midnight does not exist', () => {
  expect(startOfLocalDay(hour(12), 'UTC')).toBe(MIDNIGHT)
  expect(startOfLocalDay(MIDNIGHT, 'UTC')).toBe(MIDNIGHT)
  expect(startOfLocalDay(MIDNIGHT - 1, 'UTC')).toBe(MIDNIGHT - 24 * 3600000)
  expect(startOfLocalDay(hour(3), 'America/New_York')).toBe(hour(5, '2026-11-08')) // 2026-11-08 00:00 EST
  // New York springs forward at 02:00 on 2026-03-08: the day still starts at 00:00 EST.
  expect(startOfLocalDay(hour(20, '2026-03-08'), 'America/New_York')).toBe(hour(5, '2026-03-08'))
  // Sao Paulo went from 00:00 to 01:00 on 2018-11-04: that day began at 01:00 -02:00.
  expect(startOfLocalDay(hour(15, '2018-11-04'), 'America/Sao_Paulo')).toBe(hour(3, '2018-11-04'))
})

const r = (uuid, lb, at) => ({ uuid, d: DAY, lb, at })
const plan = over => dayOpsFromReadings({ days: [DAY], readingsByDay: {}, entryByDay: {}, localOpByDay: {}, deleted: {}, now: NOW, ...over })

test('plan: a manual entry wins its day, whatever the readings', () => {
  const readingsByDay = { [DAY]: [r('a', 180, hour(7))] }
  expect(plan({ readingsByDay, entryByDay: { [DAY]: { d: DAY, w: 182, t: 5 } } })).toEqual([])
  // Anything but src 'health' is typed, as the push guards treat it.
  expect(plan({ readingsByDay, entryByDay: { [DAY]: { d: DAY, w: 182, t: 5, src: 'Health' } } })).toEqual([])
})

test('plan: the latest reading by sample time wins, rounded to 0.1 lb; equal times go to the larger uuid', () => {
  const readingsByDay = { [DAY]: [r('late', 180.26, hour(9)), r('early', 181, hour(7))] }
  expect(plan({ readingsByDay })).toEqual([{ d: DAY, op: 'set', w: 180.3, t: NOW, src: 'health', hk: 'late' }])
  const tie = { [DAY]: [r('b', 180, hour(9)), r('c', 181, hour(9)), r('a', 182, hour(9))] }
  expect(plan({ readingsByDay: tie })[0].hk).toBe('c')
})

test('plan: nothing when the entry already holds that reading; a changed weight is set again', () => {
  const readingsByDay = { [DAY]: [r('a', 180.04, hour(7))] }
  expect(plan({ readingsByDay, entryByDay: { [DAY]: { d: DAY, w: 180, t: 1, src: 'health', hk: 'a' } } })).toEqual([])
  expect(plan({ readingsByDay, entryByDay: { [DAY]: { d: DAY, w: 179, t: 1, src: 'health', hk: 'a' } } }))
    .toEqual([{ d: DAY, op: 'set', w: 180, t: NOW, src: 'health', hk: 'a' }])
})

test('plan: no reading left removes a Health entry, and nothing else', () => {
  expect(plan({ entryByDay: { [DAY]: { d: DAY, w: 180, t: 1, src: 'health', hk: 'a' } } }))
    .toEqual([{ d: DAY, op: 'remove', t: NOW, src: 'health' }])
  expect(plan({})).toEqual([])
  expect(plan({ readingsByDay: { [DAY]: [] } })).toEqual([])
})

test('plan: a reading that rounds to no weight is passed over', () => {
  expect(plan({ readingsByDay: { [DAY]: [r('zero', 0.04, hour(9)), r('ok', 180, hour(7))] } })[0].hk).toBe('ok')
  expect(plan({ readingsByDay: { [DAY]: [r('zero', 0.04, hour(9))] } })).toEqual([])
})

test('plan: a reading deleted elsewhere is refused while the day stays absent; another comes in', () => {
  const localOpByDay = { [DAY]: { d: DAY, op: 'set', w: 180, t: 1, src: 'health', hk: 'x', acked: true } }
  expect(plan({ readingsByDay: { [DAY]: [r('x', 180, hour(7))] }, localOpByDay })).toEqual([])
  expect(plan({ readingsByDay: { [DAY]: [r('x', 180, hour(9)), r('y', 181, hour(7))] }, localOpByDay })[0].hk).toBe('y')
  // Not yet acked, or the day holds an entry: the reading is not refused.
  expect(plan({ readingsByDay: { [DAY]: [r('x', 180, hour(7))] }, localOpByDay: { [DAY]: { ...localOpByDay[DAY], acked: false } } })).toHaveLength(1)
  // After this phone's own typed removal the readings come back.
  const typedRemove = { [DAY]: { d: DAY, op: 'remove', t: 5, baseT: 4, acked: true } }
  expect(plan({ readingsByDay: { [DAY]: [r('x', 180, hour(7))] }, localOpByDay: typedRemove })[0].hk).toBe('x')
})

test('plan: a pending Health set the removal on record already beats is refused too', () => {
  const row = { d: DAY, op: 'set', w: 180, t: NOW - 100, src: 'health', hk: 'x', acked: false }
  const readingsByDay = { [DAY]: [r('x', 180, hour(9)), r('y', 181, hour(7))] }
  expect(plan({ readingsByDay, localOpByDay: { [DAY]: row }, deleted: { [DAY]: NOW - 100 } }))
    .toEqual([{ d: DAY, op: 'set', w: 181, t: NOW, src: 'health', hk: 'y' }])
  // A removal stamped before the row's t does not refuse it.
  expect(plan({ readingsByDay, localOpByDay: { [DAY]: row }, deleted: { [DAY]: NOW - 101 } })[0].hk).toBe('x')
})

test('plan: a set on a day with a removal on record takes a t past it', () => {
  const readingsByDay = { [DAY]: [r('a', 180, hour(7))] }
  expect(plan({ readingsByDay, deleted: { [DAY]: NOW + 5000 } })[0].t).toBe(NOW + 5001)
  expect(plan({ readingsByDay, deleted: { [DAY]: NOW - 5000 } })[0].t).toBe(NOW)
  expect(plan({ readingsByDay, deleted: { [DAY]: 0 } })[0].t).toBe(NOW)
})

// ---- the import pass ----

const scale = (uuid, lb, at, over = {}) => ({ uuid, lb, at, bundleId: SCALE, syncId: null, ...over })
const changes = (samples = [], deleted = []) => ({ samples, deleted })

function fakeAdapter() {
  const adapter = {
    reads: [], // what the next reads return: a changes object, an Error to throw, or a function of the args
    calls: [],
    async requestHealthAccess() {},
    workoutWriteAccess: () => 'on',
    async saveStrengthWorkout() { return { uuid: 'w' } },
    async deleteWorkoutsBySyncId() { return 1 },
    async deleteAllOwnWorkouts() { return 0 },
    async readBodyMassChanges(args) {
      adapter.calls.push(args)
      const next = adapter.reads.length ? adapter.reads.shift() : changes()
      if (typeof next === 'function') return next(args)
      if (next instanceof Error) throw next
      return { anchor: 'anchor-' + adapter.calls.length, ...next }
    },
  }
  return adapter
}

async function setup({ on = true, now = NOW } = {}) {
  const adapter = fakeAdapter()
  const store = createMemoryHealthStore()
  if (on) await store.state.set('on', '1')
  const weighIns = createMemoryWeighIns()
  const world = { copy: null, clock: now, pokes: 0, zone: 'UTC' }
  const health = createHealthSync({
    adapter,
    store,
    workouts: createMemoryFinishedWorkouts(),
    now: () => world.clock,
    weighIns,
    readCopy: async () => world.copy,
    ownBundleId: async () => OWN,
    timeZone: () => world.zone,
    onWeighIns: () => { world.pokes++ },
  })
  return { adapter, store, weighIns, health, world }
}

// The server's copy after a push of this phone's pending ops, and those ops acked.
async function pushed(weighIns, world, deleted = {}) {
  const pending = await weighIns.listPending()
  const before = world.copy?.state ?? {}
  const { next } = applyDayOps(before.bodyweight, pending, deleted)
  world.copy = { state: { ...before, bodyweight: next, deleted: { bodyweight: deleted } }, rev: 1, wid: 'w' }
  await weighIns.markAcked(pending.map(o => ({ d: o.d, t: o.t })), 'acked')
}

test('Health off: no import, nothing read, no bwSince', async () => {
  const { adapter, store, weighIns, health, world } = await setup({ on: false })
  adapter.reads.push(changes([scale('a', 180, hour(7))]))
  await health.run()
  expect(adapter.calls).toEqual([])
  expect(await weighIns.list()).toEqual([])
  expect(await store.state.get('bwSince')).toBeNull()
  expect(world.pokes).toBe(0)
})

test('own samples are ignored: own bundle id or an opengym-bw- sync id', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  adapter.reads.push(changes([
    scale('own', 180, hour(7), { bundleId: OWN }),
    scale('echo', 181, hour(8), { bundleId: 'com.apple.Health', syncId: 'opengym-bw-2026-11-09' }),
  ]))
  await health.run()
  expect(await weighIns.list()).toEqual([])
  expect(await store.readings.listDay(DAY)).toEqual([])
  expect(world.pokes).toBe(0)
  expect((await health.status()).error).toBeNull()
})

test('the latest reading of a day wins, and an earlier one arriving later changes nothing', async () => {
  const { adapter, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('early', 181, hour(7)), scale('late', 180.26, hour(9))]))
  await health.run()
  expect(await weighIns.list()).toEqual([{ d: DAY, op: 'set', w: 180.3, t: NOW, src: 'health', hk: 'late' }])
  adapter.reads.push(changes([scale('earlier', 182, hour(6))]))
  world.clock += 1000
  await health.run()
  expect(await weighIns.list()).toEqual([{ d: DAY, op: 'set', w: 180.3, t: NOW, src: 'health', hk: 'late' }])
  expect(world.pokes).toBe(1)
})

test('readings land on their local day', async () => {
  const { adapter, weighIns, health } = await setup()
  adapter.reads.push(changes([scale('a', 180, hour(23, '2026-11-08')), scale('b', 181, hour(1))]))
  await health.run()
  expect((await weighIns.list()).map(o => [o.d, o.hk])).toEqual([['2026-11-08', 'a'], [DAY, 'b']])
})

test('a typed entry is never replaced: not one from the server, not this phone\'s own', async () => {
  const { adapter, weighIns, health, world } = await setup()
  world.copy = { state: { bodyweight: [{ d: DAY, w: 182, t: 5 }] }, rev: 1, wid: 'w' }
  await weighIns.put({ d: '2026-11-08', op: 'set', w: 183, t: 6 })
  adapter.reads.push(changes([scale('a', 180, hour(7)), scale('b', 181, hour(7, '2026-11-08'))]))
  await health.run()
  expect(await weighIns.list()).toEqual([{ d: '2026-11-08', op: 'set', w: 183, t: 6 }])
  expect(world.pokes).toBe(0)
})

test('a deleted reading falls back to the day\'s next', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('a', 180, hour(9)), scale('b', 181, hour(7))]))
  await health.run()
  await pushed(weighIns, world)
  world.clock += 1000
  adapter.reads.push(changes([], ['a']))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 181, t: NOW + 1000, src: 'health', hk: 'b' })
  expect((await store.readings.listDay(DAY)).map(x => x.uuid)).toEqual(['b'])
})

test('the last reading deleted removes an imported day', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  await pushed(weighIns, world)
  world.clock += 1000
  adapter.reads.push(changes([], ['a', 'unknown']))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'remove', t: NOW + 1000, src: 'health' })
  expect(await store.readings.listDay(DAY)).toEqual([])
  expect(world.pokes).toBe(2)
})

test('a sample added and deleted in one read leaves no trace', async () => {
  const { adapter, store, weighIns, health } = await setup()
  adapter.reads.push(changes([scale('a', 180, hour(9))], ['a']))
  await health.run()
  expect(await weighIns.list()).toEqual([])
  expect(await store.readings.get('a')).toBeNull()
})

test('a Health set after a pending typed removal carries its baseT (via putFromHealth)', async () => {
  const { adapter, weighIns, health, world } = await setup()
  world.copy = { state: { bodyweight: [{ d: DAY, w: 182, t: 500 }] }, rev: 1, wid: 'w' }
  await weighIns.put({ d: DAY, op: 'remove', t: 600, baseT: 500 })
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  const op = await weighIns.get(DAY)
  expect(op).toEqual({ d: DAY, op: 'set', w: 180, t: NOW, src: 'health', hk: 'a', baseT: 500 })
  // At push time the import replaces the typed entry the owner removed.
  expect(applyDayOps(world.copy.state.bodyweight, [op], {}).next).toEqual([{ d: DAY, w: 180, t: NOW, src: 'health', hk: 'a' }])
})

test('after this phone\'s typed removal the day\'s reading comes back, with no new Health change', async () => {
  const { adapter, weighIns, health, world } = await setup()
  await weighIns.put({ d: DAY, op: 'set', w: 182, t: 500 })
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 182, t: 500 }) // typed wins
  await weighIns.put({ d: DAY, op: 'remove', t: 600, baseT: 500 })
  await health.run() // the read returns nothing new
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 180, t: NOW, src: 'health', hk: 'a', baseT: 500 })
  expect(world.pokes).toBe(1)
})

test('after an acked typed removal the reading comes back with a t past the removal on record (clock skew)', async () => {
  const { adapter, weighIns, health, world } = await setup()
  await weighIns.put({ d: DAY, op: 'set', w: 182, t: 500 })
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  await pushed(weighIns, world)
  await weighIns.put({ d: DAY, op: 'remove', t: 600, baseT: 500 })
  const stamp = NOW + 60000 // the server's clock runs ahead of the phone's
  await pushed(weighIns, world, { [DAY]: stamp })
  expect(world.copy.state.bodyweight).toEqual([])
  await health.run()
  const op = await weighIns.get(DAY)
  expect(op).toEqual({ d: DAY, op: 'set', w: 180, t: stamp + 1, src: 'health', hk: 'a' })
  expect(applyDayOps([], [op], { [DAY]: stamp }).applied).toEqual([{ d: DAY, t: stamp + 1 }])
})

test('a reading deleted elsewhere is not re-imported, but a newer reading is', async () => {
  const { adapter, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('x', 180, hour(7))]))
  await health.run()
  await pushed(weighIns, world)
  // The owner deletes the day on the web; the phone pulls the copy.
  world.copy = { state: { bodyweight: [], deleted: { bodyweight: { [DAY]: NOW + 10 } } }, rev: 2, wid: 'w' }
  world.clock += 1000
  adapter.reads.push(changes([scale('x', 180, hour(7))])) // the same reading read again
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 180, t: NOW, src: 'health', hk: 'x' })
  expect(await weighIns.listPending()).toEqual([])
  adapter.reads.push(changes([scale('y', 179, hour(10))]))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 179, t: NOW + 1000, src: 'health', hk: 'y' })
  expect(world.pokes).toBe(2)
})

test('readings before bwSince are never read: the adapter gets since, set once and never moved', async () => {
  const { adapter, store, health, world } = await setup()
  await health.run()
  expect(adapter.calls).toEqual([{ anchor: null, since: new Date(MIDNIGHT) }])
  expect(await store.state.get('bwSince')).toBe(String(MIDNIGHT))
  world.clock += 3 * 24 * 3600000
  await health.run()
  expect(adapter.calls[1]).toEqual({ anchor: 'anchor-1', since: new Date(MIDNIGHT) })
  expect(await store.state.get('bwSince')).toBe(String(MIDNIGHT))
})

test('a phone that had Health on before weigh-ins gets bwSince on its first pass', async () => {
  const { adapter, store, health } = await setup()
  await store.links.put({ kind: 'w', key: 'old', syncId: 'opengym-w-old', version: 1, hash: 'h', state: 'exported', error: null, updatedAt: 1 })
  expect(await store.state.get('bwSince')).toBeNull()
  await health.run()
  expect(await store.state.get('bwSince')).toBe(String(MIDNIGHT))
  expect(adapter.calls[0].since).toEqual(new Date(MIDNIGHT))
})

test('a malformed anchor is read past once without it, and replaced only after the ops are written', async () => {
  const { adapter, store, weighIns, health } = await setup()
  await store.state.set('bwSince', String(MIDNIGHT - 86400000))
  await store.state.set('bwAnchor', 'garbage')
  const put = weighIns.putFromHealth
  const seen = []
  weighIns.putFromHealth = async op => {
    seen.push(await store.state.get('bwAnchor'))
    return put(op)
  }
  adapter.reads.push(new Error('malformed anchor'), changes([scale('a', 180, hour(9))]))
  await health.run()
  expect(seen).toEqual(['garbage'])
  expect(adapter.calls).toEqual([
    { anchor: 'garbage', since: new Date(MIDNIGHT - 86400000) },
    { anchor: null, since: new Date(MIDNIGHT - 86400000) },
  ])
  expect(await store.state.get('bwAnchor')).toBe('anchor-2')
  expect((await weighIns.get(DAY)).hk).toBe('a')
  expect((await health.status()).error).toBeNull()
})

test('a failing read without a stored anchor is not retried; the error shows and the next pass tries again', async () => {
  const { adapter, store, weighIns, health } = await setup()
  adapter.reads.push(new Error('protected data unavailable'))
  await health.run()
  expect(adapter.calls).toHaveLength(1)
  expect(await store.state.get('bwAnchor')).toBeNull()
  expect((await health.status()).error).toBe('protected data unavailable')
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  expect((await weighIns.get(DAY)).hk).toBe('a')
  expect((await health.status()).error).toBeNull()
})

test('two failures in one pass read no more and keep the stored anchor for the next pass', async () => {
  const { adapter, store, health } = await setup()
  await store.state.set('bwAnchor', 'good')
  adapter.reads.push(new Error('database inaccessible'), new Error('still failing'))
  await health.run()
  expect(adapter.calls.map(c => c.anchor)).toEqual(['good', null])
  expect(await store.state.get('bwAnchor')).toBe('good')
  expect((await health.status()).error).toBe('still failing')
  await health.run()
  expect(adapter.calls[2].anchor).toBe('good')
  expect(await store.state.get('bwAnchor')).toBe('anchor-3')
})

test('a reading deleted while the anchored read failed: the full re-read falls back, then removes the day', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('P', 181, hour(7)), scale('Q', 180, hour(9))]))
  await health.run()
  await pushed(weighIns, world)
  expect((await weighIns.get(DAY)).hk).toBe('Q')
  // Q is deleted in Health; the anchored read fails and the read without an anchor sees only P.
  world.clock += 1000
  adapter.reads.push(new Error('transient'), changes([scale('P', 181, hour(7))]))
  await health.run()
  expect(adapter.calls.slice(1).map(c => c.anchor)).toEqual(['anchor-1', null])
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 181, t: NOW + 1000, src: 'health', hk: 'P' })
  expect((await store.readings.listDay(DAY)).map(x => x.uuid)).toEqual(['P'])
  await pushed(weighIns, world)
  // P goes the same way: the day is removed, not fallen back to the stale Q.
  world.clock += 1000
  adapter.reads.push(new Error('transient'), changes([]))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'remove', t: NOW + 2000, src: 'health' })
  expect(await store.readings.listDay(DAY)).toEqual([])
})

test('every read without an anchor is a full snapshot: a cached reading it does not return is gone', async () => {
  const { adapter, store, weighIns, health } = await setup()
  adapter.reads.push({ ...changes([scale('P', 181, hour(7)), scale('Q', 180, hour(9))]), anchor: null })
  await health.run()
  expect(await store.state.get('bwAnchor')).toBeNull()
  adapter.reads.push(changes([scale('P', 181, hour(7)), scale('own', 179, hour(10), { bundleId: OWN })]))
  await health.run()
  expect(adapter.calls[1].anchor).toBeNull()
  expect((await weighIns.get(DAY)).hk).toBe('P')
  expect((await store.readings.listDay(DAY)).map(x => x.uuid)).toEqual(['P'])
})

test('the time zone is resolved each pass, and a cached reading keeps its day', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  const r1 = Date.parse('2026-11-09T03:00:00Z') // 11-09 in UTC, 11-08 in Los Angeles
  adapter.reads.push(changes([scale('r', 180, r1)]))
  await health.run()
  world.zone = 'America/Los_Angeles'
  const s1 = Date.parse('2026-11-11T05:00:00Z') // 11-11 in UTC, 11-10 in Los Angeles
  adapter.reads.push(changes([scale('r', 180, r1), scale('s', 182, s1)]))
  await health.run()
  expect((await store.readings.get('r')).d).toBe(DAY)
  expect((await weighIns.list()).map(o => [o.d, o.hk])).toEqual([[DAY, 'r'], ['2026-11-10', 's']])
})

test('a pending import the removal on record already beats is not imported again (resent before the ack)', async () => {
  const { adapter, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('X', 180, hour(9))]))
  await health.run()
  await pushed(weighIns, world)
  const stamp = NOW + 5000
  world.copy = { state: { bodyweight: [], deleted: { bodyweight: { [DAY]: stamp } } }, rev: 2, wid: 'w' }
  await weighIns.resetAcked() // a resend before the next reconcile
  world.clock += 1000
  adapter.reads.push(changes([scale('Y', 181, hour(7))]))
  await health.run()
  expect(await weighIns.get(DAY)).toEqual({ d: DAY, op: 'set', w: 181, t: stamp + 1, src: 'health', hk: 'Y' })
})

test('typed removals before bwSince are not re-checked', async () => {
  const { store, weighIns, health } = await setup()
  await weighIns.put({ d: '2026-11-01', op: 'remove', t: 600, baseT: 500 })
  await weighIns.put({ d: DAY, op: 'remove', t: 700, baseT: 650 })
  const days = []
  const listDay = store.readings.listDay
  store.readings.listDay = async d => { days.push(d); return listDay(d) }
  await health.run()
  expect(days).toEqual([DAY])
})

test('the anchor is stored only after the ops are written: a failed write leaves the old anchor', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  await store.state.set('bwAnchor', 'old')
  const put = weighIns.putFromHealth
  const seen = []
  weighIns.putFromHealth = async op => {
    seen.push(await store.state.get('bwAnchor'))
    throw new Error('disk full')
  }
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  expect(seen).toEqual(['old'])
  expect(await store.state.get('bwAnchor')).toBe('old')
  expect(await weighIns.list()).toEqual([])
  expect(world.pokes).toBe(0)
  weighIns.putFromHealth = put
  adapter.reads.push(changes([scale('a', 180, hour(9))])) // the same changes, read again from 'old'
  await health.run()
  expect(adapter.calls[1].anchor).toBe('old')
  expect((await weighIns.get(DAY)).hk).toBe('a')
  expect(await store.state.get('bwAnchor')).toBe('anchor-2')
})

test('a deletion whose fallback failed to write is read again and still falls back', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  adapter.reads.push(changes([scale('a', 180, hour(9)), scale('b', 181, hour(7))]))
  await health.run()
  await pushed(weighIns, world)
  const put = weighIns.putFromHealth
  weighIns.putFromHealth = async () => { throw new Error('disk full') }
  adapter.reads.push(changes([], ['a']))
  await health.run()
  expect(await store.state.get('bwAnchor')).toBe('anchor-1')
  expect((await store.readings.listDay(DAY)).map(x => x.uuid)).toEqual(['b', 'a']) // the cache keeps 'a' until the op is written
  weighIns.putFromHealth = put
  adapter.reads.push(changes([], ['a']))
  await health.run()
  expect((await weighIns.get(DAY)).hk).toBe('b')
  expect((await store.readings.listDay(DAY)).map(x => x.uuid)).toEqual(['b'])
})

test('onWeighIns fires only when an op was written, and its failure never reaches the pass', async () => {
  const { adapter, weighIns, health, world } = await setup()
  await health.run()
  expect(world.pokes).toBe(0) // nothing to import
  adapter.reads.push(changes([scale('a', 180, hour(9))]))
  await health.run()
  expect(world.pokes).toBe(1)
  await health.run()
  expect(world.pokes).toBe(1) // no change
  weighIns.putFromHealth = async () => ({ written: false })
  adapter.reads.push(changes([scale('b', 179, hour(10))]))
  await health.run()
  expect(world.pokes).toBe(1) // planned, but not written
  const failing = await setup()
  failing.adapter.reads.push(changes([scale('a', 180, hour(9))]))
  const health2 = createHealthSync({
    adapter: failing.adapter,
    store: failing.store,
    workouts: createMemoryFinishedWorkouts(),
    now: () => NOW,
    weighIns: failing.weighIns,
    readCopy: async () => null,
    ownBundleId: async () => OWN,
    timeZone: () => 'UTC',
    onWeighIns: () => Promise.reject(new Error('offline')),
  })
  await health2.run()
  expect((await failing.weighIns.get(DAY)).hk).toBe('a')
  expect((await health2.status()).error).toBeNull()
})

test('turning Health off mid-import stops further adapter calls', async () => {
  const { adapter, store, weighIns, health } = await setup()
  await store.state.set('bwAnchor', 'garbage')
  let fail
  adapter.reads.push(() => new Promise((resolve, reject) => { fail = reject }))
  const running = health.run()
  await new Promise(r => setTimeout(r, 0))
  expect(adapter.calls).toHaveLength(1)
  const off = health.disable({ remove: false })
  fail(new Error('malformed anchor'))
  await Promise.all([running, off])
  expect(adapter.calls).toHaveLength(1) // no read without the anchor
  expect(await store.state.get('bwAnchor')).toBe('garbage')
  expect(await weighIns.list()).toEqual([])
})

test('a read that lands after Health was turned off writes nothing and keeps the anchor', async () => {
  const { adapter, store, weighIns, health, world } = await setup()
  let land
  adapter.reads.push(() => new Promise(resolve => { land = resolve }))
  const running = health.run()
  await new Promise(r => setTimeout(r, 0))
  const off = health.disable({ remove: false })
  land({ samples: [scale('a', 180, hour(9))], deleted: [], anchor: 'new' })
  await Promise.all([running, off])
  expect(await weighIns.list()).toEqual([])
  expect(await store.readings.get('a')).toBeNull()
  expect(await store.state.get('bwAnchor')).toBeNull()
  expect(world.pokes).toBe(0)
})

test('Health off while the own bundle id is looked up: no read', async () => {
  const { adapter, store, weighIns } = await setup()
  let give
  const health = createHealthSync({
    adapter,
    store,
    workouts: createMemoryFinishedWorkouts(),
    now: () => NOW,
    weighIns,
    readCopy: async () => null,
    ownBundleId: () => new Promise(resolve => { give = resolve }),
    timeZone: () => 'UTC',
    onWeighIns: () => {},
  })
  const running = health.run()
  await new Promise(r => setTimeout(r, 0))
  const off = health.disable({ remove: false })
  give(OWN)
  await Promise.all([running, off])
  expect(adapter.calls).toEqual([])
})

test('the own bundle id is looked up once per engine; a missing one stops the import with an error', async () => {
  const { adapter, store, weighIns } = await setup()
  let lookups = 0
  let answer = ''
  const health = createHealthSync({
    adapter,
    store,
    workouts: createMemoryFinishedWorkouts(),
    now: () => NOW,
    weighIns,
    readCopy: async () => null,
    ownBundleId: async () => { lookups++; return answer },
    timeZone: () => 'UTC',
    onWeighIns: () => {},
  })
  await health.run()
  expect(adapter.calls).toEqual([])
  expect((await health.status()).error).toMatch(/bundle/)
  answer = OWN
  await health.run()
  await health.run()
  expect(lookups).toBe(2)
  expect(adapter.calls).toHaveLength(2)
})
