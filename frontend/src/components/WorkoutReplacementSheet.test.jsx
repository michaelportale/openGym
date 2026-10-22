// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkoutReplacementSheet, { replacementNeedsLoadReview } from './WorkoutReplacementSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { swapActiveWorkoutExercise } from '../sheets.jsx'

const roots = []
const top = () => useUI.getState().sheets.at(-1)
function render(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(element))
  return host
}
const renderTop = () => { const sheet = top(); return render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) }
const click = (host, text) => act(() => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === text).click())
const labels = { 'machine-setting': 'Machine setting', 'barbell-total': 'Barbell total' }
function selectBarbell(overrides = {}) {
  act(() => swapActiveWorkoutExercise(0))
  const picker = top()
  act(() => picker.render(picker.close).props.onPick(EXIDX['0025']))
  const config = top()
  act(() => config.render(config.close).props.onSave({ mode: 'reps', sets: 2, reps: 8, weight: 40, ...overrides }))
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const S = structuredClone(DEF)
  S.active = { id: 'replacement-test', d: '2026-10-22', cur: 0, entries: [{ id: '0576', target: { mode: 'reps', sets: 2, reps: 8, weight: 7 }, equipmentSnapshot: { stationId: 'machine', label: 'Seated press', loadConvention: 'machine-setting', unit: null, status: 'exact' }, sets: [{ w: 7, r: 8, done: false }] }] }
  S.equipProfiles = [{ id: 'gym', name: 'Gym', equipment: ['barbell', 'bench'], accV: 1, stations: [{ id: 'rack', label: 'Rack A', loadConvention: 'barbell-total', exerciseIds: ['0025'] }] }]
  S.activeEquipId = 'gym'
  S.equipFilterOn = true
  useStore.setState({ S, user: null })
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''
})

it('passes the explicitly displayed station into the canonical configuration sheet', () => {
  const onPick = vi.fn()
  const S = useStore.getState().S
  const host = render(<WorkoutReplacementSheet onPick={onPick} like={EXIDX['0576']} entry={S.active.entries[0]} loadLabels={labels} />)
  const row = [...host.querySelectorAll('.replacement-option')].find(button => button.textContent.includes('Rack A'))
  expect(row.textContent).toContain('Barbell total')
  expect(row.textContent).toContain('Same role and primary target')
  expect(row.textContent).toContain('Review starting load')
  act(() => row.click())
  expect(onPick).toHaveBeenCalledWith(EXIDX['0025'], false, expect.objectContaining({ stationId: 'rack' }))
})

it('reviews actual built loads before a machine-setting to mass swap, with edit and cancel leaving state untouched', () => {
  const before = structuredClone(useStore.getState().S.active)
  selectBarbell()
  expect(useStore.getState().S.active).toEqual(before)
  const host = renderTop()
  expect(host.textContent).toContain('Machine setting → Barbell total')
  expect(host.querySelector('.replacement-starting-sets').textContent).toContain('40×8 kg')
  click(host, 'Edit settings')
  const config = top()
  expect(config.render(config.close).props.initial.weight).toBe(40)
  act(() => useUI.getState().closeSheet(config.id))
  expect(useStore.getState().S.active).toEqual(before)
})

