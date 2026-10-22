// @vitest-environment happy-dom
// #473: a swap opens on what trains the same muscle. Mid-workout (Swap exercise) and in the
// routine editor (Replace exercise) the picker starts on the exercises sharing the swapped one's
// target muscles, with role/familiarity ranking, and "All" returns to the whole list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB } from './lib/exercises.js'
import { exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { sameMuscleFirst } from './lib/similar-exercises.js'

const mounted = []
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const chips = host => [...host.querySelectorAll('.chips .chip')]
const chipByText = (host, text) => chips(host).find(b => b.textContent.trim() === text)
const sameChip = host => chips(host).find(b => b.textContent.trim().startsWith('Same muscle'))
const isOn = el => el.className.split(/\s+/).includes('on')
const rows = host => [...host.querySelectorAll('.list .item:not(.ex-new)')].map(r => r.querySelector('.ss').textContent)

// A cable triceps exercise: the catalogue has plenty of other triceps work, on cables and off.
const CABLE_TRI = EXDB.find(e => e.tg === 'triceps' && e.eq === 'cable')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('sameMuscleFirst', () => {
  it('keeps the same target muscle, drops the exercise itself, same equipment first, order kept otherwise', () => {
    const ex = { id: 'x', tg: 'triceps', eq: 'cable' }
    const list = [
      { id: 'a', tg: 'triceps', eq: 'dumbbell' },
      { id: 'x', tg: 'triceps', eq: 'cable' },
      { id: 'b', tg: 'biceps', eq: 'cable' },
      { id: 'c', tg: 'triceps', eq: 'cable' },
      { id: 'd', tg: 'triceps', eq: 'barbell' },
      { id: 'e', tg: 'triceps', eq: 'cable' }
    ]
    expect(sameMuscleFirst(list, ex).map(e => e.id)).toEqual(['c', 'e', 'a', 'd'])
    expect(sameMuscleFirst(list, { id: 'y' })).toEqual([])
  })
})

describe('swap picker opens on the same muscle', () => {
  it('mid-workout: Swap exercise starts on the target muscle, explained suggestions first, All goes back', () => {
    expect(CABLE_TRI).toBeTruthy()
    const S = structuredClone(DEF)
    S.active = {
      id: 'w', d: '2026-10-08', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ id: CABLE_TRI.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
    }
    useStore.setState({ S, user: null })
    swapActiveWorkoutExercise(0)
    const host = renderTop()

    const chip = chipByText(host, 'Suggested replacements')
    expect(isOn(chip)).toBe(true)
    expect(isOn(chipByText(host, 'All'))).toBe(false)
    const names = () => [...host.querySelectorAll('.replacement-name')].map(row => row.textContent)
    expect(names().length).toBeGreaterThan(1)
    const suggested = names()
    expect(names()).not.toContain(CABLE_TRI.n)
    expect(host.textContent).toContain('Training metadata unverified')
    act(() => chipByText(host, 'All').click())
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(names()).not.toEqual(suggested)
    act(() => chipByText(host, 'Suggested replacements').click())
    expect(names()).toEqual(suggested)
  })

  // The routine editor hands its slot's exercise in (views/RoutineEdit.replace.test.jsx).
  it('routine editor: a picker told what it replaces opens on that muscle', () => {
    const pick = vi.fn()
    exercisePicker(pick, { title: 'Replace exercise', like: CABLE_TRI.id })
    const host = renderTop()
    expect(isOn(sameChip(host))).toBe(true)
    expect(rows(host).some(s => s.startsWith('Triceps'))).toBe(true)
    expect(host.textContent).toContain('Training metadata unverified')
  })

  it('keeps occupied stations out of searched suggestions and restores them only in All', () => {
    const S = structuredClone(DEF)
    S.equipProfiles = [{ id: 'gym', name: 'Gym', accV: 1, equipment: [], stations: [{ id: 'occupied', label: 'Cable stack', exerciseIds: ['0241'] }] }]
    S.activeEquipId = 'gym'
    S.equipFilterOn = true
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: CABLE_TRI.id })
    const host = renderTop()
    const occupied = host.querySelector('input[aria-label="Occupied station: Cable stack"]')
    expect(occupied).toBeTruthy()
    act(() => occupied.click())
    const search = host.querySelector('input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(search.constructor.prototype, 'value').set.call(search, 'cable triceps pushdown')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const names = () => [...host.querySelectorAll('.list .item .tt')].map(el => el.textContent)
    expect(isOn(sameChip(host))).toBe(true)
    expect(names()).not.toContain('cable triceps pushdown (v-bar)')
    act(() => chipByText(host, 'All').click())
    expect(names()).toContain('cable triceps pushdown (v-bar)')
  })

  it('an add opens on the whole list, with no same-muscle chip', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(sameChip(host)).toBeUndefined()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
  })

  it('opens on All when nothing else trains that muscle, so a swap never starts on an empty list', () => {
    const S = structuredClone(DEF)
    // Every catalogue muscle has body-weight work, which no equipment profile hides, so the empty
    // case is one of your own exercises on a muscle nothing else names.
    S.customEx = [{ id: 'cOnly', n: 'My odd lift', bp: 'neck', tg: 'nothing-else', eq: 'body weight', custom: true }]
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: 'cOnly' })
    const host = renderTop()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(sameChip(host)).toBeUndefined()
  })
})
