import { expect, test } from 'vitest'
import { workoutSyncId, exportable, exportHash, planWorkoutExport } from './workout-export.js'

const doc = (over = {}) => ({ id: 'a1', d: '2026-11-09', start: 1000, end: 5000, vol: 1200, entries: [], ...over })
const link = (d, over = {}) => ({ kind: 'w', key: d.id, syncId: workoutSyncId(d.id), version: 900, hash: exportHash(d), state: 'exported', ...over })

test('the sync id is the workout id with the app prefix', () => {
  expect(workoutSyncId('a1')).toBe('opengym-w-a1')
})

test('only a finite, forward start and end are exportable', () => {
  expect(exportable(doc())).toBe(true)
  expect(exportable(doc({ end: 1000 }))).toBe(false)
  expect(exportable(doc({ end: 10 }))).toBe(false)
  expect(exportable(doc({ start: undefined }))).toBe(false)
  expect(exportable(doc({ end: NaN }))).toBe(false)
  expect(exportable(doc({ start: '1000' }))).toBe(false)
})

test('the hash covers exactly what Health gets and survives a JSON round trip', () => {
  const d = doc({ volumePartial: true })
  expect(exportHash(JSON.parse(JSON.stringify(d)))).toBe(exportHash({ volumePartial: true, vol: 1200, end: 5000, start: 1000 }))
  expect(exportHash(doc({ volumePartial: false }))).toBe(exportHash(doc()))
  expect(exportHash(doc({ volumePartial: true }))).not.toBe(exportHash(doc()))
  expect(exportHash(doc({ vol: 1201 }))).not.toBe(exportHash(doc()))
})

test('no link: save with version now', () => {
  const d = doc()
  const plan = planWorkoutExport({ rows: [d], links: [], now: 1000 })
  expect(plan).toEqual({ save: [{ key: 'a1', syncId: 'opengym-w-a1', version: 1000, hash: exportHash(d), doc: d }], remove: [], skip: [] })
})

test('pending link, same hash: retry with the stored version', () => {
  const d = doc()
  const plan = planWorkoutExport({ rows: [d], links: [link(d, { state: 'pending' })], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([900])
})

test('pending link, changed hash: new version', () => {
  const d = doc()
  const plan = planWorkoutExport({ rows: [doc({ vol: 5 })], links: [link(d, { state: 'pending' })], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([2000])
})

test('exported, same hash: nothing', () => {
  const d = doc()
  expect(planWorkoutExport({ rows: [d], links: [link(d)], now: 2000 })).toEqual({ save: [], remove: [], skip: [] })
})

test('exported, hash changed: new version', () => {
  const d = doc()
  const plan = planWorkoutExport({ rows: [doc({ end: 6000 })], links: [link(d)], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([2000])
})

test('a link without a row is removed', () => {
  const d = doc()
  const plan = planWorkoutExport({ rows: [], links: [link(d)], now: 2000 })
  expect(plan).toEqual({ save: [], remove: [{ key: 'a1', syncId: 'opengym-w-a1' }], skip: [] })
})

test('an inverted workout is skipped, and not listed again once skipped', () => {
  const bad = doc({ end: 500 })
  expect(planWorkoutExport({ rows: [bad], links: [], now: 1 })).toEqual({ save: [], remove: [], skip: [{ key: 'a1' }] })
  expect(planWorkoutExport({ rows: [bad], links: [link(bad, { state: 'skipped' })], now: 1 })).toEqual({ save: [], remove: [], skip: [] })
})

test('a skipped workout whose times were fixed is saved', () => {
  const bad = doc({ end: 500 })
  const fixed = doc()
  const plan = planWorkoutExport({ rows: [fixed], links: [link(bad, { state: 'skipped' })], now: 3000 })
  expect(plan.save.map((s) => s.version)).toEqual([3000])
})

test('a note or set change that Health does not carry: nothing', () => {
  const d = doc()
  const changed = doc({ entries: [{ sets: [1, 2, 3] }], note: 'felt good' })
  expect(planWorkoutExport({ rows: [changed], links: [link(d)], now: 2000 })).toEqual({ save: [], remove: [], skip: [] })
})
