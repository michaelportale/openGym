import { describe, expect, test } from 'vitest'
import { format, queue, rotation } from '../shared/training.js'
import { saveLoop, setDate, setWeekday, startOver, stopLoop, switchToRotation, switchToWeek } from './schedule-edit.js'

const localNoon = (year, monthIndex, day, hour = 12) => new Date(year, monthIndex, day, hour).getTime()
const fiveKeys = ['dayPlan', 'queue', 'rotation', 'scheduleMode', 'week']

function expectValue(result) {
  expect(Object.keys(result).sort()).toEqual(fiveKeys)
  for (const stamp of ['_ts', '_f', 'edited']) expect(result).not.toHaveProperty(stamp)
}

// Two-routine loop whose stored queue still starts 1 Nov. Finishes are out of order: a, b, then a
// again. A date-ordered replay refills when b closes the pass, so the later a leaves b next.
// saveRotation on the stored queue keeps that since/startsOn, and the added routine reads as next.
const since0 = Date.parse('2026-11-01T00:00:00Z')
const replayNow = localNoon(2026, 10, 9)
function placeFixture() {
  return {
    _ts: 9,
    edited: { queue: 9 },
    routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    rotation: { id: 'rot', sequence: ['a', 'b'], label: 'Loop' },
    queue: { ids: ['a', 'b'], since: since0, startsOn: '2026-11-01', rotationId: 'rot', label: 'Loop' },
    scheduleMode: 'rotation',
    week: { 1: ['a'] },
    dayPlan: { '2026-11-01': 'a', '2026-11-03': 'b', '2026-11-08': 'c', '2026-11-10': 'a' },
    workouts: [
      { id: 'w3', routineIds: ['a'], name: 'A', d: '2026-11-04', start: Date.parse('2026-11-04T10:00:00Z'), end: Date.parse('2026-11-04T11:00:00Z') },
      { id: 'w1', routineIds: ['a'], name: 'A', d: '2026-11-01', start: Date.parse('2026-11-01T10:00:00Z'), end: Date.parse('2026-11-01T11:00:00Z') },
      { id: 'w2', routineIds: ['b'], name: 'B', d: '2026-11-02', start: Date.parse('2026-11-02T10:00:00Z'), end: Date.parse('2026-11-02T11:00:00Z') },
    ],
  }
}

describe('switchToWeek', () => {
  test('an empty state is a fixed week with the three scalars null and the two maps empty', () => {
    const result = switchToWeek({}, replayNow)
    expectValue(result)
    expect(result).toEqual({ scheduleMode: 'week', rotation: null, queue: null, week: {}, dayPlan: {} })
  })

  test('stops this app\'s pass on the replay, so a pin between the closing workout and today is gone', () => {
    const state = placeFixture()
    const before = JSON.stringify(state)
    const result = switchToWeek(state, replayNow)
    expect(JSON.stringify(state)).toBe(before)
    expectValue(result)
    expect(result.scheduleMode).toBe('week')
    expect(result.queue).toBeNull()
    expect(result.rotation).toEqual({ id: 'rot', sequence: ['a', 'b'], label: 'Loop' })
    expect(result.week).toEqual({ 1: ['a'] })
    // 3 Nov is before today and after the workout that closed the pass. The stored queue would keep it.
    expect(result.dayPlan).toEqual({ '2026-11-01': 'a', '2026-11-08': 'c' })
  })

  test('a planner queue stays, and so does a pin on it', () => {
    const q = { ids: ['a', 'b'], since: 40, startsOn: '2026-10-01', label: 'US W1' }
    const state = {
      routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      queue: q,
      week: { 2: ['a'] },
      dayPlan: { '2026-11-12': 'a' },
    }
    const result = switchToWeek(state, replayNow)
    expectValue(result)
    expect(result).toEqual({
      scheduleMode: 'week',
      rotation: null,
      queue: q,
      week: { 2: ['a'] },
      dayPlan: { '2026-11-12': 'a' },
    })
    expect(state.queue).toBe(q)
  })
})

