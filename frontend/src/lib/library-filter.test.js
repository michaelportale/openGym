import { describe, it, expect } from 'vitest'
import { libraryFilter } from './library-filter.js'
import { EXDB } from './exercises.js'

const S = { unit: 'kg', customEx: [], routines: [], workouts: [], equipProfiles: [], activeEquipId: null }

describe('libraryFilter', () => {
  it('narrows by body part, then type, then equipment', () => {
    const r = libraryFilter({ S, bp: 'chest', cat: 'strength', eq: 'dumbbell' })
    expect(r.catOn).toBe('strength')
    expect(r.eqOn).toBe('dumbbell')
    expect(r.list.length).toBeGreaterThan(0)
    expect(r.list.every(e => e.bp === 'chest' && e.cat === 'strength' && e.eq === 'dumbbell')).toBe(true)
  })
  it('ignores an equipment choice the body part has no exercise for, without a dead end', () => {
    const missing = 'no-such-equipment'
    const r = libraryFilter({ S, bp: 'chest', eq: missing })
    expect(r.eqOn).toBe('')
    expect(r.list.length).toBe(EXDB.filter(e => e.bp === 'chest').length)
  })
  it('offers only the types and equipment present in what is left', () => {
    const r = libraryFilter({ S, bp: 'neck' })
    const neck = EXDB.filter(e => e.bp === 'neck')
    expect(r.eqOpts.every(x => neck.some(e => e.eq === x))).toBe(true)
    expect(r.catOpts.every(x => neck.some(e => e.cat === x))).toBe(true)
  })
})