it.each(['freestyle', 'planned', 'off', 'excluded'])('honors explicit starting loads, including zero, after reviewing comparable %s history', session => {
  const cfg = { mode: 'reps', sets: 2, reps: 8, weight: 40, stationId: 'rack' }
  act(() => useStore.getState().update(S => {
    if (session !== 'freestyle') {
      S.routines = [{ id: 'push', name: 'Push', prog: session === 'off' ? 'off' : 'linear', excludeFromProgression: session === 'excluded', ex: [{ id: '0576', ...S.active.entries[0].target }] }]
      S.active.entries[0].rid = 'push'
      if (session === 'excluded') S.active.entries[0].noProg = true
    }
    S.workouts = [{ id: 'prior', d: '2026-10-20', entries: [{
      id: '0025', ...(session !== 'freestyle' ? { rid: 'push' } : {}),
      target: { ...cfg, weight: 80 }, planned: { ...cfg },
      equipmentSnapshot: { stationId: 'rack', label: 'Rack A', loadConvention: 'barbell-total', unit: 'kg', status: 'exact' },
      sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: true }],
    }] }]
  }))
  const before = structuredClone(useStore.getState().S)
  selectBarbell(cfg)
  let review = renderTop()
  // The first review still receives the ordinary history/progression suggestion.
  const seededWeight = session === 'planned' ? 82.5 : session === 'freestyle' ? 80 : 40
  expect(review.querySelector('.replacement-starting-sets').textContent).toContain(`${seededWeight}×8 kg`)
  click(review, 'Edit settings')
  let config = top()
  act(() => config.render(config.close).props.onSave({ ...cfg, weight: 30 }))
  review = renderTop()
  expect(review.querySelector('.replacement-starting-sets').textContent).toContain('30×8 kg')
  expect(useStore.getState().S.active).toEqual(before.active)

  click(review, 'Edit settings')
  config = top()
  act(() => config.render(config.close).props.onSave({ ...cfg, weight: 0, reps: 10, sets: 1 }))
  review = renderTop()
  expect(review.querySelector('.replacement-starting-sets').textContent).toContain('0×10 kg')
  expect(review.querySelectorAll('.replacement-starting-sets li')).toHaveLength(1)
  click(review, 'Use in this workout')
  const S = useStore.getState().S
  expect(S.active.entries[0]).toMatchObject({
    id: '0025', target: { weight: 0, reps: 10, sets: 1, stationId: 'rack' },
    sets: [{ w: 0, r: 10, done: false }],
  })
  if (session === 'freestyle') expect(S.active.entries[0].plan).toBeNull()
  else expect(S.active.entries[0]).toMatchObject({ rid: 'push', plan: { policy: session === 'planned' ? 'linear' : 'off', kind: session === 'planned' ? 'hold' : 'off' } })
  if (session === 'excluded') expect(S.active.entries[0].noProg).toBe(true)
  expect(S.workouts).toEqual(before.workouts)
  expect(S.routines).toEqual(before.routines)
})

it('keeps logged identity and final effort, then applies the explicit group choice only once', () => {
  act(() => useStore.getState().update(S => { S.active.entries[0].sg = 'pair'; S.active.entries[0].sets[0] = { w: 7, r: 8, done: true, rir: 2 } }))
  const original = structuredClone(useStore.getState().S.active.entries[0])
  selectBarbell()
  click(renderTop(), 'Use in this workout')
  const group = renderTop()
  click(group, 'Keep replacement in this group')
  const S = useStore.getState().S
  expect(S.active.entries).toHaveLength(2)
  expect(S.active.entries[0]).toEqual(original)
  expect(S.active.entries[1]).toMatchObject({ id: '0025', sg: 'pair', equipmentSnapshot: { loadConvention: 'barbell-total' } })
  expect(S.active.entries[1].sets.every(set => set.rir == null)).toBe(true)
  click(group, 'Keep replacement in this group')
  expect(useStore.getState().S.active.entries).toHaveLength(2)
})

it('rejects a stale review after the source workout changes without overwriting new work', () => {
  selectBarbell()
  const review = renderTop()
  act(() => useStore.getState().update(S => { S.active.entries[0].sets[0].r = 9 }))
  click(review, 'Use in this workout')
  expect(useStore.getState().S.active.entries[0]).toMatchObject({ id: '0576', sets: [{ r: 9 }] })
  expect(useUI.getState().toastMsg).toBe('Workout changed. Reopen the replacement sheet.')
})

it('requires review for unknown or changed identity and permits matching load identity', () => {
  const entry = { id: '0025', target: { mode: 'reps' }, equipmentSnapshot: { stationId: 'rack', loadConvention: 'barbell-total' } }
  expect(replacementNeedsLoadReview(entry, entry)).toBeFalsy()
  expect(replacementNeedsLoadReview(entry, { ...entry, equipmentSnapshot: { loadConvention: 'barbell-total' } })).toBeTruthy()
  expect(replacementNeedsLoadReview(entry, { ...entry, equipmentSnapshot: {} })).toBeTruthy()
})
