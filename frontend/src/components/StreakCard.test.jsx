// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import StreakCard, { streakLines } from './StreakCard.jsx'

let root, host
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
const base = { mode: 'rotation', N: 6, P: 14, maxGap: 5, rounds: 4, passes: 2, best: 14, deadline: '2026-10-29', kind: null, since: null }
const mount = el => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(el)) }

it('shows the count, rounds and passes, named as one group with no nested buttons', () => {
  mount(<StreakCard streak={{ ...base, count: 14, state: 'active' }} onCalendar={() => {}} summary="2 / 3 this week" />)
  const card = host.querySelector('.streak-card')
  expect(card.getAttribute('role')).toBe('group')
  expect(card.getAttribute('aria-label')).toBe('Streak: 14 sessions on rotation, 4 rounds · 2 rest passes')
  expect(host.querySelector('.streak-num').textContent).toBe('14')
  expect(host.querySelectorAll('.streak-dots i')).toHaveLength(4)
  expect(host.querySelector('[role="button"]')).toBeNull()
  expect([...host.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Streak options', 'Calendar'])
  expect(host.textContent).not.toContain('Train by')
})

it('says when to train by when at risk, in words in the accessible name', () => {
  mount(<StreakCard streak={{ ...base, count: 3, state: 'atRisk' }} onCalendar={() => {}} />)
  expect(host.querySelector('.streak-risk').textContent).toMatch(/^Train by \S+ to keep it$/)
  expect(host.querySelector('.streak-card').getAttribute('aria-label')).toMatch(/Train by Thursday to keep it$/)
})

it('freezes the number while paused', () => {
  mount(<StreakCard streak={{ ...base, count: 5, state: 'paused', kind: 'sick', since: '2026-10-20' }} onCalendar={() => {}} />)
  expect(host.querySelector('.streak-num').classList.contains('frozen')).toBe(true)
  expect(host.querySelector('.streak-pause').textContent).toMatch(/^Paused · Sick since /)
})

it('reads a broken streak as a fresh start with the best, and offers the next session', () => {
  const onStart = vi.fn()
  mount(<StreakCard streak={{ ...base, count: 0, rounds: 0, passes: 0, state: 'broken' }} onCalendar={() => {}} startLabel="Push A" onStart={onStart} />)
  expect(host.textContent).toContain('Start a new streak')
  expect(host.textContent).toContain('Best: 14 sessions')
  expect(host.textContent).not.toMatch(/lost/i)
  act(() => host.querySelector('.streak-cta').click())
  expect(onStart).toHaveBeenCalled()
})

it('has first-run copy for zero', () => {
  expect(streakLines({ ...base, count: 0, state: 'zero' }).lead).toBe('Your streak starts with your first session')
  expect(streakLines({ ...base, count: 1, rounds: 1, passes: 1, state: 'active' }).aria).toBe('1 session on rotation, 1 round · 1 rest pass')
})

it('says "on rotation" only in Rotation mode; a Fixed Week streak counts plain sessions', () => {
  const week = { ...base, mode: 'week', N: 3, P: 7 }
  expect(streakLines({ ...week, count: 4, state: 'active' }).aria).toMatch(/^4 sessions, /)
  expect(streakLines({ ...week, count: 1, state: 'active' }).aria).toMatch(/^1 session, /)
  expect(streakLines({ ...week, count: 4, state: 'active' }).aria).not.toMatch(/rotation/)
  expect(streakLines({ ...base, count: 4, state: 'active' }).aria).toMatch(/^4 sessions on rotation, /)
})
