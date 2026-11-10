import { describe, expect, test } from 'vitest'
import { measurementsRow, nutritionRow } from './link-rows.js'

const TODAY = '2026-11-09'
const NOW = new Date(2026, 10, 9, 12).getTime()
const full = { kcal: 2500, protein: 180, carbs: 300, fat: 70, fiber: 30, dayType: 'training' }

describe('nutritionRow (Progress: today\'s calories and protein against targets)', () => {
  test('nothing logged today, or nothing at all: "Not logged today", no NaN', () => {
    for (const state of [null, undefined, {}, { nutritionDays: { [TODAY]: { kcal: 2500 } } }, { nutritionDays: { '2026-11-08': full } }]) {
      expect(nutritionRow(state, { today: TODAY })).toEqual({ title: 'Nutrition', line: 'Not logged today', a11y: 'Nutrition, not logged today' })
    }
  })

  test('logged with both targets set for its day type', () => {
    const state = { nutritionDays: { [TODAY]: full }, nutritionTargets: { training: { kcal: 2600, protein: 190 } } }
    expect(nutritionRow(state, { today: TODAY })).toEqual({
      title: 'Nutrition', line: '2,500 of 2,600 kcal · 180 of 190 g protein', a11y: 'Nutrition, 2,500 of 2,600 kcal · 180 of 190 g protein',
    })
  })

  test('logged with no target, or only one, says only what it has', () => {
    expect(nutritionRow({ nutritionDays: { [TODAY]: full } }, { today: TODAY }).line).toBe('2,500 kcal · 180 g protein')
    const kcalOnly = { nutritionDays: { [TODAY]: full }, nutritionTargets: { training: { kcal: 2600 } } }
    expect(nutritionRow(kcalOnly, { today: TODAY }).line).toBe('2,500 of 2,600 kcal · 180 g protein')
    const restTargets = { nutritionDays: { [TODAY]: full }, nutritionTargets: { rest: { kcal: 2000, protein: 150 } } }
    expect(nutritionRow(restTargets, { today: TODAY }).line).toBe('2,500 kcal · 180 g protein')
  })
})

describe('measurementsRow (Progress: the latest waist, or the first field with a reading, in inches)', () => {
  test('none logged: "No measurements yet", no NaN', () => {
    for (const state of [null, {}, { measurements: [] }, { measurements: 'x' }]) {
      expect(measurementsRow(state, { now: NOW })).toEqual({ title: 'Measurements', line: 'No measurements yet', a11y: 'Measurements, no measurements yet' })
    }
  })

  test('the latest waist in inches with its date', () => {
    const state = { measurements: [{ d: '2026-11-01', t: 1, waist: 81.28, chest: 101.6 }, { d: TODAY, t: 2, waist: 82.55 }] }
    expect(measurementsRow(state, { now: NOW })).toEqual({ title: 'Measurements', line: 'Waist 32.5 in · Nov 9', a11y: 'Measurements, Waist 32.5 in · Nov 9' })
  })

  test('no waist logged: the first offered field that has one; another year carries its year', () => {
    const state = { measurements: [{ d: '2025-12-31', t: 1, chest: 101.6, hips: 99.06 }] }
    expect(measurementsRow(state, { now: NOW }).line).toBe('Chest 40 in · Dec 31, 2025')
  })

  test('body fat alone (a disabled field with a reading) reads in percent', () => {
    expect(measurementsRow({ measurements: [{ d: TODAY, t: 1, bodyFat: 18.5 }] }, { now: NOW }).line).toBe('Body fat 18.5 % · Nov 9')
  })

  test('now is required', () => {
    expect(() => measurementsRow({}, {})).toThrow()
  })
})
