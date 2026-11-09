import { expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { createMemoryHealthStore, createSqliteHealthStore } from './health-store.js'

const link = (key, over = {}) => ({ kind: 'w', key, syncId: 'opengym-w-' + key, version: 5, hash: 'h', state: 'pending', error: null, updatedAt: 9, ...over })

async function roundTrip(store) {
  expect(await store.links.list('w')).toEqual([])
  expect(await store.state.get('on')).toBeNull()
  await store.links.put(link('a'))
  await store.links.put(link('b', { state: 'exported' }))
  await store.links.put(link('c', { kind: 'other' }))
  await store.links.put(link('a', { state: 'exported', version: 6, error: 'boom' }))
  const rows = await store.links.list('w')
  expect(rows.map(r => r.key).sort()).toEqual(['a', 'b'])
  expect(rows.find(r => r.key === 'a')).toEqual(link('a', { state: 'exported', version: 6, error: 'boom' }))
  await store.links.remove('w', 'a')
  expect((await store.links.list('w')).map(r => r.key)).toEqual(['b'])
  await store.links.clear('w')
  expect(await store.links.list('w')).toEqual([])
  expect((await store.links.list('other')).map(r => r.key)).toEqual(['c'])
  await store.state.set('on', '1')
  await store.state.set('on', '0')
  expect(await store.state.get('on')).toBe('0')
}

test('memory store: put, list, remove, clear and state round trip', async () => {
  await roundTrip(createMemoryHealthStore())
})

test('memory store hands out copies', async () => {
  const store = createMemoryHealthStore()
  await store.links.put(link('a'))
  ;(await store.links.list('w'))[0].state = 'changed'
  expect((await store.links.list('w'))[0].state).toBe('pending')
})

test('real sqlite: the store round trips and a link survives a kill', async () => {
  let db = createNodeSqliteFileDb()
  await roundTrip(createSqliteHealthStore(db))
  await createSqliteHealthStore(db).links.put(link('k'))
  await createSqliteHealthStore(db).state.set('on', '1')
  db = db.reopen()
  const again = createSqliteHealthStore(db)
  expect(await again.links.list('w')).toEqual([link('k')])
  expect(await again.state.get('on')).toBe('1')
})

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteHealthStore(db), createSqliteHealthStore(db)]
  await Promise.all(stores.map(s => s.links.list('w')))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS health_links/.test(sql))).toHaveLength(1)
  await stores[1].links.put(link('x'))
  expect((await stores[0].links.list('w')).map(r => r.key)).toEqual(['x'])
})

const reading = (uuid, over = {}) => ({ uuid, d: '2026-11-09', lb: 181.2, at: 1000, ...over })

async function readingsRoundTrip(store) {
  const { readings } = store
  expect(await readings.listDay('2026-11-09')).toEqual([])
  expect(await readings.get('a')).toBeNull()
  await readings.put(reading('b', { at: 2000 }))
  await readings.put(reading('a'))
  await readings.put(reading('c', { d: '2026-11-10' }))
  await readings.put(reading('a', { lb: 180.4 })) // the same uuid again replaces it
  expect(await readings.listDay('2026-11-09')).toEqual([reading('a', { lb: 180.4 }), reading('b', { at: 2000 })])
  expect(await readings.get('c')).toEqual(reading('c', { d: '2026-11-10' }))
  expect(await readings.remove('a')).toEqual(reading('a', { lb: 180.4 }))
  expect(await readings.remove('a')).toBeNull()
  expect(await readings.remove('never')).toBeNull()
  expect(await readings.listDay('2026-11-09')).toEqual([reading('b', { at: 2000 })])
}

test('memory store: readings put, get, list by day and remove', async () => {
  await readingsRoundTrip(createMemoryHealthStore())
})

test('memory store hands out reading copies', async () => {
  const store = createMemoryHealthStore()
  await store.readings.put(reading('a'))
  ;(await store.readings.listDay('2026-11-09'))[0].lb = 1
  ;(await store.readings.get('a')).lb = 1
  expect((await store.readings.get('a')).lb).toBe(181.2)
})

test('real sqlite: readings round trip and survive a reopen', async () => {
  let db = createNodeSqliteFileDb()
  await readingsRoundTrip(createSqliteHealthStore(db))
  await createSqliteHealthStore(db).readings.put(reading('k', { at: 1730000000123 }))
  db = db.reopen()
  const again = createSqliteHealthStore(db)
  expect(await again.readings.get('k')).toEqual(reading('k', { at: 1730000000123 }))
  expect((await again.readings.listDay('2026-11-09')).map(r => r.uuid)).toEqual(['b', 'k'])
})

test('readings share the one migration with links and state', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteHealthStore(db), createSqliteHealthStore(db)]
  await Promise.all([stores[0].readings.listDay('2026-11-09'), stores[1].links.list('w'), stores[1].readings.get('x')])
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS health_readings/.test(sql))).toHaveLength(1)
  expect(db.executed.filter(sql => /CREATE TABLE/.test(sql))).toHaveLength(1)
})
