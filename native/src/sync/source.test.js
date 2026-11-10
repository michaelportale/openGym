import { expect, test } from 'vitest'
import { readCopy } from './server-copy.js'
import { readScreenSource, screenSource } from './source.js'
import { sessionState } from '../workout/history-state.js'
import { nextRoutineId } from '../workout/next-up.js'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { createSqliteServerCopy } from './server-copy.js'
import { exercises } from '../shared/training.js'
import { createMemoryPendingEdits } from './pending-edits.js'
import { createMemoryMeasurements } from '../body/measurement-store.js'

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
  expect(out.names).toEqual(bundled.names)
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
    rev: 3, wid: 'x',
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
    rev: 0, wid: 'x',
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
  await store.put({ state: {}, rev: 1, wid: 'w' })
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
  const copy = { state: doc, rev: 1, wid: 'x' }
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
  expect(out.names).toEqual(bundled.names)
  expect(out.workouts).toBe(all)
})

test('readScreenSource: paired, the copy with the workouts it has not acked', async () => {
  const copy = { state: { routines: [], workouts: [w('c1', '2026-10-05')] }, rev: 2, wid: 'x' }
  const all = [w('a1', '2026-10-20'), w('p1', '2026-11-01')]
  const out = await readScreenSource({ ...stores({ copy, all, pending: [all[1]] }), bundled })
  expect(out.state.workouts.map(x => x.id)).toEqual(['c1', 'p1'])
  expect(out.workouts).toBe(all)
})

test('readScreenSource hands back the copy it read, so a caller need not read it again', async () => {
  const copy = { state: { routines: [], workouts: [] }, rev: 2, wid: 'x' }
  const s = stores({ copy, all: [], pending: [] })
  expect((await readScreenSource({ ...s, bundled })).copy).toBe(copy)
  expect((await readScreenSource({ ...stores({ copy: null, all: [], pending: [] }), bundled })).copy).toBeNull()
})

test('readScreenSource: a copy the screen still cannot read reads as no copy, as a corrupt one does', async () => {
  // a custom exercise whose name is not text: well-formed lists, but naming it throws
  const copy = { state: { routines: [{ id: 'rc', name: 'C', ex: [{ id: 'cust' }] }], customEx: [{ id: 'cust', n: 5 }], workouts: [] }, rev: 1, wid: 'x' }
  expect(() => screenSource({ copy, bundled, pending: [] })).toThrow()
  const all = [w('a1', '2026-10-20'), w('p1', '2026-11-01')]
  const out = await readScreenSource({ ...stores({ copy, all, pending: [all[1]] }), bundled })
  expect(out.state).toEqual(sessionState(bundled, all))
  expect(out.names).toEqual(bundled.names)
  expect(out.workouts).toBe(all)
  // The screens then show the snapshot, so an edit made there is on the snapshot's routine, and
  // its base must be the snapshot's too, never the copy's (that would put the snapshot over the
  // server's routine on the next push).
  expect(out.copy).toBeNull()
})

test('the example banner is the bundle\'s own: shown over example data, never over the server copy', async () => {
  const example = { ...bundled, example: true }
  const copy = { state: { routines: [{ id: 'rs', name: 'Server', ex: [] }], workouts: [] }, rev: 1, wid: 'x' }
  expect(screenSource({ copy: null, bundled: example, pending: [] }).example).toBe(true)
  expect(screenSource({ copy, bundled: example, pending: [] }).example).toBe(false)
  expect(screenSource({ copy: null, bundled, pending: [] }).example).toBe(false)
  expect((await readScreenSource({ ...stores({ copy, all: [], pending: [] }), bundled: example })).example).toBe(false)
  expect((await readScreenSource({ ...stores({ copy: null, all: [], pending: [] }), bundled: example })).example).toBe(true)
})

test('readScreenSource reads the unsent workouts before the copy: a sync landing between the two reads never hides one', async () => {
  const p1 = w('p1', '2026-11-08')
  const before = { state: { routines: [], workouts: [w('c1', '2026-10-05')] }, rev: 1, wid: 'a' }
  const after = { state: { routines: [], workouts: [w('c1', '2026-10-05'), { ...p1, _ts: 9 }] }, rev: 2, wid: 'b' }
  // The engine stores the copy that holds p1, then acks p1. Here that lands right after whichever
  // of the two reads comes first.
  let copy = before
  let pending = [p1]
  let landed = false
  const land = () => {
    if (landed) return
    landed = true
    copy = after
    pending = []
  }
  const finished = { list: async () => [p1], listPending: async () => { const r = pending; land(); return r } }
  const serverCopy = { get: async () => { const r = copy; land(); return r } }
  const out = await readScreenSource({ finished, serverCopy, bundled })
  expect(out.state.workouts.map(x => x.id)).toEqual(['c1', 'p1'])
})

