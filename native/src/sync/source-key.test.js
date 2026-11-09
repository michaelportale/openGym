import { expect, test, vi } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { createSqliteWeighIns } from '../body/weigh-ins.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createSqlitePendingEdits } from './pending-edits.js'
import { createSqliteServerCopy } from './server-copy.js'
import { keyed, readSourceKey, sourceKey } from './source-key.js'

const NOW = new Date(2026, 10, 9, 9).getTime()
const base = () => ({
  copyKey: { rev: 7, wid: 'w7' },
  workouts: [{ id: 'p1', d: '2026-11-08', entries: [] }],
  weighIns: [{ d: '2026-11-09', op: 'set', w: 180.2, t: 100 }],
  now: NOW,
})

test('the same inputs give the same key', () => {
  expect(sourceKey(base())).toBe(sourceKey(base()))
  expect(sourceKey({ ...base(), now: NOW + 8 * 3600000 })).toBe(sourceKey(base()))
})

test('a pending weigh-in change gives a new key', () => {
  const key = sourceKey(base())
  const w = base().weighIns[0]
  expect(sourceKey({ ...base(), weighIns: [{ ...w, t: 101 }] })).not.toBe(key)
  expect(sourceKey({ ...base(), weighIns: [{ d: w.d, op: 'remove', t: 100 }] })).not.toBe(key)
  expect(sourceKey({ ...base(), weighIns: [] })).not.toBe(key)
  expect(sourceKey({ ...base(), weighIns: [w, { d: '2026-11-08', op: 'set', w: 181, t: 90 }] })).not.toBe(key)
})

test('the copy, the unsent workouts and the day each move the key', () => {
  const key = sourceKey(base())
  expect(sourceKey({ ...base(), copyKey: { rev: 8, wid: 'w7' } })).not.toBe(key)
  expect(sourceKey({ ...base(), copyKey: { rev: 7, wid: 'w8' } })).not.toBe(key)
  expect(sourceKey({ ...base(), copyKey: null })).not.toBe(key)
  expect(sourceKey({ ...base(), workouts: [] })).not.toBe(key)
  expect(sourceKey({ ...base(), workouts: [...base().workouts, { id: 'p2' }] })).not.toBe(key)
  expect(sourceKey({ ...base(), now: new Date(2026, 10, 10, 0, 5).getTime() })).not.toBe(key)
})

test('readSourceKey reads the copy without its body', async () => {
  const get = vi.fn(async () => { throw new Error('the body was parsed') })
  const stores = {
    finished: { listPending: async () => base().workouts },
    serverCopy: { get, key: async () => ({ rev: 7, wid: 'w7' }) },
    weighIns: { listPending: async () => base().weighIns },
  }
  expect(await readSourceKey({ ...stores, now: NOW })).toBe(sourceKey(base()))
  expect(get).not.toHaveBeenCalled()
  // Without a weigh-in store (a screen that shows none), the weigh-ins are left out.
  expect(await readSourceKey({ ...stores, weighIns: null, now: NOW })).toBe(sourceKey({ ...base(), weighIns: [] }))
})

test('readSourceKey follows the stores: a stored copy, a weigh-in, a finished and an acked workout', async () => {
  const db = createNodeSqliteDb()
  const stores = { finished: createSqliteFinishedWorkouts(db), serverCopy: createSqliteServerCopy(db), weighIns: createSqliteWeighIns(db) }
  const read = () => readSourceKey({ ...stores, now: NOW })
  const keys = [await read()]
  expect(await read()).toBe(keys[0])
  await stores.serverCopy.put({ state: { workouts: [] }, rev: 1, wid: 'a' })
  keys.push(await read())
  await stores.weighIns.put({ d: '2026-11-09', op: 'set', w: 180, t: 5 })
  keys.push(await read())
  await stores.finished.put({ id: 'p1', d: '2026-11-09', entries: [] })
  keys.push(await read())
  // As the engine does: the copy that holds the workout is stored, then the workout is acked.
  await stores.serverCopy.put({ state: { workouts: [{ id: 'p1', d: '2026-11-09', entries: [] }] }, rev: 2, wid: 'b' })
  await stores.finished.markAcked(['p1'], 'now')
  keys.push(await read())
  expect(new Set(keys).size).toBe(5)
  expect(await read()).toBe(keys.at(-1))
})

