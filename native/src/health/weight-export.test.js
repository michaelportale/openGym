import { expect, test } from 'vitest'
import { planWeightExport, weightExportHash, weightSyncId } from './weight-export.js'

const row = (over = {}) => ({ d: '2026-11-09', op: 'set', w: 180.4, t: 5000, ...over })
const eff = (r, over = {}) => ({ [r.d]: { d: r.d, w: r.w, t: r.t, ...over } })
const link = (r, over = {}) => ({ kind: 'bw', key: r.d, syncId: weightSyncId(r.d), version: 900, hash: weightExportHash(r), state: 'exported', ...over })

test('the sync id is the day with the weigh-in prefix', () => {
  expect(weightSyncId('2026-11-09')).toBe('opengym-bw-2026-11-09')
})

test('a typed set with no link is saved at version now, timed at its t', () => {
  const r = row()
  expect(planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [], now: 1000 })).toEqual({
    save: [{ key: r.d, syncId: 'opengym-bw-2026-11-09', version: 1000, hash: weightExportHash(r), w: 180.4, at: 5000 }],
    remove: [],
  })
})

test('an exported link with the same hash does nothing', () => {
  const r = row()
  expect(planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [link(r)], now: 2000 })).toEqual({ save: [], remove: [] })
})

test('a pending link with the same hash retries at its stored version', () => {
  const r = row()
  const plan = planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [link(r, { state: 'pending' })], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([900])
})

test('an edit saves a version above the stored one, even when now is behind', () => {
  const old = row()
  const r = row({ w: 181, t: 6000 })
  const plan = planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [link(old, { version: 5000 })], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([5001])
  const later = planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [link(old)], now: 7000 })
  expect(later.save.map((s) => s.version)).toEqual([7000])
})

test('a link whose stored version is not a number gets now', () => {
  const old = row()
  const r = row({ w: 181, t: 6000 })
  const plan = planWeightExport({ rows: [r], effectiveByDay: eff(r), links: [link(old, { version: null })], now: 2000 })
  expect(plan.save.map((s) => s.version)).toEqual([2000])
})

test('a typed removal removes the exported day', () => {
  const r = row()
  const gone = row({ op: 'remove', w: undefined, t: 6000 })
  const plan = planWeightExport({ rows: [gone], effectiveByDay: {}, links: [link(r)], now: 2000 })
  expect(plan).toEqual({ save: [], remove: [{ key: r.d, syncId: 'opengym-bw-2026-11-09' }] })
})

test('a link whose row is gone is removed', () => {
  const r = row()
  expect(planWeightExport({ rows: [], effectiveByDay: {}, links: [link(r)], now: 2000 }).remove).toHaveLength(1)
})

test('an imported day is never saved, and an old link for it is removed', () => {
  const r = row({ src: 'health', hk: 'u1' })
  expect(planWeightExport({ rows: [r], effectiveByDay: eff(r, { src: 'health' }), links: [], now: 1 })).toEqual({ save: [], remove: [] })
  expect(planWeightExport({ rows: [r], effectiveByDay: eff(r, { src: 'health' }), links: [link(row())], now: 1 }).remove).toHaveLength(1)
})

test('a typed set the server superseded with a newer web edit is not saved, and is removed if it was', () => {
  const r = row()
  const web = { [r.d]: { d: r.d, w: 175, t: 9000 } }
  expect(planWeightExport({ rows: [r], effectiveByDay: web, links: [], now: 1 })).toEqual({ save: [], remove: [] })
  expect(planWeightExport({ rows: [r], effectiveByDay: web, links: [link(r)], now: 1 }).remove).toHaveLength(1)
})

test('a day deleted on the server (no effective entry) is not saved, and is removed if it was', () => {
  const r = row()
  expect(planWeightExport({ rows: [r], effectiveByDay: {}, links: [], now: 1 })).toEqual({ save: [], remove: [] })
  expect(planWeightExport({ rows: [r], effectiveByDay: {}, links: [link(r)], now: 1 }).remove).toHaveLength(1)
})

test('only bw links count', () => {
  const r = row()
  expect(planWeightExport({ rows: [], effectiveByDay: {}, links: [{ ...link(r), kind: 'w' }], now: 1 }).remove).toEqual([])
})

test('an unknown copy removes and saves nothing for rows that are not pending, but pending rows still decide', () => {
  const r = row()
  const other = row({ d: '2026-11-08' })
  const base = { rows: [r, other], effectiveByDay: {}, links: [link(r), link(other)], now: 1, copyKnown: false }
  expect(planWeightExport({ ...base, pendingDays: new Set() })).toEqual({ save: [], remove: [] })
  const plan = planWeightExport({ ...base, pendingDays: new Set([other.d]) })
  expect(plan.remove).toEqual([{ key: other.d, syncId: weightSyncId(other.d) }])
})