describe('switchToRotation', () => {
  test('with nothing saved, the mode is rotation and no pass starts', () => {
    const state = {
      routines: [{ id: 'a', name: 'A' }],
      queue: { ids: ['a'], since: 5, startsOn: '2026-11-01', label: 'Plan' },
      week: { 2: ['a'] },
      dayPlan: { '2026-11-12': 'a' },
    }
    const result = switchToRotation(state, replayNow)
    expectValue(result)
    expect(result.scheduleMode).toBe('rotation')
    expect(result.rotation).toBeNull()
    expect(result.queue).toEqual({ ids: ['a'], since: 5, startsOn: '2026-11-01', label: 'Plan' })
    expect(result.week).toEqual({ 2: ['a'] })
    expect(result.dayPlan).toEqual({ '2026-11-12': 'a' })
  })

  test('a malformed queue is left alone and the mode is still rotation', () => {
    const result = switchToRotation({
      routines: [{ id: 'a', name: 'A' }],
      rotation: { id: 'r', sequence: ['a'], label: 'L' },
      queue: { ids: ['gone'], since: 1 },
      week: {},
    }, replayNow)
    expect(result.scheduleMode).toBe('rotation')
    expect(result.queue).toEqual({ ids: ['gone'], since: 1 })
    expect(result.rotation).toEqual({ id: 'r', sequence: ['a'], label: 'L' })
  })

  test('a saved sequence starts a pass today, from the routines that still exist', () => {
    const now = localNoon(2031, 0, 15)
    const state = {
      routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rotation: { id: 'r1', sequence: ['b', 'gone', 'a', 'b'], label: 'Split' },
      week: { 0: ['a'] },
    }
    const before = JSON.stringify(state)
    const result = switchToRotation(state, now)
    expect(JSON.stringify(state)).toBe(before)
    expectValue(result)
    expect(result.scheduleMode).toBe('rotation')
    expect(result.queue).toEqual({
      ids: ['b', 'a'],
      since: now,
      startsOn: format.isoOf(new Date(now)),
      label: 'Split',
      rotationId: 'r1',
    })
    expect(result.week).toEqual({ 0: ['a'] })
    expect(result.dayPlan).toEqual({})
    expect(result.rotation).toEqual(state.rotation)
  })
})

describe('saveLoop', () => {
  test('an empty list is refused and the state is left alone', () => {
    const state = placeFixture()
    const before = JSON.stringify(state)
    expect(saveLoop(state, [], 'Loop', replayNow)).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })

  test('the first save creates a rotation whose pass carries that same id', () => {
    const now = localNoon(2031, 0, 15, 23)
    const ids = ['a', 'b']
    const result = saveLoop({
      routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      week: { 4: ['b'] },
    }, ids, 'Mine', now)
    ids.push('c')
    expectValue(result)
    expect(result.scheduleMode).toBeNull()
    expect(result.rotation.sequence).toEqual(['a', 'b'])
    expect(result.rotation.label).toBe('Mine')
    expect(result.queue.rotationId).toBe(result.rotation.id)
    expect(result.queue).toMatchObject({
      ids: ['a', 'b'],
      since: now,
      startsOn: format.isoOf(new Date(now)),
      label: 'Mine',
    })
    expect(result.week).toEqual({ 4: ['b'] })
    expect(result.dayPlan).toEqual({})
  })

  test('an ordinary edit keeps the pass, including strict, and drops a removed routine\'s pin from today on', () => {
    const now = localNoon(2026, 10, 11, 23)
    const today = format.isoOf(new Date(now))
    const dayBefore = format.isoOf(new Date(2026, 10, 10, 23))
    const dayAfter = format.isoOf(new Date(2026, 10, 12, 23))
    const state = {
      routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
      rotation: { id: 'r', sequence: ['a', 'b', 'c'], label: 'Old' },
      queue: { ids: ['a', 'b', 'c'], since: 111, startsOn: '2026-10-01', rotationId: 'r', label: 'Old', strict: true },
      scheduleMode: 'rotation',
      week: {},
      dayPlan: { [dayBefore]: 'c', [today]: 'c', [dayAfter]: 'a' },
      workouts: [],
    }
    const result = saveLoop(state, ['b', 'a'], 'Renamed', now)
    expectValue(result)
    expect(result.rotation).toEqual({ id: 'r', sequence: ['b', 'a'], label: 'Renamed' })
    expect(result.queue).toEqual({
      ids: ['b', 'a'],
      since: 111,
      startsOn: '2026-10-01',
      label: 'Renamed',
      rotationId: 'r',
      strict: true,
    })
    expect(result.dayPlan).toEqual({ [dayBefore]: 'c', [dayAfter]: 'a' })
    expect(result.scheduleMode).toBe('rotation')
  })

  test('adding a routine is built on the replayed queue, not the stored one', () => {
    const state = placeFixture()
    const before = JSON.stringify(state)
    const saved = saveLoop(state, ['a', 'b', 'c'], 'Loop', replayNow)
    expect(JSON.stringify(state)).toBe(before)
    expectValue(saved)
    const stored = JSON.parse(before)
    rotation.saveRotation(stored, ['a', 'b', 'c'], 'Loop', format.isoOf(new Date(replayNow)), replayNow)
    expect(
      saved.queue.since !== stored.queue.since
      || saved.queue.startsOn !== stored.queue.startsOn
      || JSON.stringify(saved.queue.ids) !== JSON.stringify(stored.queue.ids),
    ).toBe(true)
    expect(queue.queueRemaining(stored)[0]).toBe('c')
    expect(queue.queueRemaining({ ...state, queue: saved.queue, rotation: saved.rotation })[0]).toBe('b')
    expect(saved.rotation).toEqual({ id: 'rot', sequence: ['a', 'b', 'c'], label: 'Loop' })
  })
})

