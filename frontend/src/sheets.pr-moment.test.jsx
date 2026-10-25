// @vitest-environment happy-dom
// The finish summary's PR moment: a load PR turns the check into a gold trophy and lists the lift
// with its new top weight and the best it passed, and offers Share as image. Without one the
// summary is as it was; a best estimated 1RM alone is listed without the gold.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout } from './sheets.jsx'
import { workoutCardModel } from './lib/workout-card.js'

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
function finishWith(sets) {
  const st = clone(DEF)
  const before = new Date('2026-09-14T18:00:00').getTime()
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 10, weight: 50, mode: 'reps' }] }],
    week: {}, dayPlan: {}, weighIn: false,
    workouts: [{ id: 'w1', d: '2026-09-14', start: before, end: before + 3600e3, name: 'Push', routineIds: ['A'], prs: [BENCH],
      entries: [{ id: BENCH, rid: 'A', target: { sets: 1, reps: 10, weight: 50, mode: 'reps' }, sets: [{ w: 50, r: 10, done: true }] }] }],
    exWeights: { [BENCH]: { w: 50, d: '2026-09-14' } },
    active: { d: day, start: Date.now() - 1800e3, name: 'Push', routineIds: ['A'],
      entries: [{ id: BENCH, rid: 'A', target: { sets: sets.length, reps: 10, weight: 50, mode: 'reps' }, sets: sets.map(x => ({ ...x, done: true })) }] },
  })
  useStore.setState({ S: st, user: null })
  act(() => finishWorkout())
  return mountTopSheet()
}

// A combined session (two routines) holding the same lift once in each section, after one earlier
// session at `was`. Each section is `{ w, dbLoad? }`, one set of 10 at that weight.
function finishCombined(id, was, sections, wasLoad) {
  const st = clone(DEF)
  const before = new Date('2026-09-14T18:00:00').getTime()
  const target = (w, dbLoad) => ({ sets: 1, reps: 10, weight: w, mode: 'reps', ...(dbLoad ? { dbLoad } : {}) })
  Object.assign(st, {
    routines: [
      { id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id, sets: 1, reps: 10, weight: was, mode: 'reps' }] },
      { id: 'B', name: 'More', emoji: 'dumbbell', ex: [{ id, sets: 1, reps: 10, weight: was, mode: 'reps' }] },
    ],
    week: {}, dayPlan: {}, weighIn: false,
    workouts: [{ id: 'w1', d: '2026-09-14', start: before, end: before + 3600e3, name: 'Push', routineIds: ['A'], prs: [id],
      entries: [{ id, rid: 'A', target: target(was, wasLoad), sets: [{ w: was, r: 10, done: true }] }] }],
    exWeights: { [id]: { w: was, d: '2026-09-14' } },
    active: { d: day, start: Date.now() - 1800e3, name: 'Push + More', routineIds: ['A', 'B'],
      entries: sections.map((x, i) => ({ id, rid: i ? 'B' : 'A', target: target(x.w, x.dbLoad), sets: [{ w: x.w, r: 10, done: true }] })) },
  })
  useStore.setState({ S: st, user: null })
  act(() => finishWorkout())
  return mountTopSheet()
}
const recordOf = host => {
  const card = host.querySelector('.finish-records.gold')
  return { rows: card.querySelectorAll('.pr-row').length, v: card.querySelector('.finish-record-v').textContent, was: card.querySelector('.finish-record-s').textContent }
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

  it('offers Share as image, which opens the workout card over the summary', () => {
    const host = finishWith([{ w: 60, r: 10 }])
    const n = useUI.getState().sheets.length
    act(() => { button(host, 'Share as image').click() })
    expect(useUI.getState().sheets.length).toBe(n + 1)
    expect(mountTopSheet().textContent).toContain('Share workout')
  })

  it('stays a plain summary when nothing was beaten', () => {
    const host = finishWith([{ w: 50, r: 10 }])
    expect(host.querySelector('.finish-check [data-icon="check"]')).toBeTruthy()
    expect(host.querySelector('.finish-pr')).toBeNull()
    expect(host.querySelector('.finish-records')).toBeNull()
    expect(button(host, 'Share as image')).toBeUndefined()
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

  it('reports the best section of a combined session, in either order, against the previous best', () => {
    for (const order of [[100, 80], [80, 100]]) {
      const host = finishCombined(BENCH, 70, order.map(w => ({ w })))
      expect(recordOf(host)).toEqual({ rows: 1, v: '100 kg', was: 'Previous best: 70 kg' })
      const saved = useStore.getState().S.workouts.at(-1)
      expect(saved.prs).toContain(BENCH)
      const model = workoutCardModel(saved, { unit: 'kg', nameOf: e => e.id })
      expect(model.records).toEqual([BENCH])
      act(() => { mounted.splice(0).forEach(root => root.unmount()) })
      useUI.setState({ sheets: [] })
    }
  })

  it('keeps the least assistance as the record when an assisted lift is in two sections', () => {
    const host = finishCombined('0017', 40, [{ w: 20 }, { w: 30 }])
    expect(recordOf(host)).toEqual({ rows: 1, v: '20 kg', was: 'Previous best: 40 kg' })
  })

  it('compares dumbbell sections logged in different meanings in one meaning', () => {
    // 30 kg each, then 50 kg total (25 each), after 20 kg each: the record is 30 kg each.
    const host = finishCombined('0289', 20, [{ w: 30, dbLoad: 'each' }, { w: 50, dbLoad: 'total' }], 'each')
    expect(recordOf(host)).toEqual({ rows: 1, v: '30 kg', was: 'Previous best: 20 kg' })
  })
})
