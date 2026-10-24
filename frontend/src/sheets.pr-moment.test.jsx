// @vitest-environment happy-dom
// The finish summary's PR moment: a load PR turns the check into a gold trophy and lists the lift
// with its new top weight and the best it passed, and offers Share in the sheet's footer. Without one the
// summary is as it was; a best estimated 1RM alone is listed without the gold.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout } from './sheets.jsx'

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
const day = '2026-09-16'

function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

// One earlier bench session at 50 kg × 10, then today's session with the given sets, finished.
function finishWith(sets, ago = 1800e3) {
  const st = clone(DEF)
  const before = new Date('2026-09-14T18:00:00').getTime()
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 10, weight: 50, mode: 'reps' }] }],
    week: {}, dayPlan: {}, weighIn: false,
    workouts: [{ id: 'w1', d: '2026-09-14', start: before, end: before + 3600e3, name: 'Push', routineIds: ['A'], prs: [BENCH],
      entries: [{ id: BENCH, rid: 'A', target: { sets: 1, reps: 10, weight: 50, mode: 'reps' }, sets: [{ w: 50, r: 10, done: true }] }] }],
    exWeights: { [BENCH]: { w: 50, d: '2026-09-14' } },
    active: { d: day, start: Date.now() - ago, name: 'Push', routineIds: ['A'],
      entries: [{ id: BENCH, rid: 'A', target: { sets: sets.length, reps: 10, weight: 50, mode: 'reps' }, sets: sets.map(x => ({ ...x, done: true })) }] },
  })
  useStore.setState({ S: st, user: null })
  act(() => finishWorkout())
  return mountTopSheet()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(day + 'T12:00:00'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toasts: [] })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.useRealTimers()
})

describe('the PR moment on the finish summary', () => {
  it('turns the check into a trophy and lists the lift, its new top weight and the best it passed', () => {
    const host = finishWith([{ w: 60, r: 10 }])
    expect(useStore.getState().S.workouts.at(-1).prs).toEqual([BENCH])
    expect(host.querySelector('.finish-check.finish-pr [data-icon="trophy"]')).toBeTruthy()
    const card = host.querySelector('.finish-records.gold')
    expect(card.textContent).toContain('New personal records')
    expect(card.querySelector('.finish-record-n').textContent).toMatch(/bench press/i)
    expect(card.querySelector('.finish-record-v').textContent).toBe('60 kg')
    expect(card.querySelector('.finish-record-s').textContent).toBe('Previous best: 50 kg')
    expect(host.querySelector('.pr-tile .v').textContent).toBe('1')
  })

  it('offers Share, which opens the workout card over the summary', () => {
    const host = finishWith([{ w: 60, r: 10 }])
    const n = useUI.getState().sheets.length
    act(() => { button(host, 'Share').click() })
    expect(useUI.getState().sheets.length).toBe(n + 1)
    expect(mountTopSheet().textContent).toContain('Share workout')
  })

  it('stays a plain summary when nothing was beaten', () => {
    const host = finishWith([{ w: 50, r: 10 }])
    expect(host.querySelector('.finish-check [data-icon="check"]')).toBeTruthy()
    expect(host.querySelector('.finish-pr')).toBeNull()
    expect(host.querySelector('.finish-records')).toBeNull()
    expect(button(host, 'Share')).toBeUndefined()
    expect(host.querySelector('.pr-tile')).toBeNull()
  })

  it('lists a best estimated 1RM without a heavier top set, without the gold', () => {
    const host = finishWith([{ w: 50, r: 12 }])
    expect(host.querySelector('.finish-pr')).toBeNull()
    const card = host.querySelector('.finish-records')
    expect(card).toBeTruthy()
    expect(card.classList.contains('gold')).toBe(false)
    expect(card.textContent).not.toContain('New personal records')
    expect(card.querySelector('.e1-row').textContent).toContain('Best estimated 1RM:')
  })

  it('keeps Share and Done together in a footer that stays at the foot of the sheet', () => {
    const host = finishWith([{ w: 60, r: 10 }])
    const foot = host.querySelector('.finish-foot')
    expect([...foot.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Share', 'Done'])
    expect(foot.querySelector('.btn.primary').textContent.trim()).toBe('Done')
  })

  it('reads a session under a minute as <1 min and counts sets as a plain number', () => {
    const host = finishWith([{ w: 50, r: 10 }, { w: 50, r: 10 }], 20e3)
    const tiles = [...host.querySelectorAll('.tiles .tile')]
    const tile = name => tiles.find(x => x.querySelector('.l').textContent === name)
    expect(tile('Sets').querySelector('.v').textContent).toBe('2')
    expect(tile('Sets').querySelector('.tile-cap').textContent).toBe('all working')
    expect(tile('Duration').querySelector('.v').textContent).toBe('<1 min')
  })
})
