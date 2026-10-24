// @vitest-environment happy-dom
// The Nutrition screen: logging a day needs all five totals, supplements start empty and are the
// profile's own, and the week card averages the logged days against targets the profile set.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Nutrition, { nutritionLogSheet, nutritionSettingsSheet } from './Nutrition.jsx'
import Stats from './Stats.jsx'

const NOW = new Date('2026-10-21T12:00:00').getTime()   // a Wednesday; weeks start on Monday
const clone = v => JSON.parse(JSON.stringify(v))
let roots = []
function mount(el) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push([root, host])
  act(() => root.render(el))
  return host
}
const screen = (path = '/nutrition') => mount(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/nutrition" element={<Nutrition />} /><Route path="/stats" element={<Stats />} />
</Routes></MemoryRouter>)
const topSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const field = (host, label) => host.querySelector(`input[aria-label="${label}"]`)
const tile = (host, id) => host.querySelector(`[data-tile="${id}"]`)
const day = (kcal, protein, fiber, dayType = 'training') => ({ kcal, protein, carbs: 200, fat: 70, fiber, dayType, _ts: 1 })

function install(extra = {}) {
  const st = clone(DEF)
  Object.assign(st, { workouts: [], bodyweight: [], unit: 'kg', weekStart: 1 }, extra)
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: null })
})
afterEach(() => {
  for (const [root, host] of roots) { act(() => root.unmount()); host.remove() }
  roots = []
  vi.useRealTimers()
})

describe('Nutrition screen', () => {
  it('starts empty: no supplements, no targets, nothing logged', () => {
    install()
    const el = screen()
    expect(el.textContent).toContain('Nothing logged today yet.')
    expect(el.textContent).toContain("Your week's averages show here once you log a day.")
    expect(el.querySelectorAll('.nutri-check').length).toBe(0)
    expect(button(el, 'Add supplements')).toBeTruthy()
    expect(el.textContent).toContain('Days you log show here, newest first.')
    expect(useStore.getState().S.supplements).toEqual([])
    expect(useStore.getState().S.nutritionTargets).toEqual({})
  })

  it('will not save a day until all five totals are filled in', () => {
    install()
    act(() => { nutritionLogSheet('2026-10-21') })
    const sheet = topSheet()
    act(() => type(field(sheet, 'Calories'), '2000'))
    act(() => type(field(sheet, 'Protein'), '150'))
    act(() => type(field(sheet, 'Carbs'), '200'))
    act(() => type(field(sheet, 'Fat'), '70'))
    act(() => button(sheet, 'Save').click())
    expect(useStore.getState().S.nutritionDays).toEqual({})
    expect(useUI.getState().toastMsg).toBe('Fill in all five totals.')

    act(() => type(field(sheet, 'Fiber'), '30'))
    act(() => button(sheet, 'Save').click())
    const saved = useStore.getState().S.nutritionDays['2026-10-21']
    expect(saved).toMatchObject({ kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30, dayType: 'rest' })
    expect(typeof saved._ts).toBe('number')
  })

  it('guesses a training day when a workout is logged that day', () => {
    install({ workouts: [{ id: 'w1', d: '2026-10-21', ex: [] }] })
    act(() => { nutritionLogSheet('2026-10-21') })
    const sheet = topSheet()
    for (const [k, v] of [['Calories', '2000'], ['Protein', '150'], ['Carbs', '200'], ['Fat', '70'], ['Fiber', '30']]) act(() => type(field(sheet, k), v))
    act(() => button(sheet, 'Save').click())
    expect(useStore.getState().S.nutritionDays['2026-10-21'].dayType).toBe('training')
  })

  it('adds a supplement from the settings sheet and ticks it for today', () => {
    install()
    act(() => { nutritionSettingsSheet() })
    const sheet = topSheet()
    act(() => type(sheet.querySelector('input[aria-label="Supplement name"]'), 'Vitamin D'))
    act(() => button(sheet, 'Add').click())
    const list = useStore.getState().S.supplements
    expect(list.map(x => x.name)).toEqual(['Vitamin D'])

    const el = screen()
    const check = el.querySelector('.nutri-check [role="checkbox"]')
    expect(check.getAttribute('aria-checked')).toBe('false')
    act(() => check.click())
    expect(useStore.getState().S.nutritionDays['2026-10-21'].supps).toEqual([list[0].id])
    expect(el.querySelector('.nutri-check [role="checkbox"]').getAttribute('aria-checked')).toBe('true')
  })

  it('sets targets per day type, empty until the profile fills them', () => {
    install()
    act(() => { nutritionSettingsSheet() })
    const sheet = topSheet()
    const protein = field(sheet, 'Training day · Protein')
    expect(protein.value).toBe('')
    act(() => type(protein, '140'))
    expect(useStore.getState().S.nutritionTargets).toMatchObject({ training: { protein: 140 } })
    expect(field(sheet, 'Rest day · Protein').value).toBe('')
  })

  it('says when a week has no target set', () => {
    install({ nutritionDays: { '2026-10-19': day(2400, 150, 30) } })
    const el = screen()
    expect(tile(el, 'kcal').textContent).toContain('No target set')
    expect(tile(el, 'protein-hit').textContent).toContain('Set a protein target to count this')
  })

  it('averages the week against targets and counts days that reached protein', () => {
    install({
      nutritionTargets: { training: { kcal: 2400, protein: 140, fiber: 30 }, rest: { kcal: 2000, protein: 140, fiber: 30 } },
      nutritionDays: { '2026-10-19': day(2400, 150, 30), '2026-10-20': day(2000, 130, 20, 'rest'), '2026-10-12': day(1000, 50, 10) },
      bodyweight: [
        { d: '2026-10-13', t: 1, w: 81 }, { d: '2026-10-15', t: 2, w: 81 },
        { d: '2026-10-19', t: 3, w: 80 }, { d: '2026-10-20', t: 4, w: 80 },
      ],
    })
    const el = screen()
    expect(tile(el, 'logged').textContent).toContain('2/7')
    expect(tile(el, 'kcal').textContent).toContain('2,200 kcal')
    expect(tile(el, 'kcal').textContent).toContain('Target 2,200 kcal')
    expect(tile(el, 'protein').textContent).toContain('140 g')
    expect(tile(el, 'protein-hit').textContent).toContain('1/2')
    expect(tile(el, 'weight').textContent).toContain('80 kg')
    expect(tile(el, 'weight').textContent).toContain('−1 kg vs last week')

    act(() => el.querySelector('button[aria-label="Previous week"]').click())
    expect(el.textContent).toContain('Week of')
    expect(tile(el, 'logged').textContent).toContain('1/7')
    expect(tile(el, 'kcal').textContent).toContain('1,000 kcal')
    expect(tile(el, 'weight').textContent).toContain('No weigh-in last week to compare')
  })

  it('is reached from a card on Stats', () => {
    install({ nutritionDays: { '2026-10-20': day(2000, 150, 30) } })
    const el = screen('/stats')
    const card = el.querySelector('.nutri-card')
    expect(card.textContent).toContain('Nutrition')
    expect(card.textContent).toContain('Last logged')
    act(() => button(card, 'Open').click())
    expect(el.querySelector('.nutri-today')).toBeTruthy()
  })
})
