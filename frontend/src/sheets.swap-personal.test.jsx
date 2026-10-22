// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX } from './lib/exercises.js'
import { swapActiveWorkoutExercise } from './sheets.jsx'

const roots = []
const top = () => useUI.getState().sheets.at(-1)
const renderTop = () => {
  const sheet = top()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const rows = host => [...host.querySelectorAll('.list .item:not(.ex-new)')]
function choose() {
  const picker = top()
  act(() => picker.render(picker.close).props.onPick(EXIDX['0289']))
  const config = top()
  act(() => config.render(config.close).props.onSave({ mode: 'reps', sets: 2, reps: 10, weight: 22, dbLoad: 'each' }))
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  const S = structuredClone(DEF)
  S.routines = [{ id: 'push', name: 'Push', ex: [{ id: '0251', mode: 'reps', sets: 3, reps: 8, weight: 50 }] }]
  S.active = { id: 'session', d: '2026-10-21', cur: 0, entries: [{ id: '0251', rid: 'push', target: { mode: 'reps', sets: 3, reps: 8, weight: 50 }, equipmentSnapshot: { stationId: 'busy' }, sets: [{ w: 50, r: 8, done: false }] }] }
  S.equipProfiles = [{ id: 'gym', name: 'Gym', equipment: ['dumbbell', 'bench'], accV: 1, stations: [{ id: 'busy', label: 'Occupied station', exerciseIds: ['0251', '0576'] }, { id: 'free', label: 'Available station', exerciseIds: ['0577'] }] }]
  S.customEx = [{ id: 'cFree', n: 'Available press', bp: 'chest', tg: 'pectorals', eq: 'leverage machine', custom: true }]
  S.trainingMetadata = { cFree: { role: 'horizontal-press', primary: ['chest'], secondary: [] } }
  S.equipProfiles[0].stations[1].exerciseIds = ['cFree']
  S.activeEquipId = 'gym'
  S.equipFilterOn = true
  useStore.setState({ S, user: null })
})
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''
})
it('explains recommendations and temporarily excludes an occupied station while All keeps manual search', () => {
  swapActiveWorkoutExercise(0)
  const host = renderTop()
  expect(host.textContent).toContain('Same role and primary target')
  const occupied = host.querySelector('input[aria-label="Occupied station: Occupied station"]')
  expect(occupied).toBeTruthy()
  expect(rows(host).some(row => row.textContent.includes(EXIDX['0576'].n))).toBe(true)
  act(() => occupied.click())
  expect(rows(host).some(row => row.textContent.includes(EXIDX['0576'].n))).toBe(false)
  expect(rows(host).some(row => row.textContent.includes('Available press'))).toBe(true)
  expect(useStore.getState().S.equipProfiles[0].stations).toHaveLength(2)
  act(() => button(host, 'All').click())
  const search = host.querySelector('input.input')
  act(() => {
    Object.getOwnPropertyDescriptor(search.constructor.prototype, 'value').set.call(search, 'lever chest press')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(rows(host).some(row => row.textContent.includes(EXIDX['0576'].n))).toBe(true)
})
it('defaults to this workout, separately previews the future plan and accepts only the selected routine slot', () => {
  swapActiveWorkoutExercise(0)
  choose()
  const S = useStore.getState().S
  expect(S.active.entries[0].id).toBe('0289')
  expect(S.routines[0].ex[0].id).toBe('0251')
  const offer = renderTop()
  const update = button(offer, 'Update future plan…')
  expect(update).toBeTruthy()
  act(() => update.click())
  const preview = renderTop()
  expect(preview.textContent).toContain('Push')
  expect(preview.textContent).toContain(EXIDX['0251'].n)
  expect(preview.textContent).toContain(EXIDX['0289'].n)
  expect(preview.textContent).toContain('3 × 8')
  expect(preview.textContent).toContain('2 × 10')
  expect(preview.textContent).toContain('Dumbbell per hand')
  expect(useStore.getState().S.routines[0].ex[0].id).toBe('0251')
  act(() => button(preview, 'Update future plan').click())
  expect(useStore.getState().S.routines[0].ex[0]).toMatchObject({ id: '0289', reps: 10, sets: 2, dbLoad: 'each' })
})
it('cancelling the future preview retains the session swap without changing the routine or history', () => {
  swapActiveWorkoutExercise(0)
  choose()
  const offer = renderTop()
  expect(button(offer, 'Update future plan…')).toBeTruthy()
  act(() => button(offer, 'Update future plan…').click())
  const preview = renderTop()
  act(() => button(preview, 'Cancel').click())
  expect(useStore.getState().S.routines[0].ex[0].id).toBe('0251')
  expect(useStore.getState().S.active.entries[0].id).toBe('0289')
  expect(useStore.getState().S.workouts).toEqual([])
})
it('cancelling a swap after a completed limb leaves exercise, station and all logged work intact', () => {
  const S = structuredClone(useStore.getState().S)
  S.active.entries[0].sets = [{ done: false, sides: { L: { done: true, w: 23, r: 7, rir: 1 }, R: { done: false, w: 23, r: 7 } } }]
  const before = structuredClone(S)
  useStore.setState({ S, user: null })
  swapActiveWorkoutExercise(0)
  choose()
  expect(useStore.getState().S.active).toEqual(before.active)
  const confirm = renderTop()
  expect(button(confirm, 'Cancel')).toBeTruthy()
  act(() => button(confirm, 'Cancel').click())
  expect(useStore.getState().S.active).toEqual(before.active)
  expect(useStore.getState().S.routines).toEqual(before.routines)
})

it('carries ranking, occupied-station and future-plan controls into every locale', () => {
  const keys = ['Same role and primary target', 'Related role and primary target', 'Same muscle, different role', 'Training metadata unverified', 'Used in completed workouts', 'Temporarily exclude occupied stations', 'Applies to these suggestions only. All keeps manual search available.', 'Occupied station: {0}', 'Suggested replacements', 'Used in this workout', 'Your future plan is unchanged.', 'Update future plan…', 'Keep this workout only', 'Update future plan?', 'Only this routine slot changes. Logged workouts stay unchanged.', 'Update future plan', 'The routine changed. Reopen it to update this slot.']
  const packs = import.meta.glob('./locales/*.js', { eager: true, import: 'default' })
  for (const [path, pack] of Object.entries(packs)) for (const key of keys) expect(pack, path).toHaveProperty(key)
})