describe('startOver', () => {
  test('an open session is refused before the state is cloned', () => {
    const state = {
      marker: 1,
      routines: [{ id: 'a', name: 'A' }],
      rotation: { id: 'r', sequence: ['a'], label: 'L' },
    }
    state.self = state
    expect(startOver(state, { sessionOpen: true, now: replayNow })).toBeNull()
    expect(state.marker).toBe(1)
    expect(state.queue).toBeUndefined()
  })

  test('no saved sequence is refused', () => {
    const now = localNoon(2031, 0, 15)
    const state = { routines: [{ id: 'a', name: 'A' }], rotation: { id: 'r', sequence: ['gone'], label: 'L' }, queue: null }
    const before = JSON.stringify(state)
    expect(startOver({ routines: [{ id: 'a', name: 'A' }] }, { sessionOpen: false, now })).toBeNull()
    expect(startOver(state, { sessionOpen: false, now })).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })

  test('starts the saved sequence now, strict, and the caller\'s queue stays', () => {
    const now = localNoon(2031, 0, 15, 23)
    const state = {
      scheduleMode: 'rotation',
      routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rotation: { id: 'r', sequence: ['a', 'gone', 'b'], label: 'Split' },
      queue: { ids: ['a', 'b'], since: 1, startsOn: '2026-01-01', rotationId: 'r', label: 'Split' },
      week: { 1: ['a'] },
      dayPlan: {},
      workouts: [],
    }
    const queueRef = state.queue
    const result = startOver(state, { sessionOpen: false, now })
    expect(state.queue).toBe(queueRef)
    expectValue(result)
    expect(result.scheduleMode).toBe('rotation')
    expect(result.rotation).toEqual(state.rotation)
    expect(result.queue).toEqual({
      ids: ['a', 'b'],
      since: now,
      startsOn: format.isoOf(new Date(now)),
      label: 'Split',
      rotationId: 'r',
      strict: true,
    })
    expect(result.week).toEqual({ 1: ['a'] })
    expect(result.dayPlan).toEqual({})
  })
})

describe('stopLoop', () => {
  test('stops the pass on the replay: the queue is null and the in-between pin is gone', () => {
    const state = placeFixture()
    const before = JSON.stringify(state)
    const result = stopLoop(state, replayNow)
    expect(JSON.stringify(state)).toBe(before)
    expectValue(result)
    expect(result.queue).toBeNull()
    expect(result.scheduleMode).toBe('rotation')
    expect(result.rotation).toEqual({ id: 'rot', sequence: ['a', 'b'], label: 'Loop' })
    expect(result.week).toEqual({ 1: ['a'] })
    expect(result.dayPlan).toEqual({ '2026-11-01': 'a', '2026-11-08': 'c' })
  })

  test('with no pass, the queue is null and a pin is left where it was', () => {
    const result = stopLoop({ dayPlan: { '2026-11-12': 'a' }, week: { 1: ['a'] } }, replayNow)
    expectValue(result)
    expect(result).toEqual({
      scheduleMode: null,
      rotation: null,
      queue: null,
      week: { 1: ['a'] },
      dayPlan: { '2026-11-12': 'a' },
    })
  })
})

