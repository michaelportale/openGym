// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, it, expect } from 'vitest'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX } from './lib/exercises.js'
import { bindUI } from './components/ui.jsx'
import { equipmentProfileSheet, exConfigSheet, customExSheet, exerciseDetailSheet } from './sheets.jsx'
import { buildSessionEntries } from './lib/session-start.js'
bindUI(useUI)
const roots = []
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1), host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const click = (host, text) => act(() => {
  const el = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  expect(el, text).toBeTruthy(); el.click()
})
function pick(host, title, value) {
  act(() => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(title)).click())
  const sub = renderTop()
  act(() => [...sub.querySelectorAll('.lrow')].find(r => r.textContent.trim() === value).click())
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; useUI.setState({ sheets: [] }); useStore.setState({ S: structuredClone(DEF), user: null }); document.body.innerHTML = '' })
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())); localStorage.clear() })
it('adds an exact station, assigns supported exercises and uses it in a routine entry', () => {
  equipmentProfileSheet(null)
  const host = renderTop()
  act(() => type(host.querySelector('input'), 'Synthetic gym'))
  click(host, 'Add station')
  act(() => type(host.querySelector('[aria-label="Station name"]'), 'Press A'))
  act(() => type(host.querySelector('[aria-label="Manufacturer"]'), 'Example'))
  act(() => type(host.querySelector('[aria-label="Model"]'), 'One'))
  pick(host, 'Load convention', 'Plate-loaded per side')
  click(host, 'Add supported exercise')
  const picker = renderTop()
  act(() => type(picker.querySelector('.search input'), 'lever chest press'))
  act(() => picker.querySelector('.item:not(.ex-new) button').click())
  click(host, 'Save')
  const profile = useStore.getState().S.equipProfiles[0]
  expect(profile.stations[0]).toMatchObject({ label: 'Press A', manufacturer: 'Example', model: 'One', exerciseIds: ['0576'], loadConvention: 'plate-per-side' })
  let cfg
  exConfigSheet(EXIDX['0576'], { sets: 1, reps: 8, weight: 20, prog: 'off' }, c => { cfg = c })
  const config = renderTop()
  pick(config, 'Equipment station', 'Press A')
  click(config, 'Save')
  expect(cfg.stationId).toBe(profile.stations[0].id)
  const entry = buildSessionEntries(useStore.getState().S, { id: 'push', ex: [{ id: '0576', ...cfg }] })[0]
  expect(entry.equipmentSnapshot).toMatchObject({ label: 'Press A', loadConvention: 'plate-per-side', unit: 'kg', status: 'exact' })
})
it('allows a manual role override for catalogue and custom exercises', () => {
  exerciseDetailSheet(EXIDX['0289'])
  const detail = renderTop()
  pick(detail, 'Movement role', 'Chest isolation')
  expect(useStore.getState().S.trainingMetadata['0289']).toMatchObject({ role: 'chest-isolation', primary: ['chest'] })
  customExSheet({ id: 'c1', n: 'Synthetic press', bp: 'chest', eq: 'dumbbell', custom: true, primaries: ['chest'] })
  useStore.setState(s => ({ S: { ...s.S, customEx: [{ id: 'c1', n: 'Synthetic press', bp: 'chest', eq: 'dumbbell', custom: true, primaries: ['chest'] }] } }))
  const custom = renderTop()
  pick(custom, 'Movement role', 'Horizontal press')
  click(custom, 'Save')
  expect(useStore.getState().S.trainingMetadata.c1).toMatchObject({ role: 'horizontal-press', primary: ['chest'], secondary: [] })
})
it('keeps station selection fixed after work is logged', () => {
  exConfigSheet(EXIDX['0576'], { sets: 1, reps: 8, weight: 20, stationId: 'old' }, () => {}, null, null, null, null, null, true)
  const host = renderTop()
  expect(host.textContent).not.toContain('Equipment station')
  expect(host.textContent).toContain('Equipment identity stays with logged sets. Swap exercise to use another station.')
})
