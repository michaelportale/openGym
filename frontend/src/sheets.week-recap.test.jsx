// @vitest-environment happy-dom
// "Your week" opens the share sheet with the week's own heading and muscle-map wording.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { todayISO } from './lib/format.js'
import { weekRecapSheet } from './sheets.jsx'

let host, root, originalS
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  originalS = useStore.getState().S
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ S: originalS }) })

describe('weekRecapSheet', () => {
  it('opens a share sheet headed "Your week" with the week\'s muscle-map switch', async () => {
    const d = todayISO()
    useStore.setState({ S: { ...originalS, unit: 'kg', workouts: [{ id: 'w', d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }] }], prs: [] }] } })
    let render = null
    const prev = useUI.getState().openSheet
    useUI.setState({ openSheet: r => { render = r } })
    try { weekRecapSheet() } finally { useUI.setState({ openSheet: prev }) }
    expect(render).toBeTypeOf('function')
    await act(async () => root.render(render(() => {})))
    expect(host.querySelector('h3').textContent).toBe('Your week')
    expect(host.textContent).toContain('Show which muscles this week trained.')
  })

  it('offers the body-weight line as a switch that starts off, and only with weigh-ins', async () => {
    const d = todayISO()
    const wo = { id: 'w', d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }] }], prs: [] }
    const open = async S => {
      useStore.setState({ S: { ...originalS, unit: 'kg', workouts: [wo], ...S } })
      let render = null
      const prev = useUI.getState().openSheet
      useUI.setState({ openSheet: r => { render = r } })
      try { weekRecapSheet() } finally { useUI.setState({ openSheet: prev }) }
      await act(async () => root.render(render(() => {})))
    }
    await open({ bodyweight: [] })
    expect(host.querySelector('[aria-label="Body weight"]')).toBeNull()
    await open({ bodyweight: [{ d, t: Date.now(), w: 80 }] })
    const sw = host.querySelector('[aria-label="Body weight"]')
    expect(sw).toBeTruthy()
    expect(sw.getAttribute('aria-checked') ?? String(sw.checked)).toBe('false')
  })
})
