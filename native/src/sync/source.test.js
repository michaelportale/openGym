import { expect, test } from 'vitest'
import { readCopy, readScreenSource, screenSource } from './source.js'
import { sessionState } from '../workout/history-state.js'
import { nextRoutineId } from '../workout/next-up.js'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { createSqliteServerCopy } from './server-copy.js'
import { exercises } from '../shared/training.js'

const builtIn = exercises.EXDB[0]
const cap = s => s[0].toUpperCase() + s.slice(1)
const w = (id, d, extra = {}) => ({ id, d, start: 1, entries: [], ...extra })

const bundled = {
  version: 1,
  example: false,
  state: { unit: 'lb', routines: [{ id: 'r', name: 'R', ex: [] }], workouts: [w('b1', '2026-10-01')] },
  names: { snap: { name: 'Snap', category: 'X' } },
}

test('unpaired: the bundled snapshot with pending workouts, exactly as sessionState gives it', () => {
  const pending = [w('p1', '2026-11-01')]
  const out = screenSource({ copy: null, bundled, pending })
  expect(out.state).toEqual(sessionState(bundled, pending))
  expect(out.names).toBe(bundled.names)
})

test('paired: the copy wins, pending are appended, a shared id keeps the copy', () => {
  const copy = {
    state: {
      unit: 'kg',
      futureFeature: 1,
      routines: [{ id: 'r', name: 'R', ex: [{ id: builtIn.id }, { id: 'cust' }] }],
      customEx: [{ id: 'cust', n: 'my curl', tg: 'biceps', eq: 'cable' }],
      workouts: [w('c1', '2026-10-05', { vol: 1 }), w('c0', '2026-09-01')],
    },
    rev: 3, wid: 'x', pulledAt: 't',
  }
  const pending = [w('c1', '2026-10-05', { vol: 999 }), w('p1', '2026-11-01')]
  const out = screenSource({ copy, bundled, pending })
  expect(out.state.unit).toBe('kg')
  expect(out.state.futureFeature).toBe(1)
  expect(out.state.workouts.map(x => x.id)).toEqual(['c0', 'c1', 'p1'])
  expect(out.state.workouts.find(x => x.id === 'c1').vol).toBe(1)
  expect(out.names[builtIn.id]).toEqual({ name: cap(builtIn.n), category: [builtIn.bp, builtIn.eq].filter(Boolean).map(cap).join(' · ') })
  expect(out.names.cust).toEqual({ name: 'My curl', category: 'Biceps · Cable' })
  expect(out.names.snap).toBeUndefined()
})

test('paired: history ids get a name where one is known, unknown ids none', () => {
  const copy = {
    state: { routines: [], workouts: [w('c1', '2026-10-05', { entries: [{ id: builtIn.id }, { id: 'ghost' }] })] },
    rev: 0, wid: 'x', pulledAt: 't',
  }
  const out = screenSource({ copy, bundled, pending: [] })
  expect(out.names[builtIn.id].name).toBe(cap(builtIn.n))
  expect(out.names.ghost).toBeUndefined()
})

test('readCopy gives the copy, and null when the read throws or the body is corrupt', async () => {
  const good = { state: {}, rev: 1 }
  expect(await readCopy({ get: async () => good })).toBe(good)
  expect(await readCopy({ get: async () => { throw new SyntaxError('bad json') } })).toBeNull()
  const db = createNodeSqliteDb()
  const store = createSqliteServerCopy(db)
  await store.put({ state: {}, rev: 1, wid: 'w', pulledAt: 't' })
  await db.run('UPDATE server_copy SET body = ?', ['{not json'])
  expect(await readCopy(store)).toBeNull()
})

// Server documents with a malformed entry (GET /api/data passes the file through as it is).
const okRoutine = { id: 'r1', name: 'Push', ex: [{ id: builtIn.id, sets: 3, reps: 5 }] }
const okWorkout = { id: 'w1', d: '2026-11-01', entries: [{ id: builtIn.id, sets: [{ w: 60, r: 5, done: true }] }] }
const probes = [
  ['a null routine', { routines: [null, okRoutine], workouts: [okWorkout] }],
  ['a null workout', { routines: [okRoutine], workouts: [null, okWorkout] }],
  ['a null element in a routine\'s ex', { routines: [{ ...okRoutine, ex: [null, ...okRoutine.ex] }], workouts: [okWorkout] }],
  ['a null element in a workout\'s entries', { routines: [okRoutine], workouts: [{ ...okWorkout, entries: [null, ...okWorkout.entries] }] }],
  ['a null element in customEx', { routines: [okRoutine], workouts: [okWorkout], customEx: [null] }],
  ['workouts that is not a list', { routines: [okRoutine], workouts: {} }],
  ['a null set and lists inside entries that are not lists', { routines: [{ ...okRoutine, ex: 'x' }], workouts: [{ ...okWorkout, entries: [{ id: builtIn.id, sets: [null, 7, { w: 60, r: 5, done: true }] }] }, { id: 'w2', d: '2026-11-02', entries: {} }] }],
  ['routines and customEx that are not lists', { routines: 'x', workouts: [okWorkout], customEx: 5 }],
]
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const allObjects = list => Array.isArray(list) && list.every(isObj)

