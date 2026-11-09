import { describe, expect, test } from 'vitest'
import {
  addSupplement, applyDayForm, applyTargets, clearDayValue, dayForm, recentDays, removeSupplement,
  renameSupplement, targetsForm, todayCard, toggleSupplement, weekView,
} from './nutrition-view.js'

const TODAY = '2026-11-09' // a Monday
const full = { kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training' }
const SUPPS = [{ id: 'a', name: 'Creatine' }, { id: 'b', name: 'Vitamin D' }]

describe('todayCard', () => {
  test('unpaired / missing keys read plainly: nothing logged, no targets, no NaN (Nutrition.jsx:235 empty line, nutrition.js:25-27 all start empty)', () => {
    for (const state of [undefined, null, {}, { nutritionDays: [], nutritionTargets: 5, supplements: 'x' }]) {
      const c = todayCard(state, { today: TODAY })
      expect(c).toEqual({ logged: false, kcal: null, protein: null, carbs: null, fat: null, fiber: null, dayType: null, targets: null, lines: [] })
    }
  })

  test('a logged day shows its totals, type and the protein/carbs/fat/fiber lines (Nutrition.jsx:232-240)', () => {
    const state = { nutritionDays: { [TODAY]: { ...full, _ts: 5 } } }
    const c = todayCard(state, { today: TODAY })
    expect(c).toMatchObject({ logged: true, kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training', targets: null })
    expect(c.lines).toEqual(['Protein 180 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'])
  })

  test('a day missing a total is not logged (nutrition.js:84 isLoggedDay: all five and a type)', () => {
    const c = todayCard({ nutritionDays: { [TODAY]: { ...full, fat: undefined } } }, { today: TODAY })
    expect(c.logged).toBe(false)
    expect(c.kcal).toBeNull()
    expect(c.lines).toEqual([])
  })

  test("targets are the day type's, null when that type has none or none are set (nutrition.js:185 readTargets, hasTargets)", () => {
    const day = { [TODAY]: full }
    const nutritionTargets = { training: { kcal: 2600, protein: 190 }, rest: { kcal: 2200 } }
    expect(todayCard({ nutritionDays: day, nutritionTargets }, { today: TODAY }).targets).toEqual({ kcal: 2600, protein: 190, fiber: null })
    const rest = { [TODAY]: { ...full, dayType: 'rest' } }
    expect(todayCard({ nutritionDays: rest, nutritionTargets }, { today: TODAY }).targets).toEqual({ kcal: 2200, protein: null, fiber: null })
    expect(todayCard({ nutritionDays: rest, nutritionTargets: { training: { kcal: 2600 } } }, { today: TODAY }).targets).toBeNull()
  })

  test('decimals read with one place and no stray zeros (format.js:58 fmtNum)', () => {
    const c = todayCard({ nutritionDays: { [TODAY]: { ...full, protein: 150.5, carbs: 1234 } } }, { today: TODAY })
    expect(c.lines[0]).toBe('Protein 150.5 g')
    expect(c.lines[1]).toBe('Carbs 1,234 g')
  })
})

describe('weekView / recentDays', () => {
  test('an empty week reads zero logged, no averages, no weight (nutrition.js:221 weekSummary)', () => {
    const w = weekView({}, { today: TODAY, weekStart: 1 })
    expect(w).toMatchObject({ start: TODAY, logged: 0, avg: null, weight: null })
    expect(w.days).toHaveLength(7)
  })

  test('a week counts logged days and averages them; Sunday start moves the week (nutrition.js:221, format.js:116)', () => {
    const state = { nutritionDays: { '2026-11-09': full, '2026-11-10': { ...full, kcal: 2000 }, '2026-11-08': full } }
    const mon = weekView(state, { today: '2026-11-10', weekStart: 1 })
    expect(mon.start).toBe('2026-11-09')
    expect(mon.logged).toBe(2)
    expect(mon.avg.kcal).toBe(2250)
    const sun = weekView(state, { today: '2026-11-10', weekStart: 0 })
    expect(sun.start).toBe('2026-11-08')
    expect(sun.logged).toBe(3)
  })

  test('weekStart falls back to the state setting then Monday (format.js:116)', () => {
    expect(weekView({ weekStart: 0 }, { today: TODAY }).start).toBe('2026-11-08')
    expect(weekView({}, { today: TODAY }).start).toBe(TODAY)
  })

  test('recentDays is newest first, limited to 14, skips days with no log (Nutrition.jsx:217, nutrition.js:233)', () => {
    const nutritionDays = { '2026-11-01': { _ts: 1 }, '2026-11-02': full }
    for (let i = 3; i <= 20; i++) nutritionDays['2026-10-' + String(i + 10).padStart(2, '0')] = full
    const rows = recentDays({ nutritionDays }, { limit: 14 })
    expect(rows).toHaveLength(14)
    expect(rows[0].iso).toBe('2026-11-02')
    expect(rows.map(r => r.iso)).not.toContain('2026-11-01')
    expect(recentDays({ nutritionDays }).length).toBe(14)
    expect(recentDays({})).toEqual([])
  })

  test('a recent row: type or "No totals logged", supplement count over the listed ones, lines, note, clearable (Nutrition.jsx:152-174)', () => {
    const state = {
      supplements: SUPPS,
      nutritionDays: {
        '2026-11-08': { ...full, note: 'big lunch', supps: ['a', 'gone'] },
        '2026-11-07': { supps: ['b'] },
      },
    }
    const [a, b] = recentDays(state, { limit: 14 })
    expect(a).toMatchObject({ iso: '2026-11-08', logged: true, subtitle: 'Training day · Supplements 1/2', note: 'big lunch', canClear: true })
    expect(a.lines).toEqual(['Calories 2,500 kcal', 'Protein 180 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'])
    expect(b).toMatchObject({ iso: '2026-11-07', logged: false, subtitle: 'No totals logged · Supplements 1/2', note: '', canClear: false, lines: [] })
    expect(recentDays({ nutritionDays: { '2026-11-08': full } })[0].subtitle).toBe('Training day')
  })
})

describe('dayForm', () => {
  test('a new day is a training day when a workout is logged on it, else rest (Nutrition.jsx:32)', () => {
    expect(dayForm({ workouts: [{ d: '2026-11-05' }] }, '2026-11-05').dayType).toBe('training')
    expect(dayForm({ workouts: [{ d: '2026-11-05' }] }, '2026-11-06').dayType).toBe('rest')
    expect(dayForm({}, TODAY).dayType).toBe('rest')
    expect(dayForm({ workouts: [null, 3] }, TODAY).dayType).toBe('rest')
  })

  test('workoutsByDay (a Set, array or object of days) is what the guess reads when given (Nutrition.jsx:32)', () => {
    expect(dayForm({}, '2026-11-05', { workoutsByDay: new Set(['2026-11-05']) }).dayType).toBe('training')
    expect(dayForm({}, '2026-11-05', { workoutsByDay: ['2026-11-05'] }).dayType).toBe('training')
    expect(dayForm({}, '2026-11-05', { workoutsByDay: { '2026-11-05': [{}] } }).dayType).toBe('training')
    expect(dayForm({ workouts: [{ d: '2026-11-05' }] }, '2026-11-05', { workoutsByDay: {} }).dayType).toBe('rest')
  })

  test('a saved day keeps its own type, totals and note; the guess never overrides it (Nutrition.jsx:36-37)', () => {
    const state = { workouts: [{ d: TODAY }], nutritionDays: { [TODAY]: { ...full, dayType: 'rest', note: 'n' } } }
    expect(dayForm(state, TODAY)).toEqual({ ...full, dayType: 'rest', note: 'n', existing: true })
  })

  test('an empty day is all-null totals, empty note, not existing (Nutrition.jsx:36-37, :46)', () => {
    expect(dayForm({}, TODAY)).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null, dayType: 'rest', note: '', existing: false })
  })
})

describe('applyDayForm', () => {
  const form = { ...full, note: '  ok  ' }

  test('saves totals, type and a trimmed note, no stamp of its own (nutrition.js:101, ruling 1)', () => {
    const r = applyDayForm({}, TODAY, form, { today: TODAY })
    expect(r.error).toBeUndefined()
    expect(r.value).toEqual({ ...full, note: 'ok' })
    expect('_ts' in r.value).toBe(false)
  })

  test('a future day is refused with the web copy, before the totals are looked at (Nutrition.jsx:51, nutrition.js:92)', () => {
    expect(applyDayForm({}, '2026-11-10', form, { today: TODAY })).toEqual({ error: 'Choose a valid date' })
    expect(applyDayForm({}, '2026-02-30', form, { today: TODAY })).toEqual({ error: 'Choose a valid date' })
    expect(applyDayForm({}, 'nope', {}, { today: TODAY })).toEqual({ error: 'Choose a valid date' })
    expect(applyDayForm({}, TODAY, form, { today: TODAY }).error).toBeUndefined()
  })

  test("the web's error strings, verbatim (nutrition.js:103-109 nutritionInputError)", () => {
    const err = f => applyDayForm({}, TODAY, f, { today: TODAY }).error
    expect(err({ ...form, fat: null })).toBe('Fill in all five totals.')
    expect(err({ ...form, fat: '' })).toBe('Fill in all five totals.')
    expect(err({ ...form, kcal: 20001 })).toBe('One of the totals is out of range.')
    expect(err({ ...form, protein: -1 })).toBe('One of the totals is out of range.')
    expect(err({ ...form, dayType: null })).toBe('Choose training day or rest day.')
  })

  test('limits: the maximum is allowed, one past is not (nutrition.js:31 NUTRIENT_MAX)', () => {
    const at = { kcal: 20000, protein: 2000, carbs: 2000, fat: 2000, fiber: 500, dayType: 'rest' }
    expect(applyDayForm({}, TODAY, at, { today: TODAY }).error).toBeUndefined()
    for (const [k, over] of [['kcal', 20001], ['protein', 2001], ['carbs', 2001], ['fat', 2001], ['fiber', 501]]) {
      expect(applyDayForm({}, TODAY, { ...at, [k]: over }, { today: TODAY }).error).toBe('One of the totals is out of range.')
    }
  })

  test('the note is cut at 500 and an empty one is not written (nutrition.js:32,101-102)', () => {
    expect(applyDayForm({}, TODAY, { ...full, note: 'x'.repeat(600) }, { today: TODAY }).value.note).toHaveLength(500)
    expect('note' in applyDayForm({}, TODAY, { ...full, note: '   ' }, { today: TODAY }).value).toBe(false)
  })

  test('text fields are rounded like the web: kcal whole, grams to 0.1 (nutrition.js:46 round)', () => {
    const v = applyDayForm({}, TODAY, { ...full, kcal: '2500.6', protein: '180.26' }, { today: TODAY }).value
    expect(v.kcal).toBe(2501)
    expect(v.protein).toBe(180.3)
  })

  test('the day keeps its ticks (nutrition.js:103 withNutritionDay keeps supps)', () => {
    const state = { nutritionDays: { [TODAY]: { supps: ['a', 'b'], _ts: 9 } } }
    expect(applyDayForm(state, TODAY, form, { today: TODAY }).value.supps).toEqual(['a', 'b'])
  })

  test("a key the app doesn't know survives byte for byte, and the stored stamp rides along, never a new one (ruling 1)", () => {
    const state = { nutritionDays: { [TODAY]: { kcal: 1, extra: { deep: [1, 2] }, other: 'x', _ts: 123 } } }
    const v = applyDayForm(state, TODAY, form, { today: TODAY }).value
    expect(v.extra).toEqual({ deep: [1, 2] })
    expect(v.other).toBe('x')
    expect(v._ts).toBe(123)
    expect(v.kcal).toBe(2500)
  })

  test('does not touch the state it was given', () => {
    const state = { nutritionDays: { [TODAY]: { kcal: 1, supps: ['a'], _ts: 3 } } }
    const before = JSON.stringify(state)
    applyDayForm(state, TODAY, form, { today: TODAY })
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('clearDayValue', () => {
  test('clear keeps the ticks and drops totals, type and note: never a delete (nutrition.js:112, Nutrition.jsx:155)', () => {
    const state = { nutritionDays: { [TODAY]: { ...full, note: 'n', supps: ['a'], _ts: 4 } } }
    expect(clearDayValue(state, TODAY)).toEqual({ supps: ['a'], _ts: 4 })
  })

  test('with no ticks it is an empty object (nutrition.js:112)', () => {
    expect(clearDayValue({ nutritionDays: { [TODAY]: full } }, TODAY)).toEqual({})
    expect(clearDayValue({}, TODAY)).toEqual({})
  })

  test('mints no stamp, keeps unknown keys (ruling 1)', () => {
    const v = clearDayValue({ nutritionDays: { [TODAY]: { ...full, supps: ['a'], extra: 7 } } }, TODAY)
    expect(v).toEqual({ supps: ['a'], extra: 7 })
    expect('_ts' in v).toBe(false)
  })
})

describe('toggleSupplement', () => {
  test('ticks an unticked supplement and unticks a ticked one, totals kept (nutrition.js:121, Nutrition.jsx:251)', () => {
    const state = { nutritionDays: { [TODAY]: { ...full, supps: ['a'], _ts: 2 } } }
    expect(toggleSupplement(state, TODAY, 'b')).toEqual({ ...full, supps: ['a', 'b'], _ts: 2 })
    expect(toggleSupplement(state, TODAY, 'a')).toEqual({ ...full, _ts: 2 })
  })

  test('on an empty day it creates a day holding just the tick, with no stamp (nutrition.js:121, ruling 1)', () => {
    const v = toggleSupplement({}, TODAY, 'a')
    expect(v).toEqual({ supps: ['a'] })
    expect('_ts' in v).toBe(false)
  })

  test('keeps unknown keys', () => {
    expect(toggleSupplement({ nutritionDays: { [TODAY]: { extra: 1 } } }, TODAY, 'a')).toEqual({ extra: 1, supps: ['a'] })
  })

  test('a day holds at most 50 ticks: a 51st is not added, unticking still works (nutrition.js:124-126)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => 's' + i)
    const state = { nutritionDays: { [TODAY]: { supps: ids } } }
    expect(toggleSupplement(state, TODAY, 'extra').supps).toHaveLength(50)
    expect(toggleSupplement(state, TODAY, 'extra').supps).not.toContain('extra')
    expect(toggleSupplement(state, TODAY, 's0').supps).toHaveLength(49)
  })

  test('a bad date or empty id throws as the web helper does (nutrition.js:127-128)', () => {
    expect(() => toggleSupplement({}, 'nope', 'a')).toThrow()
    expect(() => toggleSupplement({}, TODAY, '')).toThrow()
  })
})

describe('targets', () => {
  test('targetsForm reads both types, null where unset, and never NaN (nutrition.js:185 readTargets)', () => {
    expect(targetsForm({})).toEqual({ training: { kcal: null, protein: null, fiber: null }, rest: { kcal: null, protein: null, fiber: null } })
    expect(targetsForm({ nutritionTargets: { training: { kcal: 'x', protein: 0, fiber: 30 } } }).training).toEqual({ kcal: null, protein: null, fiber: 30 })
  })

  test('applyTargets sets one field and returns the whole key (nutrition.js:197 withTarget)', () => {
    const state = { nutritionTargets: { training: { kcal: 2600 }, rest: { protein: 150 } } }
    expect(applyTargets(state, 'training', 'protein', '190')).toEqual({
      training: { kcal: 2600, protein: 190, fiber: null }, rest: { kcal: null, protein: 150, fiber: null },
    })
  })

  test('null, empty or 0 clears a target; out of range clears too, as the web does (nutrition.js:197-199, :31)', () => {
    const state = { nutritionTargets: { training: { kcal: 2600 } } }
    for (const v of [null, '', 0]) expect(applyTargets(state, 'training', 'kcal', v).training.kcal).toBeNull()
    expect(applyTargets(state, 'training', 'kcal', 20001).training.kcal).toBeNull()
    expect(applyTargets(state, 'training', 'kcal', 20000).training.kcal).toBe(20000)
  })

  test('a bad type or key is refused (nutrition.js:195 throws bad target); carbs/fat are not targets (nutrition.js:28)', () => {
    expect(applyTargets({}, 'cheat', 'kcal', 1)).toEqual({ error: 'bad target' })
    expect(applyTargets({}, 'rest', 'carbs', 1)).toEqual({ error: 'bad target' })
  })
})

describe('supplements', () => {
  const state = { supplements: SUPPS }

  test('add returns the whole new list, trimmed, with the id the caller minted (nutrition.js:157 withSupplement, Nutrition.jsx:107)', () => {
    expect(addSupplement(state, '  Zinc ', 'c')).toEqual([...SUPPS, { id: 'c', name: 'Zinc' }])
    expect(addSupplement({}, 'Zinc', 'c')).toEqual([{ id: 'c', name: 'Zinc' }])
  })

  test('names are cut at 60 characters (nutrition.js:34)', () => {
    expect(addSupplement({}, 'x'.repeat(80), 'c')[0].name).toHaveLength(60)
  })

  test('a name already on the list, in any case, is refused with the web toast (nutrition.js:162, Nutrition.jsx:105)', () => {
    expect(addSupplement(state, 'creatine', 'c')).toEqual({ error: 'That supplement is already on the list.' })
    expect(addSupplement(state, ' VITAMIN d ', 'c')).toEqual({ error: 'That supplement is already on the list.' })
  })

  test('an empty name is refused silently: the web only toasts when the name is non-empty (Nutrition.jsx:105)', () => {
    expect(addSupplement(state, '   ', 'c')).toEqual({ error: '' })
    expect(addSupplement(state, '', 'c')).toEqual({ error: '' })
  })

  test('at most 50: the 51st is refused, with the same toast the web shows (nutrition.js:50, :160, Nutrition.jsx:105)', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: 's' + i, name: 'S' + i }))
    expect(addSupplement({ supplements: fifty }, 'One more', 'z')).toEqual({ error: 'That supplement is already on the list.' })
    expect(addSupplement({ supplements: fifty.slice(1) }, 'One more', 'z')).toHaveLength(50)
  })

  test('add needs an id (nutrition.js:160)', () => {
    expect(addSupplement(state, 'Zinc', '')).toEqual({ error: '' })
  })

  test('rename keeps the id, so past ticks follow; same rules on the name, other than itself (no web rename: restates nutrition.js:157-164)', () => {
    expect(renameSupplement(state, 'a', ' Creatine HCl ')).toEqual([{ id: 'a', name: 'Creatine HCl' }, SUPPS[1]])
    expect(renameSupplement(state, 'a', 'CREATINE')).toEqual([{ id: 'a', name: 'CREATINE' }, SUPPS[1]])
    expect(renameSupplement(state, 'a', 'vitamin d')).toEqual({ error: 'That supplement is already on the list.' })
    expect(renameSupplement(state, 'a', '  ')).toEqual({ error: '' })
    expect(renameSupplement(state, 'zzz', 'Zinc')).toEqual({ error: 'That supplement is not on the list.' })
    expect(renameSupplement(state, 'a', 'x'.repeat(80))[0].name).toHaveLength(60)
  })

  test('remove returns the list without it and does not touch any day: past ticks stay (nutrition.js:167, Nutrition.jsx:128)', () => {
    const s = { supplements: SUPPS, nutritionDays: { [TODAY]: { supps: ['a'] } } }
    const before = JSON.stringify(s)
    expect(removeSupplement(s, 'a')).toEqual([SUPPS[1]])
    expect(JSON.stringify(s)).toBe(before)
    expect(todayCard(s, { today: TODAY }).logged).toBe(false)
    expect(toggleSupplement(s, TODAY, 'b').supps).toEqual(['a', 'b'])
  })

  test('removing the last one gives an empty list; removing an unknown id changes nothing; junk reads empty (nutrition.js:140)', () => {
    expect(removeSupplement({ supplements: [SUPPS[0]] }, 'a')).toEqual([])
    expect(removeSupplement(state, 'nope')).toEqual(SUPPS)
    expect(removeSupplement({ supplements: 'x' }, 'a')).toEqual([])
  })
})
