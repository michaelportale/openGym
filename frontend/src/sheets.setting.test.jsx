// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Workout from './views/Workout.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX } from './lib/exercises.js'
import { buildSessionEntries } from './lib/session-start.js'
import { finishWorkout, workoutDetailSheet, exerciseHistorySheet, swapActiveWorkoutExercise } from './sheets.jsx'
vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('./lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
const roots = []
const top = () => useUI.getState().sheets.at(-1)
const render = element => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(element)); return host
}
const renderTop = () => { const s = top(); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const cfg = { id: '0576', stationId: 'b', sets: 1, reps: 10, weight: 7, inc: 1, prog: 'off' }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], timer: null, work: null, toastMsg: '' })
  const S = structuredClone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [], exWeights: {}, activeEquipId: 'gym', equipProfiles: [{ id: 'gym', stations: [{ id: 'a', exerciseIds: ['0576'], loadConvention: 'machine-total' }, { id: 'b', exerciseIds: ['0576'], loadConvention: 'machine-setting' }] }] })
  S.active = { id: 'native-setting', d: '2026-10-21', start: Date.now(), cur: 0, name: 'Synthetic setting', workoutView: 'focus', entries: buildSessionEntries(S, { ex: [cfg] }) }
  useStore.setState({ S, user: null })
})
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''
  useUI.getState().stopRest()
})
it('logs and finishes a native setting once, with unitless history, partial volume and no mass PR', () => {
  const host = render(<MemoryRouter><Workout /></MemoryRouter>)
  const complete = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Complete')
  act(() => complete.click())
  expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 7, r: 10, done: true })
  act(() => finishWorkout())
  const S = useStore.getState().S, w = S.workouts[0]
  expect(S.active).toBeNull()
  expect(S.workouts).toHaveLength(1)
  expect.soft(w).toMatchObject({ vol: 0, volumePartial: true, prs: [] })
  expect(S.exWeights['0576']).toBeUndefined()
  act(() => workoutDetailSheet(w))
  const detail = renderTop()
  expect.soft(detail.querySelector('.wd-ex .ss').textContent).toContain('7 Setting')
  expect(detail.textContent).toContain('Partial load total')
  act(() => exerciseHistorySheet('0576'))
  const history = renderTop()
  expect(history.querySelector('.list .ss').textContent).toContain('7 Setting')
  expect(history.textContent).not.toContain('Est. 1RM')
})
it.each(['planned add', 'freestyle add', 'planned swap', 'freestyle swap'])('isolates new station rows through the %s UI caller', route => {
  const S = structuredClone(useStore.getState().S)
  S.workouts = [{ id: 'prior', d: '2026-10-20', entries: [{ id: cfg.id, equipmentSnapshot: { stationId: 'a', loadConvention: 'machine-total', unit: 'kg', status: 'exact' }, target: { ...cfg, stationId: 'a' }, sets: [{ w: 80, r: 10, done: true }] }] }]
  S.exWeights[cfg.id] = { w: 80 }
  if (route.startsWith('planned')) { S.routines = [{ id: 'r', ex: [cfg] }]; S.active.entries[0].rid = 'r' }
  useStore.setState({ S, user: null })
  if (route.endsWith('add')) {
    const host = render(<MemoryRouter><Workout /></MemoryRouter>)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add exercise').click())
  } else act(() => swapActiveWorkoutExercise(0))
  const picker = top(); act(() => picker.render(picker.close).props.onPick(EXIDX[cfg.id]))
  const config = top(); act(() => config.render(config.close).props.onSave({ ...cfg, prog: 'double', repsMin: 8 }))
  const entry = useStore.getState().S.active.entries.at(-1)
  expect(entry.equipmentSnapshot).toMatchObject({ stationId: 'b', loadConvention: 'machine-setting', unit: null })
  expect(entry.sets[0].w).toBe(7)
  expect(entry.target.weight).toBe(7)
})
it('keeps setting units in the actual finish comparison and text export', async () => {
  const { workoutText } = await import('./lib/workout-text.js')
  act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }))
  act(() => finishWorkout())
  const summary = renderTop()
  expect(summary.textContent).toContain('7 Setting')
  expect(summary.textContent).not.toContain('7 kg')
  expect(workoutText(useStore.getState().S.workouts[0], { unit: 'kg', nameOf: () => 'Synthetic press' })).toContain('7 Setting')
})
it('labels the setting in the exercise configuration sheet before logging', async () => {
  const { exConfigSheet } = await import('./sheets.jsx')
  act(() => exConfigSheet(EXIDX[cfg.id], cfg, () => {}))
  const host = renderTop()
  expect(host.textContent).toContain('Setting')
  expect(host.textContent).not.toContain('Weight (kg)')
})
it.each(['focus', 'list'])('requires a manual load for an uncertain imported copy after reopening in %s', async view => {
  const { repeatSessionEntries } = await import('./lib/session-repeat.js')
  const source = { id: 'source', d: '2026-10-20', entries: [{ id: cfg.id, equipmentSnapshot: { loadConvention: 'machine-setting', stationId: null, unit: null, status: 'unknown' }, sets: [{ w: 80, r: 9, done: true, sourceLoad: { value: 80, physical: false, basis: 'setting' } }] }] }
  const s = structuredClone(useStore.getState().S)
  s.active.entries = repeatSessionEntries(s, source).entries
  s.active.workoutView = view
  // Same JSON round trip as persistence/reopening; there is no hidden in-memory review state.
  useStore.setState({ S: JSON.parse(JSON.stringify(s)), user: null })
  const host = render(<MemoryRouter><Workout /></MemoryRouter>)
  expect(host.textContent).toContain('Choose the load for this copied exercise before logging it.')
  const complete = () => view === 'focus' ? [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Complete') : host.querySelector('[aria-label="Set 1 done"]')
  act(() => complete().click())
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
  const reps = host.querySelector(view === 'focus' ? '[aria-label="Increase reps"]' : '.stp.reps [aria-label="Increase"]')
  if (reps) act(() => reps.click())
  expect(useStore.getState().S.active.entries[0].sets[0].loadNeedsReview).toBe(true)
  act(() => host.querySelector('[aria-label="More"]').click())
  const menu = renderTop()
  act(() => [...menu.querySelectorAll('.menu-item')].find(b => /^(Exercise|Progression) settings/.test(b.textContent.trim())).click())
  const settings = top()
  const props = settings.render(settings.close).props
  act(() => props.onSave({ ...useStore.getState().S.active.entries[0].target, loadNeedsReview: undefined, reps: 8 }))
  expect(useStore.getState().S.active.entries[0].sets[0].loadNeedsReview).toBe(true)
  act(() => complete().click())
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
  const increase = host.querySelector(view === 'focus' ? '[aria-label="Increase load"]' : '.stp [aria-label="Increase"]')
  expect(increase).toBeTruthy()
  act(() => increase.click())
  act(() => complete().click())
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
  expect(source.entries[0].sets[0].w).toBe(80)
})
it('can finish other work while leaving a copied unknown load unlogged', async () => {
  const { repeatSessionEntries } = await import('./lib/session-repeat.js')
  const source = { entries: [{ id: '0001', equipmentSnapshot: { status: 'unknown' }, sets: [{ w: 80, r: 9, done: true, sourceLoad: { value: 80, physical: false } }] }] }
  act(() => useStore.getState().update(s => {
    s.active.entries[0].sets[0].done = true
    s.active.entries.push(...repeatSessionEntries(s, source).entries)
  }))
  act(() => finishWorkout())
  const confirm = renderTop()
  act(() => [...confirm.querySelectorAll('button')].find(b => b.textContent.trim() === 'Finish workout').click())
  const S = useStore.getState().S
  expect(S.active).toBeNull()
  expect(S.workouts).toHaveLength(1)
  expect(S.workouts[0].entries).toHaveLength(1)
  expect(S.workouts[0].entries[0].id).toBe(cfg.id)
  expect(source.entries[0].sets[0]).toMatchObject({ w: 80, done: true })
})
it('preserves a saved routine copy’s manual-load requirement when its editor saves unchanged', async () => {
  const { exConfigSheet } = await import('./sheets.jsx')
  const save = vi.fn()
  act(() => exConfigSheet(EXIDX[cfg.id], { ...cfg, weight: 0, loadNeedsReview: true }, save))
  const host = renderTop()
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, loadNeedsReview: true }))
})
it.each([false, true])('renders each mixed-history occurrence’s own load convention (reverse=%s)', reverse => {
  for (const legacy of [false, true]) {
    const physical = { id: cfg.id, target: { ...cfg }, ...(legacy ? {} : { equipmentSnapshot: { loadConvention: 'machine-total', stationId: 'a', unit: 'kg', status: 'exact' } }), sets: [{ w: 80, r: 10, done: true }] }
    const setting = { id: cfg.id, target: { ...cfg, loadConvention: 'machine-setting' }, equipmentSnapshot: { loadConvention: 'machine-setting', stationId: 'b', unit: null, status: 'exact' }, sets: [{ w: 7, r: 10, done: true }] }
    act(() => useStore.getState().update(s => { s.workouts = [{ id: 'mixed', d: '2026-10-21', entries: reverse ? [setting, physical] : [physical, setting] }] }))
    act(() => exerciseHistorySheet(cfg.id))
    const host = renderTop(), labels = host.querySelector('.list .ss').textContent
    expect.soft(labels).toBe((reverse ? ['7 Setting × 10', '80×10'] : ['80×10', '7 Setting × 10']).join('  ·  '))
  }
})
it.each(['focus', 'list'])('confirms only explicitly edited copied loads per side, including reopening (%s)', async view => {
  const s = structuredClone(useStore.getState().S)
  s.active.entries = buildSessionEntries(s, { ex: [{ ...cfg, sets: 2, side: true, reps: 20, weight: 0, loadNeedsReview: true }] })
  s.active.workoutView = view
  useStore.setState({ S: s, user: null })
  let host = render(<MemoryRouter><Workout /></MemoryRouter>)
  const row = () => useStore.getState().S.active.entries[0].sets[0]
  const sideButton = (side, action) => view === 'focus'
    ? host.querySelector(`[data-focus-side="${side}"] [aria-label="${action === 'done' ? `Complete ${side === 'L' ? 'left' : 'right'} side` : action === 'load' ? 'Increase load' : 'Increase reps'}"]`)
    : host.querySelectorAll('.setrow.side')[side === 'L' ? 0 : 1].querySelector(action === 'done' ? '[role="checkbox"]' : `.stp.${action === 'load' ? 'w' : 'r'} [aria-label="Increase"]`)
  act(() => sideButton('L', 'done').click())
  expect(row().sides.L.done).toBe(false)
  act(() => sideButton('L', 'reps').click())
  act(() => sideButton('L', 'done').click())
  expect(row().sides.L.done).toBe(false)
  act(() => sideButton('L', 'load').click())
  act(() => sideButton('R', 'done').click())
  expect(row().sides.R.done).toBe(false)
  act(() => sideButton('L', 'done').click())
  expect(row().sides.L.done).toBe(true)
  expect(row().done).toBe(false)
  const reopened = JSON.parse(JSON.stringify(useStore.getState().S))
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''
  useStore.setState({ S: reopened, user: null })
  host = render(<MemoryRouter><Workout /></MemoryRouter>)
  expect(row().sides.L.done).toBe(true)
  act(() => sideButton('R', 'done').click())
  expect(row().sides.R.done).toBe(false)
  const { buildCompletedWorkout } = await import('./lib/finish-workout.js')
  const partial = buildCompletedWorkout(useStore.getState().S.active)
  expect(partial.entries[0].sets[0].sides.L).not.toHaveProperty('loadNeedsReview')
  act(() => sideButton('R', 'load').click())
  act(() => sideButton('R', 'done').click())
  expect(row().done).toBe(true)
  expect(row().loadNeedsReview).toBeUndefined()
  const next = useStore.getState().S.active.entries[0].sets[1]
  expect(next.loadNeedsReview).toBe(true)
  const nextComplete = view === 'focus' ? host.querySelector('[aria-label="Complete left side"]') : host.querySelector('[aria-label="Set 2 (Left) done"]')
  act(() => nextComplete.click())
  expect(useStore.getState().S.active.entries[0].sets[1].sides.L.done).toBe(false)
})
it.each(['focus', 'list'])('still logs ordinary legacy per-side zero loads without review (%s)', view => {
  const s = structuredClone(useStore.getState().S)
  s.active.entries = buildSessionEntries(s, { ex: [{ ...cfg, side: true, reps: 20, weight: 0 }] })
  s.active.workoutView = view
  useStore.setState({ S: s, user: null })
  const host = render(<MemoryRouter><Workout /></MemoryRouter>)
  for (const side of ['Left', 'Right']) {
    const label = view === 'focus' ? `Complete ${side.toLowerCase()} side` : `Set 1 (${side}) done`
    act(() => host.querySelector(`[aria-label="${label}"]`).click())
  }
  expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ done: true, w: 0 })
})
