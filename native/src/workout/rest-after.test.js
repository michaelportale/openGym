import { expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'
import { openSession } from '../session/session.js'
import { plannedSetId } from '../session/ids.js'
import { completeFields, pendingRest, restEventId, restMsFor } from './rest-after.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const base = () => ({
  id: 's1', d: '2026-11-07', start: T0, name: 'Push', routineIds: ['r1'],
  entries: [
    { id: 'bench', target: { sets: 2, reps: 5 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] },
    {
      id: 'fly', target: { sets: 1, reps: 20 },
      sets: [{ w: 7.5, r: 20, done: false, sides: { L: { w: 7.5, r: 20, done: false }, R: { w: 7.5, r: 20, done: false } } }],
    },
  ],
})
const open = (db, nowMs) => openSession({ base: base(), storage: createSqliteSessionStorage(db), now: () => nowMs, timeZone: 'UTC' })
const benchSet = view => view.entries[0].sets[0]

async function commitBench(session) {
  return session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: plannedSetId('bench', 0), fields: { w: 60, r: 5 } })
}

test.each(SQLITE_DRIVERS)('%s: a kill between complete and rest restores the rest', async (_n, createDb) => {
  let db = createDb()
  const t = T0 + 1000
  const first = await open(db, t)
  await commitBench(first)
  db = db.reopen()
  const second = await open(db, t + 10_000)
  const pending = pendingRest(second.view(), t + 10_000, () => 90_000)
  expect(pending).toEqual({ eventId: restEventId(plannedSetId('bench', 0), t), deadline: t + 90_000 })
  await second.startRest(pending)
  expect(second.view().rest).toMatchObject({ status: 'running', remainingMs: 80_000 })
})

test.each(SQLITE_DRIVERS)('%s: a skipped rest stays skipped after a kill', async (_n, createDb) => {
  let db = createDb()
  const t = T0 + 1000
  const first = await open(db, t)
  await commitBench(first)
  const pending = pendingRest(first.view(), t, () => 90_000)
  await first.startRest(pending)
  await first.cancelRest({ eventId: 'cancel-1' })
  db = db.reopen()
  const second = await open(db, t + 5000)
  const again = pendingRest(second.view(), t + 5000, () => 90_000)
  expect(again).toEqual(pending)
  const result = await second.startRest(again)
  expect(result.duplicate).toBe(true)
  expect(second.view().rest).toBeNull()
})

test.each(SQLITE_DRIVERS)('%s: rest that already ran out is not restarted', async (_n, createDb) => {
  const t = T0 + 1000
  const session = await open(createDb(), t)
  await commitBench(session)
  expect(pendingRest(session.view(), t + 100_000, () => 90_000)).toBeNull()
})

test.each(SQLITE_DRIVERS)('%s: the left side survives a kill before the right', async (_n, createDb) => {
  let db = createDb()
  const t = T0 + 1000
  const setId = plannedSetId('fly', 0)
  const first = await open(db, t)
  let row = first.view().entries[1].sets[0].row
  await first.commitSet({ eventId: 'l', exerciseId: 'fly', setId, fields: completeFields(row, 'L', { r: 20 }) })
  db = db.reopen()
  const second = await open(db, t + 1000)
  const mid = second.view().entries[1].sets[0]
  expect(mid.row.sides.L.done).toBe(true)
  expect(mid.row.sides.R.done).toBe(false)
  // The engine counts a finished limb toward totals, so the view says completed. Rest waits for both.
  expect(mid.completed).toBe(true)
  expect(pendingRest(second.view(), t + 1000, () => 90_000)).toBeNull()
  row = mid.row
  await second.commitSet({ eventId: 'r', exerciseId: 'fly', setId, fields: completeFields(row, 'R', { r: 18 }) })
  const end = second.view().entries[1].sets[0]
  expect(end.completed).toBe(true)
  expect(end.row.sides.R).toEqual({ w: 7.5, r: 18, done: true })
  expect(benchSet(second.view()).completed).toBe(false)
  expect(pendingRest(second.view(), t + 1000, () => 90_000).deadline).toBe(t + 1000 + 90_000)
})

test('pendingRest takes the latest completed row across exercises', () => {
  const row = at => ({ done: true, at })
  const view = { entries: [
    { id: 'x', sets: [{ setId: 's1', completed: true, row: row(100) }] },
    { id: 'y', sets: [{ setId: 's2', completed: true, row: row(300) }, { completed: false, row: { at: 900 } }] },
  ] }
  expect(pendingRest(view, 0, id => (id === 'y' ? 50 : 10))).toEqual({ eventId: restEventId('s2', 300), deadline: 350 })
})

// A warm-up starts no rest, so a reopen must not start one for it either.
test('pendingRest ignores a completed warm-up', () => {
  const warm = at => ({ w: 45, r: 10, done: true, at, phase: 'warmup', warmup: true })
  const view = { entries: [{ id: 'x', sets: [
    { setId: 's1', completed: true, row: { done: true, at: 100 } },
    { setId: 'w1', completed: true, warmup: true, row: warm(300) },
  ] }] }
  expect(pendingRest(view, 0, () => 90)).toEqual({ eventId: restEventId('s1', 100), deadline: 190 })
  const only = { entries: [{ id: 'x', sets: [{ setId: 'w1', completed: true, warmup: true, row: warm(300) }] }] }
  expect(pendingRest(only, 0, () => 90)).toBeNull()
})

test('completeFields without a side gives weight and reps, omitting undefined', () => {
  expect(completeFields({ w: 60, r: 5 }, null, { w: 62.5, r: 4 })).toEqual({ w: 62.5, r: 4 })
  expect(completeFields({ w: 60, r: 5 }, null, { r: 4 })).toEqual({ r: 4 })
})

test('completeFields completes one side and leaves the other, without mutating', () => {
  const row = { w: 7.5, r: 20, done: false, sides: { L: { w: 7.5, r: 20, done: false }, R: { w: 7.5, r: 20, done: false } } }
  const before = JSON.stringify(row)
  const fields = completeFields(row, 'L', { r: 20 })
  expect(fields).toEqual({
    w: 7.5,
    sides: { L: { w: 7.5, r: 20, done: true }, R: { w: 7.5, r: 20, done: false } },
  })
  expect(JSON.stringify(row)).toBe(before)
})

test('completeFields shares a new weight across both sides', () => {
  const row = { w: 7.5, sides: { L: { w: 7.5, r: 20, done: false }, R: { w: 7.5, r: 18, done: true } } }
  expect(completeFields(row, 'L', { w: 10, r: 15 })).toEqual({
    w: 10,
    sides: { L: { w: 10, r: 15, done: true }, R: { w: 10, r: 18, done: true } },
  })
})

test('restMsFor prefers the exercise and falls back to the profile', () => {
  expect(restMsFor({ target: { restSec: 120 } }, 90)).toBe(120_000)
  expect(restMsFor({ target: {} }, 90)).toBe(90_000)
  expect(restMsFor({}, 90)).toBe(90_000)
})

test('restMsFor reads an exercise rest of 0 as the default, as the web does', () => {
  // The web's exercise settings write restSec: 0 for "Default" (routines.js setupOf).
  expect(restMsFor({ target: { restSec: 0 } }, 90)).toBe(90_000)
})