// Routine edits waiting to sync show over the routines the screen would otherwise have.
const edit = (rid, routine, extra = {}) => ({ kind: 'routine', key: rid, baseTs: null, value: routine, sent: null, t: 5, ...extra })

test('routine edits: unpaired, a pending edit to a snapshot routine shows, and the bundle is untouched', () => {
  const before = JSON.stringify(bundled)
  const out = screenSource({ copy: null, bundled, pending: [], edits: [edit('r', { id: 'r', name: 'Mine', ex: [] })] })
  expect(out.state.routines).toEqual([{ id: 'r', name: 'Mine', ex: [] }])
  expect(out.state.workouts.map(x => x.id)).toEqual(['b1'])
  expect(JSON.stringify(bundled)).toBe(before)
})

test('routine edits: paired, the edit shows over the copy on the copy\'s stamps, and the copy stays as stored', () => {
  const copy = { state: { routines: [{ id: 'r', name: 'R', _ts: 4, ex: [] }, { id: 's', name: 'S', ex: [] }], workouts: [] }, rev: 2, wid: 'x' }
  const before = JSON.stringify(copy)
  const out = screenSource({ copy, bundled, pending: [], edits: [edit('r', { id: 'r', name: 'Mine', ex: [] }, { baseTs: 4 })] })
  expect(out.state.routines).toEqual([{ id: 'r', name: 'Mine', ex: [], _ts: 4 }, { id: 's', name: 'S', ex: [] }])
  expect(JSON.stringify(copy)).toBe(before)
})

test('routine edits: a superseded edit does not show', () => {
  const copy = { state: { routines: [{ id: 'r', name: 'Web', _ts: 9, ex: [] }], workouts: [] }, rev: 2, wid: 'x' }
  const out = screenSource({ copy, bundled, pending: [], edits: [edit('r', { id: 'r', name: 'Mine', ex: [] }, { baseTs: 4 })] })
  expect(out.state.routines[0].name).toBe('Web')
})

test('routine edits: none leaves the routines and the state as they were', () => {
  const out = screenSource({ copy: null, bundled, pending: [], edits: [] })
  expect(out.state).toEqual(sessionState(bundled, []))
  expect(out.state.routines).toBe(bundled.state.routines)
})

test('routine edits: the next routine still follows the loop', () => {
  const rs = [{ id: 'a', name: 'A', ex: [] }, { id: 'b', name: 'B', ex: [] }]
  const base = { version: 1, example: false, state: { unit: 'lb', routines: rs, workouts: [] }, names: {} }
  const plain = screenSource({ copy: null, bundled: base, pending: [] })
  const edited = screenSource({ copy: null, bundled: base, pending: [], edits: [edit('b', { id: 'b', name: 'B2', ex: [] })] })
  expect(edited.state.routines.map(r => r.id)).toEqual(['a', 'b'])
  expect(nextRoutineId(edited.state, 1e12)).toBe(nextRoutineId(plain.state, 1e12))
})

test('readScreenSource reads the routine edits before the copy and applies them, paired or not', async () => {
  const s = stores({ copy: { state: { routines: [{ id: 'r', name: 'R', ex: [] }], workouts: [] }, rev: 1, wid: 'x' }, all: [], pending: [] })
  const log = s.log
  const edits = { listPending: async () => { log.push('edits'); return [edit('r', { id: 'r', name: 'Mine', ex: [] })] } }
  const paired = await readScreenSource({ ...s, edits, bundled })
  expect(paired.state.routines[0].name).toBe('Mine')
  expect(log.indexOf('edits')).toBeLessThan(log.indexOf('copy'))
  const unpaired = await readScreenSource({ ...stores({ copy: null, all: [], pending: [] }), edits, bundled })
  expect(unpaired.state.routines[0].name).toBe('Mine')
  expect((await readScreenSource({ ...s, bundled })).state.routines[0].name).toBe('R')
})

test('readScreenSource over the real store: an edit shows, and goes once acked', async () => {
  const edits = createMemoryPendingEdits()
  await edits.put(edit('r', { id: 'r', name: 'Mine', ex: [] }))
  const s = stores({ copy: null, all: [], pending: [] })
  expect((await readScreenSource({ ...s, edits, bundled })).state.routines[0].name).toBe('Mine')
  await edits.markAcked([{ kind: 'routine', key: 'r', t: 5 }], 'now')
  expect((await readScreenSource({ ...s, edits, bundled })).state.routines[0].name).toBe('R')
})

