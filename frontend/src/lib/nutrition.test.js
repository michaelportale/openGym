import { describe, expect, it } from 'vitest'
import {
  canLogNutrition, clearNutritionDay, hasTargets, isLoggedDay, nutrientValue, nutritionDayOf,
  lastNutritionDay, nutritionHistory, nutritionInputError, readNutritionDay, readSupplements, readTargets, weekDays,
  weekSummary, withNutritionDay, withSupplement, withSupplementTick, withTarget, withoutSupplement, SUPPLEMENTS_MAX,
} from './nutrition.js'
import { MONDAY, SUNDAY } from './format.js'

// Round example numbers only.
const full = (over = {}) => ({ kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30, dayType: 'rest', ...over })

describe('nutrientValue', () => {
  it('rounds kcal to whole numbers and grams to one decimal', () => {
    expect(nutrientValue('kcal', '2000.6')).toBe(2001)
    expect(nutrientValue('protein', 150.26)).toBe(150.3)
  })
  it('refuses empty, negative, non-numbers and typos past the bound', () => {
    for (const v of [null, '', -1, 'abc', NaN, Infinity]) expect(nutrientValue('fat', v)).toBeNull()
    expect(nutrientValue('kcal', 200000)).toBeNull()
    expect(nutrientValue('fiber', 0)).toBe(0)
  })
})

describe('nutritionInputError', () => {
  it('needs all five totals, fiber included', () => {
    expect(nutritionInputError(full())).toBeNull()
    expect(nutritionInputError(full({ fiber: null }))).toBe('Fill in all five totals.')
    expect(nutritionInputError(full({ carbs: '' }))).toBe('Fill in all five totals.')
  })
  it('refuses out-of-range totals and a missing day type', () => {
    expect(nutritionInputError(full({ kcal: -5 }))).toBe('One of the totals is out of range.')
    expect(nutritionInputError(full({ dayType: null }))).toBe('Choose training day or rest day.')
    expect(nutritionInputError(full({ dayType: 'cheat' }))).toBe('Choose training day or rest day.')
  })
})

describe('writing a day', () => {
  it('stores the totals, type and trimmed note, stamped', () => {
    const m = withNutritionDay({}, '2026-10-20', full({ note: '  travel day  ' }), 42)
    expect(m['2026-10-20']).toEqual({ _ts: 42, dayType: 'rest', kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30, note: 'travel day' })
    expect(isLoggedDay(readNutritionDay(m['2026-10-20']))).toBe(true)
  })
  it('keeps the day\'s supplement ticks when the totals are saved', () => {
    let m = withSupplementTick({}, '2026-10-20', 's1', true, 1)
    m = withNutritionDay(m, '2026-10-20', full(), 2)
    expect(m['2026-10-20'].supps).toEqual(['s1'])
  })
  it('does not touch other days, and throws on what the form refuses', () => {
    const before = { '2026-10-19': { kcal: 1, _ts: 1 } }
    const m = withNutritionDay(before, '2026-10-20', full(), 2)
    expect(m['2026-10-19']).toBe(before['2026-10-19'])
    expect(() => withNutritionDay({}, '2026-10-20', full({ protein: null }))).toThrow()
    expect(() => withNutritionDay({}, 'nope', full())).toThrow()
  })
  it('clearing leaves a stamped entry, keeping only the ticks', () => {
    let m = withNutritionDay({}, '2026-10-20', full(), 1)
    expect(clearNutritionDay(m, '2026-10-20', 5)['2026-10-20']).toEqual({ _ts: 5 })
    m = withSupplementTick(m, '2026-10-20', 's1', true, 2)
    expect(clearNutritionDay(m, '2026-10-20', 6)['2026-10-20']).toEqual({ supps: ['s1'], _ts: 6 })
  })
  it('a cleared day reads back as nothing', () => {
    expect(readNutritionDay({ _ts: 5 })).toBeNull()
    expect(nutritionDayOf({ nutritionDays: { '2026-10-20': { _ts: 5 } } }, '2026-10-20')).toBeNull()
    expect(nutritionDayOf({}, '2026-10-20')).toBeNull()
  })
  it('a day with ticks only is not logged', () => {
    const d = readNutritionDay(withSupplementTick({}, '2026-10-20', 's1', true, 1)['2026-10-20'])
    expect(d.supps).toEqual(['s1'])
    expect(isLoggedDay(d)).toBe(false)
  })
  it('only today and earlier can be logged', () => {
    expect(canLogNutrition('2026-10-20', '2026-10-24')).toBe(true)
    expect(canLogNutrition('2026-10-24', '2026-10-24')).toBe(true)
    expect(canLogNutrition('2026-10-25', '2026-10-24')).toBe(false)
    expect(canLogNutrition('bad', '2026-10-24')).toBe(false)
  })
})