describe('setWeekday', () => {
  test('stores a list on a weekday, and leaves the stored queue where it was', () => {
    const state = placeFixture()
    const ids = ['b', 'a']
    const before = JSON.stringify(state)
    const result = setWeekday(state, 3, ids)
    ids.push('c')
    expect(JSON.stringify(state)).toBe(before)
    expect(state.week).not.toBe(result.week)
    expectValue(result)
    expect(result.week).toEqual({ 1: ['a'], 3: ['b', 'a'] })
    expect(result.queue).toEqual(state.queue)
    expect(result.dayPlan).toEqual(state.dayPlan)
    expect(result.scheduleMode).toBe('rotation')
    expect(result.rotation).toEqual(state.rotation)
  })

  test('null or an empty list deletes the weekday and never writes an empty list', () => {
    const state = { scheduleMode: 'week', week: { 1: ['a'], 3: ['b'] }, dayPlan: { '2026-11-12': 'a' } }
    for (const ids of [null, []]) {
      const result = setWeekday(state, 1, ids)
      expectValue(result)
      expect(result.week).toEqual({ 3: ['b'] })
      expect(result.week[1]).toBeUndefined()
      expect(Object.values(result.week).some(value => Array.isArray(value) && value.length === 0)).toBe(false)
    }
    expect(state.week).toEqual({ 1: ['a'], 3: ['b'] })
  })

  test('Sunday and Saturday are days, and a missing week becomes a map', () => {
    expect(setWeekday({ scheduleMode: 'week' }, 0, ['sun']).week).toEqual({ 0: ['sun'] })
    expect(setWeekday({}, 6, ['sat']).week).toEqual({ 6: ['sat'] })
  })

  test('a day outside 0 through 6, or a list that is not a list, is refused', () => {
    const state = { week: { 1: ['a'] } }
    const before = JSON.stringify(state)
    for (const day of [-1, 7, 1.5, '1', null, undefined]) expect(setWeekday(state, day, ['b'])).toBeNull()
    for (const ids of ['a', {}]) expect(setWeekday(state, 1, ids)).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('setDate', () => {
  const today = '2026-11-20'

  test('stores rest or a routine on one of the next 14 dates, and keeps the stored queue', () => {
    const state = placeFixture()
    const before = JSON.stringify(state)
    const rest = setDate(state, '2026-11-22', 'rest', { today: '2026-11-09' })
    const pinned = setDate(state, '2026-12-03', 'c', { today })
    expect(JSON.stringify(state)).toBe(before)
    expectValue(rest)
    expect(rest.dayPlan['2026-11-22']).toBe('rest')
    expect(rest.dayPlan['2026-11-03']).toBe('b')
    expect(rest.queue.since).toBe(since0)
    expect(rest.queue.startsOn).toBe('2026-11-01')
    expect(rest.queue.ids).toEqual(['a', 'b'])
    expect(pinned.dayPlan['2026-12-03']).toBe('c')
    expect(pinned.scheduleMode).toBe('rotation')
    expect(pinned.week).toEqual({ 1: ['a'] })
  })

  test('today and the 13th day are inside; the day before and the 14th day are refused', () => {
    expect(setDate({}, today, 'a', { today }).dayPlan[today]).toBe('a')
    expect(setDate({}, '2026-12-03', 'rest', { today }).dayPlan['2026-12-03']).toBe('rest')
    expect(setDate({}, '2026-11-19', 'a', { today })).toBeNull()
    expect(setDate({}, '2026-12-04', 'a', { today })).toBeNull()
  })

  test('null deletes the date and never writes an empty list', () => {
    const state = { dayPlan: { '2026-11-21': 'a', '2026-11-22': 'b' }, week: { 1: ['a'] } }
    const result = setDate(state, '2026-11-21', null, { today })
    expectValue(result)
    expect(result.dayPlan).toEqual({ '2026-11-22': 'b' })
    expect(result.dayPlan['2026-11-21']).toBeUndefined()
    expect(state.dayPlan).toEqual({ '2026-11-21': 'a', '2026-11-22': 'b' })
  })

  test('a date that is not one of those 14, or a pin that is not rest or text, is refused', () => {
    const state = { dayPlan: { '2026-11-21': 'a' } }
    const before = JSON.stringify(state)
    for (const iso of ['2026-11-31', '2026-11-20extra', 'nope', '']) expect(setDate(state, iso, 'a', { today })).toBeNull()
    for (const pin of [[], '', {}, 1]) expect(setDate(state, '2026-11-21', pin, { today })).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })
})
