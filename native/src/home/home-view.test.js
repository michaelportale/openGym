import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { todayView } from '../nutrition/nutrition-screen.js'
import { createMemoryWeighIns } from '../body/weigh-ins.js'
import { nutritionLoader } from '../nutrition/nutrition-source.js'
import { applyDayForm, toggleSupplement } from '../nutrition/nutrition-view.js'
import { dayDraft, dayValues, nutritionSaveArgs } from '../nutrition/nutrition-screen.js'
import { createMemoryFinishedWorkouts } from '../session/finished-workouts.js'
import { createMemoryPendingEdits } from '../sync/pending-edits.js'
import { DAY_OPEN_FAILED, HOME_EMPTY, daySheetOpen, homeView, nutritionNoticeLink } from './home-view.js'

const TODAY = '2026-11-09'
const NOW = Date.parse('2026-11-09T12:00:00Z')
const since = Date.parse('2026-10-22T00:00:00Z')
const routines = [{ id: 'c', name: 'Legs' }, { id: 'a', name: 'Push' }, { id: 'b', name: 'Pull' }]
const plan = { routines, rotation: { id: 'rot', sequence: ['a', 'b', 'c'] }, queue: { ids: ['a', 'b', 'c'], since, startsOn: '2026-10-22', rotationId: 'rot' }, workouts: [] }
const full = { kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training' }

test('no routines: no next session, no NaN or undefined', () => {
  for (const state of [undefined, null, {}, { routines: [] }, { routines: 'x', nutritionDays: [] }]) {
    const v = homeView(state, { today: TODAY, now: NOW })
    expect(v.next).toBeNull()
    expect(v.today.logged).toBe(false)
    expect(JSON.stringify(v)).not.toMatch(/NaN|undefined/)
  }
})

test('the next session is the one the Workout tab would start, by id and name', () => {
  expect(homeView(plan, { today: TODAY, now: NOW }).next).toEqual({ id: 'a', name: 'Push' })
  const after = { ...plan, workouts: [{ id: 'w', routineIds: ['a'], start: since + 1, d: TODAY }] }
  expect(homeView(after, { today: TODAY, now: NOW }).next).toEqual({ id: 'b', name: 'Pull' })
})

test('a routine with no name still gives a next session with an empty-safe name', () => {
  expect(homeView({ routines: [{ id: 'x' }] }, { today: TODAY, now: NOW }).next).toEqual({ id: 'x', name: 'Workout' })
})

test('no nutrition logged: an empty card, as the Nutrition screen draws it', () => {
  const v = homeView(plan, { today: TODAY, now: NOW })
  expect(v.today).toEqual(todayView(plan, { today: TODAY }))
  expect(v.today).toMatchObject({ logged: false, label: 'Today', headline: null, target: null, lines: [], action: 'Log' })
})

test('a logged day with targets', () => {
  const state = { ...plan, nutritionDays: { [TODAY]: full }, nutritionTargets: { training: { kcal: 2600, protein: 190 } } }
  const v = homeView(state, { today: TODAY, now: NOW })
  expect(v.today).toEqual(todayView(state, { today: TODAY }))
  expect(v.today).toMatchObject({ logged: true, label: 'Today · Training day', headline: '2,500 kcal', target: 'Target 2,600 kcal', action: 'Edit' })
  expect(v.today.lines).toEqual(['Protein 180 g of 190 g', 'Carbs 300 g', 'Fat 70 g', 'Fiber 30 g'])
})

test('the state is not changed', () => {
  const before = JSON.stringify(plan)
  homeView(plan, { today: TODAY, now: NOW })
  expect(JSON.stringify(plan)).toBe(before)
})

test('the empty texts are pinned', () => {
  expect(HOME_EMPTY).toEqual({ next: 'No routine to start yet. Add one in the Plan tab.' })
  expect(todayView({}, { today: TODAY }).empty).toBe('Nothing logged today yet.')
})

// A nutrition edit made from Home that the web overtook shows its notice only on the Nutrition
// screen: the Home card points there in one line while any such notice is up.
test('a nutrition-day or setting notice gives one line that opens Nutrition', () => {
  const link = { key: 'nutrition-notice', text: "A nutrition change wasn't sent. Open Nutrition to see it.", hint: 'Opens Nutrition.', href: '/nutrition' }
  const day = { kind: 'nutritionDay', key: TODAY, name: TODAY, reason: 'changed', at: '2026-11-09T10:00:00.000Z' }
  const targets = { kind: 'setting', key: 'nutritionTargets', name: 'nutritionTargets', reason: 'changed', at: '2026-11-09T11:00:00.000Z' }
  const supps = { ...targets, key: 'supplements', name: 'supplements' }
  expect(nutritionNoticeLink([day])).toEqual(link)
  expect(nutritionNoticeLink([targets])).toEqual(link)
  expect(nutritionNoticeLink([supps])).toEqual(link)
  expect(nutritionNoticeLink([day, targets, supps])).toEqual(link) // one line however many
})

test('no line without a nutrition notice: none, a routine one, an unknown setting or junk', () => {
  const routine = { kind: 'routine', key: 'r1', name: 'Push', reason: 'changed', at: '2026-11-09T10:00:00.000Z' }
  for (const notices of [[], undefined, null, 'x', [routine], [{ kind: 'setting', key: 'other' }], [null, 5]]) {
    expect(nutritionNoticeLink(notices)).toBeNull()
  }
})

test('the Home screen opens the day sheet only on a fresh load', () => {
  const src = readFileSync(new URL('./HomeScreen.js', import.meta.url), 'utf8')
  expect(src).toContain('daySheetOpen(await n.reload())')
  expect(src).toContain('opened={day.source}')
  expect(src).not.toContain('canAct')
  const sheet = readFileSync(new URL('../nutrition/DaySheet.js', import.meta.url), 'utf8')
  expect(sheet).toContain('const src = opened ?? source')
})

test('the Home screen draws that line from nutritionNoticeLink and opens its href', () => {
  const src = readFileSync(new URL('./HomeScreen.js', import.meta.url), 'utf8')
  expect(src).toContain('nutritionNoticeLink(n.notices)')
  expect(src).toContain('router.push(view.notice.href)')
})

// Home is a tab and stays mounted: its source can predate a supplement tick saved on Nutrition until
// its focus reload lands. The day sheet built on that source would save the day without the tick.
// So Log/Edit opens the sheet only on what a fresh load produced (ponytail review, finding 1).
describe("daySheetOpen: what Home's Log/Edit opens the day sheet on", () => {
  const bundled = { state: { workouts: [], bodyweight: [] }, names: {} }
  const copy = {
    state: { routines: [], workouts: [], supplements: [{ id: 'a', name: 'Creatine' }], nutritionDays: { [TODAY]: { ...full, _ts: 10 } }, edited: {} },
    rev: 5, wid: 'w5',
  }
  const stores = () => ({
    finished: createMemoryFinishedWorkouts(), serverCopy: { get: async () => copy, key: async () => ({ rev: copy.rev, wid: copy.wid }) },
    weighIns: createMemoryWeighIns(), edits: createMemoryPendingEdits(), bundled, now: NOW,
  })

  test("a tick saved just before opening is in the sheet's state, and the sheet's Save keeps it", async () => {
    const s = stores()
    const load = nutritionLoader()
    const shown = (await load(s)).source // Home's source from its last visit
    // On Nutrition: tick Creatine, saved to the pending store.
    const ticked = toggleSupplement(shown.state, TODAY, 'a')
    await s.edits.put(nutritionSaveArgs({ copy: shown.copy, bundled }, { kind: 'nutritionDay', key: TODAY, value: ticked }, { t: 1000 }))
    // Back on Home, Edit: a fresh load first.
    const open = daySheetOpen(await load(s))
    expect(open.error).toBeUndefined()
    expect(open.source.state.nutritionDays[TODAY].supps).toEqual(['a'])
    const draft = dayDraft(open.source.state, TODAY)
    draft.text.kcal = '2400'
    const out = applyDayForm(open.source.state, TODAY, dayValues(draft), { today: TODAY })
    expect(out.value).toMatchObject({ kcal: 2400, supps: ['a'] })
    // The base is still the copy the sheet opened on, so a web change while it is open supersedes.
    expect(open.source.copy).toBe(copy)
    // The source Home showed would have dropped the tick: the bug this guards.
    expect(applyDayForm(shown.state, TODAY, dayValues(dayDraft(shown.state, TODAY)), { today: TODAY }).value.supps).toBeUndefined()
  })

  test('a failed load opens no sheet and says so', () => {
    expect(daySheetOpen({ ok: false, error: { message: 'disk I/O error' } })).toEqual({ error: DAY_OPEN_FAILED })
    for (const junk of [undefined, null, {}, { ok: true }]) expect(daySheetOpen(junk)).toEqual({ error: DAY_OPEN_FAILED })
    expect(DAY_OPEN_FAILED).toBe("Couldn't load today's nutrition. Try again.")
  })

  test('the sheet gets the { state, copy } of that load, nothing else', () => {
    const source = { status: 'ready', state: { a: 1 }, copy: { b: 2 }, bodyweight: [], notices: [], error: null }
    const open = daySheetOpen({ ok: true, source })
    expect(open).toEqual({ source: { state: source.state, copy: source.copy } })
    expect(open.source.state).toBe(source.state)
    expect(open.source.copy).toBe(source.copy)
  })
})
