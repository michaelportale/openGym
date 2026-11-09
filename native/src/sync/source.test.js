import { expect, test } from 'vitest'
import { screenSource } from './source.js'
import { sessionState } from '../workout/history-state.js'
import { exercises } from '../shared/training.js'

const builtIn = exercises.EXDB[0]
const cap = s => s[0].toUpperCase() + s.slice(1)
const w = (id, d, extra = {}) => ({ id, d, start: 1, entries: [], ...extra })

const bundled = {
  version: 1,
  example: false,
  state: { unit: 'lb', routines: [{ id: 'r', name: 'R', ex: [] }], workouts: [w('b1', '2026-10-01')] },
  names: { snap: { name: 'Snap', category: 'X' } },
}

test('unpaired: the bundled snapshot with pending workouts, exactly as sessionState gives it', () => {
  const pending = [w('p1', '2026-11-01')]
  const out = screenSource({ copy: null, bundled, pending })
  expect(out.state).toEqual(sessionState(bundled, pending))
  expect(out.names).toBe(bundled.names)
})

test('paired: the copy wins, pending are appended, a shared id keeps the copy', () => {
  const copy = {
    state: {
      unit: 'kg',
      futureFeature: 1,
      routines: [{ id: 'r', name: 'R', ex: [{ id: builtIn.id }, { id: 'cust' }] }],
      customEx: [{ id: 'cust', n: 'my curl', tg: 'biceps', eq: 'cable' }],
      workouts: [w('c1', '2026-10-05', { vol: 1 }), w('c0', '2026-09-01')],
    },
    rev: 3, wid: 'x', pulledAt: 't',
  }
  const pending = [w('c1', '2026-10-05', { vol: 999 }), w('p1', '2026-11-01')]
  const out = screenSource({ copy, bundled, pending })
  expect(out.state.unit).toBe('kg')
  expect(out.state.futureFeature).toBe(1)
  expect(out.state.workouts.map(x => x.id)).toEqual(['c0', 'c1', 'p1'])
  expect(out.state.workouts.find(x => x.id === 'c1').vol).toBe(1)
  expect(out.names[builtIn.id]).toEqual({ name: cap(builtIn.n), category: [builtIn.bp, builtIn.eq].filter(Boolean).map(cap).join(' · ') })
  expect(out.names.cust).toEqual({ name: 'My curl', category: 'Biceps · Cable' })
  expect(out.names.snap).toBeUndefined()
})

test('paired: history ids get a name where one is known, unknown ids none', () => {
  const copy = {
    state: { routines: [], workouts: [w('c1', '2026-10-05', { entries: [{ id: builtIn.id }, { id: 'ghost' }] })] },
    rev: 0, wid: 'x', pulledAt: 't',
  }
  const out = screenSource({ copy, bundled, pending: [] })
  expect(out.names[builtIn.id].name).toBe(cap(builtIn.n))
  expect(out.names.ghost).toBeUndefined()
})
