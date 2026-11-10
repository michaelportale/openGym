import { describe, expect, test } from 'vitest'
import { applyEdits, stampOf } from '../sync/edit-guard.js'
import { createMemoryPendingEdits } from '../sync/pending-edits.js'
import {
  canAct, dayDraft, dayRows, dayValues, nutritionNotices, nutritionSaveArgs, supplementChecks,
  supplementsSection, targetsDraft, targetsSave, todayView, weekCard,
} from './nutrition-screen.js'

const TODAY = '2026-11-09' // a Monday
const NOW = new Date(2026, 10, 9, 12).getTime()
const full = { kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training' }
const SUPPS = [{ id: 'a', name: 'Creatine' }, { id: 'b', name: 'Vitamin D' }]

describe('todayView (Nutrition.jsx Today card)', () => {
  test('nothing logged: the web\'s empty line and Log, no NaN (Nutrition.jsx:235, 237)', () => {
    for (const state of [undefined, {}, { nutritionDays: { [TODAY]: { kcal: 100 } } }]) {
      expect(todayView(state, { today: TODAY })).toEqual({
        logged: false, label: 'Today', headline: null, empty: 'Nothing logged today yet.', target: null, lines: [], action: 'Log',
      })
    }
  })

  test('a logged day: its type, calories as the headline, the other four with their targets, and Edit', () => {
    const state = { nutritionDays: { [TODAY]: full }, nutritionTargets: { training: { kcal: 2600, protein: 190 } } }
    expect(todayView(state, { today: TODAY })).toEqual({
      logged: true,
      label: 'Today · Training day',
      headline: '2,500 kcal',
      empty: null,
      target: 'Target 2,600 kcal',
      lines: ['Protein 180 g of 190 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'],
      action: 'Edit',
    })
  })

  test('no target for the day type: no target line and no "of"', () => {
    const state = { nutritionDays: { [TODAY]: { ...full, dayType: 'rest' } }, nutritionTargets: { training: { kcal: 2600 } } }
    const v = todayView(state, { today: TODAY })
    expect(v.label).toBe('Today · Rest day')
    expect(v.target).toBeNull()
    expect(v.lines).toEqual(['Protein 180 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'])
  })
})

describe('supplementChecks (Nutrition.jsx supplements card)', () => {
  test('each listed supplement with whether today has it ticked', () => {
    const state = { supplements: SUPPS, nutritionDays: { [TODAY]: { supps: ['b', 'gone'] } } }
    expect(supplementChecks(state, { today: TODAY })).toEqual([
      { id: 'a', name: 'Creatine', checked: false },
      { id: 'b', name: 'Vitamin D', checked: true },
    ])
  })

  test('no list, or junk: none', () => {
    expect(supplementChecks({}, { today: TODAY })).toEqual([])
    expect(supplementChecks({ supplements: 'x' }, { today: TODAY })).toEqual([])
  })
})

describe('weekCard (NutritionWeek.jsx)', () => {
  test('an empty current week: the web\'s empty text, Log today, no next week', () => {
    const w = weekCard({}, { today: TODAY, anchor: null, bodyweight: [] })
    expect(w).toMatchObject({ title: 'This week', current: true, empty: true, emptyText: "Your week's averages show here once you log a day.", next: null })
    expect(w.prev).toBe('2026-11-02')
    expect(w.tiles).toEqual([])
  })

  test('tiles: weight with its change, days logged, the three averages against targets, protein hits', () => {
    const state = {
      nutritionDays: { '2026-11-09': full, '2026-11-10': { ...full, kcal: 2000, protein: 200, dayType: 'rest' } },
      nutritionTargets: { training: { protein: 190 }, rest: { protein: 195 } },
    }
    const bodyweight = [{ d: '2026-11-03', w: 182, t: 1 }, { d: '2026-11-09', w: 180.4, t: 2 }, { d: '2026-11-10', w: 180, t: 3 }]
    const w = weekCard(state, { today: '2026-11-10', anchor: null, bodyweight })
    expect(w.empty).toBe(false)
    expect(w.tiles.map(t => [t.key, t.label, t.value, t.sub])).toEqual([
      ['weight', 'Average weight', '180.2 lb', '−1.8 lb vs last week'],
      ['logged', 'Days logged', '2/7', null],
      ['kcal', 'Average calories', '2,250 kcal', 'No target set'],
      ['protein', 'Average protein', '190 g', 'Target 192.5 g'],
      ['fiber', 'Average fiber', '30 g', 'No target set'],
      ['protein-hit', 'Protein target reached', '1/2', null],
    ])
    expect(w.tiles[1].a11y).toBe('Days logged: 2/7')
    expect(w.tiles[0].a11y).toBe('Average weight: 180.2 lb, −1.8 lb vs last week')
  })

  test('a week with no weigh-ins and none logged, and no protein target: dashes and the web\'s subtitles, no NaN', () => {
    const state = { nutritionDays: { [TODAY]: full } }
    const w = weekCard(state, { today: TODAY, anchor: null, bodyweight: [] })
    const byKey = Object.fromEntries(w.tiles.map(t => [t.key, t]))
    expect(byKey.weight).toMatchObject({ value: '–', sub: 'No weigh-ins this week' })
    expect(byKey['protein-hit']).toMatchObject({ value: '–', sub: 'Set a protein target to count this' })
    expect(JSON.stringify(w)).not.toMatch(/NaN|undefined/)
  })

  test('a weigh-in this week but none the week before', () => {
    const w = weekCard({}, { today: TODAY, anchor: null, bodyweight: [{ d: TODAY, w: 180, t: 1 }] })
    expect(w.empty).toBe(false)
    expect(w.tiles[0]).toMatchObject({ value: '180 lb', sub: 'No weigh-in last week to compare' })
    expect(w.tiles[2]).toMatchObject({ value: '–', sub: null })
  })

  test('stepping back shows "Week of" with Next; stepping forward into this week is the current week again', () => {
    const back = weekCard({}, { today: TODAY, anchor: '2026-11-02', bodyweight: [] })
    expect(back).toMatchObject({ title: 'Week of Nov 2', current: false, prev: '2026-10-26', next: null })
    const two = weekCard({}, { today: TODAY, anchor: '2026-10-26', bodyweight: [] })
    expect(two).toMatchObject({ title: 'Week of Oct 26', current: false, prev: '2026-10-19', next: '2026-11-02' })
    const lastYear = weekCard({}, { today: '2026-01-07', anchor: '2025-12-29', bodyweight: [] })
    expect(lastYear.title).toBe('Week of Dec 29, 2025')
  })

  test('a Sunday-start profile starts its weeks on Sunday (format.js weekStartOf)', () => {
    const w = weekCard({ weekStart: 0 }, { today: TODAY, anchor: null, bodyweight: [] })
    expect(w.prev).toBe('2026-11-01')
  })
})

describe('dayRows (Nutrition.jsx DayRow)', () => {
  test('newest first, with the date, subtitle, lines, note and whether Clear shows', () => {
    const state = {
      supplements: SUPPS,
      nutritionDays: { '2026-11-08': { supps: ['a'] }, '2026-11-09': { ...full, note: 'Felt good' }, '2025-12-31': full },
    }
    const rows = dayRows(state, { now: NOW })
    expect(rows.map(r => [r.iso, r.label, r.subtitle, r.canClear])).toEqual([
      ['2026-11-09', 'Nov 9', 'Training day · Supplements 0/2', true],
      ['2026-11-08', 'Nov 8', 'No totals logged · Supplements 1/2', false],
      ['2025-12-31', 'Dec 31, 2025', 'Training day · Supplements 0/2', true],
    ])
    expect(rows[0].lines).toEqual(['Calories 2,500 kcal', 'Protein 180 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'])
    expect(rows[0].note).toBe('Felt good')
    expect(rows[0].editLabel).toBe('Edit Nov 9')
    expect(rows[0].clearLabel).toBe('Clear Nov 9')
  })

  test('no days: none', () => {
    expect(dayRows({}, { now: NOW })).toEqual([])
  })
})

describe('dayDraft / dayValues (Nutrition.jsx DayLog)', () => {
  test('a new day: the web\'s title, empty fields and the guessed day type', () => {
    const d = dayDraft({ workouts: [{ d: TODAY }] }, TODAY)
    expect(d).toEqual({
      iso: TODAY, existing: false, title: 'Log a day', dayType: 'training', note: '',
      text: { kcal: '', protein: '', carbs: '', fat: '', fiber: '' },
    })
    expect(dayDraft({}, TODAY).dayType).toBe('rest')
  })

  test('a logged day: Edit day, its own values and note', () => {
    const d = dayDraft({ nutritionDays: { [TODAY]: { ...full, protein: 150.5, dayType: 'rest', note: 'n' } } }, TODAY)
    expect(d).toMatchObject({ existing: true, title: 'Edit day', dayType: 'rest', note: 'n' })
    expect(d.text).toEqual({ kcal: '2500', protein: '150.5', carbs: '300', fat: '70', fiber: '30' })
  })

  test('the typed text back to the values applyDayForm reads: whole calories, decimal grams, empty is null', () => {
    const v = dayValues({ dayType: 'rest', note: ' hi ', text: { kcal: '2500.6', protein: '150,5', carbs: '', fat: 'x', fiber: '30' } })
    expect(v).toEqual({ dayType: 'rest', note: ' hi ', kcal: 2500, protein: 150.5, carbs: null, fat: null, fiber: 30 })
  })
})

describe('targetsDraft / targetsSave (Nutrition.jsx TargetsAndSupplements)', () => {
  const state = { nutritionTargets: { training: { kcal: 2600, protein: 190.5 }, rest: { kcal: 2200 }, extra: 1 } }

  test('the fields as text, empty where unset', () => {
    expect(targetsDraft(state)).toEqual({
      training: { kcal: '2600', protein: '190.5', fiber: '' },
      rest: { kcal: '2200', protein: '', fiber: '' },
    })
    expect(targetsDraft({})).toEqual({ training: { kcal: '', protein: '', fiber: '' }, rest: { kcal: '', protein: '', fiber: '' } })
  })

  test('nothing changed (or only re-typed the same number): nothing to save', () => {
    expect(targetsSave(state, targetsDraft(state))).toBeNull()
    const same = targetsDraft(state)
    same.training.kcal = '2600.0'
    expect(targetsSave(state, same)).toBeNull()
  })

  test('a change gives the whole new key through withTarget: set, cleared, out of range cleared (nutrition.js withTarget)', () => {
    const draft = targetsDraft(state)
    draft.rest.protein = '160'
    draft.training.kcal = ''
    draft.training.fiber = '99999'
    expect(targetsSave(state, draft)).toEqual({
      training: { kcal: null, protein: 190.5, fiber: null },
      rest: { kcal: 2200, protein: 160, fiber: null },
    })
  })

  test('calories are whole: a typed decimal counts its whole part', () => {
    const draft = targetsDraft({})
    draft.training.kcal = '2400.9'
    expect(targetsSave({}, draft).training.kcal).toBe(2400)
  })
})

describe('supplementsSection (Nutrition.jsx TargetsAndSupplements, Supplements)', () => {
  test('each supplement with its Remove label, and the web\'s footer', () => {
    expect(supplementsSection({ supplements: SUPPS })).toEqual({
      rows: [{ id: 'a', name: 'Creatine', removeLabel: 'Remove Creatine' }, { id: 'b', name: 'Vitamin D', removeLabel: 'Remove Vitamin D' }],
      footer: 'Removing one keeps the days it was ticked.',
    })
  })

  test('none listed: the web\'s invitation', () => {
    expect(supplementsSection({})).toEqual({ rows: [], footer: 'Add the supplements you take, then tick them off each day.' })
  })
})

describe('nutritionNotices (the exact texts)', () => {
  test('a day, the targets and the supplements, oldest first, each with its Dismiss label', () => {
    const notices = [
      { kind: 'setting', key: 'supplements', name: 'supplements', reason: 'changed', at: '2026-11-09T10:00:03Z' },
      { kind: 'nutritionDay', key: '2026-11-08', name: '2026-11-08', reason: 'changed', at: '2026-11-09T10:00:01Z' },
      { kind: 'setting', key: 'nutritionTargets', name: 'nutritionTargets', reason: 'changed', at: '2026-11-09T10:00:02Z' },
      { kind: 'routine', key: 'r1', name: 'Push', reason: 'changed', at: '2026-11-09T10:00:00Z' },
    ]
    expect(nutritionNotices(notices, { now: NOW })).toEqual([
      {
        id: 'nutritionDay:2026-11-08', kind: 'nutritionDay', key: '2026-11-08',
        text: "Your change to Nov 8 nutrition wasn't sent: it was changed on the web first. This shows the web's version.",
        dismissLabel: 'Dismiss notice about Nov 8 nutrition',
      },
      {
        id: 'setting:nutritionTargets', kind: 'setting', key: 'nutritionTargets',
        text: "Your change to your nutrition targets wasn't sent: it was changed on the web first. This shows the web's version.",
        dismissLabel: 'Dismiss notice about your nutrition targets',
      },
      {
        id: 'setting:supplements', kind: 'setting', key: 'supplements',
        text: "Your change to your supplements wasn't sent: it was changed on the web first. This shows the web's version.",
        dismissLabel: 'Dismiss notice about your supplements',
      },
    ])
  })

  test('a day from another year carries the year (ui/dates.js dayLabel); none gives none', () => {
    const [n] = nutritionNotices([{ kind: 'nutritionDay', key: '2025-12-31', reason: 'changed', at: 'x' }], { now: NOW })
    expect(n.text).toBe("Your change to Dec 31, 2025 nutrition wasn't sent: it was changed on the web first. This shows the web's version.")
    expect(nutritionNotices(undefined, { now: NOW })).toEqual([])
  })
})

describe('nutritionSaveArgs: the base comes from the copy (or the snapshot) without the overlay', () => {
  const day = { ...full, _ts: 100 }
  const copy = { state: { nutritionDays: { [TODAY]: day }, edited: { nutritionTargets: 40, supplements: 41 } }, rev: 3, wid: 'w' }
  const bundled = { state: { nutritionDays: { [TODAY]: { ...full, _ts: 7 } }, edited: { nutritionTargets: 8 } } }
  const value = { ...full, kcal: 2400 }

  test("a day: the copy's day _ts, not fresh", () => {
    expect(nutritionSaveArgs({ copy, bundled }, { kind: 'nutritionDay', key: TODAY, value }, { t: 500 }))
      .toEqual({ kind: 'nutritionDay', key: TODAY, baseTs: 100, value, t: 500, fresh: false })
  })

  test('a day the copy lacks, or holds without a stamp: a null base', () => {
    expect(nutritionSaveArgs({ copy, bundled }, { kind: 'nutritionDay', key: '2026-11-08', value }, { t: 1 }).baseTs).toBeNull()
    const bare = { state: { nutritionDays: { [TODAY]: { ...full } } } }
    expect(nutritionSaveArgs({ copy: bare, bundled }, { kind: 'nutritionDay', key: TODAY, value }, { t: 1 }).baseTs).toBeNull()
    const junk = { state: { nutritionDays: [] } }
    expect(nutritionSaveArgs({ copy: junk, bundled }, { kind: 'nutritionDay', key: TODAY, value }, { t: 1 }).baseTs).toBeNull()
  })

  test("a setting: the copy's edited[key], or null", () => {
    expect(nutritionSaveArgs({ copy, bundled }, { kind: 'setting', key: 'nutritionTargets', value: {} }, { t: 2 }))
      .toEqual({ kind: 'setting', key: 'nutritionTargets', baseTs: 40, value: {}, t: 2, fresh: false })
    expect(nutritionSaveArgs({ copy, bundled }, { kind: 'setting', key: 'supplements', value: [] }, { t: 2 }).baseTs).toBe(41)
    const none = { state: {} }
    expect(nutritionSaveArgs({ copy: none, bundled }, { kind: 'setting', key: 'supplements', value: [] }, { t: 2 }).baseTs).toBeNull()
  })

  test('no copy held: the snapshot is the base and the edit is fresh (plan-view.js editBase)', () => {
    expect(nutritionSaveArgs({ copy: null, bundled }, { kind: 'nutritionDay', key: TODAY, value }, { t: 3 }))
      .toEqual({ kind: 'nutritionDay', key: TODAY, baseTs: 7, value, t: 3, fresh: true })
    expect(nutritionSaveArgs({ copy: null, bundled }, { kind: 'setting', key: 'nutritionTargets', value: {} }, { t: 3 }))
      .toMatchObject({ baseTs: 8, fresh: true })
    expect(nutritionSaveArgs({ copy: null, bundled: { state: {} } }, { kind: 'setting', key: 'supplements', value: [] }, { t: 3 }))
      .toMatchObject({ baseTs: null, fresh: true })
  })

  test('an unknown kind is a programming error', () => {
    expect(() => nutritionSaveArgs({ copy, bundled }, { kind: 'routine', key: 'r', value: {} }, { t: 1 })).toThrow()
  })

  // One reader for the stamp, the guard's: if the save read it another way, every edit would be
  // superseded as changed on the web first, and no test on either side would fail (ponytail review 2).
  test("the base is the guard's own stamp reader (edit-guard.js stampOf), for a day and a setting", () => {
    const copies = [copy, { state: {} }, { state: { nutritionDays: [], edited: 5 } }, { state: { nutritionDays: { [TODAY]: { ...full } }, edited: {} } }]
    for (const [kind, key] of [['nutritionDay', TODAY], ['nutritionDay', '2026-11-08'], ['setting', 'nutritionTargets'], ['setting', 'supplements']]) {
      for (const c of copies) {
        expect(nutritionSaveArgs({ copy: c, bundled }, { kind, key, value: {} }, { t: 1 }).baseTs).toBe(stampOf(c.state, kind, key))
      }
      expect(nutritionSaveArgs({ copy: null, bundled }, { kind, key, value: {} }, { t: 1 }).baseTs).toBe(stampOf(bundled.state, kind, key))
    }
    expect(stampOf(copy.state, 'nutritionDay', TODAY)).toBe(100)
    expect(stampOf(copy.state, 'setting', 'supplements')).toBe(41)
  })

  // The base must be the stamp the guard reads, or the push supersedes the phone's own edit (a
  // false "changed on the web") or lays it over a web change (a silent overwrite).
  test('through the store and the guard: the edit goes on the copy it was made on; a web change since is superseded', async () => {
    const store = createMemoryPendingEdits()
    await store.put(nutritionSaveArgs({ copy, bundled }, { kind: 'nutritionDay', key: TODAY, value }, { t: 10 }))
    await store.put(nutritionSaveArgs({ copy, bundled }, { kind: 'nutritionDay', key: '2026-11-08', value }, { t: 11 }))
    await store.put(nutritionSaveArgs({ copy, bundled }, { kind: 'setting', key: 'nutritionTargets', value: { training: {}, rest: {} } }, { t: 12 }))
    const pending = await store.listPending()
    const out = applyEdits(copy.state, pending)
    expect(out.applied.map(e => e.key)).toEqual([TODAY, '2026-11-08', 'nutritionTargets'])
    expect(out.superseded).toEqual([])
    expect(out.state.nutritionDays[TODAY]).toEqual({ ...value, _ts: 100 })

    const web = { ...copy.state, nutritionDays: { [TODAY]: { ...full, note: 'web', _ts: 200 } } }
    expect(applyEdits(web, pending).superseded).toEqual([{ kind: 'nutritionDay', key: TODAY, t: 10, reason: 'changed' }])
  })
})

// Task 6 fix round 1: a day sheet opened while a tick is saving would take the state before the
// tick, and its Save would replace the pending day without it.
describe('canAct (a tap that writes a day or opens the day sheet)', () => {
  test('only on a loaded screen with no save running', () => {
    expect(canAct({ ready: true, busy: false })).toBe(true)
    expect(canAct({ ready: true, busy: true })).toBe(false)
    expect(canAct({ ready: false, busy: false })).toBe(false)
    expect(canAct({ ready: false, busy: true })).toBe(false)
  })
})
