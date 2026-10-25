// The nutrition log merges one day at a time across devices (sync-merge.js STAMPED_MAPS), and
// the server's copy of the list agrees (api/sync-stamps.js).
import { describe, expect, it } from 'vitest'
import * as Server from '../../../api/sync-stamps.js'
import { STAMPED_MAPS, mergeStates } from './sync-merge.js'

const T = 1_800_000_000_000
const day = (kcal, ts, extra = {}) => ({ kcal, protein: 150, carbs: 200, fat: 70, fiber: 30, dayType: 'rest', ...extra, _ts: ts })
const doc = (ts, nutritionDays, more = {}) => ({ _ts: ts, unit: 'kg', workouts: [], routines: [], nutritionDays, ...more })

describe('nutritionDays in a sync merge', () => {
  it('is a stamped map on both sides', () => {
    expect(STAMPED_MAPS).toContain('nutritionDays')
    expect(Server.STAMPED_MAPS).toEqual(STAMPED_MAPS)
  })
  it('keeps days logged on different devices', () => {
    const a = doc(T + 10, { '2026-10-20': day(2000, T + 10) })
    const b = doc(T + 5, { '2026-10-21': day(2500, T + 5) })
    const m = mergeStates(a, b)
    expect(Object.keys(m.nutritionDays).sort()).toEqual(['2026-10-20', '2026-10-21'])
  })
  it('keeps the later save of the same day, whichever copy is newer overall', () => {
    const a = doc(T + 100, { '2026-10-20': day(2000, T + 1) })
    const b = doc(T + 5, { '2026-10-20': day(2100, T + 4) })
    expect(mergeStates(a, b).nutritionDays['2026-10-20'].kcal).toBe(2100)
    expect(mergeStates(b, a).nutritionDays['2026-10-20'].kcal).toBe(2100)
  })
  it('a cleared day beats an older copy of it', () => {
    const a = doc(T + 1, { '2026-10-20': { _ts: T + 9 } })
    const b = doc(T + 50, { '2026-10-20': day(2000, T + 2) })
    expect(mergeStates(a, b).nutritionDays['2026-10-20']).toEqual({ _ts: T + 9 })
  })
  it('targets and supplements follow the copy that changed them last', () => {
    const a = doc(T + 1, {}, { supplements: [{ id: 's1', name: 'Vitamin D' }], edited: { supplements: T + 1 } })
    const b = doc(T + 9, {}, { supplements: [], edited: { supplements: T + 9 } })
    expect(mergeStates(a, b).supplements).toEqual([])
  })
})
