// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal(), api: vi.fn() }))
import Home from '../views/Home.jsx'
import { useUI } from '../store/useUI.js'
import Plan from '../views/Plan.jsx'
import { freshState, useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { mergeStates, stampChange, resetIdsOf, sinceReset } from '../lib/sync-merge.js'

let root, host
const S = () => ({ ...freshState(), routines: [{ id: 'push', name: 'Push', ex: [{ id: '0047', sets: 4 }] }], week: { [new Date().getDay()]: 'push' }, workouts: [{ id: 'off', d: todayISO(), entries: [{ id: '0047', trainingSnapshot: { primary: ['chest'], secondary: ['triceps'], role: 'horizontal-press', status: 'manual' }, sets: [{ done: true }, { done: false }] }] }] })
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); useStore.setState({ S: S(), user: null }); localStorage.removeItem('gym_plan_view') })
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })
const render = View => act(() => root.render(<View />))
const card = () => host.querySelector('[aria-label="Training coverage"]')
const button = label => [...card().querySelectorAll('button')].find(b => b.textContent === label)
it.each([['Plan', Plan]])('renders actual vs planned coverage in the real %s view', (_, View) => {
  render(View)
  expect(card()).not.toBeNull()
  const chest = [...card().querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Chest'))
  expect(chest.textContent).toContain('Completed: 1 estimated sets')
  expect(chest.textContent).toContain('Planned: 4 estimated sets')
  expect(chest.textContent).toContain('Direct sets: 1')
  expect(chest.textContent).toContain('Direct-work days: 1')
  expect(card().textContent).toContain('A set where a muscle only helps counts as half a set.')
  expect(card().textContent).not.toContain('stimulus adequacy')
  // the rolling view carries no method note
  expect(card().textContent).not.toContain('dated prescriptions')
  // plain words for the row and the sections, and no list of zero unknowns
  expect(chest.querySelector('summary').textContent).toContain('1 of 4 planned sets done')
  expect(card().textContent).toContain('By movement')
  expect(card().textContent).not.toContain('Unknown / unclassified')
  expect(card().textContent).not.toContain('Sets that could not be counted')
  expect(card().textContent).toContain('Set your aims')
})
it('switches to accepted-cycle context without giving floating sessions an invented direct day', () => {
  const s = S(); s.queue = { ids: ['push'], since: Date.now() - 86400000, startsOn: todayISO(), label: 'PPL' }
  useStore.setState({ S: s }); render(Plan)
  act(() => button('Accepted cycle').click())
  expect(card().textContent).toContain('PPL')
  expect(card().textContent).toContain('Undated planned sets: 4')
  expect(card().textContent).toContain('Frequency gap unknown for undated plans.')
})
it('edits day and set aims through the real store and survives backup restore', () => {
  render(Plan)
  const input = (label, value) => {
    const el = card().querySelector(`[aria-label="${label}"]`)
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  input('Direct-work day aim', '3'); input('Estimated set aim (optional)', '8')
  act(() => card().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
  expect(saved.coverageTargets.chest).toMatchObject({ directDays: 3, sets: 8, _ts: expect.any(Number) })
  expect(card().textContent).toContain('Direct-day gap to aim: 2')
  act(() => useStore.getState().importBackup(saved))
  expect(useStore.getState().S.coverageTargets.chest.sets).toBe(8)
})
it('merges independent muscle aims and reset removes them', () => {
  const base = { ...freshState(), coverageTargets: {}, _ts: 1 }
  const a = structuredClone(base), b = structuredClone(base)
  a.coverageTargets.chest = { directDays: 3, sets: 8, _ts: 10 }
  b.coverageTargets.triceps = { directDays: 1, sets: null, _ts: 20 }
  stampChange(base, a, 10); stampChange(base, b, 20)
  const merged = mergeStates(a, b)
  expect(merged.coverageTargets).toMatchObject({ chest: { directDays: 3 }, triceps: { directDays: 1 } })
  expect(sinceReset(merged, 30, resetIdsOf(merged)).coverageTargets).toEqual({})
  act(() => { useStore.setState({ S: merged }); useStore.getState().resetEverything() })
  expect(useStore.getState().S.coverageTargets).toEqual({})
})
it('shows partial limbs and unclassified records without awarding completed sets', () => {
  const s = S(); s.workouts[0].entries = [{ id: 'mystery', trainingSnapshot: { primary: [], secondary: [], role: null, status: 'unknown' }, sets: [{ done: true }, { done: false, sides: { L: { done: true }, R: { done: false } } }] }]
  useStore.setState({ S: s }); render(Plan)
  expect(card().textContent).toContain('Partially completed limb rows: 1')
  expect(card().textContent).toContain('Sets with unknown targets: 1')
  expect(card().textContent).toContain('Sets with unknown role: 1')
})
it('opening the muscle picker does not save an aim before the explicit Save action', () => {
  render(Plan)
  const picker = card().querySelector('.coverage-targets .lrow')
  act(() => picker.click())
  expect(useStore.getState().S.coverageTargets.chest).toBeUndefined()
})
// Home shows a glance and opens the full report in a sheet.
it('Home shows one bar per muscle and opens the full report, aims editor included, in a sheet', () => {
  useUI.setState({ sheets: [] })
  render(Home)
  const glance = host.querySelector('.coverage-glance')
  expect(glance).not.toBeNull()
  expect(glance.querySelector('details')).toBeNull()
  const bar = name => [...glance.querySelectorAll('.coverage-bar')].find(b => b.querySelector('.coverage-bar-n').textContent === name)
  expect(bar('Chest').querySelector('.coverage-bar-v').textContent).toBe('1 / 4')
  expect(bar('Triceps').querySelector('.coverage-bar-v').textContent).toBe('0.5 / 2')
  act(() => glance.click())
  const sheets = useUI.getState().sheets
  expect(sheets.length).toBe(1)
  act(() => root.render(<>{sheets[0].render(() => {})}</>))
  expect(card().textContent).toContain('Planned: 4 estimated sets')
  expect(card().textContent).toContain('A set where a muscle only helps counts as half a set.')
  expect(card().querySelector('.coverage-targets')).not.toBeNull()
  useUI.setState({ sheets: [] })
})
it('Home leaves the glance out when nothing was done or planned in the last 7 days', () => {
  useStore.setState({ S: { ...freshState(), routines: [], week: {}, workouts: [] } })
  render(Home)
  expect(host.querySelector('.coverage-glance')).toBeNull()
})

describe('coverage unknowns', () => {
  it('lists only the non-zero lines, and nothing when all are zero', async () => {
    const { unknownLines, hasUnknowns } = await import('./TrainingCoverage.jsx')
    expect(unknownLines({ targetSets: 0, roleSets: 2, dateSessions: 1 })).toEqual([['Sets with unknown role: {0}', 2], ['Sessions without known dates: {0}', 1]])
    expect(hasUnknowns({ actual: { roleSets: 0 }, planned: {} })).toBe(false)
    expect(hasUnknowns({ actual: {}, planned: { partialRows: 1 } })).toBe(true)
  })
})
