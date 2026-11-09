import { expect, test } from 'vitest'
import { queue, rotation } from '../shared/training.js'
import { nextRoutineId } from './next-up.js'

const since = Date.parse('2026-10-22T00:00:00Z')
const now = Date.parse('2026-11-09T12:00:00Z')

const fixture = workouts => ({
  // c first, so the no-queue fallback (routines[0]) cannot pass for the refill case
  routines: [{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  rotation: { id: 'rot', sequence: ['a', 'b', 'c'] },
  queue: { ids: ['a', 'b', 'c'], since, startsOn: '2026-10-22', rotationId: 'rot' },
  workouts,
})
const done = (id, extra = {}) => ({ id: `w-${id}`, routineIds: [id], start: since + 1, d: '2026-11-09', ...extra })

test('no workouts gives the first', () => {
  expect(nextRoutineId(fixture([]), '2026-11-09', now)).toBe('a')
})

test('a historical import does not count', () => {
  expect(nextRoutineId(fixture([done('a', { historicalImport: true })]), '2026-11-09', now)).toBe('a')
})

test('a phone workout of a moves to b', () => {
  expect(nextRoutineId(fixture([done('a')]), '2026-11-09', now)).toBe('b')
})

test('a full pass refills and starts over', () => {
  expect(nextRoutineId(fixture([done('a'), done('b'), done('c')]), '2026-11-09', now)).toBe('a')
})

test('does not mutate the state', () => {
  const state = fixture([done('a'), done('b'), done('c')])
  const before = JSON.stringify(state)
  nextRoutineId(state, '2026-11-09', now)
  expect(JSON.stringify(state)).toBe(before)
})

// Past the first pass: a six-routine rotation, checked against the web. The web keeps its queue,
// and each finish lands the workout and runs refillAfter on it (sheets.jsx). The phone only ever
// has the snapshot's queue plus its workouts.
const six = ['push-a', 'pull-a', 'legs-a', 'push-b', 'pull-b', 'legs-b']
const sixState = () => ({
  routines: six.map(id => ({ id, name: id })),
  rotation: { id: 'rot', sequence: six },
  queue: { ids: six, since, startsOn: '2026-10-22', rotationId: 'rot' },
  // From before the queue: history for "last time", never a credit.
  workouts: [{ id: 'old', routineIds: ['push-a'], d: '2026-10-16', start: Date.parse('2026-10-16T17:00:00Z') }],
})
const dayAt = n => new Date(Date.parse('2026-11-01T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
const lifted = (id, n, hour = 17) => {
  const start = Date.parse(`${dayAt(n)}T${String(hour).padStart(2, '0')}:00:00Z`)
  return { id: `w${n}-${hour}-${id}`, routineIds: [id], d: dayAt(n), start, end: start + 3_600_000 }
}
const webFinish = (s, w) => {
  s.workouts.push(w)
  rotation.refillAfter(s, w, w.d, w.end)
}
// The phone's copy: the snapshot's untouched queue, and the workouts in no particular order.
const phoneNext = (web, n) => nextRoutineId({ ...sixState(), workouts: [...web.workouts].reverse() }, dayAt(n), Date.parse(`${dayAt(n)}T12:00:00Z`))

test('pass 2: a routine done out of order is still next, as on the web', () => {
  const web = sixState()
  six.forEach((id, n) => webFinish(web, lifted(id, n)))
  webFinish(web, lifted('legs-a', 6))
  expect(queue.queueRemaining(web)[0]).toBe('push-a')
  expect(phoneNext(web, 7)).toBe('push-a')
})

test('next-up agrees with the web after every finish, pass after pass', () => {
  const web = sixState()
  const picks = [
    ...six, // pass 1 in order
    'legs-a', 'push-a', 'pull-a', 'push-b', 'pull-b', 'legs-b', // pass 2 out of order
    'push-a', 'push-a', 'legs-a', 'push-b', 'pull-b', 'legs-b', // pass 3 with a redo
    'legs-a', 'push-a', // pass 4 starts after a skip
  ]
  picks.forEach((id, n) => {
    expect(phoneNext(web, n), `before workout ${n + 1}`).toBe(queue.queueRemaining(web)[0])
    webFinish(web, lifted(id, n))
    // The evening of the day that closes pass 2: a second workout, the first of pass 3.
    if (n === 11) webFinish(web, lifted('pull-a', n, 19))
  })
  expect(phoneNext(web, picks.length)).toBe(queue.queueRemaining(web)[0])
})

test('without a queue it gives the first routine, or null with none', () => {
  expect(nextRoutineId({ routines: [{ id: 'x' }], workouts: [] }, '2026-11-09', now)).toBe('x')
  expect(nextRoutineId({ routines: [], workouts: [] }, '2026-11-09', now)).toBeNull()
})
