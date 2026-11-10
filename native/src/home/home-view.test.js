import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { todayView } from '../nutrition/nutrition-screen.js'
import { HOME_EMPTY, homeView, nutritionNoticeLink } from './home-view.js'

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
    expect(v.nutrition.logged).toBe(false)
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

test('no nutrition logged: an empty card', () => {
  const v = homeView(plan, { today: TODAY, now: NOW })
  expect(v.nutrition).toMatchObject({ logged: false, kcal: null, targets: null, lines: [] })
})

test('a logged day with targets', () => {
  const state = { ...plan, nutritionDays: { [TODAY]: full }, nutritionTargets: { training: { kcal: 2600, protein: 190 } } }
  const v = homeView(state, { today: TODAY, now: NOW })
  expect(v.nutrition).toMatchObject({ logged: true, kcal: 2500, protein: 180, dayType: 'training', targets: { kcal: 2600, protein: 190, fiber: null } })
  expect(todayView(state, { today: TODAY })).toMatchObject({ headline: '2,500 kcal', target: 'Target 2,600 kcal', action: 'Edit' })
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

test('the Home screen draws that line from nutritionNoticeLink and opens its href', () => {
  const src = readFileSync(new URL('./HomeScreen.js', import.meta.url), 'utf8')
  expect(src).toContain('nutritionNoticeLink(n.notices)')
  expect(src).toContain('router.push(view.notice.href)')
})