test('keyed builds once per key and hands back the same object while the key holds', async () => {
  let key = 'a'
  const build = vi.fn(async n => ({ n }))
  const load = keyed(async () => key, build)
  const first = await load(1)
  expect(await load(2)).toBe(first)
  expect(build).toHaveBeenCalledTimes(1)
  key = 'b'
  const second = await load(3)
  expect(second).toEqual({ n: 3 })
  expect(second).not.toBe(first)
  expect(build).toHaveBeenCalledTimes(2)
})

test('keyed retries a failed build on the next call', async () => {
  let fail = true
  const load = keyed(async () => 'k', async () => {
    if (fail) throw new Error('db')
    return { ok: true }
  })
  await expect(load()).rejects.toThrow('db')
  fail = false
  expect(await load()).toEqual({ ok: true })
})

test('a pending routine edit moves the key, by its key and time', () => {
  const key = sourceKey(base())
  expect(sourceKey({ ...base(), routineEdits: [] })).toBe(key)
  const one = sourceKey({ ...base(), routineEdits: [{ kind: 'routine', key: 'a', t: 1 }] })
  expect(one).not.toBe(key)
  expect(sourceKey({ ...base(), routineEdits: [{ kind: 'routine', key: 'a', t: 2 }] })).not.toBe(one)
  expect(sourceKey({ ...base(), routineEdits: [{ kind: 'routine', key: 'b', t: 1 }] })).not.toBe(one)
})

test('readSourceKey follows routine edits: put, and acked', async () => {
  const db = createNodeSqliteDb()
  const stores = { finished: createSqliteFinishedWorkouts(db), serverCopy: createSqliteServerCopy(db), routineEdits: createSqlitePendingEdits(db) }
  const read = () => readSourceKey({ ...stores, now: NOW })
  const none = await read()
  await stores.routineEdits.put({ kind: 'routine', key: 'a', baseTs: null, value: { id: 'a', name: 'A' }, t: 3 })
  const put = await read()
  expect(put).not.toBe(none)
  await stores.routineEdits.markAcked([{ kind: 'routine', key: 'a', t: 3 }], 'now')
  expect(await read()).toBe(none)
  // Without a store the edits read as none.
  expect(await readSourceKey({ finished: stores.finished, serverCopy: stores.serverCopy, now: NOW })).toBe(none)
})

test('pending edits are keyed by kind, key and time: the same key and time under two kinds are two keys', () => {
  const at = (kind, key, t) => sourceKey({ ...base(), routineEdits: [{ kind, key, t }] })
  const day = at('nutritionDay', '2026-11-09', 1)
  expect(day).not.toBe(sourceKey(base()))
  expect(at('setting', '2026-11-09', 1)).not.toBe(day)
  expect(at('routine', '2026-11-09', 1)).not.toBe(day)
  expect(at('nutritionDay', '2026-11-08', 1)).not.toBe(day)
  expect(at('nutritionDay', '2026-11-09', 2)).not.toBe(day)
  expect(at('nutritionDay', '2026-11-09', 1)).toBe(day)
})

test('readSourceKey follows nutrition days and settings too: put, and acked', async () => {
  const db = createNodeSqliteDb()
  const stores = { finished: createSqliteFinishedWorkouts(db), serverCopy: createSqliteServerCopy(db), routineEdits: createSqlitePendingEdits(db) }
  const read = () => readSourceKey({ ...stores, now: NOW })
  const none = await read()
  await stores.routineEdits.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: { kcal: 2000 }, t: 3 })
  const day = await read()
  expect(day).not.toBe(none)
  await stores.routineEdits.put({ kind: 'setting', key: 'supplements', baseTs: null, value: [], t: 4 })
  const both = await read()
  expect(both).not.toBe(day)
  await stores.routineEdits.markAcked([{ kind: 'nutritionDay', key: '2026-11-09', t: 3 }, { kind: 'setting', key: 'supplements', t: 4 }], 'now')
  expect(await read()).toBe(none)
})
