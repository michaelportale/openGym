import { describe, expect, test } from 'vitest'
import { libraryView } from './library-view.js'
import { exercises, libraryFilter } from '../shared/training.js'

const custom = { id: 'c1', custom: true, n: 'my odd lift', bp: 'chest', tg: 'chest', eq: 'barbell' }
const state = { customEx: [custom] }
const names = v => v.rows.map(r => r.name.toLowerCase())

describe('libraryView', () => {
  test('a custom exercise without the custom flag is still yours', () => {
    const flagless = { id: 'c2', n: 'flagless lift', bp: 'chest', tg: 'chest', eq: 'barbell' }
    const v = libraryView({ state: { customEx: [flagless] } })
    expect(v.rows.find(r => r.id === 'c2').yours).toBe(true)
  })
  test('empty query: the whole catalogue plus customs, customs first', () => {
    const v = libraryView({ state })
    expect(v.rows).toHaveLength(exercises.allExercises(state).length)
    expect(v.rows).toHaveLength(5632 + 1)
    expect(v.rows[0]).toEqual({ id: 'c1', name: 'My odd lift', sub: 'chest · barbell', yours: true, fav: false })
    expect(v.rows[1].yours).toBe(false)
    expect(v.similar).toEqual([])
    expect(v.bodyParts).toEqual(['', ...exercises.BODYPARTS])
  })

  test('a favourite comes first when not searching', () => {
    const id = exercises.allExercises({}).find(e => !exercises.isCustomEx(e)).id
    const v = libraryView({ state: { favEx: [id] } })
    expect(v.rows[0].id).toBe(id)
    expect(v.rows[0].fav).toBe(true)
  })

  test('search parity with the web helper', () => {
    expect(names(libraryView({ state: {}, q: 'benchpress' })).some(n => n.includes('bench press'))).toBe(true)
    expect(names(libraryView({ state: {}, q: 'db press' })).some(n => /dumbbell.*press/.test(n))).toBe(true)
    expect(names(libraryView({ state: {}, q: 'curls' })).some(n => n.includes('curl'))).toBe(true)
    expect(names(libraryView({ state: {}, q: 'benhc press' })).some(n => n.includes('bench press'))).toBe(true)
  })

  test('body part narrows the rows', () => {
    const v = libraryView({ state: {}, bp: 'chest' })
    const byId = new Map(exercises.allExercises({}).map(e => [e.id, e]))
    expect(v.rows.length).toBeGreaterThan(0)
    expect(v.rows.every(r => byId.get(r.id).bp === 'chest')).toBe(true)
  })

  test('chips come from libraryFilter unchanged', () => {
    const direct = libraryFilter.libraryFilter({ S: state, q: 'press', bp: 'chest', cat: '', eq: 'barbell' })
    const v = libraryView({ state, q: 'press', bp: 'chest', eq: 'barbell' })
    expect(v.catOpts).toEqual(direct.catOpts)
    expect(v.catOn).toBe(direct.catOn)
    expect(v.eqOpts).toEqual(direct.eqOpts)
    expect(v.eqOn).toBe(direct.eqOn)
    expect(v.rows).toHaveLength(direct.list.length)
  })

  test('no match: close matches for a near miss, none for nonsense', () => {
    // the web helper's fuzzy search still finds rows for the bare typo, so no suggestions there
    const typo = libraryView({ state: {}, q: 'dumbell curl' })
    expect(typo.rows.length).toBeGreaterThan(0)
    expect(typo.similar).toEqual([])
    // one word nothing matches empties the rows and the suggestions take over
    const near = libraryView({ state: {}, q: 'dumbell curl banana' })
    expect(near.rows).toEqual([])
    expect(near.similar).toHaveLength(30)
    expect(near.similar[0].name.toLowerCase()).toContain('curl')
    const none = libraryView({ state: {}, q: 'zzzzqqq' })
    expect(none.rows).toEqual([])
    expect(none.similar).toEqual([])
  })

  test('similar rows have the row shape and respect the body part', () => {
    const v = libraryView({ state: {}, q: 'dumbell curl zzqq', bp: 'chest' })
    expect(v.rows).toEqual([])
    const byId = new Map(exercises.allExercises({}).map(e => [e.id, e]))
    for (const r of v.similar) {
      expect(Object.keys(r).sort()).toEqual(['fav', 'id', 'name', 'sub', 'yours'])
      expect(byId.get(r.id).bp).toBe('chest')
    }
  })

  test('profileActive follows the equipment profile; showAll lifts the filter', () => {
    const profile = { id: 'p1', name: 'Home', equipment: ['dumbbell'] }
    const on = { equipFilterOn: true, equipProfiles: [profile], activeEquipId: 'p1' }
    expect(libraryView({ state: {} }).profileActive).toBe(false)
    expect(libraryView({ state: { ...on, activeEquipId: 'nope' } }).profileActive).toBe(false)
    expect(libraryView({ state: { ...on, equipFilterOn: false } }).profileActive).toBe(false)
    const filtered = libraryView({ state: on })
    expect(filtered.profileActive).toBe(true)
    expect(filtered.rows.length).toBeLessThan(libraryView({ state: on, showAll: true }).rows.length)
  })

  test('null and undefined state work', () => {
    expect(libraryView({ state: null }).rows).toHaveLength(5632)
    expect(libraryView({}).rows).toHaveLength(5632)
  })
})
