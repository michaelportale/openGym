// @vitest-environment happy-dom
// Holding a set's + on the real workout screen: a finger's lift order (pointerup, pointerleave,
// click) adds no extra step, and a hold still running when the screen goes away stops with it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { HOLD_DELAY, HOLD_EVERY } from '../lib/hold-repeat.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container

function mount() {
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = {
    id: 'stepper-hold', d: '2026-10-24', start: Date.now(), routineId: null, name: 'Legs', bw: null, cur: 0,
    entries: [{ id: '0043', target: { sets: 1, min: 5, max: 8 }, sets: [{ w: 60, r: 5, done: false }] }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function unmount() { act(() => root.unmount()); container.remove(); root = null }

beforeEach(() => vi.useFakeTimers())
afterEach(() => { if (root) unmount(); vi.clearAllTimers(); vi.useRealTimers() })

const reps = () => useStore.getState().S.active.entries[0].sets[0].r
const plus = () => container.querySelectorAll('.setrow button[aria-label="Increase"]')[1]
const fire = (el, type, init = {}) => act(() => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
})

describe('holding a stepper on the workout screen', () => {
  it('a long press lifted by a finger steps by the hold only, with no extra step from its click', () => {
    mount()
    const btn = plus(); expect(btn).toBeTruthy()
    const before = reps()
    fire(btn, 'pointerdown', { button: 0, buttons: 1, pointerType: 'touch' })
    act(() => vi.advanceTimersByTime(HOLD_DELAY + HOLD_EVERY))
    const held = reps(); expect(held).toBe(before + 2)
    fire(plus(), 'pointerup', { button: 0, buttons: 0, pointerType: 'touch' })
    // React builds onPointerLeave from pointerout toward an element outside the button.
    fire(plus(), 'pointerout', { buttons: 0, pointerType: 'touch', relatedTarget: document.body })
    act(() => plus().click())
    act(() => vi.advanceTimersByTime(1000))
    expect(reps()).toBe(held)
  })
  it('a hold still running when the screen unmounts stops stepping', () => {
    mount()
    fire(plus(), 'pointerdown', { button: 0, buttons: 1, pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(HOLD_DELAY + HOLD_EVERY))
    const at = reps()
    unmount()
    act(() => vi.advanceTimersByTime(2000))
    expect(reps()).toBe(at)
  })
})