test.each(probes)('paired, %s: the screen is built from the objects only, and the copy stays as stored', (_n, doc) => {
  const copy = { state: doc, rev: 1, wid: 'x', pulledAt: 't' }
  const stored = JSON.parse(JSON.stringify(copy))
  const pending = [w('p1', '2026-11-08')]
  const out = screenSource({ copy, bundled, pending })
  const s = out.state
  expect(allObjects(s.routines ?? [])).toBe(true)
  for (const r of s.routines ?? []) expect(allObjects(r.ex ?? [])).toBe(true)
  expect(allObjects(s.workouts)).toBe(true)
  for (const x of s.workouts) {
    expect(allObjects(x.entries ?? [])).toBe(true)
    for (const e of x.entries ?? []) expect(allObjects(e.sets ?? [])).toBe(true)
  }
  expect(allObjects(s.customEx ?? [])).toBe(true)
  // what was well formed is all still there, and the pending workout is added
  expect(s.workouts.map(x => x.id)).toContain('p1')
  if (Array.isArray(doc.workouts) && doc.workouts.includes(okWorkout)) expect(s.workouts.find(x => x.id === 'w1')).toEqual(okWorkout)
  if (Array.isArray(doc.routines) && doc.routines.includes(okRoutine)) expect(s.routines.find(r => r.id === 'r1')).toEqual(okRoutine)
  expect(() => nextRoutineId(s, Date.parse('2026-11-09T10:00:00Z'))).not.toThrow()
  expect(copy).toEqual(stored)
})

// The two stores the Workout tab reads, with every read logged in order.
function stores({ copy, all, pending }) {
  const log = []
  return {
    log,
    finished: {
      list: async () => { log.push('list'); return all },
      listPending: async () => { log.push('pending'); return pending },
    },
    serverCopy: { get: async () => { log.push('copy'); return copy } },
  }
}

test('readScreenSource: not paired, the bundled snapshot with every workout on the phone', async () => {
  const all = [w('a1', '2026-10-20'), w('p1', '2026-11-01')]
  const out = await readScreenSource({ ...stores({ copy: null, all, pending: all }), bundled })
  expect(out.state).toEqual(sessionState(bundled, all))
  expect(out.names).toBe(bundled.names)
  expect(out.workouts).toBe(all)
})

test('readScreenSource: paired, the copy with the workouts it has not acked', async () => {
  const copy = { state: { routines: [], workouts: [w('c1', '2026-10-05')] }, rev: 2, wid: 'x', pulledAt: 't' }
  const all = [w('a1', '2026-10-20'), w('p1', '2026-11-01')]
  const out = await readScreenSource({ ...stores({ copy, all, pending: [all[1]] }), bundled })
  expect(out.state.workouts.map(x => x.id)).toEqual(['c1', 'p1'])
  expect(out.workouts).toBe(all)
})

test('readScreenSource: a copy the screen still cannot read reads as no copy, as a corrupt one does', async () => {
  // a custom exercise whose name is not text: well-formed lists, but naming it throws
  const copy = { state: { routines: [{ id: 'rc', name: 'C', ex: [{ id: 'cust' }] }], customEx: [{ id: 'cust', n: 5 }], workouts: [] }, rev: 1, wid: 'x', pulledAt: 't' }
  expect(() => screenSource({ copy, bundled, pending: [] })).toThrow()
  const all = [w('a1', '2026-10-20'), w('p1', '2026-11-01')]
  const out = await readScreenSource({ ...stores({ copy, all, pending: [all[1]] }), bundled })
  expect(out.state).toEqual(sessionState(bundled, all))
  expect(out.names).toBe(bundled.names)
  expect(out.workouts).toBe(all)
})

test('the example banner is the bundle\'s own: shown over example data, never over the server copy', async () => {
  const example = { ...bundled, example: true }
  const copy = { state: { routines: [{ id: 'rs', name: 'Server', ex: [] }], workouts: [] }, rev: 1, wid: 'x', pulledAt: 't' }
  expect(screenSource({ copy: null, bundled: example, pending: [] }).example).toBe(true)
  expect(screenSource({ copy, bundled: example, pending: [] }).example).toBe(false)
  expect(screenSource({ copy: null, bundled, pending: [] }).example).toBe(false)
  expect((await readScreenSource({ ...stores({ copy, all: [], pending: [] }), bundled: example })).example).toBe(false)
  expect((await readScreenSource({ ...stores({ copy: null, all: [], pending: [] }), bundled: example })).example).toBe(true)
})
