// @vitest-environment happy-dom
// The Exercises tab's filters: one chip row of body parts with a Filters
// chip at its start; type and equipment live in a sheet that applies each tap at once.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Library from './Library.jsx'
import { EXDB } from '../lib/exercises.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
const topSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const chip = (host, text) => [...host.querySelectorAll('.chip')].find(b => b.textContent.trim() === text)
const count = host => Number(host.querySelector('.search .search-count')?.textContent.replace(/\D/g, ''))

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Exercises filters', () => {
  it('shows one chip row, led by Filters, with no type or equipment rows on the tab', () => {
    const host = mount(<MemoryRouter><Library /></MemoryRouter>)
    const strips = host.querySelectorAll('.chips')
    expect(strips.length).toBe(1)
    expect(strips[0].firstElementChild.textContent.trim()).toBe('Filters')
    expect(chip(host, 'Any type')).toBeUndefined()
    expect(chip(host, 'Any equipment')).toBeUndefined()
  })

  it('opens a sheet with Type and Equipment; a tap filters the list behind it at once', () => {
    const host = mount(<MemoryRouter><Library /></MemoryRouter>)
    act(() => host.querySelector('.chip.lib-filters').click())
    expect(useUI.getState().sheets.length).toBe(1)
    const sheet = topSheet()
    expect([...sheet.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Type', 'Equipment'])
    expect(chip(sheet, 'Any type').getAttribute('aria-pressed')).toBe('true')
    act(() => chip(sheet, 'dumbbell').click())
    expect(chip(sheet, 'dumbbell').getAttribute('aria-pressed')).toBe('true')
    expect(count(host)).toBe(EXDB.filter(e => e.eq === 'dumbbell').length)
    expect(sheet.querySelector('.lib-filter-count').textContent).toBe(`${count(host)} exercises`)
    const f = host.querySelector('.chip.lib-filters')
    expect(f.classList.contains('on')).toBe(true)
    expect(f.textContent.trim()).toBe('dumbbell')
    expect(f.getAttribute('aria-label')).toBe('Filters: dumbbell')
  })

  it('combines type and equipment, and Reset clears both', () => {
    const host = mount(<MemoryRouter><Library /></MemoryRouter>)
    act(() => host.querySelector('.chip.lib-filters').click())
    const sheet = topSheet()
    act(() => chip(sheet, 'strength').click())
    act(() => chip(sheet, 'dumbbell').click())
    expect(count(host)).toBe(EXDB.filter(e => e.eq === 'dumbbell' && e.cat === 'strength').length)
    expect(host.querySelector('.chip.lib-filters').textContent.trim()).toBe('strength · dumbbell')
    const reset = [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reset')
    act(() => reset.click())
    expect(host.querySelector('.chip.lib-filters').classList.contains('on')).toBe(false)
    expect(host.querySelector('.search .search-count')).toBeNull()
  })

  it('keeps the body-part chips working beside it', () => {
    const host = mount(<MemoryRouter><Library /></MemoryRouter>)
    act(() => chip(host, 'neck').click())
    expect(count(host)).toBe(EXDB.filter(e => e.bp === 'neck').length)
  })
})
