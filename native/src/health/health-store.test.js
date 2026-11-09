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
