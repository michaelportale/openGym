// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Modals from './Modals.jsx'
import Toast from './Toast.jsx'
import { openWorkoutMediaViewer } from './WorkoutMedia.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'

let root, host
const visibleStatuses = () => [...host.querySelectorAll('[role="status"]')]
  .filter(node => !node.closest('[inert], [aria-hidden="true"]'))
const topDialog = () => host.querySelector('#modal-root').lastElementChild.querySelector('[role="dialog"]')
const openValidation = kind => useUI.getState().openSheet(() => <><h3>Log body weight</h3>
  <button onClick={() => useUI.getState().toast('Enter a valid weight')}>Save</button></>, { kind })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.spyOn(history, 'pushState').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  useStore.setState({ S: structuredClone(DEF), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<><main><button>Workout</button></main><aside id="timer"><button>Skip rest</button></aside><Modals /><Toast /></>))
})
afterEach(() => {
  act(() => { useUI.getState().closeAll(); root.unmount() })
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each(['sheet', 'center'])('announces validation inside an open %s while its background stays isolated', kind => {
  act(() => openValidation(kind))
  const dialog = topDialog()
  const save = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Save')
  act(() => save.click())

  expect(useUI.getState().sheets).toHaveLength(1)
  const statuses = visibleStatuses()
  expect(statuses).toHaveLength(1)
  expect(statuses[0].textContent).toBe('Enter a valid weight')
  expect(dialog.contains(statuses[0])).toBe(true)
  expect(host.querySelector('main').hasAttribute('inert')).toBe(true)
  expect(host.querySelector('#timer').getAttribute('aria-hidden')).toBe('true')
  expect(host.querySelector('#toast').getAttribute('aria-hidden')).toBe('true')
})

it('keeps only the top dialog status exposed and restores the page status when the stack closes', () => {
  act(() => openValidation('sheet'))
  act(() => openValidation('center'))
  act(() => useUI.getState().toast('Give it a name'))
  expect(visibleStatuses()).toHaveLength(1)
  expect(topDialog().contains(visibleStatuses()[0])).toBe(true)
  expect(visibleStatuses()[0].textContent).toBe('Give it a name')

  act(() => useUI.getState().closeSheet(useUI.getState().sheets.at(-1).id))
  expect(visibleStatuses()).toHaveLength(1)
  expect(topDialog().contains(visibleStatuses()[0])).toBe(true)
  act(() => useUI.getState().closeAll())
  expect(visibleStatuses()).toEqual([host.querySelector('#toast')])
  expect(host.querySelector('main').hasAttribute('inert')).toBe(false)
})

it('keeps status feedback inside the photo viewer modal too', async () => {
  const workout = { id: 'status-viewer', d: '2026-10-22', entries: [], media: [{
    kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1,
  }] }
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [workout] } })
  await act(async () => openWorkoutMediaViewer(workout))
  act(() => useUI.getState().toast('Could not create the file'))
  expect(visibleStatuses()).toHaveLength(1)
  expect(topDialog().contains(visibleStatuses()[0])).toBe(true)
  expect(visibleStatuses()[0].textContent).toBe('Could not create the file')
})