describe('supplement ticks', () => {
  it('ticks and unticks without touching the totals', () => {
    let m = withNutritionDay({}, '2026-10-20', full(), 1)
    m = withSupplementTick(m, '2026-10-20', 's1', true, 2)
    m = withSupplementTick(m, '2026-10-20', 's2', true, 3)
    expect(m['2026-10-20'].supps).toEqual(['s1', 's2'])
    m = withSupplementTick(m, '2026-10-20', 's1', false, 4)
    expect(m['2026-10-20'].supps).toEqual(['s2'])
    expect(m['2026-10-20'].kcal).toBe(2000)
    m = withSupplementTick(m, '2026-10-20', 's2', false, 5)
    expect('supps' in m['2026-10-20']).toBe(false)
    expect(m['2026-10-20']._ts).toBe(5)
  })
})

describe('the supplement list', () => {
  it('starts empty and adds, refusing blanks and duplicates', () => {
    expect(readSupplements(undefined)).toEqual([])
    const a = withSupplement([], '  Vitamin D ', 'a')
    expect(a).toEqual([{ id: 'a', name: 'Vitamin D' }])
    expect(withSupplement(a, 'vitamin d', 'b')).toBeNull()
    expect(withSupplement(a, '   ', 'b')).toBeNull()
    expect(withSupplement(a, 'Creatine', 'b')).toHaveLength(2)
  })
  it('removes by id and drops junk on read', () => {
    expect(withoutSupplement([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'a')).toEqual([{ id: 'b', name: 'B' }])
    expect(readSupplements([null, { id: 'a', name: '' }, { id: 'b', name: 'B' }, { id: 'b', name: 'B2' }, 'x'])).toEqual([{ id: 'b', name: 'B' }])
  })
})

describe('targets', () => {
  it('start unset for both day types', () => {
    expect(readTargets(undefined)).toEqual({ training: { kcal: null, protein: null, fiber: null }, rest: { kcal: null, protein: null, fiber: null } })
    expect(hasTargets({})).toBe(false)
  })
  it('set and clear one value at a time', () => {
    let tg = withTarget({}, 'training', 'protein', '160')
    expect(tg.training.protein).toBe(160)
    expect(tg.rest.protein).toBeNull()
    expect(hasTargets(tg)).toBe(true)
    tg = withTarget(tg, 'training', 'protein', '')
    expect(tg.training.protein).toBeNull()
    expect(() => withTarget({}, 'cheat', 'kcal', 1)).toThrow()
    expect(() => withTarget({}, 'rest', 'carbs', 1)).toThrow()
  })
})

describe('weekDays', () => {
  it('follows the first day of the week', () => {
    expect(weekDays('2026-10-22', MONDAY)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(weekDays('2026-10-22', SUNDAY)[0]).toBe('2026-10-18')
  })
})

describe('weekSummary', () => {
  const S = {
    nutritionTargets: { training: { kcal: 2500, protein: 160, fiber: 35 }, rest: { kcal: 2000, protein: 140, fiber: null } },
    nutritionDays: {
      '2026-10-19': full({ dayType: 'training', kcal: 2500, protein: 160, fiber: 40 }),
      '2026-10-20': full({ dayType: 'rest', kcal: 2000, protein: 130, fiber: 30 }),
      '2026-10-21': full({ dayType: 'training', kcal: 2600, protein: 170, fiber: 30 }),
      '2026-10-22': { supps: ['s1'], _ts: 1 },        // ticks only: not logged
      '2026-10-23': { _ts: 1 },                        // cleared
      '2026-10-12': full(),                            // the week before
    },
    bodyweight: [
      { d: '2026-10-13', w: 80, t: 1 }, { d: '2026-10-15', w: 80, t: 1 },
      { d: '2026-10-20', w: 79, t: 1 }, { d: '2026-10-22', w: 79.5, t: 1 },
    ],
  }
  it('counts days logged and averages them', () => {
    const w = weekSummary(S, '2026-10-22', MONDAY)
    expect(w.start).toBe('2026-10-19')
    expect(w.logged).toBe(3)
    expect(w.avg).toEqual({ kcal: 2367, protein: 153.3, fiber: 33.3 })
  })
  it('compares against the mean target of the logged days\' types', () => {
    const w = weekSummary(S, '2026-10-22', MONDAY)
    expect(w.target.kcal).toBe(2333)            // 2500, 2000, 2500
    expect(w.target.protein).toBe(153.3)        // 160, 140, 160
    expect(w.target.fiber).toBe(35)             // the rest day has no fiber target
  })
  it('counts days that reached their protein target', () => {
    expect(weekSummary(S, '2026-10-22', MONDAY).protein).toEqual({ hit: 2, of: 3 })
  })
  it('reads the week\'s weigh-ins and the change from the week before', () => {
    expect(weekSummary(S, '2026-10-22', MONDAY).weight).toEqual({ avg: 79.25, n: 2, delta: -0.75 })
  })
  it('has no change when the week before has no weigh-in', () => {
    const w = weekSummary({ ...S, bodyweight: [{ d: '2026-10-20', w: 79, t: 1 }, { d: '2026-10-01', w: 81, t: 1 }] }, '2026-10-22', MONDAY)
    expect(w.weight).toEqual({ avg: 79, n: 1, delta: null })
  })
  it('an empty week has nothing to average', () => {
    const w = weekSummary({}, '2026-10-22', MONDAY)
    expect(w).toMatchObject({ logged: 0, avg: null, weight: null, protein: { hit: 0, of: 0 } })
    expect(w.target).toEqual({ kcal: null, protein: null, fiber: null })
  })
  it('without targets, no day counts toward the protein line', () => {
    const w = weekSummary({ ...S, nutritionTargets: {} }, '2026-10-22', MONDAY)
    expect(w.protein).toEqual({ hit: 0, of: 0 })
    expect(w.target.kcal).toBeNull()
  })
})

describe('nutritionHistory', () => {
  it('lists days with anything on them, newest first, skipping cleared ones', () => {
    const S = { nutritionDays: { '2026-10-19': full(), '2026-10-21': { supps: ['a'], _ts: 1 }, '2026-10-20': { _ts: 1 }, junk: full() } }
    expect(nutritionHistory(S)).toEqual(['2026-10-21', '2026-10-19'])
  })

  it('names the newest day with totals, not one with only supplement ticks', () => {
    const S = { nutritionDays: { '2026-10-19': full(), '2026-10-21': { supps: ['a'], _ts: 1 } } }
    expect(lastNutritionDay(S)).toBe('2026-10-19')
    expect(lastNutritionDay({})).toBeNull()
  })
})

describe('reading a saved state strictly', () => {
  it('takes only real numbers as saved totals: true is not 1 and [30] is not 30', () => {
    const d = readNutritionDay({ kcal: true, protein: [30], carbs: '200', fat: { valueOf: () => 70 }, fiber: 30, dayType: 'rest', _ts: 1 })
    expect(d.kcal).toBeNull()
    expect(d.protein).toBeNull()
    expect(d.carbs).toBeNull()
    expect(d.fat).toBeNull()
    expect(d.fiber).toBe(30)
    expect(isLoggedDay(d)).toBe(false)
    expect(isLoggedDay(readNutritionDay({ ...full(), _ts: 1 }))).toBe(true)
  })
  it('the form still takes typed text: only saved days are strict', () => {
    expect(nutritionInputError({ kcal: '2000', protein: '150', carbs: '200', fat: '70', fiber: '30', dayType: 'rest' })).toBeNull()
  })
  it('caps a saved day\'s ticks at SUPPLEMENTS_MAX and keeps string ids only', () => {
    const many = Array.from({ length: SUPPLEMENTS_MAX + 20 }, (_, i) => 's' + i)
    const d = readNutritionDay({ supps: [...many, 7, null, '', { id: 'x' }], _ts: 1 })
    expect(d.supps).toHaveLength(SUPPLEMENTS_MAX)
    expect(d.supps.every(x => typeof x === 'string' && x)).toBe(true)
  })
  it('a tick needs a string id, and a full day takes no new tick but can still untick', () => {
    expect(() => withSupplementTick({}, '2026-10-20', 7, true)).toThrow()
    expect(() => withSupplementTick({}, '2026-10-20', '', true)).toThrow()
    expect(() => withSupplementTick({}, '2026-10-20', null, true)).toThrow()
    const many = Array.from({ length: SUPPLEMENTS_MAX }, (_, i) => 's' + i)
    let m = { '2026-10-20': { supps: [...many, 'over', 5], _ts: 1 } }
    m = withSupplementTick(m, '2026-10-20', 'new', true, 2)
    expect(m['2026-10-20'].supps).toHaveLength(SUPPLEMENTS_MAX)
    expect(m['2026-10-20'].supps).not.toContain('new')
    expect(m['2026-10-20'].supps).not.toContain(5)
    m = withSupplementTick(m, '2026-10-20', 's0', false, 3)
    m = withSupplementTick(m, '2026-10-20', 'new', true, 4)
    expect(m['2026-10-20'].supps).toContain('new')
    expect(m['2026-10-20'].supps).toHaveLength(SUPPLEMENTS_MAX)
  })
  it('refuses dates that are not on the calendar', () => {
    for (const d of ['9999-99-99', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-32']) {
      expect(canLogNutrition(d, '9999-12-31')).toBe(false)
      expect(() => withNutritionDay({}, d, full())).toThrow()
      expect(() => withSupplementTick({}, d, 's1', true)).toThrow()
    }
    expect(canLogNutrition('2024-02-29', '2026-10-21')).toBe(true)
    const S = { nutritionDays: { '9999-99-99': { ...full(), _ts: 1 }, '2026-02-30': { ...full(), _ts: 1 }, '2026-10-20': { ...full(), _ts: 1 } } }
    expect(nutritionHistory(S)).toEqual(['2026-10-20'])
    expect(lastNutritionDay(S)).toBe('2026-10-20')
  })
})
