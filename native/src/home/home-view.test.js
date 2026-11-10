import { expect, test } from 'vitest'
import { todayView } from '../nutrition/nutrition-screen.js'
import { HOME_EMPTY, homeView } from './home-view.js'

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