test('routine edits: unpaired, a swapped-in built-in exercise gets its catalogue name and the snapshot names stay', () => {
  const before = JSON.stringify(bundled.names)
  const out = screenSource({ copy: null, bundled, pending: [], edits: [edit('r', { id: 'r', name: 'R', ex: [{ id: builtIn.id }] })] })
  expect(out.names[builtIn.id].name).toBe(cap(builtIn.n))
  expect(out.names.snap).toEqual(bundled.names.snap)
  expect(JSON.stringify(bundled.names)).toBe(before)
})

// Nutrition days and settings waiting to sync show the same way, through the same guard.
const DAY = { kcal: 2100, protein: 160, carbs: 220, fat: 70, fiber: 30, dayType: 'training' }
const dayEdit = (d, value, extra = {}) => ({ kind: 'nutritionDay', key: d, baseTs: null, value, sent: null, t: 6, ...extra })
const settingEdit = (key, value, extra = {}) => ({ kind: 'setting', key, baseTs: null, value, sent: null, t: 7, ...extra })

test('nutrition: unpaired, a pending day shows on the snapshot state, which has no nutritionDays, and the bundle is untouched', () => {
  expect(bundled.state).not.toHaveProperty('nutritionDays')
  const before = JSON.stringify(bundled)
  const out = screenSource({ copy: null, bundled, pending: [], edits: [dayEdit('2026-11-09', DAY), settingEdit('supplements', [{ id: 's1', name: 'Creatine' }])] })
  expect(out.state.nutritionDays).toEqual({ '2026-11-09': DAY })
  expect(out.state.supplements).toEqual([{ id: 's1', name: 'Creatine' }])
  expect(out.state.routines).toBe(bundled.state.routines)
  expect(out.state.workouts.map(x => x.id)).toEqual(['b1'])
  expect(JSON.stringify(bundled)).toBe(before)
})

test('nutrition: paired, a pending day and targets show over the copy on its stamps; other days stay; the copy stays as stored', () => {
  const other = { kcal: 1900, protein: 140, carbs: 180, fat: 60, fiber: 20, dayType: 'rest', _ts: 3 }
  const copy = {
    state: {
      routines: [], workouts: [],
      nutritionDays: { '2026-11-08': { ...DAY, _ts: 4 }, '2026-11-07': other },
      nutritionTargets: { training: { kcal: 2400 } },
      edited: { nutritionTargets: 8 },
    },
    rev: 2, wid: 'x',
  }
  const before = JSON.stringify(copy)
  const targets = { training: { kcal: 2600 } }
  const out = screenSource({ copy, bundled, pending: [], edits: [dayEdit('2026-11-08', { ...DAY, kcal: 2500 }, { baseTs: 4 }), settingEdit('nutritionTargets', targets, { baseTs: 8 })] })
  expect(out.state.nutritionDays).toEqual({ '2026-11-08': { ...DAY, kcal: 2500, _ts: 4 }, '2026-11-07': other })
  expect(out.state.nutritionDays['2026-11-07']).toBe(copy.state.nutritionDays['2026-11-07'])
  expect(out.state.nutritionTargets).toEqual(targets)
  expect(out.state.edited).toEqual({ nutritionTargets: 8 })
  expect(JSON.stringify(copy)).toBe(before)
})

test('nutrition: a day or setting the web changed first does not show; the web\'s does', () => {
  const copy = { state: { routines: [], workouts: [], nutritionDays: { '2026-11-08': { ...DAY, kcal: 1800, _ts: 9 } }, supplements: [], edited: { supplements: 9 } }, rev: 2, wid: 'x' }
  const out = screenSource({ copy, bundled, pending: [], edits: [dayEdit('2026-11-08', DAY, { baseTs: 4 }), settingEdit('supplements', [{ id: 's1', name: 'Creatine' }], { baseTs: 4 })] })
  expect(out.state.nutritionDays['2026-11-08'].kcal).toBe(1800)
  expect(out.state.supplements).toEqual([])
})

test('readScreenSource over the real store shows every kind, paired or not, and each goes once acked', async () => {
  const edits = createMemoryPendingEdits()
  await edits.put(dayEdit('2026-11-09', DAY))
  await edits.put(settingEdit('nutritionTargets', { training: { kcal: 2600 } }))
  const unpaired = await readScreenSource({ ...stores({ copy: null, all: [], pending: [] }), edits, bundled })
  expect(unpaired.state.nutritionDays).toEqual({ '2026-11-09': DAY })
  expect(unpaired.state.nutritionTargets).toEqual({ training: { kcal: 2600 } })
  const s = stores({ copy: { state: { routines: [], workouts: [] }, rev: 1, wid: 'x' }, all: [], pending: [] })
  const paired = await readScreenSource({ ...s, edits, bundled })
  expect(paired.state.nutritionDays).toEqual({ '2026-11-09': DAY })
  expect(paired.state.nutritionTargets).toEqual({ training: { kcal: 2600 } })
  await edits.markAcked([{ kind: 'nutritionDay', key: '2026-11-09', t: 6 }, { kind: 'setting', key: 'nutritionTargets', t: 7 }], 'now')
  const after = await readScreenSource({ ...s, edits, bundled })
  expect(after.state).not.toHaveProperty('nutritionDays')
  expect(after.state).not.toHaveProperty('nutritionTargets')
})

