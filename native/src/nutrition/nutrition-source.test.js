import { expect, test } from 'vitest'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { createMemoryPendingEdits } from '../sync/pending-edits.js'
import { nutritionLoader } from './nutrition-source.js'

const TODAY = '2026-11-09'
const full = { kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training' }
const bundled = { state: { workouts: [], bodyweight: [] }, names: {} }
const copyDoc = { state: { routines: [], workouts: [], nutritionDays: { [TODAY]: { ...full, _ts: 10 } }, edited: {} }, rev: 5, wid: 'w5' }
const serverCopy = doc => ({ get: async () => doc, key: async () => (doc ? { rev: doc.rev, wid: doc.wid } : null) })
const stores = (over = {}) => ({
  finished: createMemoryFinishedWorkouts(), serverCopy: serverCopy(copyDoc), weighIns: createMemoryWeighIns(),
  edits: createMemoryPendingEdits(), bundled, now: Date.UTC(2026, 10, 9, 12), ...over,
})

test('a load is the source the screens show: state with pending edits laid over, the copy as read, weigh-ins, notices', async () => {
  const s = stores()
  await s.edits.put({ kind: 'nutritionDay', key: TODAY, baseTs: 10, value: { ...full, kcal: 2400 }, t: 1 })
  const r = await nutritionLoader()(s)
  expect(r.ok).toBe(true)
  expect(r.source).toMatchObject({ status: 'ready', copy: copyDoc, bodyweight: [], notices: [], error: null })
  expect(r.source.state.nutritionDays[TODAY]).toEqual({ ...full, kcal: 2400, _ts: 10 })
})

test('the notices are the nutrition-day and setting ones, never a routine\'s', async () => {
  const s = stores()
  const notices = [{ kind: 'nutritionDay', key: TODAY }, { kind: 'setting', key: 'supplements' }]
  const edits = { ...s.edits, listNotices: async ({ kind } = {}) => [...notices, { kind: 'routine', key: 'r1' }].filter(n => n.kind === kind) }
  expect((await nutritionLoader()({ ...s, edits })).source.notices).toEqual(notices)
})

test('each call reads the stores as they are then: an edit put since the last load is in the next', async () => {
  const s = stores()
  const load = nutritionLoader()
  const first = await load(s)
  await s.edits.put({ kind: 'nutritionDay', key: TODAY, baseTs: 10, value: { ...full, supps: ['a'] }, t: 1 })
  const second = await load(s)
  expect(first.source.state.nutritionDays[TODAY].supps).toBeUndefined()
  expect(second.source.state.nutritionDays[TODAY].supps).toEqual(['a'])
})

test('a failed read resolves { ok: false } with its message, and never throws', async () => {
  const broken = { ...stores().edits, listNotices: async () => { throw new Error('disk I/O error') } }
  expect(await nutritionLoader()(stores({ edits: broken }))).toEqual({ ok: false, error: { message: 'disk I/O error' } })
  const noCopyKey = { get: async () => copyDoc, key: async () => { throw new Error('locked') } }
  expect(await nutritionLoader()(stores({ serverCopy: noCopyKey }))).toEqual({ ok: false, error: { message: 'locked' } })
})
