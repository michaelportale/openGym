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
  expect(nextRoutineId(fixture([]), now)).toBe('a')
})

test('a historical import does not count', () => {
  expect(nextRoutineId(fixture([done('a', { historicalImport: true })]), now)).toBe('a')
})

test('a phone workout of a moves to b', () => {
  expect(nextRoutineId(fixture([done('a')]), now)).toBe('b')
})

test('a full pass refills and starts over', () => {
  expect(nextRoutineId(fixture([done('a'), done('b'), done('c')]), now)).toBe('a')
})

test('does not mutate the state', () => {
  const state = fixture([done('a'), done('b'), done('c')])
  const before = JSON.stringify(state)
  nextRoutineId(state, now)
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
const phoneNext = (web, n) => nextRoutineId({ ...sixState(), workouts: [...web.workouts].reverse() }, Date.parse(`${dayAt(n)}T12:00:00Z`))

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
  expect(nextRoutineId({ routines: [{ id: 'x' }], workouts: [] }, now)).toBe('x')
  expect(nextRoutineId({ routines: [], workouts: [] }, now)).toBeNull()
})

test('several passes merged into the web at once leave the web on the routine next-up names', () => {
  for (const picks of [[...six, 'push-a', 'pull-a'], [...six, ...six], [...six, ...six, 'push-a']]) {
    const finishes = picks.map((id, n) => lifted(id, n))
    const web = sixState()
    web.workouts.push(...[...finishes].reverse()) // a sync merge: every session lands together
    const last = finishes.at(-1)
    expect(rotation.refillIfComplete(web, last.d, last.end)).toBe(true)
    expect(queue.queueRemaining(web)[0], picks.length + ' finishes').toBe(phoneNext(web, picks.length))
  }
})

// Local calendar day of a noon timestamp, so the weekday does not depend on the machine's timezone.
const localNoon = (year, monthIndex, day) => new Date(year, monthIndex, day, 12).getTime()
const localDay = ts => {
  const d = new Date(ts)
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  return { iso, weekday: d.getDay() }
}

test('a fixed week returns the routine pinned to today', () => {
  const ts = localNoon(2026, 10, 11)
  const { weekday } = localDay(ts)
  // pull is first, so the no-queue fallback cannot pass for a weekday pin
  const state = {
    scheduleMode: 'week',
    week: { [weekday]: ['push'] },
    dayPlan: {},
    routines: [{ id: 'pull' }, { id: 'push' }],
    workouts: [],
  }
  expect(nextRoutineId(state, ts)).toBe('push')
})

test('an empty today returns the next training day', () => {
  const ts = localNoon(2026, 10, 11)
  const next = new Date(2026, 10, 11, 12)
  next.setDate(next.getDate() + 1)
  const { weekday } = localDay(next.getTime())
  const state = {
    scheduleMode: 'week',
    week: { [weekday]: ['pull'] },
    dayPlan: { [localDay(ts).iso]: 'rest' },
    routines: [{ id: 'push' }, { id: 'pull', ex: [{ id: 'e' }] }],
    workouts: [],
  }
  expect(nextRoutineId(state, ts)).toBe('pull')
})

test('a dayPlan override wins over the weekday', () => {
  const ts = localNoon(2026, 10, 11)
  const { iso, weekday } = localDay(ts)
  const state = {
    scheduleMode: 'week',
    week: { [weekday]: ['push'] },
    dayPlan: { [iso]: 'legs' },
    routines: [{ id: 'push' }, { id: 'legs' }],
    workouts: [],
  }
  expect(nextRoutineId(state, ts)).toBe('legs')
})

test('a live queue stays on the replay when a weekday is also pinned', () => {
  const state = fixture([])
  state.week = { [localDay(now).weekday]: ['push'] }
  expect(nextRoutineId(state, now)).toBe('a')
})

test('a chosen week with nothing scheduled returns null', () => {
  const state = {
    scheduleMode: 'week',
    week: {},
    dayPlan: {},
    routines: [{ id: 'pull', ex: [{ id: 'e' }] }],
    workouts: [],
  }
  expect(nextRoutineId(state, localNoon(2026, 10, 11))).toBeNull()
})

test('a week-mode call leaves the state unchanged', () => {
  const ts = localNoon(2026, 10, 11)
  const { weekday } = localDay(ts)
  const week = { [weekday]: ['push'] }
  const dayPlan = {}
  const routines = [{ id: 'pull' }, { id: 'push' }]
  const state = { scheduleMode: 'week', week, dayPlan, routines, workouts: [] }
  const before = JSON.stringify(state)
  nextRoutineId(state, ts)
  expect(JSON.stringify(state)).toBe(before)
  expect(state.week).toBe(week)
  expect(state.dayPlan).toBe(dayPlan)
  expect(state.routines).toBe(routines)
})