// Body measurements waiting to sync show the same way, by day, through the push's own guard
// (measurement-ops.js).
const mEntry = (d, t, fields = {}) => ({ d, t, waist: 81.28, neck: null, other: [], ...fields })
const mSet = e => ({ d: e.d, op: 'set', entry: e, t: e.t })

test('measurements: unpaired, a pending day starts the list on the snapshot, which has none; the bundle is untouched', () => {
  expect(bundled.state).not.toHaveProperty('measurements')
  const before = JSON.stringify(bundled)
  const mine = mEntry('2026-11-09', 6)
  const out = screenSource({ copy: null, bundled, pending: [], measurements: [mSet(mine), { d: '2026-11-08', op: 'remove', t: 7, baseT: 1 }] })
  expect(out.state.measurements).toEqual([mine])
  expect(out.state.routines).toBe(bundled.state.routines)
  expect(out.state.workouts.map(x => x.id)).toEqual(['b1'])
  expect(JSON.stringify(bundled)).toBe(before)
})

test('measurements: paired, pending days show over the copy; a removed day goes; other days keep their identity; the copy stays as stored', () => {
  const other = mEntry('2026-11-01', 3, { mystery: { x: 1 } })
  const copy = { state: { routines: [], workouts: [], measurements: [other, mEntry('2026-11-05', 4), mEntry('2026-11-07', 5)] }, rev: 2, wid: 'x' }
  const before = JSON.stringify(copy)
  const mine = mEntry('2026-11-05', 9, { waist: 80 })
  const out = screenSource({ copy, bundled, pending: [], measurements: [mSet(mine), { d: '2026-11-07', op: 'remove', t: 9, baseT: 5 }] })
  expect(out.state.measurements).toEqual([other, mine])
  expect(out.state.measurements[0]).toBe(other)
  expect(JSON.stringify(copy)).toBe(before)
})

test('measurements: a set the web beat, or that a removal on record beats, does not show; with none pending the list is the copy\'s own', () => {
  const webs = mEntry('2026-11-05', 20)
  const copy = { state: { routines: [], workouts: [], measurements: [webs], deleted: { measurements: { '2026-11-06': 30 } } }, rev: 2, wid: 'x' }
  const out = screenSource({ copy, bundled, pending: [], measurements: [mSet(mEntry('2026-11-05', 9)), mSet(mEntry('2026-11-06', 25))] })
  expect(out.state.measurements).toEqual([webs])
  expect(screenSource({ copy, bundled, pending: [] }).state.measurements).toBe(copy.state.measurements)
  expect(screenSource({ copy, bundled, pending: [], measurements: [] }).state.measurements).toBe(copy.state.measurements)
  expect(screenSource({ copy: null, bundled, pending: [], measurements: [] }).state).not.toHaveProperty('measurements')
})

test('readScreenSource reads the pending measurements before the copy and lays them over it, paired or not', async () => {
  const mine = mEntry('2026-11-09', 6)
  const s = stores({ copy: { state: { routines: [], workouts: [] }, rev: 1, wid: 'x' }, all: [], pending: [] })
  const measurements = { listPending: async () => { s.log.push('measurements'); return [mSet(mine)] } }
  expect((await readScreenSource({ ...s, measurements, bundled })).state.measurements).toEqual([mine])
  expect(s.log.indexOf('measurements')).toBeGreaterThanOrEqual(0)
  expect(s.log.indexOf('measurements')).toBeLessThan(s.log.indexOf('copy'))
  const u = stores({ copy: null, all: [], pending: [] })
  expect((await readScreenSource({ ...u, measurements, bundled })).state.measurements).toEqual([mine])
})

test('readScreenSource over the real store: a pending measurement shows, and goes once acked', async () => {
  const measurements = createMemoryMeasurements()
  const mine = mEntry('2026-11-09', 6)
  await measurements.put(mSet(mine))
  const s = stores({ copy: { state: { routines: [], workouts: [] }, rev: 1, wid: 'x' }, all: [], pending: [] })
  expect((await readScreenSource({ ...s, measurements, bundled })).state.measurements).toEqual([mine])
  expect((await readScreenSource({ ...s, bundled })).state).not.toHaveProperty('measurements') // a screen that reads none
  await measurements.markAcked([{ d: mine.d, t: 6 }], 'now')
  expect((await readScreenSource({ ...s, measurements, bundled })).state).not.toHaveProperty('measurements')
})
