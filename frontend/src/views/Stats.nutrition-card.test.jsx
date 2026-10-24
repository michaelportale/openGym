// @vitest-environment happy-dom
// The Stats screen's Nutrition card reads the last logged day once per render: the lookup scans the
// whole log, so it is not repeated for the condition and again for the text.
import React, { Profiler, act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../lib/nutrition.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, lastNutritionDay: S => { calls.n++; return real.lastNutritionDay(S) } }
})
const { default: Stats } = await import('./Stats.jsx')

let root, host
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T12:00:00'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: null })
  const st = JSON.parse(JSON.stringify(DEF))
  Object.assign(st, { workouts: [], bodyweight: [], unit: 'kg', weekStart: 1,
    nutritionDays: { '2026-10-20': { kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30, dayType: 'rest', _ts: 1 } } })
  useStore.setState({ S: st, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  calls.n = 0
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('Stats — Nutrition card', () => {
  it('looks up the last logged day once per render and shows it', () => {
    // Every render of Stats ends in a commit, so the lookups can't outnumber the commits.
    let commits = 0
    const tree = () => <MemoryRouter><Profiler id="stats" onRender={() => { commits++ }}><Stats /></Profiler></MemoryRouter>
    act(() => root.render(tree()))
    expect(host.querySelector('.nutri-card').textContent).toContain('Last logged')
    act(() => useStore.setState(st => ({ S: { ...st.S } })))
    act(() => root.render(tree()))
    expect(commits).toBeGreaterThan(1)
    expect(calls.n).toBeGreaterThan(0)
    expect(calls.n).toBeLessThanOrEqual(commits)
  })
})
