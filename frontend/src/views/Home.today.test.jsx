// @vitest-environment happy-dom
// Home's Today card: the session row says what the planned session holds
// before you start it, and the week strip follows it as the glance.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import Home from './Home.jsx'
import { startFlow } from '../sheets.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

const bench = { id: '0025', sets: 3, reps: 5, weight: 60, mode: 'reps' }
const routines = [{ id: 'r1', name: 'Push', emoji: null, prog: 'linear', ex: [bench, { id: '0026', sets: 3, reps: 8, mode: 'reps' }] }]
const daysAgo = n => { const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const session = (d, more = {}) => ({ id: 'w' + d, d, name: 'Push', routineIds: ['r1'], start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: '0025', rid: 'r1', target: { ...bench }, sets: [1, 2, 3].map(() => ({ w: 60, r: 5, done: true })) }], ...more })

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false, unit: 'kg', exWeights: {},
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const meta = () => [...host.querySelectorAll('.today-row .today-meta')].map(e => e.textContent)

describe('Home — the Today card', () => {
  it('leads the card, ahead of the week strip', () => {
    setS(); mount()
    const card = host.querySelector('.today-card')
    expect(card.firstElementChild.classList.contains('today-row')).toBe(true)
    expect(card.querySelector('.today-glance .week')).toBeTruthy()
  })

  it('says how many exercises the session has and when it was last done', () => {
    setS({ workouts: [session(daysAgo(3))] }); mount()
    expect(meta()[0]).toBe('2 exercises · Last time (3 days ago)')
  })

  it('names the lifts the progression moves up today', () => {
    setS({ workouts: [session(daysAgo(3))] }); mount()
    expect(meta().some(m => m.startsWith('Moving up today: '))).toBe(true)
  })

  it('names a muscle the session works that is still fatigued', () => {
    const hard = session(daysAgo(1))
    hard.entries[0].sets = Array.from({ length: 12 }, () => ({ w: 60, r: 5, rir: 0, done: true }))
    setS({ workouts: [hard] }); mount()
    const line = host.querySelector('.today-row .today-recovering')
    expect(line?.textContent).toMatch(/^Still recovering: .*Chest/)
  })

  it('has no recovery line when the muscles are fresh', () => {
    setS({ workouts: [session(daysAgo(6))] }); mount()
    expect(host.querySelector('.today-recovering')).toBeNull()
  })

  it('has no last time before the first session, and nothing moving up', () => {
    setS(); mount()
    expect(meta()).toEqual(['2 exercises'])
  })

  it('says nothing about the plan once today is done or while a session is open', () => {
    setS({ workouts: [session(daysAgo(3)), session(todayISO())] }); mount()
    expect(meta()).toEqual([])
    setS({ workouts: [session(daysAgo(3))], active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(meta()).toEqual([])
  })

  it('keeps Start as one control: the row itself, with the action drawn full width', () => {
    setS(); mount()
    const tag = host.querySelector('.today-row .tag')
    expect(tag.textContent).toBe('Start')
    expect(tag.classList.contains('today-cta')).toBe(true)
    expect(host.querySelectorAll('.today-card button').length).toBeGreaterThan(0)
    expect(tag.closest('button')).toBeNull()
  })

  it('keeps every button out of the tappable today row, and offers one way to pick another workout', () => {
    const hard = session(daysAgo(1))
    hard.entries[0].sets = Array.from({ length: 12 }, () => ({ w: 60, r: 5, rir: 0, done: true }))
    setS({ workouts: [hard] }); mount()
    const row = host.querySelector('.today-row')
    expect(row.getAttribute('role')).toBe('button')
    expect(host.querySelector('.today-recovering')).not.toBeNull()
    expect(row.querySelectorAll('button, [role="button"], a[href]').length).toBe(0)
    const choose = [...host.querySelectorAll('button')].filter(b => b.textContent === 'Choose a different workout')
    expect(choose.length).toBe(1)
    expect(choose[0].closest('[role="button"]')).toBeNull()
    expect(host.querySelectorAll('[aria-label="Choose a different workout"]').length).toBe(0)
    startFlow.mockClear()
    act(() => choose[0].click())
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('draws the progression line in the text colour with only its arrow in the accent', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain('.today-up{color:var(--label)}')
    expect(css).toContain('.today-up .icn{color:var(--acc-text)}')
  })

  it('moves the tab bar Start aside while the card Start is in view, and back when it leaves', () => {
    let cb
    const observe = vi.fn(), disconnect = vi.fn()
    globalThis.IntersectionObserver = vi.fn(function (fn) { cb = fn; this.observe = observe; this.disconnect = disconnect })
    setS(); mount()
    expect(observe).toHaveBeenCalledWith(host.querySelector('.today-cta'))
    act(() => cb([{ isIntersecting: true }]))
    expect(document.body.classList.contains('fab-aside')).toBe(true)
    act(() => cb([{ isIntersecting: false }]))
    expect(document.body.classList.contains('fab-aside')).toBe(false)
    act(() => cb([{ isIntersecting: true }]))
    act(() => root.render(<div />))
    expect(document.body.classList.contains('fab-aside')).toBe(false)
    expect(disconnect).toHaveBeenCalled()
    delete globalThis.IntersectionObserver
  })
})

